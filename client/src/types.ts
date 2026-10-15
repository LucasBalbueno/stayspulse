export type EventType =
  | "reservation.created"
  | "reservation.updated"
  | "reservation.cancelled";
export type EventStatus =
  | "received"
  | "processing"
  | "pending_reference"
  | "completed"
  | "ignored"
  | "rejected"
  | "failed";
export type Payload = {
  eventId: string;
  source: string;
  sourceVersion: number;
  occurredAt: string;
} & (
  | {
      type: "reservation.created" | "reservation.updated";
      reservation: {
        reservationId: string;
        propertyId: string;
        checkIn: string;
        checkOut: string;
        status: "confirmed";
      };
    }
  | {
      type: "reservation.cancelled";
      reservation: {
        reservationId: string;
        propertyId?: string;
        status: "cancelled";
      };
    }
);
export interface Transition {
  status: string;
  at: string;
  reason?: string;
}
export interface Event {
  id: string;
  eventId: string;
  type: EventType;
  source: string;
  reservationId: string;
  propertyId?: string;
  occurredAt: string;
  receivedAt: string;
  processedAt?: string;
  status: EventStatus;
  reason?: string;
  attempts?: number;
  payload: Payload;
  originalPayload?: unknown;
  requestId: string;
  history?: Transition[];
}
export interface Reservation {
  id: string;
  source: string;
  reservationId: string;
  propertyId: string;
  checkIn: string;
  checkOut: string;
  sourceVersion: number;
  status: "confirmed" | "cancelled";
  updatedAt: string;
}
export interface Alert {
  id: string;
  reservationA: string;
  reservationB: string;
  propertyId: string;
  status: string;
  history: Transition[];
  updatedAt: string;
}
export interface Delivery {
  id: string;
  eventId: string;
  requestId: string;
  receivedAt: string;
  payload: unknown;
  outcome: string;
}
export interface Page<T> {
  data: T[];
  pagination: { nextCursor: string | null; hasMore: boolean };
}
export interface Receipt {
  id: string;
  eventId: string;
  status: EventStatus;
}
export type Query = Record<string, string | number | undefined>;
