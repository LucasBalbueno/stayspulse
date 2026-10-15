export const apiKey = 'test-key-1234567890';
export const payload = {
  sourceVersion: 1,
  eventId: 'evt-001',
  type: 'reservation.created' as const,
  source: 'airbnb-demo',
  occurredAt: '2026-11-01T14:00:00Z',
  reservation: {
    reservationId: 'res-101',
    propertyId: 'prop-17',
    checkIn: '2026-11-10',
    checkOut: '2026-11-15',
    status: 'confirmed' as const,
  },
};
