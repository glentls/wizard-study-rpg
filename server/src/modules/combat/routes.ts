import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { auth, parse, requireAuth } from '../../http/middleware.js';
import * as combat from './service.js';

export function combatRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/encounters', (req, res) => {
    res.json(combat.listEncounters(ctx, auth(req).accountId));
  });

  router.post('/encounters', (req, res) => {
    const body = parse(z.object({ encounter_id: z.string().max(64) }).strict(), req.body);
    res.status(201).json(combat.startEncounter(ctx, auth(req).accountId, body.encounter_id));
  });

  router.get('/matches/:id', (req, res) => {
    res.json(combat.getMatch(ctx, auth(req).accountId, req.params.id));
  });

  // Strict schema: any extra field (e.g. a forged "result": "victory") is a 400, never a reward.
  router.post('/matches/:id/actions', (req, res) => {
    const body = parse(z.object({ turn_version: z.number().int().min(0), spell_id: z.string().max(64), target_id: z.string().max(16).optional() }).strict(), req.body);
    res.json(combat.submitAction(ctx, auth(req).accountId, req.params.id, { turnVersion: body.turn_version, spellId: body.spell_id }));
  });

  router.post('/matches/:id/forfeit', (req, res) => {
    res.json(combat.forfeit(ctx, auth(req).accountId, req.params.id));
  });

  return router;
}
