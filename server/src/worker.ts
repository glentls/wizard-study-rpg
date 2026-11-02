import type { AppContext } from './context.js';
import { iso } from './lib/clock.js';
import { run } from './db/database.js';
import { combatMaintenance } from './modules/combat/service.js';
import { reconcileAll } from './modules/focus/service.js';

/**
 * Background "system worker" (§3 actors). Requests already reconcile lazily, so
 * correctness never depends on this timer; it exists so sessions auto-close at
 * the cap and rewards settle even when the learner never comes back.
 */
export function runMaintenance(ctx: AppContext) {
  const focus = reconcileAll(ctx);
  const combat = combatMaintenance(ctx);
  const now = ctx.clock.now();
  run(ctx.db, 'DELETE FROM idempotency_requests WHERE created_at < ?', iso(now - 24 * 3_600_000));
  run(ctx.db, 'DELETE FROM auth_sessions WHERE refresh_expires_at < ?', iso(now - 7 * 86_400_000));
  return { focus, combat };
}

export function startWorker(ctx: AppContext): () => void {
  const tick = () => {
    try {
      const result = runMaintenance(ctx);
      if (result.focus.closed || result.focus.settled || result.combat.settled || result.combat.aborted) {
        ctx.log.info('worker_tick', result);
      }
    } catch (err) {
      ctx.log.error('worker_failed', { error: err instanceof Error ? err.stack : String(err) });
    }
  };
  tick();
  const handle = setInterval(tick, ctx.env.workerIntervalSeconds * 1000);
  return () => clearInterval(handle);
}
