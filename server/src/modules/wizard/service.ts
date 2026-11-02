import type { AppContext } from '../../context.js';
import { rankFor, type Ruleset } from '../../config/ruleset.js';
import { BASELINE_SPELL_IDS, ELEMENTS, PLAYABLE_ELEMENTS, SPELLS_BY_ID, type ElementId } from '../../content/index.js';
import { isUniqueViolation, many, one, run, transaction } from '../../db/database.js';
import { iso } from '../../lib/clock.js';
import { conflict, unprocessable } from '../../lib/errors.js';
import { newId } from '../../lib/crypto.js';
import { audit, track } from '../analytics/service.js';
import { updatePreferences } from '../identity/service.js';
import { balancesOf } from '../ledger/service.js';

export interface WizardRow {
  id: string;
  account_id: string;
  name: string;
  starter_element: ElementId;
  mana_level: number;
  loadout_revision: number;
  revision: number;
  created_at: string;
}

// Deliberately small; a moderation service replaces this before public social features (P1).
const BLOCKED_NAME_PARTS = ['fuck', 'shit', 'cunt', 'bitch', 'nigg', 'fag', 'whore', 'slut', 'rape', 'nazi', 'hitler', 'admin', 'moderator'];
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };

export function isNameAllowed(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[0-9@$]/g, (c) => LEET[c] ?? c).replace(/[^a-z]/g, '');
  return !BLOCKED_NAME_PARTS.some((part) => normalized.includes(part));
}

export function findWizard(ctx: AppContext, accountId: string): WizardRow | undefined {
  return one<WizardRow>(ctx.db, 'SELECT * FROM wizards WHERE account_id = ?', accountId);
}

export function requireWizard(ctx: AppContext, accountId: string): WizardRow {
  const wizard = findWizard(ctx, accountId);
  if (!wizard) throw unprocessable('WIZARD_REQUIRED', 'Create your wizard first');
  return wizard;
}

/** ACC-02 / AUTH-004: exactly one wizard per account, unique and filtered display name. */
export function createWizard(ctx: AppContext, accountId: string, input: { name: string; element: ElementId; learningGoal?: string | null }): WizardRow {
  if (!PLAYABLE_ELEMENTS.includes(input.element)) {
    throw unprocessable('ELEMENT_NOT_AVAILABLE', `${input.element} is not a starter element in this release`);
  }
  if (!isNameAllowed(input.name)) throw unprocessable('NAME_NOT_ALLOWED', 'Please choose a different wizard name');
  const wizard: WizardRow = {
    id: newId(),
    account_id: accountId,
    name: input.name.trim(),
    starter_element: input.element,
    mana_level: 1,
    loadout_revision: 0,
    revision: 0,
    created_at: iso(ctx.clock.now()),
  };
  try {
    transaction(ctx.db, () => {
      if (findWizard(ctx, accountId)) throw conflict('WIZARD_EXISTS', 'This account already has a wizard');
      run(
        ctx.db,
        'INSERT INTO wizards (id, account_id, name, starter_element, created_at) VALUES (?, ?, ?, ?, ?)',
        wizard.id, accountId, wizard.name, wizard.starter_element, wizard.created_at,
      );
      if (input.learningGoal !== undefined) updatePreferences(ctx, accountId, { learningGoal: input.learningGoal });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('NAME_TAKEN', 'That wizard name is already taken');
    throw err;
  }
  track(ctx, accountId, 'onboarding_completed', { element: input.element });
  return wizard;
}

export function spellLevels(ctx: AppContext, wizardId: string): Map<string, { level: number; research_progress: number }> {
  const rows = many<{ spell_id: string; level: number; research_progress: number }>(
    ctx.db,
    'SELECT spell_id, level, research_progress FROM wizard_spells WHERE wizard_id = ?',
    wizardId,
  );
  return new Map(rows.map((r) => [r.spell_id, { level: r.level, research_progress: r.research_progress }]));
}

export const maxManaFor = (rules: Ruleset, manaLevel: number): number =>
  rules.research.mana.baseMana + rules.research.mana.manaPerLevel * (manaLevel - 1);

export const maxHpFor = (rules: Ruleset, rankLevel: number): number => rules.combat.playerBaseHp + rules.combat.hpPerRank * (rankLevel - 1);

export function loadoutOf(ctx: AppContext, wizard: WizardRow, rules: Ruleset): (string | null)[] {
  const slots: (string | null)[] = Array.from({ length: rules.combat.loadoutSlots }, () => null);
  for (const row of many<{ slot: number; spell_id: string }>(ctx.db, 'SELECT slot, spell_id FROM loadouts WHERE wizard_id = ?', wizard.id)) {
    if (row.slot < slots.length) slots[row.slot] = row.spell_id;
  }
  return slots;
}

export function wizardProfile(ctx: AppContext, accountId: string) {
  const wizard = findWizard(ctx, accountId);
  if (!wizard) return null;
  const rules = ctx.rules.active();
  const balances = balancesOf(ctx, accountId);
  const rank = rankFor(rules, balances.COMBAT_XP);
  const levels = spellLevels(ctx, wizard.id);
  return {
    id: wizard.id,
    name: wizard.name,
    element: wizard.starter_element,
    element_name: ELEMENTS[wizard.starter_element].name,
    created_at: wizard.created_at,
    rank,
    stats: {
      max_hp: maxHpFor(rules, rank.level),
      max_mana: maxManaFor(rules, wizard.mana_level),
      mana_level: wizard.mana_level,
      speed: rules.combat.playerSpeed,
      mana_regen: rules.combat.manaRegenPerRound,
    },
    balances,
    unlocked_spells: [...levels.entries()]
      .filter(([, s]) => s.level > 0)
      .map(([id, s]) => ({ id, name: SPELLS_BY_ID.get(id)?.name ?? id, level: s.level, element: SPELLS_BY_ID.get(id)?.element })),
    baseline_spells: BASELINE_SPELL_IDS,
    loadout: { revision: wizard.loadout_revision, slots: loadoutOf(ctx, wizard, rules) },
  };
}

/** MAGIC-007: validated loadout with optimistic revision check (409 on stale edits). */
export function setLoadout(ctx: AppContext, accountId: string, input: { spellIds: string[]; revision: number }) {
  const rules = ctx.rules.active();
  return transaction(ctx.db, () => {
    const wizard = findWizard(ctx, accountId);
    if (!wizard) throw unprocessable('WIZARD_REQUIRED', 'Create your wizard first');
    if (wizard.loadout_revision !== input.revision) {
      throw conflict('LOADOUT_REVISION_CONFLICT', 'Your loadout changed elsewhere; reload and try again', { current_revision: wizard.loadout_revision });
    }
    if (input.spellIds.length > rules.combat.loadoutSlots) {
      throw unprocessable('TOO_MANY_SPELLS', `You can equip at most ${rules.combat.loadoutSlots} spells`);
    }
    if (new Set(input.spellIds).size !== input.spellIds.length) throw unprocessable('DUPLICATE_SPELL', 'Each spell can be equipped once');
    const levels = spellLevels(ctx, wizard.id);
    for (const spellId of input.spellIds) {
      const def = SPELLS_BY_ID.get(spellId);
      if (!def || def.baseline) throw unprocessable('SPELL_NOT_EQUIPPABLE', `${spellId} cannot be equipped`);
      if ((levels.get(spellId)?.level ?? 0) < 1) throw unprocessable('SPELL_LOCKED', `${def.name} has not been unlocked yet`);
    }
    run(ctx.db, 'DELETE FROM loadouts WHERE wizard_id = ?', wizard.id);
    input.spellIds.forEach((spellId, slot) => run(ctx.db, 'INSERT INTO loadouts (wizard_id, slot, spell_id) VALUES (?, ?, ?)', wizard.id, slot, spellId));
    run(ctx.db, 'UPDATE wizards SET loadout_revision = loadout_revision + 1 WHERE id = ?', wizard.id);
    audit(ctx, { actorId: accountId, action: 'wizard.loadout_updated', target: wizard.id, details: { spells: input.spellIds } });
    return { revision: wizard.loadout_revision + 1, slots: loadoutOf(ctx, { ...wizard }, rules) };
  });
}

/** Newly unlocked spells drop into a free loadout slot so a fresh wizard can use them straight away. */
export function autoEquip(ctx: AppContext, wizard: WizardRow, spellId: string): void {
  const rules = ctx.rules.active();
  const slots = loadoutOf(ctx, wizard, rules);
  if (slots.includes(spellId)) return;
  const free = slots.indexOf(null);
  if (free === -1) return;
  run(ctx.db, 'INSERT INTO loadouts (wizard_id, slot, spell_id) VALUES (?, ?, ?)', wizard.id, free, spellId);
  run(ctx.db, 'UPDATE wizards SET loadout_revision = loadout_revision + 1 WHERE id = ?', wizard.id);
}
