import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { many } from '../../db/database.js';
import { auth, parse, requireAdmin } from '../../http/middleware.js';
import { audit } from '../analytics/service.js';
import { invalidateSession } from '../focus/service.js';
import { reconcile } from '../ledger/service.js';

/** Minimal admin API (MVP+): ruleset versions, ledger reconciliation, abuse handling, audit trail. */
export function adminRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(requireAdmin);

  router.get('/rulesets', (_req, res) => {
    res.json({ active: ctx.rules.active(), versions: ctx.rules.list() });
  });

  // Publishing validates every safety invariant (90-minute cap, 20-minute break floor, ...).
  router.post('/rulesets', (req, res) => {
    const ruleset = ctx.rules.publish(req.body, auth(req).accountId);
    audit(ctx, { actorId: auth(req).accountId, action: 'ruleset.published', target: ruleset.id, requestId: req.id });
    res.status(201).json(ruleset);
  });

  router.get('/ledger/reconcile', (req, res) => {
    const result = reconcile(ctx);
    audit(ctx, { actorId: auth(req).accountId, action: 'ledger.reconciled', details: { clean: result.clean }, requestId: req.id });
    res.json(result);
  });

  router.post('/focus-sessions/:id/invalidate', (req, res) => {
    const body = parse(z.object({ reason: z.string().trim().min(3).max(500) }).strict(), req.body);
    res.json(invalidateSession(ctx, auth(req).accountId, req.params.id, body.reason, req.id));
  });

  router.get('/audit', (req, res) => {
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query);
    res.json({ events: many(ctx.db, 'SELECT * FROM audit_events ORDER BY created_at DESC LIMIT ?', q.limit) });
  });

  return router;
}
