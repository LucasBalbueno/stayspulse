import type { EventPayload } from '../../events/domain/event.js';
import type { StoredReservation } from './reservation.js';
import { hash } from '../../events/domain/hash.js';
export function applyEvent(payload: EventPayload, current: StoredReservation | null, now: Date) {
    const incoming = payload.reservation;

    if (!current && payload.type !== 'reservation.created') {
        return { status: 'pending_reference' as const, reason: 'missing_creation' };
    }

    if (current && payload.sourceVersion < current.sourceVersion) {
        return { status: 'ignored' as const, reason: 'older_version' };
    }

    const state = {
        propertyId: incoming.propertyId ?? current?.propertyId ?? '',
        checkIn: 'checkIn' in incoming ? incoming.checkIn : current!.checkIn,
        checkOut: 'checkOut' in incoming ? incoming.checkOut : current!.checkOut,
        status: incoming.status,
    };
    const stateHash = hash(state);

    if (current && payload.sourceVersion === current.sourceVersion) {
        return {
            status: stateHash === current.stateHash ? 'ignored' as const : 'rejected' as const,
            reason:
                stateHash === current.stateHash
                    ? 'equivalent_version'
                    : 'incompatible_version',
        };
    }

    if (current && state.propertyId !== current.propertyId) {
        return { status: 'rejected' as const, reason: 'immutable_property' };
    }

    if (current?.status === 'cancelled' && state.status !== 'cancelled') {
        return { status: 'rejected' as const, reason: 'terminal_cancellation' };
    }

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
