import { z } from 'zod';
import type { ListDeliveries } from '../../application/list-deliveries.js';
import { Router } from 'express';
import type { ListEvents } from '../../application/list-events.js';
import { pageQuery, identifier, eventType } from '../../../../shared/http/query.js';

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

  router.get('/', async (req, res) => {
    res.json(await list.execute(querySchema.parse(req.query)));
  });

  router.get('/:id/deliveries', async (req, res) => {
    const id = z.string().regex(/^[a-f0-9]{24}$/i).parse(req.params.id);
    res.json(await deliveries.execute(id, pageQuery.strict().parse(req.query)));
  });

  return router;
}
