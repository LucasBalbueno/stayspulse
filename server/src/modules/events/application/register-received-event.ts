import type { EventWriter } from './event-repository.js';
import type { EventPayload } from '../domain/event.js';

// Registra um evento que acabou de chegar
export class RegisterReceivedEvent {
  constructor(
    private readonly writer: EventWriter, // Repositório para escrita de eventos
    private readonly now: () => Date = () => new Date(), // Função para obter a data/hora atual
  ) { }

  // Executa o registro do evento recebido
  async execute(payload: EventPayload, requestId: string, originalPayload: unknown = payload) {
    const event = await this.writer.insert({
      eventId: payload.eventId,
      schemaVersion: 1,
      type: payload.type,
      source: payload.source,
      reservationId: payload.reservation.reservationId,
      ...(payload.reservation.propertyId
        ? { propertyId: payload.reservation.propertyId }
        : {}),
      occurredAt: new Date(payload.occurredAt),
      receivedAt: this.now(),
      status: 'received',
      payload,
      requestId,
      originalPayload,
    });

    return { id: event.id, eventId: event.eventId, status: event.status };
  }
}
