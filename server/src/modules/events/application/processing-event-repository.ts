import type { ReceivedEvent, EventStatus } from '../domain/event.js';

// Contrato para eventos que foram revindicados para processamento
export interface ClaimedEvent extends ReceivedEvent {
    leaseToken: string;
    attempts: number;
}

// Define o contrato para o repositório que controla o processamento dos eventos.
export interface ProcessingEventRepository {
    // Claim pega um evento pronto apra ser processado e marca "em processamento"
    claim(now: Date): Promise<ClaimedEvent | null>;
    // Finish marca um evento como processado, com sucesso ou falha
    finish(
        id: string,
        token: string,
        status: EventStatus,
        reason: string,
        now: Date,
        nextAttemptAt?: Date,
    ): Promise<void>;
    // Wake acorda eventos que estão "em processamento" há muito tempo, para que possam ser processados novamente
    wake(source: string, reservationId: string, now: Date): Promise<void>;
}
