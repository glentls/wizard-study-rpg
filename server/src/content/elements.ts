/**
 * Element definitions and the elemental effectiveness matrix (MAG-01, MAG-03, COMBAT-004).
 * Only Fire, Lightning and Light are playable in MVP. Water, Earth and Dark exist
 * as enemy elements so the matrix is exercised; they become playable in R1.
 */
export type ElementId = 'fire' | 'lightning' | 'light' | 'water' | 'earth' | 'dark' | 'arcane';

export interface ElementDefinition {
  id: ElementId;
  name: string;
  specialty: string;
  playable: boolean;
  description: string;
}

export const ELEMENTS: Record<ElementId, ElementDefinition> = {
  fire: { id: 'fire', name: 'Fire', specialty: 'Damage over time', playable: true, description: 'Relentless pressure. Burns keep hurting after the spell lands.' },
  lightning: { id: 'lightning', name: 'Lightning', specialty: 'Disruption', playable: true, description: 'Fast strikes that can paralyse foes and steal their turns.' },
  light: { id: 'light', name: 'Light', specialty: 'Support', playable: true, description: 'Heals and shields that let you outlast anything.' },
  water: { id: 'water', name: 'Water (proposed)', specialty: 'Control', playable: false, description: 'Proposed for R1.' },
  earth: { id: 'earth', name: 'Earth (proposed)', specialty: 'Defense', playable: false, description: 'Proposed for R1.' },
  dark: { id: 'dark', name: 'Dark', specialty: 'Utility', playable: false, description: 'Planned for R1.' },
  arcane: { id: 'arcane', name: 'Arcane', specialty: 'Neutral', playable: false, description: 'Shared baseline magic every wizard knows.' },
};

export const PLAYABLE_ELEMENTS = (Object.values(ELEMENTS) as ElementDefinition[]).filter((e) => e.playable).map((e) => e.id);

/**
 * Attacker element -> defender element -> damage multiplier in basis points.
 * Anything not listed is 10000 (1.00x). The matrix is intentionally asymmetric
 * where design calls for it (e.g. Fire scorches Earth but Earth only resists Fire).
 */
export const ELEMENT_MATRIX: Partial<Record<ElementId, Partial<Record<ElementId, number>>>> = {
  fire: { earth: 15_000, water: 5_000, fire: 7_500 },
  lightning: { water: 15_000, earth: 5_000, lightning: 7_500 },
  light: { dark: 15_000, light: 7_500 },
  water: { fire: 15_000, water: 7_500 },
  earth: { lightning: 15_000, fire: 7_500 },
  dark: { light: 15_000, dark: 7_500 },
};

export function effectivenessBp(attacker: ElementId, defender: ElementId): number {
  return ELEMENT_MATRIX[attacker]?.[defender] ?? 10_000;
}

/**
 * Status-effect rules: stacking, duration and immunity are explicit data (§7.3).
 * - burn: does not stack; re-applying refreshes duration and keeps the stronger tick.
 * - paralysis: does not stack; each affected turn has a chance to be lost;
 *   when it expires the target is immune for `immunityTurns` rounds.
 * - shield: absorbs damage; a new shield replaces the old one only if stronger.
 */
export const STATUS_RULES = {
  burn: { maxTurns: 4 },
  paralysis: { skipChanceBp: 5_000, maxTurns: 3, immunityTurns: 1 },
  shield: { maxTurns: 4 },
} as const;
