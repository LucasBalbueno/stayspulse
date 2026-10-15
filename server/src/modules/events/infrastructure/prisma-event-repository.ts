import type { PageQuery } from '../../../shared/application/pagination.js';
import { Prisma, type ReservationEvent, type PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { EventPayload, ReceivedEvent, EventStatus } from '../domain/event.js';
import type { EventQuery, EventReader, EventWriter } from '../application/event-repository.js';
import type { ProcessingEventRepository, ClaimedEvent } from '../application/processing-event-repository.js';
import { page } from '../../../infrastructure/database/pagination.js';
import { hash } from '../domain/hash.js';
import { AppError } from '../../../shared/errors/app-error.js';

const toDomain = (row: ReservationEvent): ReceivedEvent => ({
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

export class PrismaEventRepository implements EventReader, EventWriter, ProcessingEventRepository {
    constructor(
        private readonly prisma: Prisma.TransactionClient,
        private readonly root?: PrismaClient,
    ) { }

    async insert(event: Omit<ReceivedEvent, 'id'>) {
        const originalPayload =
            (event.originalPayload ?? event.payload) as Prisma.InputJsonValue;
        const payloadHash = hash(originalPayload);
        let row: ReservationEvent | undefined;

        for (let attempt = 0; ; attempt++) {
            try {
                const create = async (tx: Prisma.TransactionClient) => {
                    const created = await tx.reservationEvent.create({
                        data: {
                            ...event,
                            history: [],
                            originalPayload,
                            payload: event.payload as unknown as Prisma.InputJsonValue,
                            payloadHash,
                            sourceVersion: event.payload.sourceVersion,
                            nextAttemptAt: event.receivedAt,
                            leaseToken: null,
                            leaseUntil: null,
                        },
                    });

                    await tx.webhookDelivery.create({
                        data: {
                            eventId: created.id,
                            requestId: event.requestId,
                            receivedAt: event.receivedAt,
                            payload: originalPayload,
                            payloadHash,
                            outcome: 'accepted',
                        },
                    });

                    return created;
                };

                const created = this.root
                    ? await this.root.$transaction(create)
                    : await create(this.prisma);
                return toDomain(created);
            } catch (error) {
                if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
                    throw error;
                }

                if (error.code === 'P2034' && attempt < 4) {
                    await new Promise((resolve) =>
                        setTimeout(resolve, 20 * 2 ** attempt),
                    );
                    continue;
                }

                if (error.code !== 'P2002') throw error;

                const existing = await this.prisma.reservationEvent.findUnique({
                    where: {
                        source_eventId: {
                            source: event.source,
                            eventId: event.eventId,
                        },
                    },
                });

                if (!existing) throw error;
                row = existing;
                break;
            }
        }

        const mismatch = row.payloadHash !== payloadHash;
        await this.prisma.webhookDelivery.create({
            data: {
                eventId: row.id,
                requestId: event.requestId,
                receivedAt: event.receivedAt,
                payload: originalPayload,
                payloadHash,
                outcome: mismatch ? 'inconsistent' : 'accepted',
            },
        });

        if (mismatch) {
            throw new AppError(
                409,
                'EVENT_CONTENT_CONFLICT',
                'Identificador de evento reutilizado com conteúdo diferente.',
            );
        }

        return toDomain(row);
    }

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

    async claim(now: Date): Promise<ClaimedEvent | null> {
        const eligible: Prisma.ReservationEventWhereInput = {
            OR: [
                {
                    status: { in: ['received', 'pending_reference'] },
                    nextAttemptAt: { lte: now },
                },
                { status: 'processing', leaseUntil: { lte: now } },
            ],
        };
        const candidate = await this.prisma.reservationEvent.findFirst({
            where: eligible,
            orderBy: { nextAttemptAt: 'asc' },
        });

        if (!candidate) return null;

        const leaseToken = randomUUID();
        const result = await this.prisma.reservationEvent.updateMany({
            where: { id: candidate.id, ...eligible },
            data: {
                status: 'processing',
                history: [
                    ...(candidate.history as Prisma.JsonArray),
                    { status: 'processing', at: now.toISOString() },
                ] as Prisma.InputJsonValue,
                leaseToken,
                leaseUntil: new Date(now.getTime() + 30000),
                attempts: { increment: 1 },
            },
        });

        if (result.count !== 1) return null;

        return {
            ...toDomain(candidate),
            status: 'processing',
            leaseToken,
            attempts: candidate.attempts + 1,
        };
    }

    async finish(
        id: string,
        token: string,
        status: EventStatus,
        reason: string,
        now: Date,
        nextAttemptAt = now,
    ) {
        const current = await this.prisma.reservationEvent.findUniqueOrThrow({
            where: { id },
        });
        const result = await this.prisma.reservationEvent.updateMany({
            where: {
                id,
                status: 'processing',
                leaseToken: token,
                leaseUntil: { gt: now },
            },
            data: {
                status,
                reason,
                history: [
                    ...(current.history as Prisma.JsonArray),
                    { status, reason, at: now.toISOString() },
                ] as Prisma.InputJsonValue,
                processedAt: ['completed', 'ignored', 'rejected', 'failed'].includes(
                    status,
                )
                    ? now
                    : null,
                nextAttemptAt,
                leaseToken: null,
                leaseUntil: null,
            },
        });

        if (result.count !== 1) throw new Error('Lease perdida.');
    }

    async wake(source: string, reservationId: string, now: Date) {
        await this.prisma.reservationEvent.updateMany({
            where: { source, reservationId, status: 'pending_reference' },
            data: { nextAttemptAt: now },
        });
    }
}
