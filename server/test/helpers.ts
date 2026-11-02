import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import type { Ruleset } from '../src/config/ruleset.js';
import { createContext } from '../src/context.js';
import { openDatabase } from '../src/db/database.js';
import { FakeClock } from '../src/lib/clock.js';
import type { Logger } from '../src/lib/logger.js';

export const PASSWORD = 'correct horse battery staple';

/** Captures log lines so tests can read dev-only email links. */
function memoryLogger() {
  const lines: { msg: string; fields: Record<string, unknown> }[] = [];
  const log = (_level: string, msg: string, fields: Record<string, unknown> = {}) => lines.push({ msg, fields });
  const logger: Logger = { log, info: (m, f) => log('info', m, f), warn: (m, f) => log('warn', m, f), error: (m, f) => log('error', m, f) };
  return { logger, lines };
}

export function setup(opts: { ruleset?: Ruleset; accessTtlSeconds?: number } = {}) {
  const clock = new FakeClock();
  const db = openDatabase(':memory:');
  const { logger, lines } = memoryLogger();
  const env = {
    ...loadEnv({ NODE_ENV: 'test' }),
    pseudonymSecret: 'test-secret',
    // Long-lived access tokens so tests can fast-forward through 90-minute sessions.
    accessTokenTtlSeconds: opts.accessTtlSeconds ?? 7 * 86_400,
    logEmailLinks: true,
    clientDistDir: '/nonexistent',
  };
  const ctx = createContext({ db, clock, log: logger, env, seedRuleset: opts.ruleset });
  const app = createApp(ctx);

  let counter = 0;
  /** Registers an account, creates its wizard and returns an authenticated API helper. */
  async function player(o: { element?: 'fire' | 'lightning' | 'light'; withWizard?: boolean; analytics?: boolean } = {}) {
    counter++;
    const email = `learner${counter}@example.com`;
    const agent = request.agent(app);
    const reg = await agent
      .post('/v1/auth/register')
      .send({ email, password: PASSWORD, timezone: 'UTC', accept_terms: true, analytics_opt_in: o.analytics ?? false })
      .expect(201);
    const token: string = reg.body.access_token;
    const api = {
      get: (path: string) => agent.get(path).set('Authorization', `Bearer ${token}`),
      post: (path: string, body: object = {}, idempotencyKey?: string) => {
        const req = agent.post(path).set('Authorization', `Bearer ${token}`);
        if (idempotencyKey) req.set('Idempotency-Key', idempotencyKey);
        return req.send(body);
      },
      put: (path: string, body: object) => agent.put(path).set('Authorization', `Bearer ${token}`).send(body),
      patch: (path: string, body: object) => agent.patch(path).set('Authorization', `Bearer ${token}`).send(body),
      delete: (path: string, body: object) => agent.delete(path).set('Authorization', `Bearer ${token}`).send(body),
    };
    if (o.withWizard !== false) {
      await api.post('/v1/wizard', { name: `Wizard ${counter}`, element: o.element ?? 'fire' }).expect(201);
    }
    const me = await api.get('/v1/me').expect(200);
    return { email, agent, token, api, accountId: me.body.account.id as string };
  }

  return { ctx, clock, app, db, lines, player };
}

export type Api = Awaited<ReturnType<ReturnType<typeof setup>['player']>>['api'];

let keySeq = 0;
export const key = () => `test-key-${++keySeq}-${Date.now()}`;

/** Advances time minute-by-minute, sending a heartbeat every `everyMinutes` like the real client. */
export async function focusFor(api: Api, clock: FakeClock, sessionId: string, minutes: number, everyMinutes = 2) {
  let seq = Math.floor(Math.random() * 1_000_000);
  for (let m = 1; m <= minutes; m++) {
    clock.advanceMinutes(1);
    if (m % everyMinutes === 0 || m === minutes) {
      const res = await api.post(`/v1/focus-sessions/${sessionId}/heartbeat`, { sequence: seq++ });
      if (res.status !== 200) return res;
    }
  }
  return null;
}

export async function startFocus(api: Api, body: object = {}) {
  const res = await api.post('/v1/focus-sessions', body).expect(201);
  return res.body as { id: string; cap_at: string; started_at: string; continuous_focus_before_seconds: number };
}

export function finish(api: Api, sessionId: string, idempotencyKey = key()) {
  return api.post(`/v1/focus-sessions/${sessionId}/finish`, {}, idempotencyKey);
}
