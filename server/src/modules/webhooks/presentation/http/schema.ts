import { z } from 'zod';
import { identifier } from '../../../../shared/http/query.js';

// Usa Zod para validar o payload do webhook recebido
// Snapshot representa a estrutura de dados de uma reserva
const snapshot = z
  .object({
    reservationId: identifier,
    propertyId: identifier,
    checkIn: z.iso.date(),
    checkOut: z.iso.date(),
    status: z.literal('confirmed'),
  })
  .strict()
  .refine(reservation => reservation.checkOut > reservation.checkIn, {
    path: ['checkOut'],
    message: 'Deve ser posterior ao checkIn.',
  });

// Define a estrutura base do payload do webhook
// Inclui campos comuns a todos os tipos de eventos
const base = {
  sourceVersion: z.number().int().min(0).max(2147483647),
  eventId: identifier,
  source: identifier,
  occurredAt: z.iso.datetime({ offset: true }),
};

// Define o esquema de validação do webhook usando uma união discriminada com base no tipo de evento
// Validação dinâmica pelo tipo do evento
export const webhookSchema = z.discriminatedUnion('type', [
  // Define o esquema para eventos de criação de reserva
  z.object({
    ...base,
    type: z.literal('reservation.created'),
    reservation: snapshot,
  })
    .strict(),
  // Define o esquema para eventos de atualização de reserva
  z.object({
    ...base,
    type: z.literal('reservation.updated'),
    reservation: snapshot,
  })
    .strict(),
  // Define o esquema para eventos de cancelamento de reserva
  z.object({
    ...base,
    type: z.literal('reservation.cancelled'),
    reservation: z
      .object({
        reservationId: identifier,
        propertyId: identifier.optional(),
        status: z.literal('cancelled'),
      })
      .strict(),
  })
    .strict(),
]);
