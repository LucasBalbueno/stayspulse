import { Api } from "./api";
import { waitEvent } from "./polling";
import type { Event, Payload } from "./types";
export type DemoKind = "delayed" | "ordering" | "conflict" | "duplicate";
export interface DemoRun {
  id: string;
  source: string;
  propertyId: string;
  a: string;
  b: string;
  kind: DemoKind;
}
export function futureDate(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function newRun(kind: DemoKind): DemoRun {
  const id = crypto.randomUUID();
  return {
    id,
    source: `demo-${id}`,
    propertyId: `prop-${id}`,
    a: `res-A-${id}`,
    b: `res-B-${id}`,
    kind,
  };
}
export async function runDemo(
  api: Api,
  run: DemoRun,
  signal: AbortSignal,
  log: (text: string) => void,
  observe: (event: Event) => void,
  refresh: () => Promise<void>,
) {
  const snapshot = (
    eventId: string,
    reservationId: string,
    version: number,
    type: "reservation.created" | "reservation.updated",
    start: number,
    end: number,
  ): Payload => ({
    eventId: `${eventId}-${run.id}`,
    source: run.source,
    sourceVersion: version,
    type,
    occurredAt: new Date().toISOString(),
    reservation: {
      reservationId,
      propertyId: run.propertyId,
      checkIn: futureDate(start),
      checkOut: futureDate(end),
      status: "confirmed",
    },
  });
  const send = async (payload: Payload, expected = "completed") => {
    if (signal.aborted)
      throw new Error(
        "Apresentação interrompida. Os registros foram preservados.",
      );
    const receipt = await api.post(payload, signal);
    log(
      `HTTP 201 · ${payload.eventId} · recebido pela API; estado retornado: ${receipt.data.status}.`,
    );
    const event = await waitEvent(api, payload, signal, observe, expected);
    log(
      `${payload.eventId} → ${event.status} · ${event.reason ?? "sem motivo"}`,
    );
    await refresh();
    return event;
  };
  if (run.kind === "conflict") {
    const a = snapshot("create-A", run.a, 1, "reservation.created", 30, 35);
    await send(a);
    await send(snapshot("create-B", run.b, 1, "reservation.created", 33, 38));
    const opened = (await api.alerts(run.propertyId, signal)).data.find(
      (a) => a.status === "open",
    );
    if (!opened)
      throw new Error(
        "O processamento terminou, mas o alerta aberto não foi encontrado.",
      );
    log(
      `Alerta ${opened.id} aberto: sobreposição confirmada. Nenhuma reserva foi cancelada automaticamente.`,
    );
    await send({
      eventId: `cancel-B-${run.id}`,
      source: run.source,
      sourceVersion: 2,
      occurredAt: new Date().toISOString(),
      type: "reservation.cancelled",
      reservation: {
        reservationId: run.b,
        propertyId: run.propertyId,
        status: "cancelled",
      },
    });
    const resolved = (await api.alerts(run.propertyId, signal)).data.find(
      (a) => a.id === opened.id,
    );
    if (
      resolved?.status !== "resolved" ||
      !resolved.history.some((h) => h.status === "open") ||
      !resolved.history.some((h) => h.status === "resolved")
    )
      throw new Error(
        "A resolução com histórico ainda não foi confirmada pela API.",
      );
    log(
      `Alerta ${resolved.id} resolvido. Histórico de abertura e resolução preservado.`,
    );
  } else if (run.kind === "duplicate") {
    const a = snapshot("create-A", run.a, 1, "reservation.created", 30, 35);
    const original = await send(a);
    const before = await api.deliveries(original.id, undefined, signal);
    const duplicate = await send(a);
    const after = await api.deliveries(original.id, undefined, signal);
    if (
      original.id !== duplicate.id ||
      !after.data.some(
        (d) => !before.data.some((previous) => previous.id === d.id),
      )
    )
      throw new Error(
        "A API não confirmou a reutilização do evento com uma nova entrega.",
      );
    log(
      `Idempotência comprovada: evento interno ${original.id} reutilizado; nova entrega ${after.data[0].id}.`,
    );
    const reservations = await api.reservations({ source: run.source }, signal);
    if (reservations.data.length !== 1 || reservations.data[0].sourceVersion !== 1)
      throw new Error("O reenvio alterou ou duplicou a reserva.");
    log("Reenvio confirmado: um único evento, uma única reserva e duas entregas.");
  } else if (run.kind === "ordering") {
    const update = snapshot("update", run.a, 2, "reservation.updated", 32, 38);
    await send(update, "pending_reference");
    log(
      "Referência pendente observada. Este estado não é final; a criação será enviada agora para permitir a reavaliação.",
    );
    await send(snapshot("create", run.a, 1, "reservation.created", 30, 35));
    await waitEvent(api, update, signal, observe, "completed");
    const reservations = await api.reservations(
      { source: run.source, propertyId: run.propertyId, limit: 100 },
      signal,
    );
    const latest = reservations.data.find((r) => r.reservationId === run.a);
    if (latest?.sourceVersion !== 2 || latest.checkOut !== futureDate(38))
      throw new Error(
        "O snapshot mais recente ainda não foi confirmado na reserva.",
      );
    log(
      `Reavaliação confirmada: reserva ${latest.reservationId}, versão ${latest.sourceVersion}, ${latest.checkIn} → ${latest.checkOut}.`,
    );
  } else {
    log("Criando a reserva na versão 1 e aplicando uma atualização na versão 2.");
    await send(snapshot("create", run.a, 1, "reservation.created", 30, 35));
    await send(snapshot("update", run.a, 2, "reservation.updated", 32, 38));
    log("Enviando uma atualização atrasada, na versão 0, com datas antigas.");
    await send(snapshot("old", run.a, 0, "reservation.updated", 30, 34), "ignored");
    const reservations = await api.reservations({ source: run.source }, signal);
    const latest = reservations.data.find((r) => r.reservationId === run.a);
    if (latest?.sourceVersion !== 2 || latest.checkIn !== futureDate(32) || latest.checkOut !== futureDate(38))
      throw new Error("A atualização atrasada alterou o estado mais recente da reserva.");
    log("Versão antiga ignorada: reserva preservada na versão 2, com as datas mais recentes.");
  }
  await refresh();
  log(
    "Cenário concluído com respostas reais. Registros preservados para consulta.",
  );
}
