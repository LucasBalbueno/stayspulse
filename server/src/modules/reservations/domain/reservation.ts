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

export interface StoredReservation extends Reservation {
  sourceVersion: number;
  stateHash: string;
}
