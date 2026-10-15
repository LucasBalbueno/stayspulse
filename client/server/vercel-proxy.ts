interface ProxyEnv {
  STAYPULSE_API_URL?: string;
  STAYPULSE_API_KEY?: string;
}

const failure = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, {
    status, headers: { 'Cache-Control': 'no-store' },
  });

export async function proxyRequest(
  request: Request,
  env: ProxyEnv,
  upstreamFetch: typeof fetch = fetch,
): Promise<Response> {
  const incoming = new URL(request.url);
  const origin = request.headers.get('origin');
  if (request.headers.get('sec-fetch-site') === 'cross-site' ||
      (origin && origin !== incoming.origin)) {
    return failure(403, 'FORBIDDEN', 'Origem não permitida.');
  }

  // O rewrite usa um parâmetro reservado, removido antes de chamar o backend.
  const paths = incoming.searchParams.getAll('__path');
  const path = paths[0] ?? '';
  const readRoute = /^(events|reservations|alerts)$/.test(path) ||
    /^events\/[a-fA-F0-9]{24}\/deliveries$/.test(path);
  const writeRoute = path === 'webhooks/reservations';
  if (paths.length !== 1 || (!readRoute && !writeRoute)) {
    return failure(404, 'NOT_FOUND', 'Rota não encontrada.');
  }
  if (request.method !== (writeRoute ? 'POST' : 'GET')) {
    return failure(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
  }

  let target: URL;
  const key = env.STAYPULSE_API_KEY ?? '';
  try {
    target = new URL(env.STAYPULSE_API_URL ?? '');
    if (!['http:', 'https:'].includes(target.protocol) || target.username ||
        target.password || target.search || target.hash ||
        key.length < 16 || key.trim() !== key || /[\r\n]/.test(key)) throw new Error();
  } catch {
    return failure(503, 'PROXY_NOT_CONFIGURED', 'Conexão com a API não configurada no servidor.');
  }
  target.pathname = `${target.pathname.replace(/\/$/, '')}/${path}`;
  incoming.searchParams.delete('__path');
  // A Vercel também inclui a captura :path* na query da função.
  // Ambos são metadados do rewrite, não filtros aceitos pela API.
  incoming.searchParams.delete('path');
  target.search = incoming.searchParams.toString();

  let body: Uint8Array | undefined;
  if (writeRoute) {
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
      return failure(415, 'UNSUPPORTED_MEDIA_TYPE', 'Envie o corpo como application/json.');
    }
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 64 * 1024) {
            await reader.cancel();
            return failure(413, 'PAYLOAD_TOO_LARGE', 'JSON excede 64 KB.');
          }
          chunks.push(value);
        }
      } catch {
        return failure(400, 'INVALID_BODY', 'Não foi possível ler o corpo.');
      }
    }
    body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  }

  try {
    const upstream = await upstreamFetch(target, {
      method: request.method,
      headers: { 'X-API-Key': key, ...(writeRoute ? { 'Content-Type': 'application/json' } : {}) },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(12_000),
    });
    // Não repassa cookies, credenciais, CORS ou cache do upstream.
    const headers = new Headers({ 'Cache-Control': 'no-store' });
    for (const name of ['content-type', 'x-request-id']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    const responseBody = await upstream.arrayBuffer();
    return new Response([204, 205, 304].includes(upstream.status) ? null : responseBody, {
      status: upstream.status, headers,
    });
  } catch {
    return failure(502, 'API_UNAVAILABLE', 'Não foi possível acessar a API.');
  }
}
