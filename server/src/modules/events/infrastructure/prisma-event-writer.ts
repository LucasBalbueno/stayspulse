import { Prisma, type ReservationEvent, type PrismaClient } from '@prisma/client';
import type { ReceivedEvent } from '../domain/event.js';
import type { EventWriter } from '../application/event-repository.js';
import { hash } from '../domain/hash.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { toDomain } from './prisma-event-mapper.js';

export class PrismaEventWriter implements EventWriter {
    constructor(
        private readonly prisma: Prisma.TransactionClient,
        private readonly root?: PrismaClient,
    ) {}

    // O método insert é responsável por persistir um novo evento no banco de dados
    // Ele recebe um objeto do tipo ReceivedEvent (sem o campo id) e realiza algumas operações

    async insert(event: Omit<ReceivedEvent, 'id'>) {
        // 1. Calcula o hash do payload original do evento.
        // Isso permite saber se duas entregas possuem o mesmo conteúdo.
        const originalPayload =
        (event.originalPayload ?? event.payload) as Prisma.InputJsonValue;
        const payloadHash = hash(originalPayload);
        let row: ReservationEvent | undefined;
        
        // Dentro de um loop, tenta persistir o evento no banco de dados, lidando com possíveis conflitos e erros de concorrência.
        for (let attempt = 0; ; attempt++) {
            try {
                // 2. Tenta criar uma nova entrada na tabela reservationEvent com os dados do evento.
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
                    
                    // 3. Cria uma entrada na tabela webhookDelivery para registrar a tentativa de entrega do evento
                    // Cada vez que um evento é processado, uma nova entrada é criada na tabela webhookDelivery, registrando o resultado da entrega (aceito, rejeitado, inconsistente, etc.) e o payload enviado
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
                
                // Se a transação raiz estiver disponível, utiliza-a para criar o evento e a entrega, caso contrário, cria apenas o evento.
                const created = this.root
                ? await this.root.$transaction(create)
                : await create(this.prisma);
                return toDomain(created); // Retorno quando o evento é criado com sucesso, transformando a linha do banco em um objeto de domínio.
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
            
            // 4. Caso ocorra um erro de conflito (P2002), verifica se o evento já existe no banco e registra a entrega como inconsistente, lançando um erro de conflito.
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

        // Verfificando o conteúdo do evento existente no banco de dados com o conteúdo do evento que está sendo inserido
        // Se forem iguais é a repetição da mesma entrega
        // Se não forem iguais, o mesmo identificado está sendo usado para conteúdos diferentes
        const mismatch = row.payloadHash !== payloadHash;
        // Mesmo que o evento já exista ele faz o registro de criação
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

}
