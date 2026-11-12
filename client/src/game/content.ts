/**
 * Static game content: elements, spells, mana upgrades and potions.
 * The meeting asked for two playable elements to start with; the rest show as faded,
 * sealed scrolls so the library already hints at what is coming.
 */

export type ElementId = 'fire' | 'water' | 'earth' | 'air' | 'lightning' | 'shadow';

export interface ElementDef {
  id: ElementId;
  name: string;
  icon: string;
  color: string;
  available: boolean;
  blurb: string;
}

export const ELEMENTS: ElementDef[] = [
  { id: 'fire', name: 'Fire', icon: '🔥', color: '#ff8a3d', available: true, blurb: 'Fierce, bright and impatient.' },
  { id: 'water', name: 'Water', icon: '💧', color: '#4cc3ff', available: true, blurb: 'Calm, patient and relentless.' },
  { id: 'earth', name: 'Earth', icon: '🪨', color: '#b49a6a', available: false, blurb: 'Sealed for now.' },
  { id: 'air', name: 'Air', icon: '🌪️', color: '#c8f1ff', available: false, blurb: 'Sealed for now.' },
  { id: 'lightning', name: 'Lightning', icon: '⚡', color: '#ffe14d', available: false, blurb: 'Sealed for now.' },
  { id: 'shadow', name: 'Shadow', icon: '🌑', color: '#a78bfa', available: false, blurb: 'Sealed for now.' },
];

export type UpgradeKind = 'spell' | 'mana';

export interface UpgradeDef {
  id: string;
  kind: UpgradeKind;
  /** Element for spells; undefined for mana upgrades. */
  element?: ElementId;
  name: string;
  icon: string;
  description: string;
  /** XP needed to reach level 1. Later levels cost more (see progression.ts). */
  baseCost: number;
  /** Upgrade that must be learned (level 1+) first. */
  requires?: string;
  /** What the upgrade does, shown on the spell card. Purely descriptive until combat ships. */
  stat: { label: string; base: number; perLevel: number; suffix?: string };
}

export const SPELLS: UpgradeDef[] = [
  // Fire
  {
    id: 'fire-ember', kind: 'spell', element: 'fire', name: 'Ember Spark', icon: '🔥', baseCost: 10,
    description: 'A flicker of flame flicked from the fingertips. Every fire wizard starts here.',
    stat: { label: 'Power', base: 10, perLevel: 3 },
  },
  {
    id: 'fire-lash', kind: 'spell', element: 'fire', name: 'Flame Lash', icon: '🪢', baseCost: 25, requires: 'fire-ember',
    description: 'A whip of living fire that leaves foes smouldering.',
    stat: { label: 'Power', base: 22, perLevel: 5 },
  },
  {
    id: 'fire-phoenix', kind: 'spell', element: 'fire', name: 'Phoenix Flare', icon: '🐦‍🔥', baseCost: 50, requires: 'fire-lash',
    description: 'Summon a blazing phoenix that dives through everything in its path.',
    stat: { label: 'Power', base: 40, perLevel: 8 },
  },
  // Water
  {
    id: 'water-bubble', kind: 'spell', element: 'water', name: 'Bubble Shot', icon: '🫧', baseCost: 10,
    description: 'A pressurised bubble that pops with surprising force.',
    stat: { label: 'Power', base: 9, perLevel: 3 },
  },
  {
    id: 'water-mist', kind: 'spell', element: 'water', name: 'Mist Veil', icon: '🌫️', baseCost: 25, requires: 'water-bubble',
    description: 'Wrap yourself in a cool mist that turns attacks aside.',
    stat: { label: 'Shield', base: 15, perLevel: 4 },
  },
  {
    id: 'water-tide', kind: 'spell', element: 'water', name: 'Tidal Surge', icon: '🌊', baseCost: 50, requires: 'water-mist',
    description: 'Call a towering wave down on the battlefield.',
    stat: { label: 'Power', base: 38, perLevel: 8 },
  },
];

export const MANA_UPGRADES: UpgradeDef[] = [
  {
    id: 'mana-pool', kind: 'mana', name: 'Mana Pool', icon: '🔮', baseCost: 15,
    description: 'Deepen your well of mana so you can cast more before resting.',
    stat: { label: 'Max mana', base: 100, perLevel: 10 },
  },
  {
    id: 'mana-flow', kind: 'mana', name: 'Mana Flow', icon: '💫', baseCost: 15,
    description: 'Mana returns to you faster between casts.',
    stat: { label: 'Regen per turn', base: 5, perLevel: 1 },
  },
  {
    id: 'mana-focus', kind: 'mana', name: 'Arcane Focus', icon: '🧿', baseCost: 30, requires: 'mana-pool',
    description: 'Channel mana more efficiently, making every spell cheaper.',
    stat: { label: 'Spell cost', base: -3, perLevel: -2, suffix: '%' },
  },
];

export const ALL_UPGRADES: UpgradeDef[] = [...SPELLS, ...MANA_UPGRADES];

const UPGRADE_INDEX = new Map(ALL_UPGRADES.map((u) => [u.id, u]));

export function getUpgrade(id: string): UpgradeDef | undefined {
  return UPGRADE_INDEX.get(id);
}

export function spellsFor(element: ElementId): UpgradeDef[] {
  return SPELLS.filter((s) => s.element === element);
}

export function elementDef(id: ElementId): ElementDef {
  return ELEMENTS.find((e) => e.id === id)!;
}

/** Potions brewed at the end of a completed session. Longer sessions brew rarer potions. */
export type PotionId = 'minor' | 'focus' | 'clarity' | 'grand';

export interface PotionDef {
  id: PotionId;
  name: string;
  color: string;
  minMinutes: number;
}

export const POTIONS: PotionDef[] = [
  { id: 'minor', name: 'Minor Focus Draught', color: '#7dd3fc', minMinutes: 0 },
  { id: 'focus', name: 'Focus Elixir', color: '#86efac', minMinutes: 25 },
  { id: 'clarity', name: 'Elixir of Clarity', color: '#c4b5fd', minMinutes: 60 },
  { id: 'grand', name: 'Grand Elixir of Wisdom', color: '#fcd34d', minMinutes: 90 },
];

export function potionFor(minutes: number): PotionDef {
  let best = POTIONS[0]!;
  for (const p of POTIONS) if (minutes >= p.minMinutes) best = p;
  return best;
}

export function potionDef(id: PotionId): PotionDef {
  return POTIONS.find((p) => p.id === id)!;
}
