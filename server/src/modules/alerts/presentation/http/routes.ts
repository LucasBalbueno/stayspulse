import { Router } from 'express';
import { z } from 'zod';
import type { ListAlerts } from '../../application/list-alerts.js';
import { identifier } from '../../../../shared/http/query.js';

export function alertRoutes(list: ListAlerts) {
    const router = Router();

    router.get('/', async (req, res) => {
        const query = z
            .object({ propertyId: identifier.optional() })
            .strict()
            .parse(req.query);
        res.json({ data: await list.execute(query.propertyId) });
    });

    return router;
}
