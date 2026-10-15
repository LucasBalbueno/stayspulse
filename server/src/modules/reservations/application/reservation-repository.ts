import type { StoredReservation } from '../domain/reservation.js';
export type { StoredReservation } from '../domain/reservation.js';
export interface ReservationRepository {
    find(source: string, reservationId: string): Promise<StoredReservation | null>;
    save(
        reservation: Omit<StoredReservation, 'id'>,
        id?: string,
    ): Promise<StoredReservation>;
    overlaps(reservation: StoredReservation): Promise<StoredReservation[]>;
}
