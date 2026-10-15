import type { Prisma, Reservation as Row } from '@prisma/client';
import type { StoredReservation, ReservationRepository } from '../application/reservation-repository.js';
import type { ReservationQuery, ReservationReader } from '../application/list-reservations.js';
import { page } from '../../../infrastructure/database/pagination.js';

const toDomain = (row: Row): StoredReservation => ({
    ...row,
    reservationId: row.externalReservationId,
    checkIn: row.checkIn.toISOString().slice(0, 10),
    checkOut: row.checkOut.toISOString().slice(0, 10),
    status: row.status as StoredReservation['status'],
});

export class PrismaReservationRepository implements ReservationReader, ReservationRepository {
    constructor(private readonly prisma: Prisma.TransactionClient) { }

    async find(source: string, externalReservationId: string) {
        const row = await this.prisma.reservation.findUnique({
            where: {
                source_externalReservationId: { source, externalReservationId },
            },
        });

        return row ? toDomain(row) : null;
    }

    async save(value: Omit<StoredReservation, 'id'>, id?: string) {
        const { reservationId, checkIn, checkOut, ...rest } = value;
        const data = {
            ...rest,
            externalReservationId: reservationId,
            checkIn: new Date(`${checkIn}T00:00:00.000Z`),
            checkOut: new Date(`${checkOut}T00:00:00.000Z`),
        };

        const row = id
            ? await this.prisma.reservation.update({ where: { id }, data })
            : await this.prisma.reservation.create({ data });

        return toDomain(row);
    }

    async overlaps(value: StoredReservation) {
        const rows = await this.prisma.reservation.findMany({
            where: {
                propertyId: value.propertyId,
                status: 'confirmed',
                id: { not: value.id },
                checkIn: { lt: new Date(value.checkOut) },
                checkOut: { gt: new Date(value.checkIn) },
            },
        });

        return rows.map(toDomain);
    }

    async list({ limit, cursor, ...filters }: ReservationQuery) {
        const rows = await this.prisma.reservation.findMany({
            where: {
                ...filters,
                ...(cursor
                    ? {
                        OR: [
                            { updatedAt: { lt: new Date(cursor.date) } },
                            {
                                updatedAt: new Date(cursor.date),
                                id: { lt: cursor.id },
                            },
                        ],
                    }
                    : {}),
            },
            orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
            take: limit + 1,
        });

        return page(rows.map(toDomain), limit, (row) => row.updatedAt);
    }
}
