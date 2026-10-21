import type { EventPayload } from '../../events/domain/event.js';
import type { StoredReservation } from './reservation.js';
import { hash } from '../../events/domain/hash.js';

// Decide se um evento pode ser aplicado em uma reserva
export function applyEvent(payload: EventPayload, current: StoredReservation | null, now: Date) {
    const incoming = payload.reservation;

    // Se a reserva ainda não existe e chega um evento de atualização ou cancelamento ele cria um pending_reference
    if (!current && payload.type !== 'reservation.created') {
        return { status: 'pending_reference' as const, reason: 'missing_creation' };
    }

    // Se a reserva existe e chega um evento com versão mais antiga, ele é ignorado
    if (current && payload.sourceVersion < current.sourceVersion) {
        return { status: 'ignored' as const, reason: 'older_version' };
    }

    // Cria um hash do estado novo
    const state = {
        propertyId: incoming.propertyId ?? current?.propertyId ?? '',
        checkIn: 'checkIn' in incoming ? incoming.checkIn : current!.checkIn,
        checkOut: 'checkOut' in incoming ? incoming.checkOut : current!.checkOut,
        status: incoming.status,
    };
    const stateHash = hash(state);

    // Compara com hash salvo no estado atual, se for igual, ignora, se for diferente, rejeita
    if (current && payload.sourceVersion === current.sourceVersion) {
        return {
            status: stateHash === current.stateHash ? 'ignored' as const : 'rejected' as const,
            reason:
                stateHash === current.stateHash
                    ? 'equivalent_version'
                    : 'incompatible_version',
        };
    }

    // Uma reserva não pode mudar de propriedade, se isso acontecer, rejeita
    if (current && state.propertyId !== current.propertyId) {
        return { status: 'rejected' as const, reason: 'immutable_property' };
    }

    // Uma reserva não pode voltar de cancelada para confirmada, se isso acontecer, rejeita
    if (current?.status === 'cancelled' && state.status !== 'cancelled') {
        return { status: 'rejected' as const, reason: 'terminal_cancellation' };
    }

    // Se a reserva já existe e chega um evento de criação, rejeita
    if (current && payload.type === 'reservation.created') {
        return { status: 'rejected' as const, reason: 'already_created' };
    }

    return {
        status: 'completed' as const,
        reason: 'applied',
        reservation: {
            ...state,
            source: payload.source,
            reservationId: incoming.reservationId,
            sourceVersion: payload.sourceVersion,
            stateHash,
            updatedAt: now,
        },
    };
}
