import type { Prisma } from '@prisma/client';
import type { PageQuery } from '../../../shared/application/pagination.js';
import type { EventQuery, EventReader } from '../application/event-repository.js';
import type { DeliveryReader } from '../application/list-deliveries.js';
import { page } from '../../../infrastructure/database/pagination.js';
import { toDomain } from './prisma-event-mapper.js';

export class PrismaEventReader implements EventReader, DeliveryReader {
    constructor(private readonly prisma: Prisma.TransactionClient) {}

    // O método list serve para buscar eventos
    async list({ limit, cursor, ...filters }: EventQuery) {
        const rows = await this.prisma.reservationEvent.findMany({
            where: {
                ...filters,
                ...(cursor
                    ? {
                        OR: [
                            { receivedAt: { lt: new Date(cursor.date) } },
                            {
                                receivedAt: new Date(cursor.date),
                                id: { lt: cursor.id },
                            },
                        ],
                    }
                    : {}),
            },
            orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
            take: limit + 1,
        });

        return page(rows.map(toDomain), limit, (row) => row.receivedAt);
    }

    // O método deliveries busca as tentativas de entrega de um evento em webhookDelivery
    async deliveries(eventId: string, { limit, cursor }: PageQuery) {
        const rows = await this.prisma.webhookDelivery.findMany({
            where: {
                eventId,
                ...(cursor
                    ? {
                        OR: [
                            { receivedAt: { lt: new Date(cursor.date) } },
                            {
                                receivedAt: new Date(cursor.date),
                                id: { lt: cursor.id },
                            },
                        ],
                    }
                    : {}),
            },
            orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
            take: limit + 1,
        });

        return page(
            rows.map(({ id, eventId, requestId, receivedAt, payload, outcome }) => ({
                id,
                eventId,
                requestId,
                receivedAt,
                payload,
                outcome,
            })),
            limit,
            (row) => row.receivedAt,
        );
    }

}
