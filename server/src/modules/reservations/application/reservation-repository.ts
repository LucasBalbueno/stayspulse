import type { StoredReservation } from '../domain/reservation.js';
export type { StoredReservation } from '../domain/reservation.js';

// Contrato de persistência de reservas
export interface ReservationRepository {
    // Procura uma reserva
    find(source: string, reservationId: string): Promise<StoredReservation | null>;
    // Salva uma reserva
    save(
        reservation: Omit<StoredReservation, 'id'>,
        id?: string,
    ): Promise<StoredReservation>;
    // Procura outras reservas que ocupam a mesma propriedade no mesmo período (Sobreposição)
    overlaps(reservation: StoredReservation): Promise<StoredReservation[]>;
}
