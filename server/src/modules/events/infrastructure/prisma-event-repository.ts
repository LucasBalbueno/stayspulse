import type { Prisma, PrismaClient } from '@prisma/client';
import type { PageQuery } from '../../../shared/application/pagination.js';
import type { ReceivedEvent, EventStatus } from '../domain/event.js';
import type { EventQuery, EventReader, EventWriter } from '../application/event-repository.js';
import type { DeliveryReader } from '../application/list-deliveries.js';
import type { ProcessingEventRepository } from '../application/processing-event-repository.js';
import { PrismaEventReader } from './prisma-event-reader.js';
import { PrismaEventWriter } from './prisma-event-writer.js';
import { PrismaProcessingEventRepository } from './prisma-processing-event-repository.js';

// O PrismaEventRepository é a implementação responsável por persistir, consultar e controlar o processamento dos eventos de reserva no banco MongoDB através do Prisma.
// Após o evento passar pelo Caso de Uso, ele é persistido no banco de dados e fica disponível para ser processado por outros serviços, como o serviço de Webhooks.

// O PrismaEventRepository concentra o acesso ao banco
// Implementa contratos de leitura, escrita e processamento de eventos
// Delega cada responsabilidade para sua implementação especializada.
export class PrismaEventRepository implements EventReader, EventWriter, DeliveryReader, ProcessingEventRepository {
    private readonly reader: PrismaEventReader;
    private readonly writer: PrismaEventWriter;
    private readonly processing: PrismaProcessingEventRepository;

    constructor(prisma: Prisma.TransactionClient, root?: PrismaClient) {
        this.reader = new PrismaEventReader(prisma);
        this.writer = new PrismaEventWriter(prisma, root);
        this.processing = new PrismaProcessingEventRepository(prisma);
    }

    insert(event: Omit<ReceivedEvent, 'id'>) {
        return this.writer.insert(event);
    }

    list(query: EventQuery) {
        return this.reader.list(query);
    }

    deliveries(eventId: string, query: PageQuery) {
        return this.reader.deliveries(eventId, query);
    }

    claim(now: Date) {
        return this.processing.claim(now);
    }

    finish(id: string, token: string, status: EventStatus, reason: string, now: Date, nextAttemptAt = now) {
        return this.processing.finish(id, token, status, reason, now, nextAttemptAt);
    }

    wake(source: string, reservationId: string, now: Date) {
        return this.processing.wake(source, reservationId, now);
    }
}
