import type { Reservation } from '../domain/reservation.js';
import type { Page, PageQuery } from '../../../shared/application/pagination.js';
export interface ReservationQuery extends PageQuery {
  source?: string;
  status?: Reservation['status'];
  propertyId?: string;
}
export interface ReservationReader {
  list(query: ReservationQuery): Promise<Page<Reservation>>;
}
export class ListReservations {
  constructor(private readonly reader: ReservationReader) { }
  execute(query: ReservationQuery) { return this.reader.list(query); }
}
