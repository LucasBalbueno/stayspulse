export type EventType =
  | 'reservation.created'
  | 'reservation.updated'
  | 'reservation.cancelled';

export interface ReservationSnapshot {
  reservationId: string;
  propertyId: string;
  checkIn: string;
  checkOut: string;
  status: 'confirmed';
}

export type EventPayload = {
  eventId: string;
  source: string;
  sourceVersion: number;
  occurredAt: string;
} & (
    | {
      type: 'reservation.created' | 'reservation.updated';
      reservation: ReservationSnapshot;
    }
    | {
      type: 'reservation.cancelled';
      reservation: {
        reservationId: string;
        propertyId?: string;
        status: 'cancelled';
      };
    }
  );

export interface ReceivedEvent {
  id: string;
  eventId: string;
  schemaVersion: 1;
  type: EventType;
  source: string;
  reservationId: string;
  propertyId?: string;
  occurredAt: Date;
  receivedAt: Date;
  reason?: string;
  processedAt?: Date;
  attempts?: number;
  history?: unknown;
  originalPayload?: unknown;
  status: EventStatus;
  payload: EventPayload;
  requestId: string;
}

export type EventStatus =
  | 'received'
  | 'processing'
  | 'pending_reference'
  | 'completed'
  | 'ignored'
  | 'rejected'
  | 'failed';
