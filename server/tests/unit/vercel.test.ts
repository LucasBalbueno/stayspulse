import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import app from '../../src/app.js';

test('entrada Vercel exporta aplicação HTTP com liveness sem banco', async () => {
  assert.equal(typeof app, 'function');
  const response = await request(app).get('/').expect(200);
  assert.equal(response.body.service, 'StayPulse API');
  await request(app).get('/health').expect(200);
});

test('entrada Vercel responde 503 para configuração ausente sem expor credenciais', async () => {
  const previous = process.env.API_KEY;
  try {
    delete process.env.API_KEY;
    const response = await request(app).get('/events').expect(503);
    assert.equal(response.body.error.code, 'SERVICE_UNAVAILABLE');
  } finally {
    if (previous !== undefined) process.env.API_KEY = previous;
  }
});
