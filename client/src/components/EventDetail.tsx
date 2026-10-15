import { useEffect, useState } from "react";
import type { Api } from "../api";
import { errorText } from "../api";
import type { Delivery, Event, Page } from "../types";
import { Badge, Empty, Notice, reasons, time } from "./ui";
export function EventDetail({
  event,
  api,
  close,
}: {
  event: Event;
  api: Api;
  close: () => void;
}) {
  const [page, setPage] = useState<Page<Delivery> | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setPage(null);
    setError("");
    setBusy(true);
    api
      .deliveries(event.id, undefined, controller.signal)
      .then(setPage)
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorText(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [api, event.id, revision]);
  async function more() {
    setBusy(true);
    setError("");
    try {
      const next = await api.deliveries(
        event.id,
        page?.pagination.nextCursor ?? undefined,
      );
      setPage((previous) => ({
        ...next,
        data: [...(previous?.data ?? []), ...next.data],
      }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel detail" aria-label="Detalhe do evento">
      <div className="section-head">
        <div>
          <span className="eyebrow">RASTREABILIDADE</span>
          <h2>Detalhe do evento</h2>
        </div>
        <button onClick={close}>Fechar detalhe</button>
      </div>
      <div className="detail-title">
        <code>{event.eventId}</code>
        <Badge status={event.status} />
      </div>
      <p>
        {reasons[event.reason ?? ""] ??
          (event.reason
            ? "O backend registrou o motivo abaixo. Consulte o histórico para diagnóstico."
            : "O backend ainda não informou um motivo de processamento.")}
      </p>
      {event.reason && <code className="reason">{event.reason}</code>}
      <dl>
        <dt>ID interno</dt>
        <dd>{event.id}</dd>
        <dt>requestId</dt>
        <dd>{event.requestId}</dd>
        <dt>Ocorrido em</dt>
        <dd>{time(event.occurredAt)}</dd>
        <dt>Recebido em</dt>
        <dd>{time(event.receivedAt)}</dd>
        <dt>Processado em</dt>
        <dd>
          {event.processedAt ? time(event.processedAt) : "Ainda não finalizado"}
        </dd>
        <dt>Tentativas</dt>
        <dd>{event.attempts ?? 0}</dd>
      </dl>
      <h3>Histórico de processamento</h3>
      <ol className="history">
        {event.history?.map((entry, index) => (
          <li key={index}>
            <Badge status={entry.status} />
            <span>
              {time(entry.at)} {entry.reason && `· ${entry.reason}`}
            </span>
          </li>
        ))}
      </ol>
      {!event.history?.length && (
        <p className="muted">Sem transições registradas.</p>
      )}
      <details>
        <summary>Payload original recebido</summary>
        <pre>
          {JSON.stringify(event.originalPayload ?? event.payload, null, 2)}
        </pre>
      </details>
      <div className="section-head">
        <h3>Entregas associadas</h3>
        <button disabled={busy} onClick={() => setRevision((v) => v + 1)}>
          Atualizar entregas
        </button>
      </div>
      <small>
        {page?.data.length ?? 0} carregadas
        {page?.pagination.hasMore ? " · há mais entregas" : ""}. Aceita indica
        recebimento; não indica processamento.
      </small>
      {error && <Notice error>{error}</Notice>}
      {busy && <p role="status">Consultando entregas…</p>}
      {page?.data.map((delivery) => (
        <details key={delivery.id} className="delivery">
          <summary>
            <Badge status={delivery.outcome} /> {time(delivery.receivedAt)}
          </summary>
          <p>
            ID: <code>{delivery.id}</code>
            <br />
            requestId: <code>{delivery.requestId}</code>
          </p>
          <pre>{JSON.stringify(delivery.payload, null, 2)}</pre>
        </details>
      ))}
      {page && !page.data.length && <Empty>Nenhuma entrega encontrada.</Empty>}
      {page?.pagination.hasMore && (
        <button disabled={busy} onClick={more}>
          Carregar mais entregas
        </button>
      )}
    </section>
  );
}
