import type { ProcessingEventRepository } from './processing-event-repository.js';
import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import { applyEvent } from '../../reservations/domain/apply-event.js';

// Coordena o processamento de um evento
// Recebe o evento e workflow de processamento, garantindo que o evento seja processado de forma segura e consistente
export class ProcessEvents {
    constructor(
        private readonly events: ProcessingEventRepository,
        private readonly uow: UnitOfWork,
    ) { }

    // Executa o processamento de um evento
    async execute() {
        // Busca o próximo evento a ser processado
        const event = await this.events.claim(new Date());
        if (!event) return false;

        try {
            // Abre uma unidade de trabalho
            await this.uow.execute(async ({ events, reservations, alerts, lockProperty }) => {
                // Busca o estado inicial da reserva associada ao evento
                const initial = await reservations.find(event.source, event.reservationId);
                // Busca a propriedade associada ao evento
                const propertyId = initial?.propertyId ?? event.propertyId;

                // Se há propriedade, bloqueia para evitar concorrência de processamento
                if (propertyId) await lockProperty(propertyId);

                // Confere a reserva novamente para evitar outro acesso enquanto o lock estava sendo executado
                const current = await reservations.find(event.source, event.reservationId);
                const now = new Date();
                // Aplicando a regra de negócio no evento
                const decision = applyEvent(event.payload, current, now);

                // Se a decisão resultou em uma reserva, salva a reserva, verifica sobreposições e reconcilia os alertas
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

                // O evento é finalizado com a regra de negócio aplicada
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
            // Mesmo com erro, o sistema tenta finalizar o evento com um estado apropriado e agendar uma nova tentativa de processamento, caso o número de tentativas seja menor que 8
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
