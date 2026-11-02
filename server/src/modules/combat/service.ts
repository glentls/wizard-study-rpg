import type { AppContext } from '../../context.js';
import { rankFor } from '../../config/ruleset.js';
import { CONTENT_VERSION, ENCOUNTERS, ENCOUNTERS_BY_ID, SPELLS_BY_ID, scaledEffects } from '../../content/index.js';
import { isUniqueViolation, many, one, run, transaction } from '../../db/database.js';
import { iso, ms } from '../../lib/clock.js';
import { conflict, notFound, unprocessable } from '../../lib/errors.js';
import { newId } from '../../lib/crypto.js';
import { studyDay } from '../../lib/time.js';
import { track } from '../analytics/service.js';
import { preferencesOf } from '../identity/service.js';
import { balanceOf, creditedOnDay, postEntry } from '../ledger/service.js';
import { loadoutOf, maxHpFor, maxManaFor, requireWizard, spellLevels } from '../wizard/service.js';
import {
  IllegalActionError,
  initialState,
  legalActions,
  resolveTurn,
  type BattleEvent,
  type BattleState,
  type CombatSpell,
  type Fighter,
  type MatchSnapshot,
} from './engine.js';

type MatchState = 'CREATED' | 'IN_PROGRESS' | 'SETTLING' | 'FINISHED' | 'ABORTED';

interface MatchRow {
  id: string;
  account_id: string;
  encounter_id: string;
  mode: string;
  content_version: string;
  ruleset_id: string;
  seed: string;
  state: MatchState;
  turn_version: number;
  snapshot: string;
  battle_state: string;
  winner: 'player' | 'enemy' | null;
  reward: string | null;
  created_at: string;
  updated_at: string;
  settled_at: string | null;
}

const COMBAT_REWARD_REASON = 'COMBAT_VICTORY';

function ownedMatch(ctx: AppContext, accountId: string, matchId: string): MatchRow {
  const row = one<MatchRow>(ctx.db, 'SELECT * FROM matches WHERE id = ?', matchId);
  if (!row || row.account_id !== accountId) throw notFound('Match');
  return row;
}

function xpEarnedToday(ctx: AppContext, accountId: string): { day: string; earned: number } {
  const day = studyDay(ctx.clock.now(), preferencesOf(ctx, accountId).timezone);
  return { day, earned: creditedOnDay(ctx, accountId, 'COMBAT_XP', day, COMBAT_REWARD_REASON) };
}

export function listEncounters(ctx: AppContext, accountId: string) {
  const rules = ctx.rules.active();
  requireWizard(ctx, accountId);
  const rank = rankFor(rules, balanceOf(ctx, accountId, 'COMBAT_XP'));
  const wins = new Map(
    many<{ encounter_id: string; wins: number }>(
      ctx.db,
      "SELECT encounter_id, COUNT(*) AS wins FROM matches WHERE account_id = ? AND state = 'FINISHED' AND winner = 'player' GROUP BY encounter_id",
      accountId,
    ).map((r) => [r.encounter_id, r.wins]),
  );
  const open = one<{ id: string }>(ctx.db, "SELECT id FROM matches WHERE account_id = ? AND state IN ('CREATED', 'IN_PROGRESS')", accountId);
  const { earned } = xpEarnedToday(ctx, accountId);
  return {
    rank,
    open_match_id: open?.id ?? null,
    daily_xp_cap: rules.combat.dailyXpCap,
    daily_xp_remaining: Math.max(0, rules.combat.dailyXpCap - earned),
    encounters: ENCOUNTERS.map((e) => ({
      id: e.id,
      name: e.name,
      description: e.description,
      tutorial: Boolean(e.tutorial),
      recommended_rank: e.recommendedRank,
      xp_reward: e.xpReward,
      enemy: { name: e.enemy.name, element: e.enemy.element, max_hp: e.enemy.hp },
      victories: wins.get(e.id) ?? 0,
    })),
    recent: many<{ id: string; encounter_id: string; state: string; winner: string | null; reward: string | null; created_at: string }>(
      ctx.db,
      'SELECT id, encounter_id, state, winner, reward, created_at FROM matches WHERE account_id = ? ORDER BY created_at DESC LIMIT 10',
      accountId,
    ).map((m) => ({ ...m, encounter_name: ENCOUNTERS_BY_ID.get(m.encounter_id)?.name ?? m.encounter_id, reward: m.reward ? JSON.parse(m.reward) : null })),
  };
}

/** COMBAT-001: freeze the player's stats, spell versions and the enemy definition at match creation. */
function buildSnapshot(ctx: AppContext, accountId: string, encounterId: string): MatchSnapshot {
  const rules = ctx.rules.active();
  const encounter = ENCOUNTERS_BY_ID.get(encounterId);
  if (!encounter) throw notFound('Encounter');
  const wizard = requireWizard(ctx, accountId);
  const rank = rankFor(rules, balanceOf(ctx, accountId, 'COMBAT_XP'));
  const levels = spellLevels(ctx, wizard.id);
  const toCombatSpell = (id: string, level: number): CombatSpell => {
    const def = SPELLS_BY_ID.get(id)!;
    return { id, name: def.name, element: def.element, manaCost: def.manaCost, cooldown: def.cooldown, effects: scaledEffects(def.effects, level) };
  };
  const equipped = loadoutOf(ctx, wizard, rules).filter((id): id is string => id !== null && (levels.get(id)?.level ?? 0) > 0);
  return {
    contentVersion: CONTENT_VERSION,
    rulesetId: rules.id,
    encounterId,
    player: {
      name: wizard.name,
      element: wizard.starter_element,
      maxHp: maxHpFor(rules, rank.level),
      maxMana: maxManaFor(rules, wizard.mana_level),
      speed: rules.combat.playerSpeed,
      manaRegen: rules.combat.manaRegenPerRound,
      spells: [toCombatSpell('arcane_bolt', 1), toCombatSpell('guard', 1), ...equipped.map((id) => toCombatSpell(id, levels.get(id)!.level))],
    },
    enemy: {
      name: encounter.enemy.name,
      element: encounter.enemy.element,
      maxHp: encounter.enemy.hp,
      speed: encounter.enemy.speed,
      moves: encounter.enemy.moves.map((m) => ({ id: m.id, name: m.name, element: m.element, manaCost: 0, cooldown: m.cooldown, effects: m.effects, weight: m.weight })),
    },
  };
}

export function startEncounter(ctx: AppContext, accountId: string, encounterId: string) {
  const snapshot = buildSnapshot(ctx, accountId, encounterId);
  const id = newId();
  const now = iso(ctx.clock.now());
  try {
    run(
      ctx.db,
      `INSERT INTO matches (id, account_id, encounter_id, mode, content_version, ruleset_id, seed, state, turn_version, snapshot, battle_state, created_at, updated_at)
       VALUES (?, ?, ?, 'pve', ?, ?, ?, 'IN_PROGRESS', 0, ?, ?, ?, ?)`,
      id, accountId, encounterId, snapshot.contentVersion, snapshot.rulesetId, newId(),
      JSON.stringify(snapshot), JSON.stringify(initialState(snapshot)), now, now,
    );
  } catch (err) {
    if (isUniqueViolation(err)) {
      const open = one<{ id: string }>(ctx.db, "SELECT id FROM matches WHERE account_id = ? AND state IN ('CREATED', 'IN_PROGRESS')", accountId);
      throw conflict('MATCH_IN_PROGRESS', 'Finish or forfeit your current battle first', { match_id: open?.id });
    }
    throw err;
  }
  track(ctx, accountId, 'encounter_started', { encounter_id: encounterId, content_version: CONTENT_VERSION });
  return matchView(ctx, one<MatchRow>(ctx.db, 'SELECT * FROM matches WHERE id = ?', id)!);
}

export function getMatch(ctx: AppContext, accountId: string, matchId: string) {
  return matchView(ctx, ownedMatch(ctx, accountId, matchId));
}

/**
 * COMBAT-002/003: validate turn version and legality, resolve on the server, and
 * persist ordered events. A repeated or stale `turn_version` is rejected without
 * applying anything twice (AT-07). The client never submits outcomes (AT-06).
 */
export function submitAction(ctx: AppContext, accountId: string, matchId: string, input: { turnVersion: number; spellId: string }) {
  const result = transaction(ctx.db, () => {
    const row = ownedMatch(ctx, accountId, matchId);
    if (row.state !== 'IN_PROGRESS') throw conflict('MATCH_NOT_ACTIVE', 'This battle has already ended', { state: row.state });
    if (row.turn_version !== input.turnVersion) {
      throw conflict('STALE_TURN', 'That turn was already played; refresh the battle', { current_turn_version: row.turn_version });
    }
    const snapshot = JSON.parse(row.snapshot) as MatchSnapshot;
    let resolved: { state: BattleState; events: BattleEvent[] };
    try {
      resolved = resolveTurn(snapshot, row.seed, JSON.parse(row.battle_state) as BattleState, input.spellId);
    } catch (err) {
      if (err instanceof IllegalActionError) throw unprocessable(err.code, err.message);
      throw err;
    }
    const now = iso(ctx.clock.now());
    run(ctx.db, 'INSERT INTO combat_actions (match_id, turn_version, spell_id, created_at) VALUES (?, ?, ?, ?)', row.id, row.turn_version, input.spellId, now);
    const firstSeq = one<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM combat_events WHERE match_id = ?', row.id)!.n;
    resolved.events.forEach((e, i) =>
      run(
        ctx.db,
        'INSERT INTO combat_events (match_id, sequence, turn, actor, kind, payload) VALUES (?, ?, ?, ?, ?, ?)',
        row.id, firstSeq + i, e.turn, e.actor, e.kind, JSON.stringify({ message: e.message, data: e.data ?? null }),
      ),
    );
    const outcome = resolved.state.outcome;
    run(
      ctx.db,
      'UPDATE matches SET battle_state = ?, turn_version = turn_version + 1, state = ?, winner = ?, updated_at = ? WHERE id = ? AND turn_version = ?',
      JSON.stringify(resolved.state),
      outcome ? 'SETTLING' : 'IN_PROGRESS',
      outcome === 'victory' ? 'player' : outcome === 'defeat' ? 'enemy' : null,
      now,
      row.id,
      row.turn_version,
    );
    if (outcome) settleMatch(ctx, row.id);
    return resolved.events;
  });
  return { ...getMatch(ctx, accountId, matchId), new_events: result };
}

export function forfeit(ctx: AppContext, accountId: string, matchId: string) {
  transaction(ctx.db, () => {
    const row = ownedMatch(ctx, accountId, matchId);
    if (row.state !== 'IN_PROGRESS') throw conflict('MATCH_NOT_ACTIVE', 'This battle has already ended', { state: row.state });
    run(ctx.db, "UPDATE matches SET state = 'SETTLING', winner = 'enemy', updated_at = ? WHERE id = ?", iso(ctx.clock.now()), row.id);
    settleMatch(ctx, row.id);
  });
  return getMatch(ctx, accountId, matchId);
}

/**
 * COMBAT-006: settle exactly once. Only SETTLING matches are processed, the
 * transition to FINISHED happens in the same transaction as the XP credit, and
 * the ledger key `combat-reward:<match>` makes a duplicate credit impossible
 * even if a worker retries after a crash (AT-10).
 */
export function settleMatch(ctx: AppContext, matchId: string): void {
  transaction(ctx.db, () => {
    const row = one<MatchRow>(ctx.db, 'SELECT * FROM matches WHERE id = ?', matchId);
    if (!row || row.state !== 'SETTLING') return;
    const rules = ctx.rules.byId(row.ruleset_id);
    const encounter = ENCOUNTERS_BY_ID.get(row.encounter_id);
    const { day, earned } = xpEarnedToday(ctx, row.account_id);
    const base = row.winner === 'player' ? encounter?.xpReward ?? 0 : 0;
    const xp = Math.min(base, Math.max(0, rules.combat.dailyXpCap - earned));
    if (xp > 0) {
      postEntry(ctx, {
        accountId: row.account_id,
        currency: 'COMBAT_XP',
        delta: xp,
        reason: COMBAT_REWARD_REASON,
        sourceId: row.id,
        idempotencyKey: `combat-reward:${row.id}`,
        rulesetId: rules.id,
        studyDay: day,
      });
    }
    const now = iso(ctx.clock.now());
    run(
      ctx.db,
      "UPDATE matches SET state = 'FINISHED', reward = ?, settled_at = ?, updated_at = ? WHERE id = ? AND state = 'SETTLING'",
      JSON.stringify({ xp, base_xp: base, daily_cap: rules.combat.dailyXpCap, capped: xp < base }),
      now, now, row.id,
    );
    track(ctx, row.account_id, 'battle_completed', { encounter_id: row.encounter_id, result: row.winner === 'player' ? 'victory' : 'defeat', xp });
  });
}

/** Worker: finish settlement for anything left in SETTLING and auto-surrender abandoned battles. */
export function combatMaintenance(ctx: AppContext): { settled: number; aborted: number } {
  const pending = many<{ id: string }>(ctx.db, "SELECT id FROM matches WHERE state = 'SETTLING'");
  for (const { id } of pending) settleMatch(ctx, id);
  const cutoff = ctx.clock.now() - ctx.rules.active().combat.matchIdleAbortHours * 3_600_000;
  const idle = many<{ id: string; updated_at: string }>(ctx.db, "SELECT id, updated_at FROM matches WHERE state = 'IN_PROGRESS'").filter(
    (m) => ms(m.updated_at) < cutoff,
  );
  for (const { id } of idle) {
    run(ctx.db, "UPDATE matches SET state = 'ABORTED', winner = 'enemy', updated_at = ? WHERE id = ? AND state = 'IN_PROGRESS'", iso(ctx.clock.now()), id);
  }
  return { settled: pending.length, aborted: idle.length };
}

function statusesOf(f: Fighter) {
  return {
    shield: f.shield,
    burn: f.burn,
    paralysis: f.paralysis,
    guarding: f.guarding,
  };
}

/** Client-facing view. The seed is never exposed, so outcomes cannot be predicted. */
function matchView(ctx: AppContext, row: MatchRow) {
  const snapshot = JSON.parse(row.snapshot) as MatchSnapshot;
  const state = JSON.parse(row.battle_state) as BattleState;
  const legal = new Map(legalActions(snapshot, state).map((a) => [a.spell_id, a]));
  const encounter = ENCOUNTERS_BY_ID.get(row.encounter_id);
  const events = many<{ sequence: number; turn: number; actor: string; kind: string; payload: string }>(
    ctx.db,
    'SELECT sequence, turn, actor, kind, payload FROM combat_events WHERE match_id = ? ORDER BY sequence',
    row.id,
  ).map((e) => ({ sequence: e.sequence, turn: e.turn, actor: e.actor, kind: e.kind, ...(JSON.parse(e.payload) as { message: string; data: unknown }) }));
  return {
    id: row.id,
    encounter: { id: row.encounter_id, name: encounter?.name ?? row.encounter_id, description: encounter?.description ?? '' },
    state: row.state,
    turn_version: row.turn_version,
    winner: row.winner,
    reward: row.reward ? JSON.parse(row.reward) : null,
    content_version: row.content_version,
    player: {
      name: snapshot.player.name,
      element: snapshot.player.element,
      hp: state.player.hp,
      max_hp: snapshot.player.maxHp,
      mana: state.player.mana,
      max_mana: snapshot.player.maxMana,
      statuses: statusesOf(state.player),
    },
    enemy: {
      name: snapshot.enemy.name,
      element: snapshot.enemy.element,
      hp: state.enemy.hp,
      max_hp: snapshot.enemy.maxHp,
      statuses: statusesOf(state.enemy),
    },
    actions: snapshot.player.spells.map((s) => ({
      spell_id: s.id,
      name: s.name,
      element: s.element,
      mana_cost: s.manaCost,
      cooldown: s.cooldown,
      cooldown_remaining: state.player.cooldowns[s.id] ?? 0,
      effects: s.effects,
      description: SPELLS_BY_ID.get(s.id)?.description ?? '',
      available: legal.get(s.id)?.available ?? false,
      reason: legal.get(s.id)?.reason ?? null,
    })),
    events,
    created_at: row.created_at,
  };
}
