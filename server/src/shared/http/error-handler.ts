import { isPrismaUnavailable } from '../../infrastructure/database/prisma-errors.js';
import type { ErrorRequestHandler } from 'express';
import type { Logger } from 'pino';
import { ZodError } from 'zod';
import { MongoNetworkError, MongoServerSelectionError, MongoOperationTimeoutError, MongoError } from 'mongodb';
import { AppError } from '../errors/app-error.js';

// Middleware para tratar erros de requisição HTTP
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, _req, res, _next) => {
    // Erro 500 genérico
    let failure = new AppError(500, 'INTERNAL_ERROR', 'Erro interno.');

    // Verifica o tipo de erro e define a resposta apropriada
    // Se for um AppError, usa o próprio erro
    if (error instanceof AppError) failure = error;

    // Se for um erro de validação do Zod, cria um AppError 422 com detalhes dos campos inválidos
    else if (error instanceof ZodError)
      failure = new AppError(422, 'VALIDATION_ERROR', 'A requisição contém campos inválidos.', error.issues.map(i => ({
        field: i.path.join('.'),
        message: i.message
      })));

    // Se for um erro de banco de dados, cria um AppError 503 indicando que o banco está indisponível
    else if (isPrismaUnavailable(error) ||
      error instanceof MongoNetworkError ||
      error instanceof MongoServerSelectionError ||
      error instanceof MongoOperationTimeoutError ||
      (error instanceof MongoError && ['MongoWaitQueueTimeoutError', 'MongoPoolClearedError'].includes(error.name)))
      failure = new AppError(503, 'DATABASE_UNAVAILABLE', 'Banco de dados temporariamente indisponível.');

    // Se for um erro de parsing do corpo da requisição, cria um AppError 400 indicando que o JSON está mal formado
    else if (typeof error === 'object' && error !== null && 'type' in error) {
      if (error.type === 'entity.parse.failed')
        failure = new AppError(400, 'INVALID_JSON', 'JSON malformado.');

      if (error.type === 'entity.too.large')
        failure = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Corpo excede o limite de 64 KB.');

      if (error.type === 'encoding.unsupported' ||
        error.type === 'charset.unsupported')
        failure = new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Codificação não suportada.');
    }

    // Se for um erro de requisição inválida, cria um AppError 400 indicando que a requisição é inválida
    if (failure.status >= 500)
      logger.error({
        requestId: res.locals.requestId,
        code: failure.code
      }, 'Falha na requisição');

    // Retorna a resposta de erro com o status e o corpo apropriados
    res.status(failure.status).json({
      error: {
        code: failure.code,
        message: failure.message,
        ...(failure.details ? { details: failure.details } : {}),
        requestId: res.locals.requestId
      }
    });
  };
}
