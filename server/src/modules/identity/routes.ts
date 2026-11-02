import { Router, type Response } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { auth, parse, rateLimit, requireAuth } from '../../http/middleware.js';
import { badRequest } from '../../lib/errors.js';
import { balancesOf } from '../ledger/service.js';
import { wizardProfile } from '../wizard/service.js';
import { preferencesPatchSchema } from './preferences.js';
import * as identity from './service.js';

const REFRESH_COOKIE = 'wsr_refresh';

const email = z.string().trim().email().max(254);
const password = z.string().min(10, 'Use at least 10 characters').max(128);

export function identityRoutes(ctx: AppContext): Router {
  const router = Router();
  const authLimiter = rateLimit({
    windowSeconds: 60,
    max: 20,
    key: (req) => `auth:${req.ip}`,
    now: () => ctx.clock.now(),
  });

  /** Refresh token lives in an httpOnly, SameSite=Strict cookie scoped to /v1/auth; the access token stays in memory. */
  const sendTokens = (res: Response, status: number, tokens: identity.IssuedTokens) => {
    res.cookie(REFRESH_COOKIE, tokens.refresh_token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: ctx.env.isProduction,
      path: '/v1/auth',
      expires: new Date(tokens.refresh_expires_at),
    });
    res.status(status).json({ access_token: tokens.access_token, access_expires_at: tokens.access_expires_at });
  };

  router.post('/auth/register', authLimiter, async (req, res) => {
    const body = parse(
      z.object({
        email,
        password,
        timezone: z.string().min(1).max(64),
        accept_terms: z.literal(true, { errorMap: () => ({ message: 'You must accept the terms and privacy notice' }) }),
        analytics_opt_in: z.boolean().default(false),
        device_label: z.string().max(80).optional(),
      }),
      req.body,
    );
    const { tokens } = await identity.register(ctx, {
      email: body.email,
      password: body.password,
      timezone: body.timezone,
      acceptTerms: body.accept_terms,
      analyticsOptIn: body.analytics_opt_in,
      deviceLabel: body.device_label,
    });
    sendTokens(res, 201, tokens);
  });

  router.post('/auth/login', authLimiter, async (req, res) => {
    const body = parse(z.object({ email, password: z.string().min(1).max(128), device_label: z.string().max(80).optional() }), req.body);
    sendTokens(res, 200, await identity.login(ctx, { email: body.email, password: body.password, deviceLabel: body.device_label }));
  });

  router.post('/auth/refresh', authLimiter, (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (typeof token !== 'string' || !token) throw badRequest('REFRESH_TOKEN_MISSING', 'No session to refresh');
    sendTokens(res, 200, identity.refresh(ctx, token));
  });

  router.post('/auth/logout', requireAuth, (req, res) => {
    const body = parse(z.object({ all_devices: z.boolean().default(false) }), req.body ?? {});
    const { accountId, sessionId } = auth(req);
    identity.logout(ctx, accountId, sessionId, body.all_devices);
    res.clearCookie(REFRESH_COOKIE, { path: '/v1/auth' });
    res.status(204).end();
  });

  router.post('/auth/password-reset/request', authLimiter, (req, res) => {
    identity.requestPasswordReset(ctx, parse(z.object({ email }), req.body).email);
    res.status(202).json({ message: 'If that email has an account, a reset link is on its way.' });
  });

  router.post('/auth/password-reset/confirm', authLimiter, async (req, res) => {
    const body = parse(z.object({ token: z.string().min(10).max(200), password }), req.body);
    await identity.resetPassword(ctx, body.token, body.password);
    res.status(204).end();
  });

  router.post('/auth/verify-email', authLimiter, (req, res) => {
    identity.verifyEmail(ctx, parse(z.object({ token: z.string().min(10).max(200) }), req.body).token);
    res.status(204).end();
  });

  router.post('/auth/verify-email/resend', requireAuth, authLimiter, (req, res) => {
    identity.resendVerification(ctx, auth(req).accountId);
    res.status(202).json({ message: 'Verification link sent.' });
  });

  router.get('/me', requireAuth, (req, res) => {
    const { accountId, role } = auth(req);
    const account = identity.getAccount(ctx, accountId)!;
    res.json({
      account: { id: account.id, email: account.email, email_verified: Boolean(account.email_verified_at), role, created_at: account.created_at },
      preferences: identity.preferencesOf(ctx, accountId),
      wizard: wizardProfile(ctx, accountId),
      balances: balancesOf(ctx, accountId),
      server_time: new Date(ctx.clock.now()).toISOString(),
    });
  });

  router.patch('/me/preferences', requireAuth, (req, res) => {
    res.json({ preferences: identity.updatePreferences(ctx, auth(req).accountId, parse(preferencesPatchSchema, req.body)) });
  });

  router.get('/me/export', requireAuth, (req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="wizard-study-export.json"');
    res.json(identity.exportAccount(ctx, auth(req).accountId));
  });

  router.delete('/me', requireAuth, async (req, res) => {
    const body = parse(z.object({ password: z.string().min(1).max(128) }), req.body);
    await identity.deleteAccount(ctx, auth(req).accountId, body.password, req.id);
    res.clearCookie(REFRESH_COOKIE, { path: '/v1/auth' });
    res.status(202).json({ status: 'deleted', message: 'Your personal data has been erased. Anonymised reward records are retained for audit.' });
  });

  return router;
}
