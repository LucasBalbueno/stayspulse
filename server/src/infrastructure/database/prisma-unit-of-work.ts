import { Prisma, type PrismaClient } from '@prisma/client';
import type { UnitOfWork, TransactionRepositories } from '../../shared/application/unit-of-work.js';
import { PrismaEventRepository } from '../../modules/events/infrastructure/prisma-event-repository.js';
import { PrismaReservationRepository } from '../../modules/reservations/infrastructure/prisma-reservation-repository.js';
import { PrismaAlertRepository } from '../../modules/alerts/infrastructure/prisma-alert-repository.js';

// Worker em ciclo para executar operações transacionais com o Banco
export class PrismaUnitOfWork implements UnitOfWork {
    // Dependency Injection com PrismaClient
    constructor(private readonly prisma: PrismaClient) { }

    async execute<T>(operation: (repositories: TransactionRepositories) => Promise<T>): Promise<T> {
        for (let attempt = 0; ; attempt++) {
            try {
                // O Prisma abre uma transação e fornece o objeto para cada repositório
                // Se a terceira operação falhar, a reserva e o alerta também são revertidos.
                return await this.prisma.$transaction(async tx => operation({
                    events: new PrismaEventRepository(tx),
                    reservations: new PrismaReservationRepository(tx),
                    alerts: new PrismaAlertRepository(tx),

                    // Garante a persistência de eventos da mesma propriedade, evitando que dois workers processem eventos da mesma propriedade ao mesmo tempo.
                    lockProperty: async propertyId => {
                        await tx.propertyGuard.upsert({
                            where: { propertyId },
                            create: { propertyId, revision: 1 },
                            update: { revision: { increment: 1 } }
                        });
                    }
                }), {
                    // Temps de espera e execução de cada worker
                    maxWait: 5000,
                    timeout: 10000
                });
            } catch (error) {
                // Evita erros repetidos
                // Configura um limite de tentativas para evitar loops infinitos (5)
                // As tentativas ficam progressivamente mais espaçadas e recebem uma pequena aleatoriedade
                if (
                    attempt >= 4 ||
                    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
                    !['P2034', 'P2002'].includes(error.code))
                    throw error;
                await new Promise(resolve => setTimeout(resolve, 20 * 2 ** attempt + Math.random() * 20));
            }
        }
    }
}
