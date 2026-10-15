import type { Prisma } from '@prisma/client';
import type { AlertRepository } from '../application/alert-repository.js';

export class PrismaAlertRepository implements AlertRepository {
    constructor(private readonly prisma: Prisma.TransactionClient) { }

    async list(propertyId?: string) {
        return this.prisma.conflictAlert.findMany({
            where: { propertyId },
            orderBy: { updatedAt: 'desc' },
            take: 100,
        });
    }

    async reconcile(
        id: string,
        propertyId: string,
        overlappingIds: string[],
        now: Date,
    ) {
        const existing = await this.prisma.conflictAlert.findMany({
            where: { OR: [{ reservationA: id }, { reservationB: id }] },
        });

        for (const row of existing) {
            const other = row.reservationA === id ? row.reservationB : row.reservationA;
            const status = overlappingIds.includes(other) ? 'open' : 'resolved';

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

        for (const other of overlappingIds) {
            const [reservationA, reservationB] = [id, other].sort() as [
                string,
                string,
            ];

            if (
                !existing.some(
                    (row) =>
                        row.reservationA === reservationA && row.reservationB === reservationB,
                )
            ) {
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
