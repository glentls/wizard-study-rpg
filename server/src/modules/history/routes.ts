import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { auth, parse, requireAuth } from '../../http/middleware.js';
import { balancesOf, listEntries } from '../ledger/service.js';

export function historyRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(requireAuth);

  // ECON-006: player-visible transaction history with cursor pagination.
  router.get('/ledger', (req, res) => {
    const q = parse(z.object({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).default(25) }), req.query);
    const { accountId } = auth(req);
    res.json({ balances: balancesOf(ctx, accountId), ...listEntries(ctx, accountId, q.cursor, q.limit) });
  });

  return router;
}
