import type { ReservationEvent } from '@prisma/client';
import type { EventPayload, ReceivedEvent, EventStatus } from '../domain/event.js';

// Trasforma uma linha do banco de dados (ReservationEvent) em um objeto de domínio (ReceivedEvent)
export const toDomain = (row: ReservationEvent): ReceivedEvent => ({
    id: row.id,
    eventId: row.eventId,
    schemaVersion: 1,
    type: row.type as ReceivedEvent['type'],
    source: row.source,
    reservationId: row.reservationId,
    occurredAt: row.occurredAt,
    receivedAt: row.receivedAt,
    requestId: row.requestId,
    status: row.status as EventStatus,
    propertyId: row.propertyId ?? undefined,
    payload: row.payload as unknown as EventPayload,
    originalPayload: row.originalPayload,
    reason: row.reason ?? undefined,
    processedAt: row.processedAt ?? undefined,
    attempts: row.attempts,
    history: row.history,
});
