import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { PLAYABLE_ELEMENTS, type ElementId } from '../../content/index.js';
import { auth, parse, requireAuth } from '../../http/middleware.js';
import { createWizard, setLoadout, wizardProfile } from './service.js';

const wizardName = z
  .string()
  .trim()
  .min(3)
  .max(24)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 _'-]*[A-Za-z0-9]$/, 'Use letters, numbers, spaces, apostrophes, - or _');

export function wizardRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(requireAuth);

  router.post('/wizard', (req, res) => {
    const body = parse(
      z
        .object({
          name: wizardName,
          element: z.enum(PLAYABLE_ELEMENTS as [ElementId, ...ElementId[]]),
          learning_goal: z.string().trim().max(120).nullable().optional(),
        })
        .strict(),
      req.body,
    );
    const { accountId } = auth(req);
    createWizard(ctx, accountId, { name: body.name, element: body.element, learningGoal: body.learning_goal });
    res.status(201).json(wizardProfile(ctx, accountId));
  });

  router.get('/wizard', (req, res) => {
    res.json(wizardProfile(ctx, auth(req).accountId));
  });

  router.put('/wizard/loadout', (req, res) => {
    const body = parse(z.object({ spell_ids: z.array(z.string().max(64)).max(8), revision: z.number().int().min(0) }).strict(), req.body);
    res.json(setLoadout(ctx, auth(req).accountId, { spellIds: body.spell_ids, revision: body.revision }));
  });

  return router;
}
