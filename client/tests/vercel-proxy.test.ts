import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proxyRequest } from '../server/vercel-proxy.ts';

const env = { STAYPULSE_API_URL: 'https://backend.example', STAYPULSE_API_KEY: 'server-only-test-key' };
const req = (path: string, init?: RequestInit) => new Request(`https://panel.example/api/proxy?__path=${path}`, init);

test('proxy encaminha filtros e chave privada, preservando status e requestId', async () => {
  const response = await proxyRequest(req('events&path=events&limit=20&source=channel', {
    headers: { 'X-API-Key': 'untrusted', Cookie: 'private=value' },
  }), env, async (url, options) => {
    assert.equal(String(url), 'https://backend.example/events?limit=20&source=channel');
    const headers = new Headers(options?.headers);
    assert.equal(headers.get('x-api-key'), env.STAYPULSE_API_KEY);
    assert.equal(headers.get('cookie'), null);
    assert.equal(options?.redirect, 'error');
    return Response.json({ error: { code: 'UNAUTHORIZED', requestId: 'test-id' } }, {
      status: 401, headers: { 'X-Request-ID': 'test-id', 'Set-Cookie': 'secret=value' },
    });
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('x-request-id'), 'test-id');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).error.code, 'UNAUTHORIZED');
});

test('proxy envia JSON sem alterar conteúdo e atende entregas aninhadas', async () => {
  const payload = '{"eventId":"example", "sourceVersion":1}';
  const response = await proxyRequest(req('webhooks/reservations', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://panel.example' }, body: payload,
  }), env, async (url, options) => {
    assert.equal(String(url), 'https://backend.example/webhooks/reservations');
    assert.equal(new TextDecoder().decode(options?.body as Uint8Array), payload);
    return Response.json({ data: { id: 'event' } }, { status: 201 });
  });
  assert.equal(response.status, 201);
  const deliveries = await proxyRequest(req('events/0123456789abcdef01234567/deliveries&path=events%2F0123456789abcdef01234567%2Fdeliveries&cursor=abc'), env, async (url) => {
    assert.equal(String(url), 'https://backend.example/events/0123456789abcdef01234567/deliveries?cursor=abc');
    return Response.json({ data: [] });
  });
  assert.equal(deliveries.status, 200);
});

test('proxy bloqueia outras origens, rotas arbitrárias, métodos e corpos grandes antes do upstream', async () => {
  const noFetch: typeof fetch = async () => { throw new Error('upstream should not be called'); };
  for (const [request, status] of [
    [req('events', { headers: { Origin: 'https://attacker.example' } }), 403],
    [req('events', { headers: { 'Sec-Fetch-Site': 'cross-site' } }), 403],
    [req('https://attacker.example'), 404],
    [req('../admin'), 404],
    [req('events&__path=alerts'), 404],
    [req('events', { method: 'DELETE' }), 405],
    [req('webhooks/reservations', { method: 'POST', body: '{}' }), 415],
    [req('webhooks/reservations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(65537) }), 413],
  ] as const) {
    assert.equal((await proxyRequest(request, env, noFetch)).status, status);
  }
});

test('proxy distingue configuração ausente e falha de rede sem expor segredos', async () => {
  assert.equal((await proxyRequest(req('events'), {})).status, 503);
  const response = await proxyRequest(req('events'), env, async () => {
    throw new Error(env.STAYPULSE_API_KEY);
  });
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes(env.STAYPULSE_API_KEY));
});
