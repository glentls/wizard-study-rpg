import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { auth, idempotent, parse, requireAuth } from '../../http/middleware.js';
import * as research from './service.js';

export function researchRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/research/tree', (req, res) => {
    res.json(research.researchTree(ctx, auth(req).accountId));
  });

  router.post('/research/allocate', idempotent(ctx), (req, res) => {
    const body = parse(
      z.object({ spell_id: z.string().max(64), points: z.number().int().min(1).max(100_000), expected_level: z.number().int().min(0) }).strict(),
      req.body,
    );
    res.json(research.allocate(ctx, auth(req).accountId, { spellId: body.spell_id, points: body.points, expectedLevel: body.expected_level }));
  });

  router.post('/research/milestones', (req, res) => {
    const body = parse(z.object({ spell_id: z.string().max(64), session_id: z.string().uuid() }).strict(), req.body);
    res.json(research.applyMilestoneFromSession(ctx, auth(req).accountId, body.spell_id, body.session_id));
  });

  router.post('/research/mana', idempotent(ctx), (req, res) => {
    const body = parse(z.object({ expected_level: z.number().int().min(1) }).strict(), req.body);
    res.json(research.upgradeMana(ctx, auth(req).accountId, body.expected_level));
  });

  return router;
}
