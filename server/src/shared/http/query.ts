import { z } from 'zod';

// Valida o identificador
export const identifier = z.string().trim().min(1).max(200);

// Valida o cursor de paginação
const cursorValue = z.object({ date: z.iso.datetime(), id: z.string().regex(/^[a-f0-9]{24}$/) }).strict();

// Valida os parâmetros de paginação
export const pageQuery = z.object({
  limit: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().max(100)).default(20),
  cursor: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/).transform((value, ctx) => {
    try {
      return cursorValue.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Cursor inválido.' });
      return z.NEVER;
    }
  }).optional(),
});

// Valida o tipo de evento (ENUM)
export const eventType = z.enum([
  'reservation.created',
  'reservation.updated',
  'reservation.cancelled'
]);
