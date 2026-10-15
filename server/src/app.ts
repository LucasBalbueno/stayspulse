import express from 'express';
import { pino } from 'pino';
import { createApp } from './create-app.js';
import { readEnv } from './config/env.js';
import { compose } from './composition-root.js';
import { createPrismaClient } from './infrastructure/database/prisma-client.js';

export { createApp } from './create-app.js';

// Entrada reconhecida pela Vercel. Inicialização tardia mantém imports e health
// independentes das credenciais e reutiliza o pool Prisma por instância quente.
const app = express();
app.disable('x-powered-by');
app.get('/', (_req, res) => {
  res.json({ service: 'StayPulse API', status: 'ok' });
});
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

let api: ReturnType<typeof createApp> | undefined;
app.use((req, res, next) => {
  if (!api) {
    try {
      const env = readEnv(process.env);
      const prisma = createPrismaClient(env.MONGODB_URI);
      api = createApp(compose(prisma), {
        apiKey: env.API_KEY,
        logger: pino({ level: env.LOG_LEVEL }),
        processOnRequest: true,
      });
    } catch {
      console.error('Falha ao configurar API. Verifique MONGODB_URI e API_KEY.');
      res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'API indisponível.' } });
      return;
    }
  }
  api(req, res, next);
});

export default app;
