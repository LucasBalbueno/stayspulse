import type { Reservation } from '../domain/reservation.js';
import type { Page, PageQuery } from '../../../shared/application/pagination.js';

// Contrato de casos de uso de leitura/listagem de reservas

// Contrato de consulta de reservas
export interface ReservationQuery extends PageQuery {
  source?: string;
  status?: Reservation['status'];
  propertyId?: string;
}

// Contrato de leitura/listagem de reservas
export interface ReservationReader {
  list(query: ReservationQuery): Promise<Page<Reservation>>;
}

export class ListReservations {
  constructor(private readonly reader: ReservationReader) { }
  execute(query: ReservationQuery) { return this.reader.list(query); }
}
