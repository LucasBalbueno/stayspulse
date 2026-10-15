import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startupErrorMessage } from '../../src/shared/errors/startup-error.js';

test('diagnóstico de inicialização distingue DNS, autenticação, permissão e porta', () => {
  assert.match(startupErrorMessage({ code: 'EREFUSED' }, 'connect'), /DNS.*EREFUSED/);
  assert.match(startupErrorMessage({ cause: { code: 'EREFUSED' } }, 'connect'), /DNS/);
  assert.match(startupErrorMessage({ code: 18 }, 'connect'), /Autenticação/);
  assert.match(startupErrorMessage({ code: 13 }, 'indexes'), /permissão/);
  assert.match(startupErrorMessage({ code: 'EADDRINUSE' }, 'listen'), /Porta HTTP/);
});

test('mensagens de driver e valores desconhecidos nunca aparecem no diagnóstico', () => {
  const error = {
    message: 'mongodb://user:secret@host',
    code: 'secret',
    cause: { message: 'secret' },
  };
  for (const stage of ['client', 'connect', 'ping', 'indexes', 'listen'] as const) {
    assert.ok(!startupErrorMessage(error, stage).includes('secret'));
  }
});
