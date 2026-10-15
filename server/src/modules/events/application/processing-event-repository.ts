import type { ReceivedEvent, EventStatus } from '../domain/event.js';

export interface ClaimedEvent extends ReceivedEvent {
    leaseToken: string;
    attempts: number;
}

export interface ProcessingEventRepository {
    claim(now: Date): Promise<ClaimedEvent | null>;
    finish(
        id: string,
        token: string,
        status: EventStatus,
        reason: string,
        now: Date,
        nextAttemptAt?: Date,
    ): Promise<void>;
    wake(source: string, reservationId: string, now: Date): Promise<void>;
}
