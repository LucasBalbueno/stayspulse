import { Router } from 'express';
import { z } from 'zod';
import type { ListReservations } from '../../application/list-reservations.js';
import { pageQuery, identifier } from '../../../../shared/http/query.js';
const querySchema = pageQuery
  .extend({
    source: identifier.optional(),
    status: z.enum(['confirmed', 'cancelled']).optional(),
    propertyId: identifier.optional(),
  })
  .strict();
export function reservationRoutes(list: ListReservations) {
  const router = Router();
  router.get('/', async (req, res) => {
    res.json(await list.execute(querySchema.parse(req.query)));
  });
  return router;
}
