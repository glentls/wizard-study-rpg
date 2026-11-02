import type { ElementId } from './elements.js';

export type SpellEffect =
  | { type: 'damage'; power: number }
  | { type: 'heal'; power: number }
  | { type: 'shield'; power: number; turns: number }
  | { type: 'burn'; chanceBp: number; perTurn: number; turns: number }
  | { type: 'paralysis'; chanceBp: number; turns: number }
  | { type: 'guard'; manaRestore: number };

export interface SpellDefinition {
  id: string;
  name: string;
  element: ElementId;
  tier: 0 | 1 | 2 | 3;
  description: string;
  target: 'enemy' | 'self';
  manaCost: number;
  cooldown: number;
  effects: SpellEffect[];
  /** Spells that must be at a minimum level before this one can be researched. */
  prerequisites: { spellId: string; minLevel: number }[];
  /** Research points to reach level 1. Baseline spells are free and always known. */
  unlockCost: number;
  /** Cost of level 2; later levels grow by ruleset.research.upgradeCostGrowthBp. */
  upgradeCostBase: number;
  baseline?: boolean;
}

/** Shared baseline actions every wizard has (MAG-02). They do not use loadout slots. */
const BASELINE: SpellDefinition[] = [
  {
    id: 'arcane_bolt', name: 'Arcane Bolt', element: 'arcane', tier: 0, baseline: true,
    description: 'A dependable bolt of raw magic. Costs no mana.',
    target: 'enemy', manaCost: 0, cooldown: 0, effects: [{ type: 'damage', power: 12 }],
    prerequisites: [], unlockCost: 0, upgradeCostBase: 0,
  },
  {
    id: 'guard', name: 'Guard', element: 'arcane', tier: 0, baseline: true,
    description: 'Brace yourself: halve incoming damage this round and recover mana.',
    target: 'self', manaCost: 0, cooldown: 0, effects: [{ type: 'guard', manaRestore: 15 }],
    prerequisites: [], unlockCost: 0, upgradeCostBase: 0,
  },
];

const FIRE: SpellDefinition[] = [
  {
    id: 'ember_lance', name: 'Ember Lance', element: 'fire', tier: 1,
    description: 'A spear of flame that may set the target alight.',
    target: 'enemy', manaCost: 10, cooldown: 0,
    effects: [{ type: 'damage', power: 18 }, { type: 'burn', chanceBp: 6_000, perTurn: 4, turns: 3 }],
    prerequisites: [], unlockCost: 25, upgradeCostBase: 30,
  },
  {
    id: 'fireball', name: 'Fireball', element: 'fire', tier: 2,
    description: 'An exploding sphere that always ignites its target.',
    target: 'enemy', manaCost: 22, cooldown: 2,
    effects: [{ type: 'damage', power: 30 }, { type: 'burn', chanceBp: 10_000, perTurn: 6, turns: 3 }],
    prerequisites: [{ spellId: 'ember_lance', minLevel: 2 }], unlockCost: 120, upgradeCostBase: 60,
  },
  {
    id: 'inferno', name: 'Inferno', element: 'fire', tier: 3,
    description: 'A roaring firestorm. Devastating, slow to recover.',
    target: 'enemy', manaCost: 40, cooldown: 4,
    effects: [{ type: 'damage', power: 48 }, { type: 'burn', chanceBp: 10_000, perTurn: 8, turns: 3 }],
    prerequisites: [{ spellId: 'fireball', minLevel: 3 }], unlockCost: 300, upgradeCostBase: 120,
  },
];

const LIGHTNING: SpellDefinition[] = [
  {
    id: 'static_spark', name: 'Static Spark', element: 'lightning', tier: 1,
    description: 'A quick jolt with a chance to paralyse.',
    target: 'enemy', manaCost: 8, cooldown: 0,
    effects: [{ type: 'damage', power: 16 }, { type: 'paralysis', chanceBp: 3_000, turns: 2 }],
    prerequisites: [], unlockCost: 25, upgradeCostBase: 30,
  },
  {
    id: 'chain_lightning', name: 'Chain Lightning', element: 'lightning', tier: 2,
    description: 'Arcing current that hits hard and may lock the target down.',
    target: 'enemy', manaCost: 24, cooldown: 2,
    effects: [{ type: 'damage', power: 34 }, { type: 'paralysis', chanceBp: 2_500, turns: 2 }],
    prerequisites: [{ spellId: 'static_spark', minLevel: 2 }], unlockCost: 120, upgradeCostBase: 60,
  },
  {
    id: 'tempest', name: 'Tempest Call', element: 'lightning', tier: 3,
    description: 'Summon a storm. Likely to paralyse whatever survives.',
    target: 'enemy', manaCost: 42, cooldown: 4,
    effects: [{ type: 'damage', power: 52 }, { type: 'paralysis', chanceBp: 5_000, turns: 2 }],
    prerequisites: [{ spellId: 'chain_lightning', minLevel: 3 }], unlockCost: 300, upgradeCostBase: 120,
  },
];

const LIGHT: SpellDefinition[] = [
  {
    id: 'mending_light', name: 'Mending Light', element: 'light', tier: 1,
    description: 'Warm light that restores health.',
    target: 'self', manaCost: 12, cooldown: 1,
    effects: [{ type: 'heal', power: 25 }],
    prerequisites: [], unlockCost: 25, upgradeCostBase: 30,
  },
  {
    id: 'radiant_aegis', name: 'Radiant Aegis', element: 'light', tier: 2,
    description: 'A shimmering barrier that absorbs damage for several rounds.',
    target: 'self', manaCost: 18, cooldown: 3,
    effects: [{ type: 'shield', power: 30, turns: 3 }],
    prerequisites: [{ spellId: 'mending_light', minLevel: 2 }], unlockCost: 120, upgradeCostBase: 60,
  },
  {
    id: 'solar_smite', name: 'Solar Smite', element: 'light', tier: 3,
    description: 'Concentrated sunlight. Burns away darkness and mends the caster.',
    target: 'enemy', manaCost: 30, cooldown: 2,
    effects: [{ type: 'damage', power: 40 }, { type: 'heal', power: 10 }],
    prerequisites: [{ spellId: 'radiant_aegis', minLevel: 3 }], unlockCost: 300, upgradeCostBase: 120,
  },
];

export const SPELLS: SpellDefinition[] = [...BASELINE, ...FIRE, ...LIGHTNING, ...LIGHT];
export const SPELLS_BY_ID = new Map(SPELLS.map((s) => [s.id, s]));
export const RESEARCHABLE_SPELLS = SPELLS.filter((s) => !s.baseline);
export const BASELINE_SPELL_IDS = BASELINE.map((s) => s.id);

/** Effect power grows 12% per level above 1 (MAGIC-005). */
export function scaledPower(base: number, level: number): number {
  return Math.floor((base * (100 + 12 * Math.max(0, level - 1))) / 100);
}

export function scaledEffects(effects: SpellEffect[], level: number): SpellEffect[] {
  return effects.map((e) => {
    if (e.type === 'damage' || e.type === 'heal' || e.type === 'shield') return { ...e, power: scaledPower(e.power, level) };
    if (e.type === 'burn') return { ...e, perTurn: scaledPower(e.perTurn, level) };
    return e;
  });
}

export function starterSpellFor(element: ElementId): SpellDefinition | undefined {
  return RESEARCHABLE_SPELLS.find((s) => s.element === element && s.tier === 1);
}
