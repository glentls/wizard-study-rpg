import type { AppContext } from '../../context.js';
import { one, run } from '../../db/database.js';
import { iso } from '../../lib/clock.js';
import { newId, pseudonymize } from '../../lib/crypto.js';

/**
 * Product analytics (§13 / ADM-04). Opt-in only, pseudonymous, and callers must
 * never pass study content (objectives, notes) as properties.
 */
export function track(
  ctx: AppContext,
  accountId: string,
  name: string,
  properties: Record<string, string | number | boolean | null> = {},
): void {
  const row = one<{ preferences: string }>(ctx.db, 'SELECT preferences FROM accounts WHERE id = ?', accountId);
  if (!row || JSON.parse(row.preferences)?.privacy?.analyticsOptIn !== true) return;
  run(
    ctx.db,
    'INSERT INTO analytics_events (event_id, name, occurred_at, user_pseudonym, app_version, ruleset_id, properties) VALUES (?, ?, ?, ?, ?, ?, ?)',
    newId(),
    name,
    iso(ctx.clock.now()),
    pseudonymize(ctx.env.pseudonymSecret, accountId),
    ctx.env.appVersion,
    ctx.rules.active().id,
    JSON.stringify(properties),
  );
}

export function audit(
  ctx: AppContext,
  event: { actorId: string | null; action: string; target?: string; details?: unknown; requestId?: string },
): void {
  run(
    ctx.db,
    'INSERT INTO audit_events (id, actor_id, action, target, details, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    newId(),
    event.actorId,
    event.action,
    event.target ?? null,
    event.details === undefined ? null : JSON.stringify(event.details),
    event.requestId ?? null,
    iso(ctx.clock.now()),
  );
}

/** Coarse buckets keep exact durations out of analytics (§17). */
export function durationBucket(minutes: number): string {
  if (minutes < 15) return '<15';
  if (minutes < 30) return '15-29';
  if (minutes < 60) return '30-59';
  return '60-90';
}
