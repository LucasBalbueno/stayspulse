import { createPrismaClient } from '../src/infrastructure/database/prisma-client.js';
import { compose } from '../src/composition-root.js';
const prisma = createPrismaClient(process.env.MONGODB_URI!);
try {
 const cases = compose(prisma);
 await cases.receiveWebhook.execute({ source: 'seed-demo', eventId: 'seed-created-1', sourceVersion: 1, occurredAt: '2026-01-01T00:00:00Z', type: 'reservation.created', reservation: { reservationId: 'seed-reservation', propertyId: 'seed-property', checkIn: '2027-01-10', checkOut: '2027-01-15', status: 'confirmed' } }, 'seed');
 for (let i = 0; i < 100 && await cases.processEvents.execute(); i++);
} finally { await prisma.$disconnect(); }
