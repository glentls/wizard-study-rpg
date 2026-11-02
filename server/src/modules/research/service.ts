import type { AppContext } from '../../context.js';
import type { Ruleset } from '../../config/ruleset.js';
import {
  CONTENT_VERSION,
  ELEMENTS,
  PLAYABLE_ELEMENTS,
  RESEARCHABLE_SPELLS,
  SPELLS,
  SPELLS_BY_ID,
  scaledEffects,
  starterSpellFor,
  type SpellDefinition,
} from '../../content/index.js';
import { isUniqueViolation, one, run, transaction } from '../../db/database.js';
import { iso } from '../../lib/clock.js';
import { conflict, notFound, unprocessable } from '../../lib/errors.js';
import { newId } from '../../lib/crypto.js';
import { studyDay } from '../../lib/time.js';
import { track } from '../analytics/service.js';
import { preferencesOf } from '../identity/service.js';
import { balanceOf, postEntry } from '../ledger/service.js';
import { autoEquip, maxManaFor, requireWizard, spellLevels, type WizardRow } from '../wizard/service.js';

export type ResearchState = 'LOCKED' | 'AVAILABLE' | 'IN_PROGRESS' | 'MILESTONE_PENDING' | 'UNLOCKED' | 'MAXED';

/** Research points needed to reach `targetLevel` (1 = initial unlock). */
export function costFor(rules: Ruleset, spell: SpellDefinition, targetLevel: number): number {
  if (targetLevel <= 1) return spell.unlockCost;
  return Math.round(spell.upgradeCostBase * (rules.research.upgradeCostGrowthBp / 10_000) ** (targetLevel - 2));
}

/** Minutes of uninterrupted focus required to reach `targetLevel`, or 0 if none (MAGIC-002/003). */
export function milestoneMinutesFor(rules: Ruleset, spell: SpellDefinition, targetLevel: number, wizard: WizardRow): number {
  if (targetLevel === 1) {
    const isStarter = starterSpellFor(wizard.starter_element)?.id === spell.id;
    if (isStarter && rules.research.starterSpellMilestoneExempt) return 0;
    return rules.research.initialUnlockMilestoneMinutes;
  }
  return rules.research.criticalLevels.includes(targetLevel) ? rules.research.criticalMilestoneMinutes : 0;
}

export const manaUpgradeCost = (rules: Ruleset, currentLevel: number): number =>
  Math.round(rules.research.mana.costBase * (rules.research.mana.costGrowthBp / 10_000) ** (currentLevel - 1));

function milestoneSatisfied(ctx: AppContext, wizardId: string, spellId: string, targetLevel: number): boolean {
  return Boolean(
    one(
      ctx.db,
      'SELECT 1 FROM research_milestones WHERE wizard_id = ? AND spell_id = ? AND target_level = ? AND consumed_at IS NULL',
      wizardId, spellId, targetLevel,
    ),
  );
}

function prerequisitesMet(spell: SpellDefinition, levels: Map<string, { level: number }>): boolean {
  return spell.prerequisites.every((p) => (levels.get(p.spellId)?.level ?? 0) >= p.minLevel);
}

function spellView(ctx: AppContext, rules: Ruleset, wizard: WizardRow, spell: SpellDefinition, levels: Map<string, { level: number; research_progress: number }>) {
  const current = levels.get(spell.id) ?? { level: 0, research_progress: 0 };
  const max = rules.research.maxSpellLevel;
  const maxed = current.level >= max;
  const target = current.level + 1;
  const cost = maxed ? null : costFor(rules, spell, target);
  const milestoneMinutes = maxed ? 0 : milestoneMinutesFor(rules, spell, target, wizard);
  const milestoneDone = milestoneMinutes > 0 && milestoneSatisfied(ctx, wizard.id, spell.id, target);
  const prereqsMet = prerequisitesMet(spell, levels);

  let state: ResearchState;
  if (maxed) state = 'MAXED';
  else if (current.level === 0 && !prereqsMet) state = 'LOCKED';
  else if (cost !== null && current.research_progress >= cost && milestoneMinutes > 0 && !milestoneDone) state = 'MILESTONE_PENDING';
  else if (current.research_progress > 0) state = 'IN_PROGRESS';
  else if (current.level > 0) state = 'UNLOCKED';
  else state = 'AVAILABLE';

  return {
    id: spell.id,
    name: spell.name,
    element: spell.element,
    tier: spell.tier,
    description: spell.description,
    target: spell.target,
    mana_cost: spell.manaCost,
    cooldown: spell.cooldown,
    effects: scaledEffects(spell.effects, Math.max(1, current.level)),
    prerequisites: spell.prerequisites.map((p) => ({
      spell_id: p.spellId,
      name: SPELLS_BY_ID.get(p.spellId)?.name ?? p.spellId,
      min_level: p.minLevel,
      met: (levels.get(p.spellId)?.level ?? 0) >= p.minLevel,
    })),
    level: current.level,
    max_level: max,
    state,
    next_level: maxed ? null : target,
    next_cost: cost,
    progress: current.research_progress,
    milestone: milestoneMinutes > 0 ? { minutes: milestoneMinutes, satisfied: milestoneDone } : null,
  };
}

export type SpellView = ReturnType<typeof spellView>;

/** GET /research/tree: versioned tree with this wizard's state for every spell (MAGIC-001). */
export function researchTree(ctx: AppContext, accountId: string) {
  const rules = ctx.rules.active();
  const wizard = requireWizard(ctx, accountId);
  const levels = spellLevels(ctx, wizard.id);
  const manaMaxed = wizard.mana_level >= rules.research.mana.maxLevel;
  return {
    content_version: CONTENT_VERSION,
    ruleset_id: rules.id,
    balance: balanceOf(ctx, accountId, 'RESEARCH_POINTS'),
    elements: PLAYABLE_ELEMENTS.map((id) => ({
      ...ELEMENTS[id],
      is_starter: id === wizard.starter_element,
      spells: RESEARCHABLE_SPELLS.filter((s) => s.element === id).map((s) => spellView(ctx, rules, wizard, s, levels)),
    })),
    baseline: SPELLS.filter((s) => s.baseline).map((s) => ({ id: s.id, name: s.name, description: s.description, effects: s.effects, mana_cost: s.manaCost })),
    mana: {
      level: wizard.mana_level,
      max_level: rules.research.mana.maxLevel,
      max_mana: maxManaFor(rules, wizard.mana_level),
      next_max_mana: manaMaxed ? null : maxManaFor(rules, wizard.mana_level + 1),
      next_cost: manaMaxed ? null : manaUpgradeCost(rules, wizard.mana_level),
    },
  };
}

function loadSpell(spellId: string): SpellDefinition {
  const spell = SPELLS_BY_ID.get(spellId);
  if (!spell || spell.baseline) throw notFound(`Spell ${spellId}`);
  return spell;
}

/** Levels the spell up if points and any milestone are both in place. Runs inside the caller's transaction. */
function levelUpIfReady(ctx: AppContext, accountId: string, wizard: WizardRow, spell: SpellDefinition): number | null {
  const rules = ctx.rules.active();
  const row = one<{ level: number; research_progress: number }>(
    ctx.db, 'SELECT level, research_progress FROM wizard_spells WHERE wizard_id = ? AND spell_id = ?', wizard.id, spell.id,
  );
  if (!row || row.level >= rules.research.maxSpellLevel) return null;
  const target = row.level + 1;
  const cost = costFor(rules, spell, target);
  if (row.research_progress < cost) return null;
  if (milestoneMinutesFor(rules, spell, target, wizard) > 0) {
    if (!milestoneSatisfied(ctx, wizard.id, spell.id, target)) return null;
    run(
      ctx.db,
      'UPDATE research_milestones SET consumed_at = ? WHERE wizard_id = ? AND spell_id = ? AND target_level = ? AND consumed_at IS NULL',
      iso(ctx.clock.now()), wizard.id, spell.id, target,
    );
  }
  const now = iso(ctx.clock.now());
  run(
    ctx.db,
    `UPDATE wizard_spells SET level = ?, research_progress = research_progress - ?, unlocked_at = COALESCE(unlocked_at, ?), updated_at = ?
     WHERE wizard_id = ? AND spell_id = ?`,
    target, cost, now, now, wizard.id, spell.id,
  );
  run(ctx.db, 'UPDATE wizards SET revision = revision + 1 WHERE id = ?', wizard.id);
  if (target === 1) autoEquip(ctx, wizard, spell.id);
  track(ctx, accountId, 'spell_unlocked', { spell_id: spell.id, tier: spell.tier, level: target, research_cost: cost });
  return target;
}

/**
 * MAGIC-003/004, BR-04: move research points from the balance into a spell.
 * Debit, progress and any resulting level-up commit atomically, or not at all.
 * `expectedLevel` rejects stale requests (e.g. a second tab that already upgraded).
 */
export function allocate(ctx: AppContext, accountId: string, input: { spellId: string; points: number; expectedLevel: number }) {
  const rules = ctx.rules.active();
  const spell = loadSpell(input.spellId);
  return transaction(ctx.db, () => {
    const wizard = requireWizard(ctx, accountId);
    const levels = spellLevels(ctx, wizard.id);
    const current = levels.get(spell.id) ?? { level: 0, research_progress: 0 };
    if (current.level !== input.expectedLevel) {
      throw conflict('STALE_RESEARCH_STATE', 'This spell changed since you last looked; refresh and try again', { level: current.level });
    }
    if (current.level >= rules.research.maxSpellLevel) throw unprocessable('SPELL_MAXED', `${spell.name} is already at its maximum level`);
    if (current.level === 0 && !prerequisitesMet(spell, levels)) {
      throw unprocessable('PREREQUISITES_NOT_MET', `Research the prerequisites for ${spell.name} first`, { prerequisites: spell.prerequisites });
    }
    const remaining = costFor(rules, spell, current.level + 1) - current.research_progress;
    if (remaining <= 0) throw unprocessable('MILESTONE_REQUIRED', `${spell.name} is fully funded and waiting on its focus milestone`);
    const spend = Math.min(input.points, remaining);
    const day = studyDay(ctx.clock.now(), preferencesOf(ctx, accountId).timezone);
    postEntry(ctx, {
      accountId,
      currency: 'RESEARCH_POINTS',
      delta: -spend,
      reason: 'RESEARCH_ALLOCATION',
      sourceId: spell.id,
      idempotencyKey: `research-allocation:${newId()}`,
      rulesetId: rules.id,
      studyDay: day,
    });
    const now = iso(ctx.clock.now());
    run(
      ctx.db,
      `INSERT INTO wizard_spells (wizard_id, spell_id, level, research_progress, updated_at) VALUES (?, ?, 0, ?, ?)
       ON CONFLICT (wizard_id, spell_id) DO UPDATE SET research_progress = research_progress + excluded.research_progress, updated_at = excluded.updated_at`,
      wizard.id, spell.id, spend, now,
    );
    track(ctx, accountId, 'research_allocated', { spell_id: spell.id, points: spend });
    const newLevel = levelUpIfReady(ctx, accountId, wizard, spell);
    return {
      allocated: spend,
      leveled_up_to: newLevel,
      balance: balanceOf(ctx, accountId, 'RESEARCH_POINTS'),
      spell: spellView(ctx, rules, wizard, spell, spellLevels(ctx, wizard.id)),
    };
  });
}

export interface MilestoneAttempt {
  spellId: string;
  sessionId: string;
  sessionState: string;
  validatedSeconds: number;
}

/**
 * Applies a completed focus session to a spell's milestone (MAGIC-002, RES-03).
 * Interrupted or too-short sessions never count, but they also never take away
 * points; the session's ordinary focus reward is unaffected either way.
 */
export function applyMilestone(ctx: AppContext, accountId: string, attempt: MilestoneAttempt) {
  const rules = ctx.rules.active();
  const spell = loadSpell(attempt.spellId);
  return transaction(ctx.db, () => {
    const wizard = requireWizard(ctx, accountId);
    const levels = spellLevels(ctx, wizard.id);
    const current = levels.get(spell.id) ?? { level: 0, research_progress: 0 };
    if (current.level === 0 && !prerequisitesMet(spell, levels)) {
      throw unprocessable('PREREQUISITES_NOT_MET', `Research the prerequisites for ${spell.name} first`);
    }
    const target = current.level + 1;
    const minutes = milestoneMinutesFor(rules, spell, target, wizard);
    if (minutes === 0) throw unprocessable('MILESTONE_NOT_REQUIRED', `Level ${target} of ${spell.name} has no milestone`);
    if (milestoneSatisfied(ctx, wizard.id, spell.id, target)) {
      throw conflict('MILESTONE_ALREADY_SATISFIED', `The level ${target} milestone for ${spell.name} is already complete`);
    }
    if (attempt.sessionState !== 'COMPLETED') {
      throw unprocessable('MILESTONE_INTERRUPTED', 'Milestones need an uninterrupted session; your focus points were still kept');
    }
    if (attempt.validatedSeconds < minutes * 60) {
      throw unprocessable('MILESTONE_TOO_SHORT', `This milestone needs ${minutes} uninterrupted minutes`, {
        required_minutes: minutes,
        session_minutes: Math.floor(attempt.validatedSeconds / 60),
      });
    }
    try {
      run(
        ctx.db,
        'INSERT INTO research_milestones (id, wizard_id, spell_id, target_level, session_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        newId(), wizard.id, spell.id, target, attempt.sessionId, iso(ctx.clock.now()),
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('SESSION_ALREADY_USED', 'That session has already been used for a milestone');
      throw err;
    }
    const newLevel = levelUpIfReady(ctx, accountId, wizard, spell);
    return {
      spell_id: spell.id,
      target_level: target,
      satisfied: true,
      leveled_up_to: newLevel,
      spell: spellView(ctx, rules, wizard, spell, spellLevels(ctx, wizard.id)),
    };
  });
}

/** POST /research/milestones: apply an already-finished session after the fact. */
export function applyMilestoneFromSession(ctx: AppContext, accountId: string, spellId: string, sessionId: string) {
  const session = one<{ state: string; validated_seconds: number | null; settled_at: string | null }>(
    ctx.db,
    'SELECT state, validated_seconds, settled_at FROM focus_sessions WHERE id = ? AND account_id = ?',
    sessionId, accountId,
  );
  if (!session) throw notFound('Focus session');
  if (!session.settled_at) throw unprocessable('SESSION_NOT_FINISHED', 'Finish the session before applying it to a milestone');
  return applyMilestone(ctx, accountId, {
    spellId,
    sessionId,
    sessionState: session.state,
    validatedSeconds: session.validated_seconds ?? 0,
  });
}

/** MAGIC-006: mana capacity is its own research track, separate from spells. */
export function upgradeMana(ctx: AppContext, accountId: string, expectedLevel: number) {
  const rules = ctx.rules.active();
  return transaction(ctx.db, () => {
    const wizard = requireWizard(ctx, accountId);
    if (wizard.mana_level !== expectedLevel) {
      throw conflict('STALE_RESEARCH_STATE', 'Mana level changed since you last looked', { level: wizard.mana_level });
    }
    if (wizard.mana_level >= rules.research.mana.maxLevel) throw unprocessable('MANA_MAXED', 'Mana capacity is already at its maximum');
    const cost = manaUpgradeCost(rules, wizard.mana_level);
    postEntry(ctx, {
      accountId,
      currency: 'RESEARCH_POINTS',
      delta: -cost,
      reason: 'MANA_RESEARCH',
      sourceId: wizard.id,
      idempotencyKey: `mana-research:${wizard.id}:${wizard.mana_level + 1}`,
      rulesetId: rules.id,
      studyDay: studyDay(ctx.clock.now(), preferencesOf(ctx, accountId).timezone),
    });
    run(ctx.db, 'UPDATE wizards SET mana_level = mana_level + 1, revision = revision + 1 WHERE id = ?', wizard.id);
    return {
      level: wizard.mana_level + 1,
      max_mana: maxManaFor(rules, wizard.mana_level + 1),
      spent: cost,
      balance: balanceOf(ctx, accountId, 'RESEARCH_POINTS'),
    };
  });
}
