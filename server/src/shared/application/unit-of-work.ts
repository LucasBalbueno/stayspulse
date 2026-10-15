import type { ReservationRepository } from '../../modules/reservations/application/reservation-repository.js';
import type { ProcessingEventRepository } from '../../modules/events/application/processing-event-repository.js';
import type { AlertRepository } from '../../modules/alerts/application/alert-repository.js';

export interface TransactionRepositories {
    reservations: ReservationRepository;
    events: ProcessingEventRepository;
    alerts: AlertRepository;
    // Mecanismo para coordenar o processamento de eventos da mesma propriedade.
    lockProperty(propertyId: string): Promise<void>
}

// Representa uma unidade de trabalho transacional (genérica)
export interface UnitOfWork {
    execute<T>(
        operation: (repositories: TransactionRepositories) => Promise<T>
    ): Promise<T>
}
