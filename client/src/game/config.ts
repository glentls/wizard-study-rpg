/**
 * Every tunable number in the game lives here so balancing never means hunting through UI code.
 * Values follow the design meeting: sessions up to 1.5 hours, a skippable 10-minute break,
 * rewards (XP + gold) handed out only after studying so there is no decision-making up front.
 */

/** Study-time slider (minutes). The meeting set the maximum at one and a half hours. */
export const SESSION_MIN_MINUTES = 5;
export const SESSION_MAX_MINUTES = 90;
export const SESSION_STEP_MINUTES = 5;
export const SESSION_DEFAULT_MINUTES = 25;

/** The break offered after a session. It is always skippable, like a workout app's rest timer. */
export const BREAK_MINUTES = 10;

/** Rewards. XP is earned per minute studied; finishing the full session adds a focus bonus. */
export const XP_PER_MINUTE = 1;
export const FOCUS_BONUS_RATE = 0.2; // +20% XP for completing the session you planned
export const GOLD_PER_MINUTES = 2; // 1 gold per 2 minutes studied
export const COMPLETION_GOLD = 5;

/** Wizard level curve: XP needed to go from level L to L+1. */
export function xpToNextLevel(level: number): number {
  return 50 + 25 * (level - 1);
}

/** Every library upgrade (spells and mana) shares the same 10-level cap. */
export const MAX_UPGRADE_LEVEL = 10;
/** Cost of each upgrade level grows by this factor. */
export const UPGRADE_COST_GROWTH = 1.5;

/** Demo speed makes one minute pass in one second, so the whole loop can be shown in a pitch. */
export const DEMO_SPEED = 60;

export const SAVE_KEY = 'wizard-study:save:v1';
