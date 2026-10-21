import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { EventStatus } from '../domain/event.js';
import type { ProcessingEventRepository, ClaimedEvent } from '../application/processing-event-repository.js';
import { toDomain } from './prisma-event-mapper.js';

export class PrismaProcessingEventRepository implements ProcessingEventRepository {
    constructor(private readonly prisma: Prisma.TransactionClient) {}

    // O método claim é responsável por buscar um evento elegível para processamento, marcá-lo como "processing" e retornar o evento com um token de lease.
    // Aqui o worker que processa o evento adquire um "lease" (uma espécie de bloqueio temporário) para garantir que nenhum outro worker processe o mesmo evento simultaneamente.
    async claim(now: Date): Promise<ClaimedEvent | null> {
        // Lista quais eventos podem ser processados
        const eligible: Prisma.ReservationEventWhereInput = {
            OR: [
                {
                    status: { in: ['received', 'pending_reference'] },
                    nextAttemptAt: { lte: now },
                },
                { status: 'processing', leaseUntil: { lte: now } },
            ],
        };
        
        // Escolhe o worker candidato por ordem de tempo (nextAttemptAt - mais antigo primeiro)
        const candidate = await this.prisma.reservationEvent.findFirst({
            where: eligible,
            orderBy: { nextAttemptAt: 'asc' },
        });

        if (!candidate) return null;

        // O worker recebe um token aleatório
        const leaseToken = randomUUID();

        // Todo o evento possui um histórico de workers que tentaram processá-lo, com o status e a data da tentativa
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

    // O método finish é responsável por finalizar o processamento de um evento, atualizando seu status, registrando o motivo da finalização e liberando o lease.
    async finish(
        id: string,
        token: string,
        status: EventStatus,
        reason: string,
        now: Date,
        nextAttemptAt = now,
    ) {
        // Buscando o evento atual no banco de dados para obter seu histórico e outros detalhes
        const current = await this.prisma.reservationEvent.findUniqueOrThrow({
            where: { id },
        });

        // Verifica se o status do evento é "processing" e se o token de lease corresponde
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

    // O método wake é responsável por "acordar" eventos que estão em estado de "pending_reference", atualizando seu nextAttemptAt para a data atual.
    async wake(source: string, reservationId: string, now: Date) {
        await this.prisma.reservationEvent.updateMany({
            where: { source, reservationId, status: 'pending_reference' },
            data: { nextAttemptAt: now },
        });
    }
}
