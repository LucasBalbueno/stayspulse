import type { Prisma } from '@prisma/client';
import type { AlertRepository } from '../application/alert-repository.js';

export class PrismaAlertRepository implements AlertRepository {
    constructor(private readonly prisma: Prisma.TransactionClient) { }

    // Método para listar alertas de conflito, opcionalmente filtrando por propertyId
    async list(propertyId?: string) {
        return this.prisma.conflictAlert.findMany({
            where: { propertyId },
            orderBy: { updatedAt: 'desc' },
            take: 100,
        });
    }

    // Método para reconciliar alertas de reservas em conflito
    // Recebe a reserva atual, a propriedade, os conflitos encontrados e o horário atual
    async reconcile(
        id: string,
        propertyId: string,
        overlappingIds: string[],
        now: Date,
    ) {
        // Busca alertas existentes que envolvem as reservas
        const existing = await this.prisma.conflictAlert.findMany({
            where: { OR: [{ reservationA: id }, { reservationB: id }] },
        });

        // Verifica alertas existentes e atualiza o status conforme necessário
        for (const row of existing) {
            const other = row.reservationA === id ? row.reservationB : row.reservationA;
            const status = overlappingIds.includes(other) ? 'open' : 'resolved';

            // Atualiza o status do alerta se ele for diferente do status atual
            if (status !== row.status) {
                await this.prisma.conflictAlert.update({
                    where: { id: row.id },
                    data: {
                        status,
                        updatedAt: now,
                        history: [
                            ...(row.history as Prisma.JsonArray),
                            { status, at: now.toISOString() },
                        ] as Prisma.InputJsonValue,
                    },
                });
            }
        }

        // Verifica os alertas existentes e cria novos alertas para reservas em conflito que ainda não possuem um alerta
        // Para cada reserva em conflito, cria um par de reservas
        for (const other of overlappingIds) {
            const [reservationA, reservationB] = [id, other].sort() as [
                string,
                string,
            ];

            // Verifica se já existe um alerta para esse par
            if (
                !existing.some(
                    (row) =>
                        row.reservationA === reservationA && row.reservationB === reservationB,
                )
            ) {
                // Cria novo alerta de conflito
                await this.prisma.conflictAlert.create({
                    data: {
                        reservationA,
                        reservationB,
                        propertyId,
                        status: 'open',
                        updatedAt: now,
                        history: [{ status: 'open', at: now.toISOString() }],
                    },
                });
            }
        }
    }
}
