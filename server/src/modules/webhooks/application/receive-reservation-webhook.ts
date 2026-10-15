import type { RegisterReceivedEvent } from '../../events/application/register-received-event.js';
import type { EventPayload } from '../../events/domain/event.js';

export class ReceiveReservationWebhook {
  // Recebe RegisterReceivedEvent por injeção de dependência
  constructor(private readonly register: RegisterReceivedEvent) { }

  // Encaminha a execução para RegisterReceivedEvent, propagando o payload, requestId e payload original
  execute(
    payload: EventPayload,
    requestId: string,
    originalPayload: unknown = payload,
  ) {
    return this.register.execute(payload, requestId, originalPayload);
  }
}
