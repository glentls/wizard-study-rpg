import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { auth, idempotent, parse, requireAuth } from '../../http/middleware.js';
import * as focus from './service.js';

const pageQuery = z.object({ cursor: z.string().max(100).optional(), limit: z.coerce.number().int().min(1).max(100).default(20) });

export function focusRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/focus-sessions/current', (req, res) => {
    res.json(focus.currentFocus(ctx, auth(req).accountId));
  });

  router.get('/focus-sessions', (req, res) => {
    const q = parse(pageQuery, req.query);
    res.json(focus.listSessions(ctx, auth(req).accountId, q.cursor, q.limit));
  });

  router.post('/focus-sessions', (req, res) => {
    const body = parse(
      z
        .object({
          objective: z.string().trim().max(140).nullable().optional(),
          research_target_spell_id: z.string().max(64).nullable().optional(),
        })
        .strict(),
      req.body ?? {},
    );
    res.status(201).json(
      focus.startSession(ctx, auth(req).accountId, { objective: body.objective, researchTargetSpellId: body.research_target_spell_id }),
    );
  });

  router.get('/focus-sessions/:id', (req, res) => {
    res.json(focus.getSessionView(ctx, auth(req).accountId, req.params.id));
  });

  router.post('/focus-sessions/:id/heartbeat', (req, res) => {
    const body = parse(z.object({ sequence: z.number().int().min(0), device_id: z.string().max(64).optional() }).strict(), req.body);
    res.json(focus.heartbeat(ctx, auth(req).accountId, req.params.id, { sequence: body.sequence, deviceId: body.device_id }));
  });

  // Reward-bearing: requires Idempotency-Key, retries replay the original award.
  router.post('/focus-sessions/:id/finish', idempotent(ctx), (req, res) => {
    res.json(focus.finishSession(ctx, auth(req).accountId, String(req.params.id)));
  });

  router.get('/me/summary', (req, res) => {
    res.json(focus.studySummary(ctx, auth(req).accountId));
  });

  return router;
}
