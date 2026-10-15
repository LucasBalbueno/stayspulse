import type { EventType, ReceivedEvent } from '../domain/event.js';
import type { Page, PageQuery } from '../../../shared/application/pagination.js';

export interface EventQuery extends PageQuery {
    source?: string;
    type?: EventType;
    reservationId?: string;
    propertyId?: string;
}

export interface EventReader {
    list(query: EventQuery): Promise<Page<ReceivedEvent>>;
}

export interface EventWriter {
    insert(event: Omit<ReceivedEvent, 'id'>): Promise<ReceivedEvent>;
}
