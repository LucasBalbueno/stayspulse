import type {
  Alert,
  Delivery,
  Event,
  Page,
  Payload,
  Query,
  Receipt,
  Reservation,
} from "./types";
const messages: Record<number, string> = {
  401: "Chave não autorizada. Confira STAYPULSE_API_KEY no ambiente do frontend.",
  409: "Este identificador de evento já foi usado com outro conteúdo.",
  422: "Revise os campos enviados. A API encontrou valores inválidos.",
  503: "O serviço está temporariamente indisponível. Tente novamente em instantes.",
};
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
    public details?: { field: string; message: string }[],
  ) {
    super(message);
  }
}
export function errorText(error: unknown): string {
  if (error instanceof ApiError)
    return `${error.message} · HTTP ${error.status || "indisponível"} · ${error.code}${error.requestId ? ` · requestId: ${error.requestId}` : ""}${error.details?.length ? ` · ${error.details.map((d) => `${d.field}: ${d.message}`).join("; ")}` : ""}`;
  return error instanceof Error
    ? error.message
    : "Não foi possível concluir a operação.";
}
export function validBaseUrl(value: string) {
  if (/[\\\s]/.test(value)) return false;
  if (/^\/(?!\/)[^?#]*$/.test(value)) return true;
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
export class Api {
  constructor(
    private base: string,
    private key?: string,
  ) {}
  private async request<T>(
    path: string,
    query: Query = {},
    payload?: Payload,
    signal?: AbortSignal,
  ): Promise<T> {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== "") params.set(key, String(value));
    });
    const timeout = AbortSignal.timeout(15000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetch(
        `${this.base.replace(/\/$/, "")}${path}${params.size ? `?${params}` : ""}`,
        {
          method: payload ? "POST" : "GET",
          headers: {
            ...(this.key ? { "X-API-Key": this.key } : {}),
            ...(payload ? { "Content-Type": "application/json" } : {}),
          },
          body: payload ? JSON.stringify(payload) : undefined,
          signal: combined,
          credentials: "omit",
          redirect: "error",
        },
      );
    } catch {
      if (signal?.aborted)
        throw new Error(
          "Acompanhamento cancelado. Os eventos já recebidos continuam no backend.",
        );
      throw new ApiError(
        0,
        "CONNECTION_UNAVAILABLE",
        "Não foi possível acessar a API. Confira se o backend está ativo e STAYPULSE_API_URL está correta no ambiente do frontend.",
      );
    }
    const body = await response.json().catch(() => null);
    const requestId =
      body?.error?.requestId ??
      response.headers.get("X-Request-ID") ??
      undefined;
    if (!response.ok)
      throw new ApiError(
        response.status,
        body?.error?.code ?? "HTTP_ERROR",
        messages[response.status] ??
          body?.error?.message ??
          "A API não conseguiu concluir a solicitação.",
        requestId,
        body?.error?.details,
      );
    if (!body || !("data" in body))
      throw new ApiError(
        response.status,
        "INVALID_RESPONSE",
        "A URL retornou uma resposta inesperada. Confira o endereço da API.",
        requestId,
      );
    return body as T;
  }
  events(query: Query = {}, signal?: AbortSignal) {
    return this.request<Page<Event>>("/events", query, undefined, signal);
  }
  reservations(query: Query = {}, signal?: AbortSignal) {
    return this.request<Page<Reservation>>(
      "/reservations",
      query,
      undefined,
      signal,
    );
  }
  alerts(propertyId?: string, signal?: AbortSignal) {
    return this.request<{ data: Alert[] }>(
      "/alerts",
      { propertyId },
      undefined,
      signal,
    );
  }
  deliveries(id: string, cursor?: string, signal?: AbortSignal) {
    return this.request<Page<Delivery>>(
      `/events/${encodeURIComponent(id)}/deliveries`,
      { limit: 20, cursor },
      undefined,
      signal,
    );
  }
  post(payload: Payload, signal?: AbortSignal) {
    return this.request<{ data: Receipt }>(
      "/webhooks/reservations",
      {},
      payload,
      signal,
    );
  }
}
