import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { errorText } from "./api";
import { useConnection } from "./connection";
import { newRun, runDemo, type DemoKind, type DemoRun } from "./demo";
import { waitEvent } from "./polling";
import type { Alert, Event, Page, Payload, Query, Reservation } from "./types";
import { Badge, Empty, Notice, day, time } from "./components/ui";
import { ManualForm } from "./components/ManualForm";
import { EventDetail } from "./components/EventDetail";
import { Explainer } from "./components/Explainer";
interface Filters {
  source: string;
  propertyId: string;
  reservationId: string;
  type: string;
  status: string;
}
const blank: Filters = {
  source: "",
  propertyId: "",
  reservationId: "",
  type: "",
  status: "",
};
const emptyPage = <T,>(): Page<T> => ({
  data: [],
  pagination: { nextCursor: null, hasMore: false },
});
function merge<T extends { id: string }>(previous: T[], next: T[]) {
  return [
    ...new Map([...previous, ...next].map((item) => [item.id, item])).values(),
  ];
}
const scenarios: { kind: DemoKind; title: string; steps: string[]; result: string }[] = [
  {
    kind: "delayed",
    title: "Receber uma atualização atrasada",
    steps: [
      "Cria a reserva na versão 1 e aplica uma atualização na versão 2, com novas datas.",
      "Envia depois uma atualização antiga, na versão 0, com datas diferentes.",
    ],
    result: "O evento antigo é ignorado. A reserva mantém a versão 2 e suas datas mais recentes.",
  },
  {
    kind: "ordering",
    title: "Receber atualização antes da criação",
    steps: [
      "Envia uma atualização na versão 2 para uma reserva que ainda não existe. O evento fica pendente de referência.",
      "Envia a criação na versão 1 e acompanha a reavaliação da atualização pelo worker.",
    ],
    result: "A atualização pendente é concluída e a reserva fica na versão 2, com as datas atualizadas.",
  },
  {
    kind: "conflict",
    title: "Criar um conflito e depois resolvê-lo",
    steps: [
      "Cria duas reservas para a mesma acomodação com datas sobrepostas, abrindo um alerta de conflito.",
      "Cancela a segunda reserva e consulta o alerta novamente para confirmar sua resolução.",
    ],
    result: "O alerta passa de aberto para resolvido, preservando o histórico e os registros das duas reservas.",
  },
  {
    kind: "duplicate",
    title: "Receber o mesmo evento novamente",
    steps: [
      "Envia um evento de criação e aguarda o processamento da reserva.",
      "Reenvia exatamente o mesmo evento, com a mesma origem, identificador e conteúdo, e consulta as entregas.",
    ],
    result: "Uma nova entrega é registrada, mantendo um único evento e uma única reserva, sem reaplicar a criação.",
  },
];
export default function App() {
  const { api, url } = useConnection();
  const [tab, setTab] = useState<"events" | "reservations" | "alerts">(
    "events",
  );
  const [filters, setFilters] = useState(blank),
    [draft, setDraft] = useState(blank);
  const [events, setEvents] = useState(emptyPage<Event>),
    [reservations, setReservations] = useState(emptyPage<Reservation>),
    [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [connected, setConnected] = useState(false),
    [loadedAt, setLoadedAt] = useState("");
  const [selected, setSelected] = useState<Event | null>(null),
    [busy, setBusy] = useState(false),
    [activity, setActivity] = useState(""),
    [operationError, setOperationError] = useState("");
  const [run, setRun] = useState<DemoRun | null>(null),
    [logs, setLogs] = useState<string[]>([]),
    [lastPayload, setLastPayload] = useState<Payload | null>(null);
  const operation = useRef<AbortController | null>(null),
    reads = useRef<AbortController | null>(null);
  const scope = useRef({ api, filters });
  scope.current = { api, filters };
  const eventQuery: Query = {
    source: filters.source,
    propertyId: filters.propertyId,
    reservationId: filters.reservationId,
    type: filters.type,
    limit: 20,
  };
  const reservationQuery: Query = {
    source: filters.source,
    propertyId: filters.propertyId,
    status: filters.status,
    limit: 20,
  };
  const refresh = useCallback(async () => {
    reads.current?.abort();
    if (!api) return;
    const controller = new AbortController();
    reads.current = controller;
    setLoading(true);
    setError("");
    try {
      const [e, r, a] = await Promise.all([
        api.events(
          {
            source: filters.source,
            propertyId: filters.propertyId,
            reservationId: filters.reservationId,
            type: filters.type,
            limit: 20,
          },
          controller.signal,
        ),
        api.reservations(
          {
            source: filters.source,
            propertyId: filters.propertyId,
            status: filters.status,
            limit: 20,
          },
          controller.signal,
        ),
        api.alerts(filters.propertyId, controller.signal),
      ]);
      if (controller.signal.aborted) return;
      setEvents(e);
      setReservations(r);
      setAlerts(a.data);
      setConnected(true);
      setLoadedAt(new Date().toISOString());
      setSelected((previous) =>
        previous
          ? (e.data.find((row) => row.id === previous.id) ?? previous)
          : null,
      );
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(errorText(error));
        setConnected(false);
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [api, filters]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    setEvents(emptyPage());
    setReservations(emptyPage());
    setAlerts([]);
    setSelected(null);
    setLoadedAt("");
    setError("");
    setConnected(false);
    if (!api) setLoading(false);
    void refresh();
    return () => reads.current?.abort();
  }, [refresh, api]);
  useEffect(() => {
    return () => {
      operation.current?.abort();
    };
  }, [api]);
  const observe = (event: Event) => {
    setSelected(event);
    setActivity(
      `${event.eventId} · ${event.status} · tentativa ${event.attempts ?? 0}`,
    );
    setEvents((previous) => ({
      ...previous,
      data: previous.data.map((row) => (row.id === event.id ? event : row)),
    }));
  };
  function applyFilters(event: FormEvent) {
    event.preventDefault();
    if (busy || loading) return;
    setFilters({ ...draft });
  }
  async function more() {
    if (!api || loading) return;
    const currentScope = scope.current;
    const controller = new AbortController();
    reads.current?.abort();
    reads.current = controller;
    setLoading(true);
    setError("");
    try {
      if (tab === "events") {
        const next = await api.events(
          {
            ...eventQuery,
            cursor: events.pagination.nextCursor ?? undefined,
          },
          controller.signal,
        );
        if (
          !controller.signal.aborted &&
          scope.current.api === currentScope.api &&
          scope.current.filters === currentScope.filters
        )
          setEvents((previous) => ({
            ...next,
            data: merge(previous.data, next.data),
          }));
      } else {
        const next = await api.reservations(
          {
            ...reservationQuery,
            cursor: reservations.pagination.nextCursor ?? undefined,
          },
          controller.signal,
        );
        if (
          !controller.signal.aborted &&
          scope.current.api === currentScope.api &&
          scope.current.filters === currentScope.filters
        )
          setReservations((previous) => ({
            ...next,
            data: merge(previous.data, next.data),
          }));
      }
    } catch (error) {
      if (
        !controller.signal.aborted &&
        scope.current.api === currentScope.api &&
        scope.current.filters === currentScope.filters
      )
        setError(errorText(error));
    } finally {
      if (
        !controller.signal.aborted &&
        scope.current.api === currentScope.api &&
        scope.current.filters === currentScope.filters
      )
        setLoading(false);
    }
  }
  async function manual(payload: Payload, resume = false) {
    if (!api || busy) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setOperationError("");
    setLastPayload(payload);
    setActivity(resume ? "Retomando consulta do evento…" : "Enviando evento…");
    try {
      if (!resume) {
        const receipt = await api.post(payload, controller.signal);
        setActivity(
          `HTTP 201 · recebido · ID ${receipt.data.id}. Aguardando processamento…`,
        );
      }
      const result = await waitEvent(api, payload, controller.signal, observe);
      setActivity(
        `Acompanhamento finalizado: ${result.status} · ${result.reason ?? "sem motivo"}.`,
      );
    } catch (error) {
      setOperationError(errorText(error));
    } finally {
      setBusy(false);
      if (!controller.signal.aborted) await refreshRef.current();
    }
  }
  async function demo(kind: DemoKind) {
    if (!api || busy) return;
    const next = newRun(kind),
      controller = new AbortController();
    operation.current = controller;
    setRun(next);
    setLogs([]);
    setOperationError("");
    setBusy(true);
    setLastPayload(null);
    const nextFilters = {
      ...blank,
      source: next.source,
      propertyId: next.propertyId,
    };
    setDraft(nextFilters);
    setFilters(nextFilters);
    try {
      await runDemo(
        api,
        next,
        controller.signal,
        (text) => setLogs((previous) => [...previous, text]),
        observe,
        () => refreshRef.current(),
      );
      setActivity(
        "Apresentação concluída. Consulte eventos, reservas e alertas abaixo.",
      );
    } catch (error) {
      setOperationError(errorText(error));
    } finally {
      setBusy(false);
      if (!controller.signal.aborted) await refreshRef.current();
    }
  }
  function consultRun() {
    if (run) {
      const next = { ...blank, source: run.source, propertyId: run.propertyId };
      setDraft(next);
      setFilters(next);
    }
  }
  const reservationName = (id: string) => {
    const value = reservations.data.find((r) => r.id === id);
    return value
      ? `${value.reservationId} · ${value.source}`
      : `ID interno: ${id}`;
  };
  const currentData = tab === "events" ? events : reservations;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#top">
          <span className="brand-mark" aria-hidden="true">
            S<span>•</span>
          </span>
          <span>
            StayPulse<small>OPERATIONS CONSOLE</small>
          </span>
        </a>
        <div className="workspace-label">
          WORKSPACE <span>01</span>
        </div>
        <nav aria-label="Navegação principal">
          <a className="nav-active" href="#overview">
            <span aria-hidden="true">◫</span> Visão geral
          </a>
          <a href="#demo">
            <span aria-hidden="true">▷</span> Apresentação guiada
          </a>
          <a href="#records">
            <span aria-hidden="true">≋</span> Registros da API
          </a>
          <a href="#manual">
            <span aria-hidden="true">↗</span> Enviar evento
          </a>
          <a href="#architecture">
            <span aria-hidden="true">◇</span> Como funciona
          </a>
        </nav>
        <div className="sidebar-bottom">
          <span className="pulse-dot" /> EVENT-DRIVEN BY DESIGN
          <p>
            Uma reserva.
            <br />
            Todos os canais.
            <br />
            Um estado confiável.
          </p>
          <small>MVP · capacidade de uma unidade</small>
        </div>
      </aside>
      <main id="top">
        <header className="topbar">
          <span>
            Workspace <span className="slash">/</span>{" "}
            <strong>Operações</strong>
          </span>
          <div className="connection-status">
            <span className={`status-dot ${connected ? "online" : ""}`} />
            <span>
              {!api
                ? "Não configurada"
                : connected
                  ? "API conectada"
                  : loading
                    ? "Consultando API"
                    : "Conexão indisponível"}
            </span>
          </div>
        </header>
        <div className="page-content">
          <section id="overview" className="page-intro">
            <div>
              <span className="eyebrow">RESERVAS EM SINTONIA</span>
              <h1>Uma visão clara de cada estadia.</h1>
              <p>Monitore reservas entre canais, acompanhe eventos e entenda cada decisão do processamento.</p>
            </div>
            <span className="environment-tag">
              <span className="pulse-dot" /> API REAL · REQUESTS SIMULADAS
            </span>
          </section>
          <div className="metrics">
            {[
              ["Eventos", events.data.length, "Registros na timeline"],
              [
                "Reservas confirmadas",
                reservations.data.filter((r) => r.status === "confirmed")
                  .length,
                "Entre as reservas carregadas",
              ],
              [
                "Referências pendentes",
                events.data.filter((e) => e.status === "pending_reference")
                  .length,
                "Aguardando a criação",
              ],
              [
                "Alertas abertos",
                alerts.filter((a) => a.status === "open").length,
                "Para revisão humana",
              ],
            ].map(([label, value, caption], index) => (
              <article className={`metric metric-${index}`} key={label}>
                <div>
                  <span>{label}</span>
                  <span className="metric-icon" aria-hidden="true">
                    {["≋", "▤", "◷", "⚑"][index]}
                  </span>
                </div>
                <strong>{loadedAt ? value : "—"}</strong>
                <small>{caption}</small>
              </article>
            ))}
          </div>
          <div className="metrics-note">
            <span>
              Totais apenas dos registros carregados, com os filtros aplicados.
              Alertas: no máximo 100 mais recentes.
            </span>
            <span>
              {loadedAt
                ? `Consulta: ${time(loadedAt)}`
                : "Aguardando primeira consulta"}
            </span>
          </div>
          <section id="demo" className="demo-panel">
            <div className="demo-heading">
              <div>
                <span className="eyebrow">DO RECEBIMENTO À RESOLUÇÃO</span>
                <h2>Veja o StayPulse em ação.</h2>
                <p>Escolha um cenário para simular situações comuns de integração. Cada etapa envia ou consulta a API real e mostra como o StayPulse trata o evento. Acompanhe os resultados no histórico da execução e nos registros abaixo.</p>
              </div>
              <span className="demo-symbol" aria-hidden="true">
                ↗
              </span>
            </div>
            <div className="demo-options">
              {scenarios.map((scenario, index) => (
                <article key={scenario.kind}>
                  <span className="scenario-number">CENÁRIO {String(index + 1).padStart(2, "0")}</span>
                  <h3>{scenario.title}</h3>
                  <ol className="scenario-steps">
                    {scenario.steps.map((step) => <li key={step}>{step}</li>)}
                  </ol>
                  <p><strong>Resultado esperado:</strong> {scenario.result}</p>
                  <button
                    disabled={!api || busy}
                    onClick={() => void demo(scenario.kind)}
                    aria-label={`Executar cenário: ${scenario.title}`}
                  >
                    Executar cenário <span aria-hidden="true">→</span>
                  </button>
                </article>
              ))}
            </div>
            <small>
              Os cenários gravam registros reais e não os apagam ao terminar.
              Datas futuras são geradas na execução.
            </small>
          </section>
          {run && (
            <section className="panel run-panel">
              <div className="section-head">
                <h2>
                  Execução ·{" "}
                  {scenarios.find((scenario) => scenario.kind === run.kind)?.title}
                </h2>
                <button disabled={busy} onClick={consultRun}>
                  Consultar esta execução
                </button>
              </div>
              <dl>
                <dt>Origem</dt>
                <dd>{run.source}</dd>
                <dt>Propriedade</dt>
                <dd>{run.propertyId}</dd>
                <dt>Reserva A</dt>
                <dd>{run.a}</dd>
                {run.kind === "conflict" && (
                  <>
                    <dt>Reserva B</dt>
                    <dd>{run.b}</dd>
                  </>
                )}
              </dl>
              <ol className="run-log">
                {logs.map((text, index) => (
                  <li key={index}>{text}</li>
                ))}
              </ol>
              <p className="muted">
                IDs de eventos e entregas aparecem nas evidências acima. Iniciar
                outro cenário cria outra origem e propriedade; estes registros
                continuam consultáveis pelos filtros.
              </p>
            </section>
          )}
          {(busy || activity || operationError) && (
            <section className="operation-status">
              <div role="status" aria-live="polite">
                <strong>
                  {busy ? "Acompanhamento em andamento" : "Última operação"}
                </strong>
                <p>{activity}</p>
                {busy && (
                  <small>
                    Consulta a cada 1,5 s · limite de 60 s por espera ·
                    pendência não é conclusão.
                  </small>
                )}
              </div>
              <div className="actions">
                {busy ? (
                  <button
                    onClick={() => {
                      operation.current?.abort();
                      setActivity(
                        "Acompanhamento interrompido; eventos já recebidos continuam no backend.",
                      );
                    }}
                  >
                    Cancelar acompanhamento
                  </button>
                ) : (
                  lastPayload && (
                    <button
                      disabled={!api}
                      onClick={() => void manual(lastPayload, true)}
                    >
                      Retomar consulta do último evento
                    </button>
                  )
                )}
              </div>
              {operationError && <Notice error>{operationError}</Notice>}
            </section>
          )}
          <section id="records" className="panel records">
            <div className="section-head">
              <div>
                <span className="eyebrow">OBSERVABILIDADE</span>
                <h2>Da entrada ao estado atual</h2>
              </div>
              <button disabled={!api || loading} onClick={() => void refresh()}>
                {loading ? "Consultando…" : "↻ Atualizar registros"}
              </button>
            </div>
            <form onSubmit={applyFilters} className="filters">
              <label>
                Origem
                <input
                  maxLength={200}
                  value={draft.source}
                  onChange={(e) =>
                    setDraft({ ...draft, source: e.target.value })
                  }
                  placeholder="Todas as origens"
                />
              </label>
              <label>
                Propriedade
                <input
                  maxLength={200}
                  value={draft.propertyId}
                  onChange={(e) =>
                    setDraft({ ...draft, propertyId: e.target.value })
                  }
                  placeholder="Todas as propriedades"
                />
              </label>
              <label>
                Reserva · eventos
                <input
                  maxLength={200}
                  value={draft.reservationId}
                  onChange={(e) =>
                    setDraft({ ...draft, reservationId: e.target.value })
                  }
                  placeholder="reservationId"
                />
              </label>
              <label>
                Tipo · eventos
                <select
                  value={draft.type}
                  onChange={(e) => setDraft({ ...draft, type: e.target.value })}
                >
                  <option value="">Todos os tipos</option>
                  <option>reservation.created</option>
                  <option>reservation.updated</option>
                  <option>reservation.cancelled</option>
                </select>
              </label>
              <label>
                Estado · reservas
                <select
                  value={draft.status}
                  onChange={(e) =>
                    setDraft({ ...draft, status: e.target.value })
                  }
                >
                  <option value="">Todos os estados</option>
                  <option value="confirmed">Confirmadas</option>
                  <option value="cancelled">Canceladas</option>
                </select>
              </label>
              <div className="actions">
                <button className="primary" disabled={!api || loading || busy}>
                  Aplicar filtros
                </button>
                <button
                  type="button"
                  disabled={loading || busy}
                  onClick={() => {
                    setDraft(blank);
                    setFilters(blank);
                  }}
                >
                  Limpar
                </button>
              </div>
            </form>
            <p className="filter-help">
              Origem e propriedade filtram eventos e reservas. Alertas aceitam
              somente propriedade. Atualizar reinicia a paginação; consultas
              entre páginas podem refletir mudanças do worker.
            </p>
            <div className="tabs" role="group" aria-label="Tipo de registro">
              {(["events", "reservations", "alerts"] as const).map(
                (name, index) => (
                  <button
                    key={name}
                    className={tab === name ? "active" : ""}
                    aria-pressed={tab === name}
                    onClick={() => setTab(name)}
                  >
                    {["Timeline de eventos", "Reservas", "Alertas"][index]}
                    <span>
                      {
                        [
                          events.data.length,
                          reservations.data.length,
                          alerts.length,
                        ][index]
                      }
                    </span>
                  </button>
                ),
              )}
            </div>
            {error && (
              <Notice error>
                {error}
                {loadedAt &&
                  " Os dados visíveis são da última consulta bem-sucedida."}
              </Notice>
            )}
            {loading && (
              <div className="loading" role="status">
                Consultando registros na API…
              </div>
            )}
            {!api ? (
              <Empty>
                Configure client/.env e inicie o proxy para consultar os dados
                reais.
              </Empty>
            ) : (
              <>
                {tab === "events" &&
                  (events.data.length ? (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Evento / origem</th>
                            <th>Reserva</th>
                            <th>Versão</th>
                            <th>Recebido em</th>
                            <th>Tentativas</th>
                            <th>Estado</th>
                            <th>
                              <span className="sr-only">Detalhes</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {events.data.map((event) => (
                            <tr key={event.id}>
                              <td>
                                <strong>{event.type}</strong>
                                <small>{event.source}</small>
                                <code>{event.eventId}</code>
                              </td>
                              <td>
                                {event.reservationId}
                                <small>
                                  {event.propertyId ??
                                    "Propriedade não informada"}
                                </small>
                              </td>
                              <td>
                                <span className="version">
                                  v{event.payload.sourceVersion}
                                </span>
                              </td>
                              <td className="nowrap">
                                {time(event.receivedAt)}
                              </td>
                              <td>{event.attempts ?? 0}</td>
                              <td>
                                <Badge status={event.status} />
                              </td>
                              <td>
                                <button
                                  aria-label={`Ver detalhes de ${event.eventId}`}
                                  onClick={() => setSelected(event)}
                                >
                                  Detalhes ↗
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    !loading && (
                      <Empty>
                        Nenhum evento encontrado com estes filtros. Envie um
                        evento ou execute um cenário.
                      </Empty>
                    )
                  ))}
                {tab === "reservations" &&
                  (reservations.data.length ? (
                    <div className="reservation-grid">
                      {reservations.data.map((reservation) => (
                        <article
                          className="reservation-card"
                          key={reservation.id}
                        >
                          <div className="section-head">
                            <span className="property-label">
                              {reservation.propertyId}
                            </span>
                            <Badge status={reservation.status} />
                          </div>
                          <h3>{reservation.reservationId}</h3>
                          <p>
                            {reservation.source}{" "}
                            <span className="version">
                              v{reservation.sourceVersion}
                            </span>
                          </p>
                          <div className="stay-period">
                            <div>
                              <small>CHECK-IN</small>
                              <strong>{day(reservation.checkIn)}</strong>
                            </div>
                            <span aria-hidden="true">⟶</span>
                            <div>
                              <small>CHECKOUT</small>
                              <strong>{day(reservation.checkOut)}</strong>
                            </div>
                          </div>
                          <small>
                            Intervalo [entrada, saída) · atualizado{" "}
                            {time(reservation.updatedAt)}
                          </small>
                        </article>
                      ))}
                    </div>
                  ) : (
                    !loading && (
                      <Empty>
                        Nenhuma reserva encontrada com estes filtros.
                      </Empty>
                    )
                  ))}
                {tab === "alerts" &&
                  (alerts.length ? (
                    <div className="alert-list">
                      {alerts.map((alert) => (
                        <article key={alert.id} className="alert-card">
                          <div className="section-head">
                            <div>
                              <span className="eyebrow">
                                SOBREPOSIÇÃO · {alert.propertyId}
                              </span>
                              <h3>Revisão de disponibilidade</h3>
                            </div>
                            <Badge status={alert.status} />
                          </div>
                          <div className="reservation-pair">
                            <code>{reservationName(alert.reservationA)}</code>
                            <span aria-hidden="true">↔</span>
                            <code>{reservationName(alert.reservationB)}</code>
                          </div>
                          <small>
                            Alerta {alert.id} · nenhuma ação automática de
                            cancelamento
                          </small>
                          <ol className="history">
                            {alert.history.map((entry, index) => (
                              <li key={index}>
                                <Badge status={entry.status} />
                                <span>{time(entry.at)}</span>
                              </li>
                            ))}
                          </ol>
                        </article>
                      ))}
                    </div>
                  ) : (
                    !loading && (
                      <Empty>
                        Nenhum alerta retornado para esta propriedade.
                      </Empty>
                    )
                  ))}
                <div className="pagination">
                  <small>
                    {tab === "alerts"
                      ? `${alerts.length} alertas retornados · API limitada aos 100 mais recentes`
                      : `${currentData.data.length} registros carregados · ${currentData.pagination.hasMore ? "há mais páginas disponíveis" : "fim da consulta atual"}`}
                  </small>
                  {tab !== "alerts" && currentData.pagination.hasMore && (
                    <button disabled={loading} onClick={() => void more()}>
                      Carregar mais 20
                    </button>
                  )}
                </div>
              </>
            )}
          </section>
          {selected && api && (
            <EventDetail
              key={`${selected.id}-${api === null}`}
              event={selected}
              api={api}
              close={() => setSelected(null)}
            />
          )}
          <div id="manual">
            <ManualForm
              disabled={!api || busy}
              send={(payload) => void manual(payload)}
            />
          </div>
          <div id="architecture">
            <Explainer />
          </div>
          <footer>
            <span>
              StayPulse <span className="muted">/ Operações de reservas</span>
            </span>
            <span>
              {api ? `Destino: ${url}` : "Conexão não configurada"}{" "}
              <small> · conexão configurada pelo ambiente</small>
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}
