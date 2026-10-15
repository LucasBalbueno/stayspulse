import { ListAlerts } from './modules/alerts/application/list-alerts.js';
import { ListDeliveries } from './modules/events/application/list-deliveries.js';
import { PrismaUnitOfWork } from './infrastructure/database/prisma-unit-of-work.js';
import { ProcessEvents } from './modules/events/application/process-events.js';
import { PrismaAlertRepository } from './modules/alerts/infrastructure/prisma-alert-repository.js';
import type { PrismaClient } from '@prisma/client';
import { PrismaEventRepository } from './modules/events/infrastructure/prisma-event-repository.js';
import { PrismaReservationRepository } from './modules/reservations/infrastructure/prisma-reservation-repository.js';
import { ListEvents } from './modules/events/application/list-events.js';
import { RegisterReceivedEvent } from './modules/events/application/register-received-event.js';
import { ListReservations } from './modules/reservations/application/list-reservations.js';
import { ReceiveReservationWebhook } from './modules/webhooks/application/receive-reservation-webhook.js';

// Composição das dependências da aplicação
// Request -> UseCase -> Repository -> Database
export function compose(prisma: PrismaClient) {
  // Repositório de eventos para processar eventos recebidos
  const events = new PrismaEventRepository(prisma, prisma);

  // UseCases da aplicação
  return {
    processEvents: new ProcessEvents(events, new PrismaUnitOfWork(prisma)),
    listDeliveries: new ListDeliveries(events),
    listAlerts: new ListAlerts(new PrismaAlertRepository(prisma)),
    receiveWebhook: new ReceiveReservationWebhook(new RegisterReceivedEvent(events)),
    listEvents: new ListEvents(events),
    listReservations: new ListReservations(new PrismaReservationRepository(prisma))
  };
}

// Define o tipo UseCases como o retorno da função compose
export type UseCases = ReturnType<typeof compose>;
