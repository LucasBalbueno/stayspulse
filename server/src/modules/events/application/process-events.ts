import type { ProcessingEventRepository } from './processing-event-repository.js';
import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import { applyEvent } from '../../reservations/domain/apply-event.js';

export class ProcessEvents {
    constructor(
        private readonly events: ProcessingEventRepository,
        private readonly uow: UnitOfWork,
    ) { }

    async execute() {
        const event = await this.events.claim(new Date());
        if (!event) return false;

        try {
            await this.uow.execute(async ({ events, reservations, alerts, lockProperty }) => {
                // Cancellation can omit propertyId; resolve it, then re-read after taking the guard.
                const initial = await reservations.find(event.source, event.reservationId);
                const propertyId = initial?.propertyId ?? event.propertyId;

                if (propertyId) await lockProperty(propertyId);

                const current = await reservations.find(event.source, event.reservationId);
                const now = new Date();
                const decision = applyEvent(event.payload, current, now);

                if (decision.reservation) {
                    const saved = await reservations.save(decision.reservation, current?.id);
                    const overlaps =
                        saved.status === 'confirmed' ? await reservations.overlaps(saved) : [];

                    await alerts.reconcile(
                        saved.id,
                        saved.propertyId,
                        overlaps.map((reservation) => reservation.id),
                        now,
                    );
                    await events.wake(event.source, event.reservationId, now);
                }

                await events.finish(
                    event.id,
                    event.leaseToken,
                    decision.status,
                    decision.reason,
                    now,
                    new Date(now.getTime() + 5000),
                );
            });
        } catch {
            // A stale worker cannot reschedule or finish an event owned by another worker.
            await this.events
                .finish(
                    event.id,
                    event.leaseToken,
                    event.attempts >= 8 ? 'failed' : 'received',
                    'processing_error',
                    new Date(),
                    new Date(
                        Date.now() + Math.min(60000, 1000 * 2 ** event.attempts),
                    ),
                )
                .catch(() => undefined);
        }

        return true;
    }
}
