import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { hash } from '../../modules/events/domain/hash.js';

// Middleware para autenticar requisições usando uma chave de API

// A chave não é comparada diretamente como texto. Ela é convertida para um hash SHA-256.
const digest = (value: string) => createHash('sha256').update(value).digest();

export function authentication(apiKey: string): RequestHandler {
  // A função recebe a chave correta das configurações
  const expected = digest(apiKey);

  return (req, _res, next) => {
    // Le do header da requisição
    const supplied = req.get('X-API-Key');

    // Lança erro 401
    if (!supplied || !timingSafeEqual(expected, digest(supplied)))
      throw new AppError(401, 'UNAUTHORIZED', 'Chave de API inválida.');

    next();
  };
}
