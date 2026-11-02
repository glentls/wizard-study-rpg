import type { Clock } from '../lib/clock.js';
import { iso } from '../lib/clock.js';
import { many, one, run, transaction, type Db } from '../db/database.js';
import { conflict, notFound } from '../lib/errors.js';
import { DEFAULT_RULESET, rulesetSchema, type Ruleset } from './ruleset.js';

/**
 * Rulesets are immutable once published; changing balance means publishing a new
 * id (ADM-01). Historic sessions keep pointing at the ruleset they were earned under.
 */
export class RulesetStore {
  private cache = new Map<string, Ruleset>();
  private activeId: string | null = null;

  constructor(private db: Db, private clock: Clock) {}

  /** Seeds the default ruleset on first boot. */
  init(seed: Ruleset = DEFAULT_RULESET): void {
    const active = one<{ id: string }>(this.db, 'SELECT id FROM rulesets WHERE active = 1');
    if (active) {
      this.activeId = active.id;
      return;
    }
    this.publish(seed, null);
  }

  active(): Ruleset {
    if (!this.activeId) throw new Error('RulesetStore not initialised');
    return this.byId(this.activeId);
  }

  byId(id: string): Ruleset {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const row = one<{ config: string }>(this.db, 'SELECT config FROM rulesets WHERE id = ?', id);
    if (!row) throw notFound(`Ruleset ${id}`);
    const parsed = rulesetSchema.parse(JSON.parse(row.config));
    this.cache.set(id, parsed);
    return parsed;
  }

  list(): { id: string; active: boolean; created_at: string; created_by: string | null }[] {
    return many<{ id: string; active: number; created_at: string; created_by: string | null }>(
      this.db,
      'SELECT id, active, created_at, created_by FROM rulesets ORDER BY created_at DESC',
    ).map((r) => ({ ...r, active: r.active === 1 }));
  }

  /** Validates (including safety invariants) and atomically makes the ruleset active. */
  publish(input: unknown, actorId: string | null): Ruleset {
    const ruleset = rulesetSchema.parse(input);
    transaction(this.db, () => {
      if (one(this.db, 'SELECT 1 FROM rulesets WHERE id = ?', ruleset.id)) {
        throw conflict('RULESET_EXISTS', `Ruleset ${ruleset.id} already exists; publish a new id`);
      }
      run(this.db, 'UPDATE rulesets SET active = 0 WHERE active = 1');
      run(
        this.db,
        'INSERT INTO rulesets (id, config, active, created_by, created_at) VALUES (?, ?, 1, ?, ?)',
        ruleset.id,
        JSON.stringify(ruleset),
        actorId,
        iso(this.clock.now()),
      );
    });
    this.cache.set(ruleset.id, ruleset);
    this.activeId = ruleset.id;
    return ruleset;
  }
}
