import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

// Middleware para gerar um ID único para cada requisição, que será usado para rastrear logs e erros.
export const requestId: RequestHandler = (_req, res, next) => {
  res.locals.requestId = randomUUID();
  res.setHeader('X-Request-ID', res.locals.requestId as string);
  next();
};