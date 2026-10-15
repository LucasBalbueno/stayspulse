import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webhookSchema } from '../../src/modules/webhooks/presentation/http/schema.js';
import { readEnv } from '../../src/config/env.js';
import { RegisterReceivedEvent } from '../../src/modules/events/application/register-received-event.js';
import { payload } from '../fixtures.js';

test('valida datas reais, intervalo, timestamp com fuso e campos desconhecidos', () => {
  for (const reservation of [
    { ...payload.reservation, checkIn: '2026-02-30' },
    { ...payload.reservation, checkOut: payload.reservation.checkIn },
    { ...payload.reservation, checkOut: '2026-11-09' },
    { ...payload.reservation, propertyId: '' },
  ]) {
    assert.equal(
      webhookSchema.safeParse({ ...payload, reservation }).success,
      false,
    );
  }
  assert.equal(
    webhookSchema.safeParse({
      ...payload,
      occurredAt: '2026-11-01T14:00:00',
    }).success,
    false,
  );
  assert.equal(
    webhookSchema.safeParse({ ...payload, unexpected: true }).success,
    false,
  );
  assert.equal(
    webhookSchema.safeParse({
      ...payload,
      occurredAt: '2026-11-01T14:00:00-03:00',
    }).success,
    true,
  );
  assert.equal(
    webhookSchema.safeParse({ ...payload, type: 'reservation.cancelled' }).success,
    false,
  );
});

test('configuração falha sem expor valores de credenciais', () => {
  assert.throws(
    () => readEnv({ API_KEY: 'secret', MONGODB_URI: 'secret-uri' }),
    error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /API_KEY/);
      assert.ok(!error.message.includes('secret'));
      return true;
    },
  );
  const env = readEnv({
    API_KEY: 'test-key-1234567890',
    MONGODB_URI: 'mongodb://localhost:27017',
  });
  assert.equal(env.PORT, 3000);
});

test('registro usa relógio do servidor e propaga falha de persistência', async () => {
  const now = new Date('2026-10-14T12:00:00Z');
  const register = new RegisterReceivedEvent(
    {
      insert: async event => {
        assert.equal(event.receivedAt, now);
        assert.equal(event.status, 'received');
        assert.equal(event.requestId, 'request-test');
        return { ...event, id: 'internal-id' };
      },
    },
    () => now,
  );
  assert.deepEqual(
    await register.execute(payload, 'request-test'),
    {
      id: 'internal-id',
      eventId: payload.eventId,
      status: 'received',
    },
  );
  const failure = new Error('write failed');
  await assert.rejects(
    new RegisterReceivedEvent({
      insert: async () => {
        throw failure;
      },
    }).execute(payload, 'id'),
    failure,
  );
});
