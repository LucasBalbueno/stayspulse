import { Router } from 'express';
import type { ReceiveReservationWebhook } from '../../application/receive-reservation-webhook.js';
import { webhookSchema } from './schema.js';

export function webhookRoutes(receive: ReceiveReservationWebhook) {
  const router = Router();

  router.post('/reservations', async (req, res) => {
    // Valida o payload do weebhook
    const payload = webhookSchema.parse(req.body);

    // Executa o caso de uso para processar o webhook recebido
    // Envia o payload validado, o ID da requisição e o payload original para registro
    const data = await receive.execute(
      payload,
      res.locals.requestId as string,
      req.body,
    );

    // Envia os dados processados
    res.status(201).json({ data });
  });

  return router;
}
