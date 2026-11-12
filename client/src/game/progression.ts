import {
  COMPLETION_GOLD,
  FOCUS_BONUS_RATE,
  GOLD_PER_MINUTES,
  MAX_UPGRADE_LEVEL,
  UPGRADE_COST_GROWTH,
  XP_PER_MINUTE,
  xpToNextLevel,
} from './config';
import type { UpgradeDef } from './content';

export interface LevelInfo {
  level: number;
  /** XP earned inside the current level. */
  into: number;
  /** XP needed to finish the current level. */
  needed: number;
}

/** Wizard level comes from lifetime XP. Spending XP in the library never lowers it. */
export function levelFromXp(totalXp: number): LevelInfo {
  let level = 1;
  let remaining = Math.max(0, Math.floor(totalXp));
  while (remaining >= xpToNextLevel(level)) {
    remaining -= xpToNextLevel(level);
    level += 1;
  }
  return { level, into: remaining, needed: xpToNextLevel(level) };
}

export interface SessionRewards {
  minutes: number;
  baseXp: number;
  bonusXp: number;
  xp: number;
  gold: number;
}

/**
 * Rewards for a study session. Partial sessions still earn XP for every full minute studied,
 * so ending early never wipes out real effort, but only completed sessions get the focus bonus.
 */
export function sessionRewards(minutesStudied: number, completed: boolean): SessionRewards {
  const minutes = Math.max(0, Math.floor(minutesStudied));
  const baseXp = minutes * XP_PER_MINUTE;
  const bonusXp = completed ? Math.round(baseXp * FOCUS_BONUS_RATE) : 0;
  const gold = Math.floor(minutes / GOLD_PER_MINUTES) + (completed && minutes > 0 ? COMPLETION_GOLD : 0);
  return { minutes, baseXp, bonusXp, xp: baseXp + bonusXp, gold };
}

/** XP needed to take an upgrade from `level` to `level + 1`. */
export function upgradeCost(def: UpgradeDef, level: number): number {
  return Math.round(def.baseCost * UPGRADE_COST_GROWTH ** level);
}

export function statAt(def: UpgradeDef, level: number): number {
  if (level <= 0) return 0;
  return def.stat.base + def.stat.perLevel * (level - 1);
}

export function isMaxed(level: number): boolean {
  return level >= MAX_UPGRADE_LEVEL;
}
