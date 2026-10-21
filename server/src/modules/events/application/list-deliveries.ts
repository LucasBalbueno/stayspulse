import type { Page, PageQuery } from '../../../shared/application/pagination.js';

// Entrega = webhook que foi disparado para um evento

// Define o formato de uma entrega
export interface Delivery {
    id: string;
    eventId: string;
    requestId: string;
    receivedAt: Date;
    payload: unknown;
    outcome: string;
}

// Define o contrato para ler entregas
export interface DeliveryReader {
    deliveries(eventId: string, query: PageQuery): Promise<Page<Delivery>>;
}

// Lista as entregas de um evento específico
export class ListDeliveries {
    constructor(private readonly reader: DeliveryReader) { }
    
    execute(eventId: string, query: PageQuery) {
        return this.reader.deliveries(eventId, query);
    }
}
