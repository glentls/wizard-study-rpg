import type { AppContext } from '../../context.js';
import type { Ruleset } from '../../config/ruleset.js';
import { SPELLS_BY_ID } from '../../content/index.js';
import { isUniqueViolation, many, one, run, transaction } from '../../db/database.js';
import { iso, ms } from '../../lib/clock.js';
import { AppError, conflict, notFound, unprocessable } from '../../lib/errors.js';
import { newId } from '../../lib/crypto.js';
import { recentStudyDays, studyDay } from '../../lib/time.js';
import { audit, durationBucket, track } from '../analytics/service.js';
import { preferencesOf } from '../identity/service.js';
import { balanceOf, postEntry } from '../ledger/service.js';
import { applyMilestone, milestoneMinutesFor } from '../research/service.js';
import { findWizard, spellLevels } from '../wizard/service.js';
import { calculateAward, type AwardBreakdown } from './rewards.js';

export type FocusState = 'CREATED' | 'ACTIVE' | 'COMPLETED' | 'INTERRUPTED' | 'INVALIDATED';

export interface FocusSessionRow {
  id: string;
  account_id: string;
  state: FocusState;
  objective: string | null;
  research_target_spell_id: string | null;
  ruleset_id: string;
  started_at: string;
  cap_at: string;
  chain_offset_seconds: number;
  last_seen_at: string;
  ended_at: string | null;
  end_reason: string | null;
  validated_seconds: number | null;
  credited_minutes: number | null;
  study_day: string;
  break_until: string | null;
  award: string | null;
  settled_at: string | null;
}

export interface StoredAward extends AwardBreakdown {
  milestone: { spell_id: string; applied: boolean; code?: string; message?: string; leveled_up_to?: number | null } | null;
}

const ACTIVE_STATES = "('CREATED', 'ACTIVE')";

const getSession = (ctx: AppContext, id: string) => one<FocusSessionRow>(ctx.db, 'SELECT * FROM focus_sessions WHERE id = ?', id);

function ownedSession(ctx: AppContext, accountId: string, id: string): FocusSessionRow {
  const row = getSession(ctx, id);
  if (!row || row.account_id !== accountId) throw notFound('Focus session');
  return row;
}

/**
 * Continuous focus already accumulated before `atMs`: sessions separated by
 * less than the fatigue gap are chained together toward the 90-minute cap.
 */
function continuousChainSeconds(ctx: AppContext, accountId: string, atMs: number, rules: Ruleset): number {
  const rows = many<{ started_at: string; ended_at: string; validated_seconds: number }>(
    ctx.db,
    `SELECT started_at, ended_at, validated_seconds FROM focus_sessions
     WHERE account_id = ? AND state IN ('COMPLETED', 'INTERRUPTED') AND ended_at IS NOT NULL AND validated_seconds IS NOT NULL
     ORDER BY ended_at DESC LIMIT 50`,
    accountId,
  );
  const gapMs = rules.focus.fatigueChainGapMinutes * 60_000;
  let seconds = 0;
  let cursor = atMs;
  for (const row of rows) {
    if (cursor - ms(row.ended_at) >= gapMs) break;
    seconds += row.validated_seconds;
    cursor = ms(row.started_at);
  }
  return seconds;
}

/** FOC-02 / FOCUS-005: whether a break is required right now, and how much focus remains before one is. */
export function breakStatus(ctx: AppContext, accountId: string, rules = ctx.rules.active()) {
  const now = ctx.clock.now();
  const capSeconds = rules.focus.maxContinuousMinutes * 60;
  // break_until is written when a session closes at the continuous cap; it is the source of truth.
  const until = one<{ until: string | null }>(ctx.db, 'SELECT MAX(break_until) AS until FROM focus_sessions WHERE account_id = ?', accountId)?.until;
  if (until && ms(until) > now) {
    return {
      break_required: true,
      break_until: until,
      break_remaining_seconds: Math.ceil((ms(until) - now) / 1000),
      chain_seconds: capSeconds,
      focus_available_seconds: 0,
    };
  }
  const chain = continuousChainSeconds(ctx, accountId, now, rules);
  const carried = chain >= capSeconds ? 0 : chain;
  return { break_required: false, break_until: null, break_remaining_seconds: 0, chain_seconds: carried, focus_available_seconds: capSeconds - carried };
}

/**
 * Decides whether an active session must close, purely from server timestamps
 * (FOCUS-002/004/007):
 *  - no heartbeat for longer than the grace window -> INTERRUPTED at the last
 *    verified heartbeat (the unverified gap is not credited);
 *  - otherwise, once the cap time passes -> COMPLETED exactly at the cap,
 *    even if the client never came back.
 */
function evaluateActive(row: FocusSessionRow, now: number, rules: Ruleset): { state: FocusState; endedAt: number; reason: string } | null {
  const lastSeen = ms(row.last_seen_at);
  const cap = ms(row.cap_at);
  const grace = rules.focus.heartbeatGraceSeconds * 1000;
  if (lastSeen + grace < Math.min(now, cap)) return { state: 'INTERRUPTED', endedAt: lastSeen, reason: 'disconnected' };
  if (now >= cap) return { state: 'COMPLETED', endedAt: cap, reason: 'cap_reached' };
  return null;
}

function closeSession(ctx: AppContext, row: FocusSessionRow, state: FocusState, endedAt: number, reason: string): void {
  const validated = Math.max(0, Math.floor((endedAt - ms(row.started_at)) / 1000));
  // Conditional update keeps state transitions idempotent: only an ACTIVE row can close, and only once.
  run(
    ctx.db,
    `UPDATE focus_sessions SET state = ?, ended_at = ?, end_reason = ?, validated_seconds = ? WHERE id = ? AND state IN ${ACTIVE_STATES}`,
    state, iso(endedAt), reason, validated, row.id,
  );
}

/**
 * Exactly-once reward settlement. Safe to call any number of times, from a
 * request or from the background worker: settled_at plus the unique ledger key
 * `focus-reward:<session>` guarantee a single credit (ECON-003, AT-03).
 */
export function settleSession(ctx: AppContext, sessionId: string): FocusSessionRow {
  return transaction(ctx.db, () => {
    const row = getSession(ctx, sessionId);
    if (!row) throw notFound('Focus session');
    if (row.settled_at || (row.state !== 'COMPLETED' && row.state !== 'INTERRUPTED')) return row;
    const rules = ctx.rules.byId(row.ruleset_id);
    const validated = row.validated_seconds ?? 0;
    const creditedToday =
      one<{ total: number | null }>(
        ctx.db,
        'SELECT SUM(credited_minutes) AS total FROM focus_sessions WHERE account_id = ? AND study_day = ? AND settled_at IS NOT NULL AND id <> ?',
        row.account_id, row.study_day, row.id,
      )?.total ?? 0;
    const breakdown = calculateAward(rules, validated, creditedToday);
    if (breakdown.awarded_points > 0) {
      postEntry(ctx, {
        accountId: row.account_id,
        currency: 'RESEARCH_POINTS',
        delta: breakdown.awarded_points,
        reason: 'FOCUS_SESSION',
        sourceId: row.id,
        idempotencyKey: `focus-reward:${row.id}`,
        rulesetId: rules.id,
        studyDay: row.study_day,
      });
    }

    let milestone: StoredAward['milestone'] = null;
    if (row.research_target_spell_id) {
      try {
        const result = applyMilestone(ctx, row.account_id, {
          spellId: row.research_target_spell_id,
          sessionId: row.id,
          sessionState: row.state,
          validatedSeconds: validated,
        });
        milestone = { spell_id: row.research_target_spell_id, applied: true, leveled_up_to: result.leveled_up_to };
      } catch (err) {
        // A milestone that does not qualify never blocks the ordinary focus reward.
        if (!(err instanceof AppError)) throw err;
        milestone = { spell_id: row.research_target_spell_id, applied: false, code: err.code, message: err.message };
      }
    }

    const capSeconds = rules.focus.maxContinuousMinutes * 60;
    const breakUntil =
      row.ended_at && row.chain_offset_seconds + validated >= capSeconds
        ? iso(ms(row.ended_at) + rules.focus.requiredBreakMinutes * 60_000)
        : null;
    const award: StoredAward = { ...breakdown, milestone };
    run(
      ctx.db,
      'UPDATE focus_sessions SET award = ?, credited_minutes = ?, break_until = ?, settled_at = ? WHERE id = ? AND settled_at IS NULL',
      JSON.stringify(award), breakdown.credited_minutes, breakUntil, iso(ctx.clock.now()), row.id,
    );
    track(ctx, row.account_id, row.state === 'COMPLETED' ? 'focus_completed' : 'focus_interrupted', {
      session_id: row.id,
      duration_bucket: durationBucket(breakdown.validated_minutes),
      status: row.state,
    });
    if (breakdown.awarded_points > 0) track(ctx, row.account_id, 'points_granted', { amount: breakdown.awarded_points, currency: 'RESEARCH_POINTS' });
    return getSession(ctx, row.id)!;
  });
}

/** Closes any session whose time is up for this account. Called before every focus operation. */
export function reconcileAccount(ctx: AppContext, accountId: string): void {
  const rows = many<FocusSessionRow>(ctx.db, `SELECT * FROM focus_sessions WHERE account_id = ? AND state IN ${ACTIVE_STATES}`, accountId);
  for (const row of rows) reconcileRow(ctx, row);
}

function reconcileRow(ctx: AppContext, row: FocusSessionRow): void {
  const decision = evaluateActive(row, ctx.clock.now(), ctx.rules.byId(row.ruleset_id));
  if (!decision) return;
  transaction(ctx.db, () => {
    closeSession(ctx, row, decision.state, decision.endedAt, decision.reason);
    settleSession(ctx, row.id);
  });
}

/** Background worker pass: auto-close at cap / on disconnect, then settle anything left unsettled. */
export function reconcileAll(ctx: AppContext): { closed: number; settled: number } {
  let closed = 0;
  for (const row of many<FocusSessionRow>(ctx.db, `SELECT * FROM focus_sessions WHERE state IN ${ACTIVE_STATES}`)) {
    const before = row.state;
    reconcileRow(ctx, row);
    if (getSession(ctx, row.id)?.state !== before) closed++;
  }
  const unsettled = many<{ id: string }>(ctx.db, "SELECT id FROM focus_sessions WHERE state IN ('COMPLETED', 'INTERRUPTED') AND settled_at IS NULL");
  for (const { id } of unsettled) settleSession(ctx, id);
  return { closed, settled: unsettled.length };
}

export function startSession(ctx: AppContext, accountId: string, input: { objective?: string | null; researchTargetSpellId?: string | null }) {
  reconcileAccount(ctx, accountId);
  const rules = ctx.rules.active();
  const now = ctx.clock.now();
  const prefs = preferencesOf(ctx, accountId);
  const id = newId();
  try {
    transaction(ctx.db, () => {
      const active = one<{ id: string }>(ctx.db, `SELECT id FROM focus_sessions WHERE account_id = ? AND state IN ${ACTIVE_STATES}`, accountId);
      if (active) throw conflict('SESSION_ALREADY_ACTIVE', 'You already have a focus session running', { session_id: active.id });
      const status = breakStatus(ctx, accountId, rules);
      if (status.break_required) {
        throw unprocessable('BREAK_REQUIRED', 'Time for a break before your next rewarded session', { break_until: status.break_until });
      }
      if (input.researchTargetSpellId) {
        const spell = SPELLS_BY_ID.get(input.researchTargetSpellId);
        const wizard = findWizard(ctx, accountId);
        if (!spell || spell.baseline || !wizard) throw unprocessable('INVALID_RESEARCH_TARGET', 'Choose a spell from your research tree');
        const level = spellLevels(ctx, wizard.id).get(spell.id)?.level ?? 0;
        const needed = milestoneMinutesFor(rules, spell, level + 1, wizard) * 60;
        if (needed > status.focus_available_seconds) {
          throw unprocessable('MILESTONE_NOT_POSSIBLE', 'Not enough focus time left before your next break to reach this milestone', {
            required_minutes: needed / 60,
            available_minutes: Math.floor(status.focus_available_seconds / 60),
          });
        }
      }
      run(
        ctx.db,
        `INSERT INTO focus_sessions (id, account_id, state, objective, research_target_spell_id, ruleset_id, started_at, cap_at, chain_offset_seconds, last_seen_at, study_day)
         VALUES (?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        accountId,
        input.objective?.trim() || null,
        input.researchTargetSpellId ?? null,
        rules.id,
        iso(now),
        iso(now + status.focus_available_seconds * 1000),
        status.chain_seconds,
        iso(now),
        studyDay(now, prefs.timezone),
      );
    });
  } catch (err) {
    // Backstop for two devices racing past the check (FOCUS-001): the partial unique index rejects the second.
    if (isUniqueViolation(err)) throw conflict('SESSION_ALREADY_ACTIVE', 'You already have a focus session running');
    throw err;
  }
  track(ctx, accountId, 'focus_started', { session_id: id, has_research_target: Boolean(input.researchTargetSpellId) });
  return sessionView(ctx, getSession(ctx, id)!);
}

export function heartbeat(ctx: AppContext, accountId: string, sessionId: string, input: { sequence: number; deviceId?: string }) {
  ownedSession(ctx, accountId, sessionId);
  reconcileAccount(ctx, accountId);
  const row = getSession(ctx, sessionId)!;
  if (row.state !== 'ACTIVE') {
    throw conflict('SESSION_NOT_ACTIVE', 'This session has already ended', { session: sessionView(ctx, row) });
  }
  const now = iso(ctx.clock.now());
  transaction(ctx.db, () => {
    // Duplicate sequence numbers (client retries) are ignored rather than counted twice.
    run(
      ctx.db,
      'INSERT OR IGNORE INTO focus_heartbeats (session_id, sequence, device_id, server_received_at) VALUES (?, ?, ?, ?)',
      sessionId, input.sequence, input.deviceId ?? null, now,
    );
    run(ctx.db, "UPDATE focus_sessions SET last_seen_at = ? WHERE id = ? AND state = 'ACTIVE'", now, sessionId);
  });
  return sessionView(ctx, getSession(ctx, sessionId)!);
}

/**
 * Early finish or "pause" (MVP policy: pausing ends the session, FOCUS-003).
 * Idempotent: finishing an already-closed session returns its original result.
 */
export function finishSession(ctx: AppContext, accountId: string, sessionId: string) {
  ownedSession(ctx, accountId, sessionId);
  reconcileAccount(ctx, accountId);
  transaction(ctx.db, () => {
    const row = getSession(ctx, sessionId)!;
    if (row.state === 'ACTIVE' || row.state === 'CREATED') closeSession(ctx, row, 'COMPLETED', ctx.clock.now(), 'finished');
    settleSession(ctx, sessionId);
  });
  return sessionView(ctx, getSession(ctx, sessionId)!);
}

/** ADM-03: invalidate a session; if it was already rewarded, reverse what can be reversed. */
export function invalidateSession(ctx: AppContext, adminId: string, sessionId: string, reason: string, requestId: string) {
  return transaction(ctx.db, () => {
    const row = getSession(ctx, sessionId);
    if (!row) throw notFound('Focus session');
    if (row.state === 'INVALIDATED') return sessionView(ctx, row);
    const now = ctx.clock.now();
    const award = row.award ? (JSON.parse(row.award) as StoredAward) : null;
    let reversed = 0;
    if (award && award.awarded_points > 0) {
      reversed = Math.min(award.awarded_points, balanceOf(ctx, row.account_id, 'RESEARCH_POINTS'));
      if (reversed > 0) {
        postEntry(ctx, {
          accountId: row.account_id,
          currency: 'RESEARCH_POINTS',
          delta: -reversed,
          reason: 'ADMIN_REVERSAL',
          sourceId: row.id,
          idempotencyKey: `focus-reversal:${row.id}`,
          rulesetId: row.ruleset_id,
          studyDay: row.study_day,
        });
      }
    }
    run(
      ctx.db,
      `UPDATE focus_sessions SET state = 'INVALIDATED', ended_at = COALESCE(ended_at, ?), end_reason = 'invalidated',
       validated_seconds = COALESCE(validated_seconds, 0), credited_minutes = 0, settled_at = COALESCE(settled_at, ?) WHERE id = ?`,
      iso(now), iso(now), row.id,
    );
    audit(ctx, { actorId: adminId, action: 'focus.invalidated', target: row.id, details: { reason, reversed_points: reversed }, requestId });
    return sessionView(ctx, getSession(ctx, row.id)!);
  });
}

export function sessionView(ctx: AppContext, row: FocusSessionRow) {
  const rules = ctx.rules.byId(row.ruleset_id);
  const now = ctx.clock.now();
  const started = ms(row.started_at);
  const active = row.state === 'ACTIVE' || row.state === 'CREATED';
  const elapsed = active ? Math.max(0, Math.floor((Math.min(now, ms(row.cap_at)) - started) / 1000)) : row.validated_seconds ?? 0;
  const target = row.research_target_spell_id ? SPELLS_BY_ID.get(row.research_target_spell_id) : undefined;
  return {
    id: row.id,
    state: row.state,
    objective: row.objective,
    research_target: target ? { spell_id: target.id, name: target.name } : null,
    started_at: row.started_at,
    cap_at: row.cap_at,
    ended_at: row.ended_at,
    end_reason: row.end_reason,
    elapsed_seconds: elapsed,
    remaining_seconds: active ? Math.max(0, Math.floor((ms(row.cap_at) - now) / 1000)) : 0,
    continuous_focus_before_seconds: row.chain_offset_seconds,
    validated_seconds: row.validated_seconds,
    /** Live estimate while running (ignores the daily cap); final numbers come from `award`. */
    estimate: active ? calculateAward(rules, elapsed, 0) : null,
    award: row.award ? (JSON.parse(row.award) as StoredAward) : null,
    break_until: row.break_until,
    study_day: row.study_day,
    ruleset_id: row.ruleset_id,
    heartbeat_interval_seconds: rules.focus.heartbeatIntervalSeconds,
    heartbeat_grace_seconds: rules.focus.heartbeatGraceSeconds,
    server_time: iso(now),
  };
}

export type SessionView = ReturnType<typeof sessionView>;

export function getSessionView(ctx: AppContext, accountId: string, sessionId: string) {
  ownedSession(ctx, accountId, sessionId);
  reconcileAccount(ctx, accountId);
  return sessionView(ctx, getSession(ctx, sessionId)!);
}

/** FOC-05: everything the focus screen needs to recover after a reload or restart. */
export function currentFocus(ctx: AppContext, accountId: string) {
  reconcileAccount(ctx, accountId);
  const active = one<FocusSessionRow>(ctx.db, `SELECT * FROM focus_sessions WHERE account_id = ? AND state IN ${ACTIVE_STATES}`, accountId);
  const last = one<FocusSessionRow>(
    ctx.db,
    "SELECT * FROM focus_sessions WHERE account_id = ? AND state <> 'ACTIVE' ORDER BY started_at DESC LIMIT 1",
    accountId,
  );
  const rules = ctx.rules.active();
  return {
    active: active ? sessionView(ctx, active) : null,
    last: last ? sessionView(ctx, last) : null,
    break: breakStatus(ctx, accountId, rules),
    today: todayTotals(ctx, accountId, rules),
    rules: {
      ruleset_id: rules.id,
      max_continuous_minutes: rules.focus.maxContinuousMinutes,
      required_break_minutes: rules.focus.requiredBreakMinutes,
      daily_cap_minutes: rules.rewards.dailyCreditedMinutesCap,
      multiplier_bands: rules.rewards.multiplierBands.map((b) => ({ min_minutes: b.minMinutes, multiplier: b.multiplierBp / 10_000 })),
      heartbeat_interval_seconds: rules.focus.heartbeatIntervalSeconds,
    },
    server_time: iso(ctx.clock.now()),
  };
}

function todayTotals(ctx: AppContext, accountId: string, rules: Ruleset) {
  const day = studyDay(ctx.clock.now(), preferencesOf(ctx, accountId).timezone);
  const row = one<{ credited: number | null; validated: number | null; sessions: number }>(
    ctx.db,
    `SELECT SUM(credited_minutes) AS credited, SUM(validated_seconds) AS validated, COUNT(*) AS sessions
     FROM focus_sessions WHERE account_id = ? AND study_day = ? AND settled_at IS NOT NULL AND state <> 'INVALIDATED'`,
    accountId, day,
  );
  const credited = row?.credited ?? 0;
  return {
    study_day: day,
    sessions: row?.sessions ?? 0,
    focus_minutes: Math.floor((row?.validated ?? 0) / 60),
    credited_minutes: credited,
    daily_cap_remaining_minutes: Math.max(0, rules.rewards.dailyCreditedMinutesCap - credited),
  };
}

export function listSessions(ctx: AppContext, accountId: string, cursor: string | undefined, limit: number) {
  reconcileAccount(ctx, accountId);
  const rows = cursor
    ? many<FocusSessionRow>(ctx.db, 'SELECT * FROM focus_sessions WHERE account_id = ? AND started_at < ? ORDER BY started_at DESC LIMIT ?', accountId, cursor, limit + 1)
    : many<FocusSessionRow>(ctx.db, 'SELECT * FROM focus_sessions WHERE account_id = ? ORDER BY started_at DESC LIMIT ?', accountId, limit + 1);
  const page = rows.slice(0, limit);
  return { sessions: page.map((r) => sessionView(ctx, r)), next_cursor: rows.length > limit ? page[page.length - 1]!.started_at : null };
}

/**
 * FOC-06: daily/weekly summary. Streaks are shown gently: missing a day resets
 * the count but never removes rewards or progress (§12.5, no shame-based loss).
 */
export function studySummary(ctx: AppContext, accountId: string) {
  reconcileAccount(ctx, accountId);
  const prefs = preferencesOf(ctx, accountId);
  const days = recentStudyDays(ctx.clock.now(), prefs.timezone, 7);
  const rows = many<{ study_day: string; minutes: number; credited: number; sessions: number }>(
    ctx.db,
    `SELECT study_day, SUM(validated_seconds) / 60 AS minutes, SUM(credited_minutes) AS credited, COUNT(*) AS sessions
     FROM focus_sessions WHERE account_id = ? AND settled_at IS NOT NULL AND state <> 'INVALIDATED'
     GROUP BY study_day ORDER BY study_day DESC LIMIT 400`,
    accountId,
  );
  const byDay = new Map(rows.map((r) => [r.study_day, r]));
  const week = days.map((d) => ({
    study_day: d,
    focus_minutes: byDay.get(d)?.minutes ?? 0,
    credited_minutes: byDay.get(d)?.credited ?? 0,
    sessions: byDay.get(d)?.sessions ?? 0,
  }));

  // Streak: consecutive studied days ending today (or yesterday, so an unfinished today never "breaks" it).
  const studied = new Set(rows.filter((r) => r.minutes > 0).map((r) => r.study_day));
  const history = recentStudyDays(ctx.clock.now(), prefs.timezone, 366).reverse();
  let streak = 0;
  for (let i = studied.has(history[0]!) ? 0 : 1; i < history.length && studied.has(history[i]!); i++) streak++;

  const today = week[week.length - 1]!;
  return {
    week,
    week_focus_minutes: week.reduce((s, d) => s + d.focus_minutes, 0),
    week_study_days: week.filter((d) => d.focus_minutes > 0).length,
    current_streak_days: streak,
    daily_goal_minutes: prefs.dailyGoalMinutes,
    today_goal_progress: prefs.dailyGoalMinutes ? Math.min(1, today.focus_minutes / prefs.dailyGoalMinutes) : null,
    total_sessions: rows.reduce((s, r) => s + r.sessions, 0),
  };
}
