import { existsSync } from 'node:fs';
import { join } from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { AppContext } from './context.js';
import { CONTENT_VERSION, ELEMENTS, PLAYABLE_ELEMENTS, starterSpellFor } from './content/index.js';
import { authenticate, errorHandler, rateLimit, requestContext } from './http/middleware.js';
import { notFound } from './lib/errors.js';
import { adminRoutes } from './modules/admin/routes.js';
import { combatRoutes } from './modules/combat/routes.js';
import { focusRoutes } from './modules/focus/routes.js';
import { historyRoutes } from './modules/history/routes.js';
import { identityRoutes } from './modules/identity/routes.js';
import { researchRoutes } from './modules/research/routes.js';
import { wizardRoutes } from './modules/wizard/routes.js';

export function createApp(ctx: AppContext): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(helmet());
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());
  app.use(requestContext(ctx));
  app.use('/v1', rateLimit({ windowSeconds: 60, max: 600, key: (req) => `api:${req.ip}`, now: () => Date.now() }));
  app.use('/v1', authenticate(ctx));

  // Public endpoints
  app.get('/v1/health', (_req, res) => {
    res.json({ status: 'ok', version: ctx.env.appVersion, ruleset_id: ctx.rules.active().id, content_version: CONTENT_VERSION });
  });
  app.get('/v1/content/elements', (_req, res) => {
    res.json({
      content_version: CONTENT_VERSION,
      elements: PLAYABLE_ELEMENTS.map((id) => ({ ...ELEMENTS[id], starter_spell: starterSpellFor(id)?.name ?? null })),
    });
  });

  app.use('/v1/admin', adminRoutes(ctx));
  app.use('/v1', identityRoutes(ctx));
  app.use('/v1', wizardRoutes(ctx));
  app.use('/v1', focusRoutes(ctx));
  app.use('/v1', researchRoutes(ctx));
  app.use('/v1', combatRoutes(ctx));
  app.use('/v1', historyRoutes(ctx));
  app.use('/v1', () => {
    throw notFound('Endpoint');
  });

  // Production: serve the built client from the same origin (single deployable).
  if (existsSync(ctx.env.clientDistDir)) {
    app.use(express.static(ctx.env.clientDistDir, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!v1\/).*/, (_req, res) => res.sendFile(join(ctx.env.clientDistDir, 'index.html')));
  }

  app.use(errorHandler(ctx));
  return app;
}
