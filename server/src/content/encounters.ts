import type { ElementId } from './elements.js';
import type { SpellEffect } from './spells.js';

export interface EnemyMove {
  id: string;
  name: string;
  element: ElementId;
  target: 'enemy' | 'self';
  cooldown: number;
  /** Relative chance the move is picked when available. */
  weight: number;
  effects: SpellEffect[];
}

export interface EncounterDefinition {
  id: string;
  name: string;
  description: string;
  recommendedRank: number;
  tutorial?: boolean;
  enemy: {
    name: string;
    element: ElementId;
    hp: number;
    speed: number;
    moves: EnemyMove[];
  };
  xpReward: number;
}

const basic = (id: string, name: string, element: ElementId, power: number, weight = 3): EnemyMove => ({
  id, name, element, target: 'enemy', cooldown: 0, weight, effects: [{ type: 'damage', power }],
});

export const ENCOUNTERS: EncounterDefinition[] = [
  {
    id: 'training_golem', name: 'Training Golem', tutorial: true, recommendedRank: 1, xpReward: 20,
    description: 'A patient clay golem from the academy yard. Perfect for a first duel.',
    enemy: { name: 'Training Golem', element: 'earth', hp: 60, speed: 6, moves: [basic('slam', 'Clay Slam', 'earth', 7)] },
  },
  {
    id: 'ember_imp', name: 'Ember Imp', recommendedRank: 1, xpReward: 40,
    description: 'A mischievous imp that spits sparks. Fire resists fire.',
    enemy: {
      name: 'Ember Imp', element: 'fire', hp: 90, speed: 12,
      moves: [
        basic('scratch', 'Scratch', 'fire', 8),
        { id: 'fire_spit', name: 'Fire Spit', element: 'fire', target: 'enemy', cooldown: 2, weight: 2,
          effects: [{ type: 'damage', power: 11 }, { type: 'burn', chanceBp: 5_000, perTurn: 3, turns: 2 }] },
      ],
    },
  },
  {
    id: 'storm_wisp', name: 'Storm Wisp', recommendedRank: 2, xpReward: 55,
    description: 'A crackling wisp. Quick, and its touch can paralyse.',
    enemy: {
      name: 'Storm Wisp', element: 'lightning', hp: 110, speed: 14,
      moves: [
        basic('zap', 'Zap', 'lightning', 10),
        { id: 'jolt', name: 'Jolt', element: 'lightning', target: 'enemy', cooldown: 3, weight: 2,
          effects: [{ type: 'damage', power: 9 }, { type: 'paralysis', chanceBp: 3_500, turns: 1 }] },
      ],
    },
  },
  {
    id: 'tidal_serpent', name: 'Tidal Serpent', recommendedRank: 3, xpReward: 80,
    description: 'A river serpent. Lightning courses through it; fire fizzles.',
    enemy: {
      name: 'Tidal Serpent', element: 'water', hp: 150, speed: 9,
      moves: [
        basic('bite', 'Bite', 'water', 12),
        { id: 'crushing_wave', name: 'Crushing Wave', element: 'water', target: 'enemy', cooldown: 3, weight: 2, effects: [{ type: 'damage', power: 20 }] },
      ],
    },
  },
  {
    id: 'shade_wraith', name: 'Shade Wraith', recommendedRank: 4, xpReward: 90,
    description: 'A wraith from the restricted stacks. Weak to Light; it mends itself in shadow.',
    enemy: {
      name: 'Shade Wraith', element: 'dark', hp: 140, speed: 13,
      moves: [
        basic('claw', 'Shadow Claw', 'dark', 13),
        { id: 'umbral_mend', name: 'Umbral Mend', element: 'dark', target: 'self', cooldown: 4, weight: 1, effects: [{ type: 'heal', power: 18 }] },
      ],
    },
  },
  {
    id: 'hollow_archivist', name: 'The Hollow Archivist', recommendedRank: 6, xpReward: 200,
    description: 'Boss. The spirit of a scholar who never took a break. Hits hard and shields itself.',
    enemy: {
      name: 'The Hollow Archivist', element: 'dark', hp: 260, speed: 11,
      moves: [
        basic('tome_strike', 'Tome Strike', 'dark', 15),
        { id: 'ink_barrier', name: 'Ink Barrier', element: 'dark', target: 'self', cooldown: 4, weight: 1, effects: [{ type: 'shield', power: 25, turns: 2 }] },
        { id: 'endless_night', name: 'Endless Night', element: 'dark', target: 'enemy', cooldown: 3, weight: 2, effects: [{ type: 'damage', power: 24 }] },
      ],
    },
  },
];

export const ENCOUNTERS_BY_ID = new Map(ENCOUNTERS.map((e) => [e.id, e]));
