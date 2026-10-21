import { Router } from 'express';
import { z } from 'zod';
import type { ListReservations } from '../../application/list-reservations.js';
import { pageQuery, identifier } from '../../../../shared/http/query.js';

// Validação do query string para listagem de reservas
const querySchema = pageQuery
  .extend({
    source: identifier.optional(),
    status: z.enum(['confirmed', 'cancelled']).optional(),
    propertyId: identifier.optional(),
  })
  .strict();

// Rota para listagem de reservas
export function reservationRoutes(list: ListReservations) {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json(await list.execute(querySchema.parse(req.query)));
  });
  
  return router;
}
