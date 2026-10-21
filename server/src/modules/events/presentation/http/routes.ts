import { z } from 'zod';
import type { ListDeliveries } from '../../application/list-deliveries.js';
import { Router } from 'express';
import type { ListEvents } from '../../application/list-events.js';
import { pageQuery, identifier, eventType } from '../../../../shared/http/query.js';

// Validação da query de paginação e filtros para listagem de eventos
// PageQuery é a validação de paginação
const querySchema = pageQuery
  .extend({
    source: identifier.optional(),
    type: eventType.optional(),
    reservationId: identifier.optional(),
    propertyId: identifier.optional(),
  })
  .strict();

export function eventRoutes(list: ListEvents, deliveries: ListDeliveries) {
  const router = Router();

  // Listagem de eventos com paginação e filtros (no corpo da query)
  router.get('/', async (req, res) => {
    // Validação da query de paginação e filtros
    res.json(await list.execute(querySchema.parse(req.query)));
  });

  // Listagem de entregas de um evento específico com paginação (no corpo da query)
  router.get('/:id/deliveries', async (req, res) => {
    // Validação do ID do evento
    const id = z.string().regex(/^[a-f0-9]{24}$/i).parse(req.params.id);

    // Validação da query de paginação
    res.json(await deliveries.execute(id, pageQuery.strict().parse(req.query)));
  });

  return router;
}
