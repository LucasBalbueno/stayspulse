// Uses only an isolated replica set and a random, in-memory key. Never reads server/.env.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { MongoMemoryReplSet } from "../../server/node_modules/mongodb-memory-server/index.js";
import pino from "../../server/node_modules/pino/pino.js";
import { createPrismaClient } from "../../server/src/infrastructure/database/prisma-client.ts";
import { createApp } from "../../server/src/app.ts";
import { compose } from "../../server/src/composition-root.ts";
import { Api, ApiError, validBaseUrl } from "../src/api.ts";
import { newRun, runDemo, futureDate } from "../src/demo.ts";
import { waitEvent } from "../src/polling.ts";
import type { Payload } from "../src/types.ts";
let mongo: MongoMemoryReplSet;
let prisma: ReturnType<typeof createPrismaClient>;
let http: ReturnType<ReturnType<typeof createApp>["listen"]>;
let api: Api;
let base: string;
let stop = false;
let worker: Promise<void>;
const key = randomUUID();
before(async () => {
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  const uri = mongo.getUri("staypulse_frontend_test");
  const cwd = fileURLToPath(new URL("../../server", import.meta.url));
  const push = spawnSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "db", "push"],
    { cwd, env: { ...process.env, MONGODB_URI: uri }, encoding: "utf8" },
  );
  assert.equal(push.status, 0, push.stderr);
  prisma = createPrismaClient(uri);
  await prisma.$connect();
  const useCases = compose(prisma);
  http = createApp(useCases, {
    apiKey: key,
    logger: pino({ level: "silent" }),
  }).listen(0, "127.0.0.1");
  await once(http, "listening");
  const address = http.address();
  assert(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
  api = new Api(base, key);
  worker = (async () => {
    while (!stop) {
      await useCases.processEvents.execute();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  })();
});
after(async () => {
  stop = true;
  await worker;
  if (http) await new Promise<void>((resolve) => http.close(() => resolve()));
  await prisma?.$disconnect();
  await mongo?.stop();
});
test("cenário de conflito abre e resolve alerta com cancelamento e histórico", async () => {
  const run = newRun("conflict"),
    logs: string[] = [];
  await runDemo(
    api,
    run,
    new AbortController().signal,
    (text) => logs.push(text),
    () => {},
    async () => {},
  );
  const events = await api.events({ source: run.source });
  assert.equal(events.data.length, 3);
  const created = events.data.find(
    (event) => event.eventId === `create-A-${run.id}`,
  )!;
  const deliveries = await api.deliveries(created.id);
  assert.equal(deliveries.data.length, 1);
  assert.deepEqual(deliveries.data.map((d) => d.outcome).sort(), [
    "accepted",
  ]);
  const alert = (await api.alerts(run.propertyId)).data[0];
  assert.equal(alert.status, "resolved");
  assert.deepEqual(
    alert.history.map((h) => h.status),
    ["open", "resolved"],
  );
  const reservations = (await api.reservations({ source: run.source })).data;
  assert.equal(
    reservations.find((r) => r.reservationId === run.b)?.status,
    "cancelled",
  );
});
test("cenário de atualização antes da criação reavalia referência pendente", async () => {
  const run = newRun("ordering"),
    states: string[] = [];
  await runDemo(
    api,
    run,
    new AbortController().signal,
    () => {},
    (event) => states.push(event.status),
    async () => {},
  );
  assert(states.includes("pending_reference"));
  assert(!states.includes("ignored"));
  const reservation = (await api.reservations({ source: run.source })).data[0];
  assert.equal(reservation.sourceVersion, 2);
  assert.equal(reservation.checkOut, futureDate(38));
  const first = await api.events({ source: run.source, limit: 1 });
  assert(first.pagination.hasMore);
  const second = await api.events({
    source: run.source,
    limit: 1,
    cursor: first.pagination.nextCursor!,
  });
  assert.notEqual(first.data[0].id, second.data[0].id);
  assert.equal(second.data[0].source, run.source);
});
test("cenário de atualização atrasada ignora versão antiga e preserva datas recentes", async () => {
  const run = newRun("delayed");
  await runDemo(api, run, new AbortController().signal, () => {}, () => {}, async () => {});
  const events = (await api.events({ source: run.source })).data;
  assert.equal(events.length, 3);
  assert.equal(events.find((event) => event.eventId === `old-${run.id}`)?.status, "ignored");
  const reservation = (await api.reservations({ source: run.source })).data[0];
  assert.equal(reservation.sourceVersion, 2);
  assert.equal(reservation.checkIn, futureDate(32));
  assert.equal(reservation.checkOut, futureDate(38));
});
test("cenário de reenvio mantém um evento e uma reserva com duas entregas", async () => {
  const run = newRun("duplicate");
  await runDemo(api, run, new AbortController().signal, () => {}, () => {}, async () => {});
  const events = (await api.events({ source: run.source })).data;
  assert.equal(events.length, 1);
  const deliveries = (await api.deliveries(events[0].id)).data;
  assert.equal(deliveries.length, 2);
  assert(deliveries.every((delivery) => delivery.outcome === "accepted"));
  const reservations = (await api.reservations({ source: run.source })).data;
  assert.equal(reservations.length, 1);
  assert.equal(reservations[0].sourceVersion, 1);
  assert.equal((await api.alerts(run.propertyId)).data.length, 0);
});
test("401 e 422 preservam status, código e requestId; URLs não aceitam credenciais", async () => {
  await assert.rejects(
    new Api(base, "").events(),
    (error: unknown) =>
      error instanceof ApiError && error.status === 401 && !!error.requestId,
  );
  await assert.rejects(
    api.post({} as Payload),
    (error: unknown) =>
      error instanceof ApiError &&
      error.status === 422 &&
      !!error.requestId &&
      !!error.details?.length,
  );
  assert(validBaseUrl("/api"));
  assert(!validBaseUrl("https://user:password@example.com"));
  assert(!validBaseUrl("https://example.com?key=anything"));
  assert(!validBaseUrl("//example.com"));
});
test("cancelar acompanhamento não desfaz o evento pendente no backend", async () => {
  const run = newRun("ordering");
  const payload: Payload = {
    eventId: run.id,
    source: run.source,
    sourceVersion: 2,
    occurredAt: new Date().toISOString(),
    type: "reservation.cancelled",
    reservation: { reservationId: run.a, status: "cancelled" },
  };
  await api.post(payload);
  await waitEvent(
    api,
    payload,
    new AbortController().signal,
    () => {},
    "pending_reference",
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    waitEvent(api, payload, controller.signal, () => {}),
    /cancelado/,
  );
  assert.equal((await api.events({ source: run.source })).data.length, 1);
});

test("proxy autentica chamadas sem chave no navegador e bloqueia outra origem", async () => {
  const { createServer } = await import("vite");
  const { createApiProxy } = await import("../server/api-proxy.ts");
  const proxy = await createServer({
    configFile: false,
    envFile: false,
    root: fileURLToPath(new URL("..", import.meta.url)),
    logLevel: "silent",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: {
      host: "127.0.0.1",
      preTransformRequests: false,
      port: 0,
      cors: false,
      proxy: createApiProxy(base, key),
    },
  });
  try {
    await proxy.listen();
    const address = proxy.httpServer!.address();
    assert(address && typeof address !== "string");
    const proxyBase = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${proxyBase}/api/events?limit=1`);
    assert.equal(response.status, 200);
    assert(Array.isArray((await response.json()).data));
    const override = await fetch(`${proxyBase}/api/events?limit=1`, {
      headers: { "X-API-Key": "invalid-browser-key" },
    });
    assert.equal(override.status, 200);
    const foreign = await fetch(`${proxyBase}/api/events`, {
      headers: { Origin: "https://unrelated.example" },
    });
    assert.equal(foreign.status, 404);
    const privateEnv = await fetch(`${proxyBase}/.env`);
    assert.notEqual(privateEnv.status, 200);
    const connection = await (
      await fetch(`${proxyBase}/src/connection.tsx`)
    ).text();
    assert(!connection.includes(key));
  } finally {
    await proxy.close();
  }
});
