// Contrato de uma reserva
export interface Reservation {
  id: string;
  source: string;
  reservationId: string;
  propertyId: string;
  checkIn: string;
  checkOut: string;
  status: 'confirmed' | 'cancelled';
  updatedAt: Date;
}

// Contrato de uma reserva armazenada, com versão e hash de estado
export interface StoredReservation extends Reservation {
  sourceVersion: number;
  stateHash: string;
}
