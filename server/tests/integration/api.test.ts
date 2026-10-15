import { Prisma, type PrismaClient } from '@prisma/client';
import { createPrismaClient } from '../../src/infrastructure/database/prisma-client.js';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient, MongoNetworkError, ObjectId, type Db } from 'mongodb';
import request from 'supertest';
import { pino } from 'pino';
import { createApp } from '../../src/app.js';
import { compose } from '../../src/composition-root.js';
import { spawnSync } from 'node:child_process';
import { PrismaUnitOfWork } from '../../src/infrastructure/database/prisma-unit-of-work.js';
import { PrismaEventRepository } from '../../src/modules/events/infrastructure/prisma-event-repository.js';
import { payload, apiKey } from '../fixtures.js';

let mongo: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;
let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
const logger = pino({ level: 'silent' });

before(async () => {
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  client = await new MongoClient(mongo.getUri()).connect();
  db = client.db('staypulse_isolated_test');
  const testUri = mongo.getUri('staypulse_isolated_test');
  const push = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'db', 'push'],
    { env: { ...process.env, MONGODB_URI: testUri }, encoding: 'utf8' },
  );
  assert.equal(push.status, 0, push.stderr);
  prisma = createPrismaClient(testUri);
  await prisma.$connect();
  app = createApp(compose(prisma), { apiKey, logger });
});
after(async () => {
  await prisma?.$disconnect();
  await client?.close();
  await mongo?.stop();
});

beforeEach(async () => {
  for (const name of [
    'events',
    'reservations',
    'webhook_deliveries',
    'conflict_alerts',
    'property_guards',
  ]) {
    await db.collection(name).deleteMany({});
  }
});

const post = (body: unknown) =>
  request(app)
    .post('/webhooks/reservations')
    .set('X-API-Key', apiKey)
    .send(body as object);

const get = (path: string) =>
  request(app).get(path).set('X-API-Key', apiKey);

test('deduplica entregas concorrentes, registra inconsistência e preserva resultado concluído', async () => {
  const results = await Promise.all(
    Array.from({ length: 8 }, () => post(payload).expect(201)),
  );
  assert.equal(new Set(results.map(r => r.body.data.id)).size, 1);
  assert.equal(await prisma.reservationEvent.count(), 1);
  assert.equal(await prisma.webhookDelivery.count(), 8);
  await post({ ...payload, sourceVersion: 2 }).expect(409);
  assert.equal(await prisma.webhookDelivery.count({ where: { outcome: 'inconsistent' } }), 1);
  await compose(prisma).processEvents.execute();
  assert.equal((await post(payload)).body.data.status, 'completed');
  assert.equal(await prisma.reservation.count(), 1);
});

test('rejeita autenticação, JSON malformado, tamanho e contrato sem gravar', async () => {
  for (const route of ['/events', '/reservations']) {
    await request(app).get(route).expect(401);
  }
  await request(app).post('/webhooks/reservations').send(payload).expect(401);
  await request(app).post('/webhooks/reservations').set('X-API-Key', 'incorrect').send(payload).expect(401);
  const malformed = await request(app).post('/webhooks/reservations').set('X-API-Key', apiKey).set('Content-Type', 'application/json').send('{').expect(400);
  assert.equal(malformed.body.error.code, 'INVALID_JSON');
  assert.equal(malformed.body.error.requestId, malformed.headers['x-request-id']);
  await post({ ...payload, padding: 'x'.repeat(70_000) }).expect(413);
  await post({ ...payload, reservation: { ...payload.reservation, checkOut: '2026-11-09' } }).expect(422);
  await post({ ...payload, type: 'reservation.updated', reservation: { reservationId: 'res-101' } }).expect(422);
  await post({ ...payload, type: 'reservation.cancelled' }).expect(422);
  assert.equal(await db.collection('events').countDocuments(), 0);
});

test('filtros e paginação estável de eventos com datas iguais', async () => {
  for (let i = 0; i < 5; i++) {
    await post({
      ...payload,
      eventId: `evt-${i}`,
      source: i === 4 ? 'booking-demo' : 'airbnb-demo',
    }).expect(201);
  }
  await db.collection('events').updateMany({}, { $set: { receivedAt: new Date('2026-10-14T12:00:00Z') } });
  let cursor: string | null = null;
  const ids: string[] = [];
  do {
    const result: request.Response = await get(
      `/events?limit=2&source=airbnb-demo${cursor ? `&cursor=${cursor}` : ''}`,
    ).expect(200);
    ids.push(...result.body.data.map((e: { id: string }) => e.id));
    cursor = result.body.pagination.nextCursor;
  } while (cursor);
  assert.equal(ids.length, 4);
  assert.equal(new Set(ids).size, 4);
  assert.deepEqual(ids, [...ids].sort().reverse());
  for (const filter of [
    'propertyId=prop-17',
    'reservationId=res-101',
    'type=reservation.created',
  ]) {
    assert.equal(
      (await get(`/events?${filter}`)).body.data.length,
      5,
    );
  }
  assert.equal((await get('/events?propertyId=missing')).body.data.length, 0);
  for (const query of [
    'limit=101',
    'limit=0',
    'limit=1.5',
    'cursor=broken',
    'source=a&source=b',
    'unknown=1',
  ]) {
    await get(`/events?${query}`).expect(422);
  }
});

test('consulta reservas reais de teste, filtra e pagina sem alterar seu estado', async () => {
  const rows = Array.from({ length: 4 }, (_, i) => ({
    _id: new ObjectId(),
    ...payload.reservation,
    checkIn: new Date(payload.reservation.checkIn),
    checkOut: new Date(payload.reservation.checkOut),
    sourceVersion: 1,
    stateHash: 'fixture',
    reservationId: `res-${i}`,
    source: i === 3 ? 'booking-demo' : 'airbnb-demo',
    status: i === 3 ? 'cancelled' : 'confirmed',
    updatedAt: new Date('2026-10-14T12:00:00Z'),
  }));
  await db.collection('reservations').insertMany(rows);
  const first = await get('/reservations?limit=2&source=airbnb-demo&status=confirmed&propertyId=prop-17').expect(200);
  assert.equal(first.body.data.length, 2);
  const second = await get(`/reservations?limit=2&source=airbnb-demo&status=confirmed&propertyId=prop-17&cursor=${first.body.pagination.nextCursor}`).expect(200);
  assert.equal(second.body.data.length, 1);
  assert.equal(second.body.pagination.hasMore, false);
  assert.equal(new Set([...first.body.data, ...second.body.data].map(r => r.id)).size, 3);
  assert.equal((await get('/reservations?status=cancelled')).body.data.length, 1);
  const prior = await db.collection('reservations').find().toArray();
  await post(payload).expect(201);
  assert.deepEqual(await db.collection('reservations').find().toArray(), prior);
});

test('falha de banco retorna 503 e erro inesperado retorna 500 sem detalhes internos', async () => {
  for (const [error, status, code] of [
    [
      new Prisma.PrismaClientKnownRequestError('secret', {
        code: 'P1001',
        clientVersion: '6.19.0',
      }),
      503,
      'DATABASE_UNAVAILABLE',
    ],
    [
      new MongoNetworkError('secret database connection'),
      503,
      'DATABASE_UNAVAILABLE',
    ],
    [
      new Error('secret implementation detail'),
      500,
      'INTERNAL_ERROR',
    ],
  ] as const) {
    const cases = compose(prisma);
    cases.receiveWebhook.execute = async () => { throw error; };
    cases.listEvents.execute = async () => { throw error; };
    const failing = createApp(cases, { apiKey, logger });
    const result = await request(failing).post('/webhooks/reservations').set('X-API-Key', apiKey).send(payload).expect(status);
    assert.equal(result.body.error.code, code);
    assert.ok(!JSON.stringify(result.body).includes('secret'));
    await request(failing).get('/events').set('X-API-Key', apiKey).expect(status);
  }
  assert.equal(await db.collection('events').countDocuments(), 0);
});

const drain = async () => {
  for (
    let i = 0;
    i < 30 && await compose(prisma).processEvents.execute();
    i++
  );
};

const send = async (event: object) => {
  await post(event).expect(201);
  await drain();
};

test('ordena snapshots, mantém cancelamento terminal e propriedade imutável', async () => {
  await send({
    ...payload,
    eventId: 'update-first',
    sourceVersion: 3,
    type: 'reservation.updated',
    reservation: {
      ...payload.reservation,
      checkOut: '2026-11-20',
    },
  });
  assert.equal(
    (await prisma.reservationEvent.findFirst())?.status,
    'pending_reference',
  );
  await send(payload);
  let row = await prisma.reservation.findFirstOrThrow();
  assert.equal(row.sourceVersion, 3);
  assert.equal(row.checkOut.toISOString().slice(0, 10), '2026-11-20');
  await send({
    ...payload,
    eventId: 'old',
    sourceVersion: 2,
    type: 'reservation.updated',
  });
  await send({
    ...payload,
    eventId: 'same-bad',
    sourceVersion: 3,
    type: 'reservation.updated',
  });
  await send({
    ...payload,
    eventId: 'move',
    sourceVersion: 4,
    type: 'reservation.updated',
    reservation: { ...payload.reservation, propertyId: 'another' },
  });
  await send({
    ...payload,
    eventId: 'cancel',
    sourceVersion: 4,
    type: 'reservation.cancelled',
    reservation: { reservationId: 'res-101', status: 'cancelled' },
  });
  await send({
    ...payload,
    eventId: 'reactivate',
    sourceVersion: 5,
    type: 'reservation.updated',
  });
  row = await prisma.reservation.findFirstOrThrow();
  assert.equal(row.status, 'cancelled');
  assert.equal(row.sourceVersion, 4);
  assert.equal(
    await prisma.reservationEvent.count({ where: { status: 'rejected' } }),
    3,
  );
  assert.equal(
    await prisma.reservationEvent.count({ where: { status: 'ignored' } }),
    1,
  );
});

test('coordena criações concorrentes por propriedade e resolve/reabre alerta com histórico', async () => {
  await post(payload);
  await post({ ...payload, eventId: 'other', source: 'booking' });
  await Promise.all([
    compose(prisma).processEvents.execute(),
    compose(prisma).processEvents.execute(),
  ]);
  await drain();
  assert.equal(await prisma.reservation.count(), 2);
  assert.equal(await prisma.conflictAlert.count(), 1);
  const change = {
    ...payload,
    eventId: 'touch',
    sourceVersion: 2,
    type: 'reservation.updated',
    reservation: {
      ...payload.reservation,
      checkIn: '2026-11-15',
      checkOut: '2026-11-18',
    },
  };
  await send(change);
  assert.equal(
    (await prisma.conflictAlert.findFirstOrThrow()).status,
    'resolved',
  );
  await send({
    ...payload,
    eventId: 'reopen',
    sourceVersion: 3,
    type: 'reservation.updated',
  });
  const alert = await prisma.conflictAlert.findFirstOrThrow();
  assert.equal(alert.status, 'open');
  assert.equal((alert.history as unknown[]).length, 3);
  await send({
    ...payload,
    eventId: 'cancel',
    sourceVersion: 4,
    type: 'reservation.cancelled',
    reservation: { reservationId: 'res-101', status: 'cancelled' },
  });
  assert.equal(
    (await prisma.conflictAlert.findFirstOrThrow()).status,
    'resolved',
  );
});
test('rollback desfaz reserva e alerta; token antigo não pode finalizar lease reassumida', async () => {
  await post(payload);
  const events = new PrismaEventRepository(prisma);
  const first = await events.claim(new Date());
  assert.ok(first);
  await prisma.reservationEvent.update({
    where: { id: first.id },
    data: { leaseUntil: new Date(0) },
  });
  const second = await events.claim(new Date());
  assert.ok(second);
  assert.notEqual(first.leaseToken, second.leaseToken);
  await assert.rejects(
    events.finish(
      first.id,
      first.leaseToken,
      'completed',
      'stale',
      new Date(),
    ),
  );
  const uow = new PrismaUnitOfWork(prisma);
  await assert.rejects(
    uow.execute(async ({
      reservations,
      alerts,
      events: txEvents,
      lockProperty,
    }) => {
      await lockProperty('prop-17');
      const saved = await reservations.save({
        ...payload.reservation,
        source: payload.source,
        sourceVersion: 1,
        stateHash: 'test',
        updatedAt: new Date(),
      });
      await alerts.reconcile(
        saved.id,
        saved.propertyId,
        ['000000000000000000000001'],
        new Date(),
      );
      await txEvents.finish(
        first.id,
        first.leaseToken,
        'completed',
        'stale',
        new Date(),
      );
    }),
  );
  assert.equal(await prisma.reservation.count(), 0);
  assert.equal(await prisma.conflictAlert.count(), 0);
  assert.equal(
    (await prisma.reservationEvent.findFirstOrThrow()).leaseToken,
    second.leaseToken,
  );
  await events.finish(
    second.id,
    second.leaseToken,
    'received',
    'retry',
    new Date(),
  );
  await drain();
  assert.equal(
    (await prisma.reservationEvent.findFirstOrThrow()).status,
    'completed',
  );
});

test('duas transações simultâneas da mesma propriedade detectam conflito após retry', async () => {
  const { ProcessEvents } = await import(
    '../../src/modules/events/application/process-events.js'
  );
  await post(payload);
  await post({ ...payload, source: 'booking', eventId: 'parallel' });
  const events = new PrismaEventRepository(prisma);
  const a = await events.claim(new Date());
  const b = await events.claim(new Date());
  assert.ok(a);
  assert.ok(b);
  assert.notEqual(a.id, b.id);
  const worker = (event: typeof a) =>
    new ProcessEvents(
      {
        claim: async () => event,
        finish: events.finish.bind(events),
        wake: events.wake.bind(events),
      },
      new PrismaUnitOfWork(prisma),
    );
  await Promise.all([worker(a).execute(), worker(b).execute()]);
  assert.equal(
    await prisma.reservationEvent.count({ where: { status: 'completed' } }),
    2,
  );
  assert.equal(
    await prisma.conflictAlert.count({ where: { status: 'open' } }),
    1,
  );
});

test('preserva JSON original e consulta entregas paginadas e histórico', async () => {
  const original = {
    ...payload,
    reservation: { ...payload.reservation, propertyId: ' prop-17 ' },
  };
  const result = await post(original).expect(201);
  await post(original).expect(201);
  await drain();
  const deliveries = await get(
    `/events/${result.body.data.id}/deliveries?limit=1`,
  ).expect(200);
  assert.equal(deliveries.body.pagination.hasMore, true);
  assert.equal(
    deliveries.body.data[0].payload.reservation.propertyId,
    ' prop-17 ',
  );
  const timeline = await get(
    '/events?source=airbnb-demo&reservationId=res-101',
  ).expect(200);
  assert.equal(timeline.body.data[0].history.at(-1).status, 'completed');
  assert.equal(
    timeline.body.data[0].originalPayload.reservation.propertyId,
    ' prop-17 ',
  );
  await get('/events/not-an-object-id/deliveries').expect(422);
  await get('/alerts?propertyId=prop-17').expect(200);
});

test('migração preserva entregas antigas, arquiva duplicatas e é reexecutável', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const folder = mkdtempSync(join(tmpdir(), 'staypulse-migration-test-'));
  const migrationDb = client.db('staypulse_migration_test');

  try {
    const ids = [new ObjectId(), new ObjectId(), new ObjectId()];
    const { sourceVersion: _version, ...legacyPayload } = payload;
    void _version;
    await migrationDb.collection('events').insertMany(
      ids.map((_id, i) => ({
        _id,
        eventId: payload.eventId,
        schemaVersion: 1,
        type: payload.type,
        source: payload.source,
        reservationId: payload.reservation.reservationId,
        propertyId: payload.reservation.propertyId,
        occurredAt: new Date(payload.occurredAt),
        receivedAt: new Date(),
        status: 'received',
        payload: i === 2
          ? {
            ...legacyPayload,
            reservation: {
              ...payload.reservation,
              checkOut: '2026-11-19',
            },
          }
          : legacyPayload,
        requestId: `old-${i}`,
      })),
    );
    const map = join(folder, 'versions.json');
    writeFileSync(
      map,
      JSON.stringify(
        Object.fromEntries(ids.map(id => [id.toHexString(), 1])),
      ),
    );
    const run = (...args: string[]) =>
      spawnSync(
        process.execPath,
        ['--import', 'tsx', 'scripts/data-migrations/001-events.ts', ...args],
        {
          env: {
            ...process.env,
            MONGODB_URI: mongo.getUri('staypulse_migration_test'),
          },
          encoding: 'utf8',
        },
      );
    assert.equal(run().status, 0);
    assert.equal(await migrationDb.collection('events').countDocuments(), 3);
    const applied = run(`--versions=${map}`, '--apply');
    assert.equal(applied.status, 0, applied.stderr);
    assert.equal(await migrationDb.collection('events').countDocuments(), 1);
    assert.equal(
      await migrationDb
        .collection('events_stage1_archive')
        .countDocuments(),
      3,
    );
    assert.equal(
      await migrationDb.collection('webhook_deliveries').countDocuments(),
      3,
    );
    assert.equal(
      await migrationDb
        .collection('webhook_deliveries')
        .countDocuments({ outcome: 'inconsistent' }),
      1,
    );
    assert.equal(run('--apply').status, 0);
  } finally {
    await migrationDb.dropDatabase();
    rmSync(folder, { recursive: true, force: true });
  }
});

test('falhas transitórias reagendam com backoff e falhas repetidas chegam ao limite', async () => {
  const { ProcessEvents } = await import(
    '../../src/modules/events/application/process-events.js'
  );
  await post(payload);
  const events = new PrismaEventRepository(prisma);
  const worker = new ProcessEvents(events, {
    execute: async () => {
      throw new Error('injected rollback');
    },
  });
  await worker.execute();
  let event = await prisma.reservationEvent.findFirstOrThrow();
  assert.equal(event.status, 'received');
  assert.equal(event.reason, 'processing_error');
  assert.ok(event.nextAttemptAt.getTime() > Date.now());
  assert.equal(await worker.execute(), false);
  await prisma.reservationEvent.update({
    where: { id: event.id },
    data: { nextAttemptAt: new Date(0), attempts: 7 },
  });
  await worker.execute();
  event = await prisma.reservationEvent.findFirstOrThrow();
  assert.equal(event.status, 'failed');
  assert.equal(event.attempts, 8);
  assert.equal(await prisma.reservation.count(), 0);
});
