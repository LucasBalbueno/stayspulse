import type { Page, PageQuery } from '../../../shared/application/pagination.js';

export interface Delivery {
    id: string;
    eventId: string;
    requestId: string;
    receivedAt: Date;
    payload: unknown;
    outcome: string;
}

export interface DeliveryReader {
    deliveries(eventId: string, query: PageQuery): Promise<Page<Delivery>>;
}

export class ListDeliveries {
    constructor(private readonly reader: DeliveryReader) { }

    execute(eventId: string, query: PageQuery) {
        return this.reader.deliveries(eventId, query);
    }
}
