import type { Api } from "./api";
import type { Event, Payload } from "./types";
export const POLL_INTERVAL = 1500;
export const POLL_TIMEOUT = 60000;
export const terminal = (status: string) =>
  ["completed", "ignored", "rejected", "failed"].includes(status);
export function pause(signal: AbortSignal, duration = POLL_INTERVAL) {
  return new Promise<void>((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      reject(
        new Error(
          "Acompanhamento cancelado. Os eventos recebidos continuam no backend.",
        ),
      );
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, duration);
    if (signal.aborted) cancel();
    else signal.addEventListener("abort", cancel, { once: true });
  });
}
// There is no GET /events/:id. Scan the filtered pages without assuming the first page is complete.
export async function findEvent(
  api: Api,
  payload: Payload,
  signal: AbortSignal,
): Promise<Event | undefined> {
  let cursor: string | undefined;
  do {
    const page = await api.events(
      {
        source: payload.source,
        reservationId: payload.reservation.reservationId,
        limit: 100,
        cursor,
      },
      signal,
    );
    const match = page.data.find((event) => event.eventId === payload.eventId);
    if (match) return match;
    cursor = page.pagination.nextCursor ?? undefined;
  } while (cursor && !signal.aborted);
}
export async function waitEvent(
  api: Api,
  payload: Payload,
  signal: AbortSignal,
  observe: (event: Event) => void,
  expected?: string,
) {
  if (signal.aborted)
    throw new Error(
      "Acompanhamento cancelado. Os eventos recebidos continuam no backend.",
    );
  const deadline = AbortSignal.timeout(POLL_TIMEOUT);
  const bounded = AbortSignal.any([signal, deadline]);
  try {
    while (!bounded.aborted) {
      const event = await findEvent(api, payload, bounded);
      if (event) {
        observe(event);
        if (expected ? event.status === expected : terminal(event.status))
          return event;
        if (terminal(event.status))
          throw new Error(
            `Esperado ${expected}, mas a API retornou ${event.status} (${event.reason ?? "sem motivo"}).`,
          );
      }
      await pause(bounded);
    }
  } catch (error) {
    if (!deadline.aborted || signal.aborted) throw error;
  }
  if (signal.aborted)
    throw new Error(
      "Acompanhamento cancelado. Os eventos recebidos continuam no backend.",
    );
  throw new Error(
    "Tempo limite de 60 segundos atingido. O processamento pode continuar no backend; consulte os registros ou retome o acompanhamento.",
  );
}
