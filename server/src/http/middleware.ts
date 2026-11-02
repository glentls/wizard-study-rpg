import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import type { AppContext } from '../context.js';
import { one, run } from '../db/database.js';
import { iso } from '../lib/clock.js';
import { AppError, badRequest, forbidden, tooManyRequests, unauthorized, unprocessable } from '../lib/errors.js';
import { hashRequest, newId } from '../lib/crypto.js';
import { resolveAccessToken } from '../modules/identity/service.js';

export interface AuthInfo {
  accountId: string;
  role: 'player' | 'admin';
  sessionId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id: string;
      auth?: AuthInfo;
    }
  }
}

/** Parses and validates input; ZodErrors become 400 VALIDATION_ERROR responses. */
export const parse = <S extends ZodTypeAny>(schema: S, value: unknown): z.output<S> => schema.parse(value);

export const auth = (req: Request): AuthInfo => {
  if (!req.auth) throw unauthorized();
  return req.auth;
};

export function requestContext(ctx: AppContext): RequestHandler {
  return (req, res, next) => {
    req.id = newId();
    res.setHeader('X-Request-Id', req.id);
    const started = performance.now();
    res.on('finish', () => {
      // Path only (no query string or body) so nothing sensitive reaches the logs.
      ctx.log.info('http', {
        request_id: req.id,
        method: req.method,
        path: req.baseUrl + req.path,
        status: res.statusCode,
        ms: Math.round(performance.now() - started),
        account: req.auth?.accountId,
      });
    });
    next();
  };
}

/** Attaches req.auth when a valid bearer token is present; does not reject. */
export function authenticate(ctx: AppContext): RequestHandler {
  return (req, _res, next) => {
    const header = req.header('authorization');
    if (header?.startsWith('Bearer ')) {
      const resolved = resolveAccessToken(ctx, header.slice(7).trim());
      if (resolved) req.auth = resolved;
    }
    next();
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) throw unauthorized();
  next();
};

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.auth) throw unauthorized();
  if (req.auth.role !== 'admin') throw forbidden('Administrator role required');
  next();
};

/**
 * Fixed-window in-memory rate limiter. Fine for a single-node pilot; move the
 * counters to Redis when running more than one API instance.
 */
export function rateLimit(opts: { windowSeconds: number; max: number; key: (req: Request) => string; now: () => number }): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req, res, next) => {
    const now = opts.now();
    const key = opts.key(req);
    let bucket = hits.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + opts.windowSeconds * 1000 };
      hits.set(key, bucket);
      if (hits.size > 10_000) for (const [k, b] of hits) if (b.resetAt <= now) hits.delete(k);
    }
    bucket.count++;
    if (bucket.count > opts.max) {
      const retry = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retry));
      throw tooManyRequests(retry);
    }
    next();
  };
}

/**
 * Idempotency-Key handling for currency/reward mutations (spec §12).
 * The first successful response for (account, key) is stored and replayed for
 * retries; reusing a key for a different request is rejected. Domain code adds
 * its own guarantees (unique ledger keys, state checks) underneath this.
 */
export function idempotent(ctx: AppContext): RequestHandler {
  return (req, res, next) => {
    const { accountId } = auth(req);
    const key = req.header('idempotency-key');
    if (!key || key.length < 8 || key.length > 128) {
      throw badRequest('IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header (8-128 characters) with this request');
    }
    const route = `${req.method} ${req.baseUrl}${req.path}`;
    const requestHash = hashRequest(req.body);
    const prior = one<{ route: string; request_hash: string; status_code: number; response: string }>(
      ctx.db,
      'SELECT route, request_hash, status_code, response FROM idempotency_requests WHERE account_id = ? AND key = ?',
      accountId,
      key,
    );
    if (prior) {
      if (prior.route !== route || prior.request_hash !== requestHash) {
        throw unprocessable('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different request');
      }
      res.setHeader('Idempotent-Replayed', 'true');
      res.status(prior.status_code).json(JSON.parse(prior.response));
      return;
    }
    const send = res.json.bind(res);
    res.json = (body: unknown) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        run(
          ctx.db,
          `INSERT OR IGNORE INTO idempotency_requests (account_id, key, route, request_hash, status_code, response, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          accountId, key, route, requestHash, res.statusCode, JSON.stringify(body), iso(ctx.clock.now()),
        );
      }
      return send(body);
    };
    next();
  };
}

export function errorHandler(ctx: AppContext) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const requestId = req.id;
    if (err instanceof AppError) {
      res.status(err.status).json({ code: err.code, message: err.message, details: err.details ?? null, request_id: requestId });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        request_id: requestId,
      });
      return;
    }
    const status = (err as { status?: number; type?: string }).status;
    if (status === 400 || status === 413) {
      res.status(status).json({ code: 'INVALID_BODY', message: 'Malformed or oversized request body', details: null, request_id: requestId });
      return;
    }
    ctx.log.error('unhandled_error', { request_id: requestId, error: err instanceof Error ? err.stack : String(err) });
    res.status(500).json({ code: 'INTERNAL', message: 'Something went wrong on our side', details: null, request_id: requestId });
  };
}
