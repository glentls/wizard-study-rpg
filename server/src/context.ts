import type { EnvConfig } from './config/env.js';
import { RulesetStore } from './config/rulesetStore.js';
import type { Ruleset } from './config/ruleset.js';
import type { Db } from './db/database.js';
import type { Clock } from './lib/clock.js';
import type { Logger } from './lib/logger.js';

/** Everything a module needs, passed explicitly (no globals) so tests can swap clock/db. */
export interface AppContext {
  db: Db;
  clock: Clock;
  log: Logger;
  env: EnvConfig;
  rules: RulesetStore;
}

export function createContext(opts: { db: Db; clock: Clock; log: Logger; env: EnvConfig; seedRuleset?: Ruleset }): AppContext {
  const rules = new RulesetStore(opts.db, opts.clock);
  rules.init(opts.seedRuleset);
  return { db: opts.db, clock: opts.clock, log: opts.log, env: opts.env, rules };
}
