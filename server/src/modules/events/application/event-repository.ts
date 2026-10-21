import type { EventType, ReceivedEvent } from '../domain/event.js';
import type { Page, PageQuery } from '../../../shared/application/pagination.js';

// Controlar o processamento básico concorrente dos eventos
export interface EventQuery extends PageQuery {
    source?: string;
    type?: EventType;
    reservationId?: string;
    propertyId?: string;
}

// Ler/listar eventos
export interface EventReader {
    list(query: EventQuery): Promise<Page<ReceivedEvent>>;
}

// Registrar novos eventos
export interface EventWriter {
    insert(event: Omit<ReceivedEvent, 'id'>): Promise<ReceivedEvent>;
}
