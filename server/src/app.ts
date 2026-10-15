import { alertRoutes } from './modules/alerts/presentation/http/routes.js';
import express from 'express';
import type { Logger } from 'pino';
import type { UseCases } from './composition-root.js';
import { requestId } from './shared/http/request-id.js';
import { authentication } from './shared/http/authentication.js';
import { errorHandler } from './shared/http/error-handler.js';
import { AppError } from './shared/errors/app-error.js';
import { webhookRoutes } from './modules/webhooks/presentation/http/routes.js';
import { eventRoutes } from './modules/events/presentation/http/routes.js';
import { reservationRoutes } from './modules/reservations/presentation/http/routes.js';

export function createApp(useCases: UseCases, options: { apiKey: string; logger: Logger }) {
  const app = express();

  // Configurações do Express
  app.disable('x-powered-by');
  app.set('query parser', 'simple');

  app.use(requestId); // Middleware para gerar um ID único para cada requisição
  app.use((_req, res, next) => {
    const started = performance.now();
    res.on('finish', () => options.logger.info({ requestId: res.locals.requestId, status: res.statusCode, durationMs: Math.round(performance.now() - started) }, 'Requisição concluída'));
    next();
  }); // Middleware para logar o tempo de duração de cada requisição
  app.use(authentication(options.apiKey)); // Middleware para autenticar requisições usando uma chave de API
  app.use(express.json({ limit: '64kb', inflate: false })); // Middleware para parsear o corpo da requisição como JSON

  // Rotas da aplicação
  app.use('/webhooks', webhookRoutes(useCases.receiveWebhook));
  app.use('/alerts', alertRoutes(useCases.listAlerts));
  app.use('/events', eventRoutes(useCases.listEvents, useCases.listDeliveries));
  app.use('/reservations', reservationRoutes(useCases.listReservations));

  // Middleware para tratar rotas não encontradas
  app.use(() => { throw new AppError(404, 'NOT_FOUND', 'Rota não encontrada.'); });

  // Middleware para tratar erros de requisição HTTP
  app.use(errorHandler(options.logger));

  return app;
}
