import { z } from 'zod';

/**
 * Versioned economy and safety rules. Every focus award and combat settlement
 * records the ruleset id it was calculated with (spec Appendix A).
 *
 * All numbers here are the *proposed* values from the design docs and are
 * hypotheses to tune in beta (D-02), not approved balance decisions.
 * Multipliers are integer basis points (10000 = 1.00x) so award maths is exact.
 */
const multiplierBand = z.object({
  minMinutes: z.number().int().min(0),
  multiplierBp: z.number().int().min(10_000).max(20_000),
});

export const rulesetSchema = z
  .object({
    id: z.string().min(1).max(64),
    focus: z.object({
      /** FOCUS-004: hard ceiling of 90 is a safety rule, not tunable upward. */
      maxContinuousMinutes: z.number().int().min(10).max(90),
      /** FOCUS-005: break can be made longer but never shorter than 20 minutes. */
      requiredBreakMinutes: z.number().int().min(20).max(120),
      /**
       * Fatigue rule (§7.1): sessions separated by less than this gap count as one
       * continuous block toward the 90-minute cap, so back-to-back short sessions
       * cannot bypass the break.
       */
      fatigueChainGapMinutes: z.number().int().min(0).max(120),
      heartbeatIntervalSeconds: z.number().int().min(5).max(120),
      /** FOCUS-007 / D-07: a disconnect longer than this interrupts the session. */
      heartbeatGraceSeconds: z.number().int().min(30).max(900),
    }),
    rewards: z.object({
      pointsPerMinute: z.number().int().min(1).max(10),
      multiplierBands: z.array(multiplierBand).min(1),
      /** Study rooms are R1; the room bonus is fixed at 1.00x in MVP, capped at 1.05x. */
      roomBonusBp: z.number().int().min(10_000).max(10_500),
      dailyCreditedMinutesCap: z.number().int().min(30).max(24 * 60),
    }),
    research: z.object({
      /** MAGIC-002: an initial unlock needs one uninterrupted session of this length (0 disables). */
      initialUnlockMilestoneMinutes: z.number().int().min(0).max(90),
      /** Onboarding: the starter element's tier-1 spell skips the milestone (see README, D-03). */
      starterSpellMilestoneExempt: z.boolean(),
      /** RES-04 / MAGIC-003: levels that require a dedicated milestone session. */
      criticalLevels: z.array(z.number().int().min(2)),
      criticalMilestoneMinutes: z.number().int().min(0).max(90),
      maxSpellLevel: z.number().int().min(1).max(20),
      upgradeCostGrowthBp: z.number().int().min(10_000).max(30_000),
      mana: z.object({
        baseMana: z.number().int().min(10),
        manaPerLevel: z.number().int().min(1),
        maxLevel: z.number().int().min(1),
        costBase: z.number().int().min(1),
        costGrowthBp: z.number().int().min(10_000).max(30_000),
      }),
    }),
    combat: z.object({
      loadoutSlots: z.number().int().min(1).max(8),
      playerBaseHp: z.number().int().min(10),
      hpPerRank: z.number().int().min(0),
      playerSpeed: z.number().int().min(1),
      manaRegenPerRound: z.number().int().min(0),
      /** COMBAT-006: combat rewards are bounded per study day. */
      dailyXpCap: z.number().int().min(0),
      /** COMBAT-007: idle PvE matches are auto-surrendered after this long. */
      matchIdleAbortHours: z.number().int().min(1),
      /** Cumulative XP needed for rank 1, 2, 3, ... (first entry must be 0). */
      rankXpThresholds: z.array(z.number().int().min(0)).min(1),
    }),
  })
  .superRefine((r, ctx) => {
    const bands = r.rewards.multiplierBands;
    if (bands[0]?.minMinutes !== 0) {
      ctx.addIssue({ code: 'custom', path: ['rewards', 'multiplierBands'], message: 'First band must start at 0 minutes' });
    }
    bands.forEach((band, i) => {
      const prev = bands[i - 1];
      if (prev && band.minMinutes <= prev.minMinutes) {
        ctx.addIssue({ code: 'custom', path: ['rewards', 'multiplierBands', i], message: 'Bands must be strictly ascending' });
      }
    });
    // §7.4: a one-time requirement may never exceed what a single permitted session can deliver.
    for (const key of ['initialUnlockMilestoneMinutes', 'criticalMilestoneMinutes'] as const) {
      if (r.research[key] > r.focus.maxContinuousMinutes) {
        ctx.addIssue({ code: 'custom', path: ['research', key], message: 'Milestone cannot exceed the maximum focus session' });
      }
    }
    // Otherwise a completed break would not reset the continuous-focus chain.
    if (r.focus.fatigueChainGapMinutes > r.focus.requiredBreakMinutes) {
      ctx.addIssue({ code: 'custom', path: ['focus', 'fatigueChainGapMinutes'], message: 'Cannot exceed requiredBreakMinutes' });
    }
    if (r.combat.rankXpThresholds[0] !== 0) {
      ctx.addIssue({ code: 'custom', path: ['combat', 'rankXpThresholds'], message: 'Rank 1 must start at 0 XP' });
    }
  });

export type Ruleset = z.infer<typeof rulesetSchema>;

export const DEFAULT_RULESET: Ruleset = rulesetSchema.parse({
  id: 'rules-2026.11-v1',
  focus: {
    maxContinuousMinutes: 90,
    requiredBreakMinutes: 20,
    fatigueChainGapMinutes: 20,
    heartbeatIntervalSeconds: 30,
    heartbeatGraceSeconds: 300,
  },
  rewards: {
    pointsPerMinute: 1,
    // Engineering spec §6: 1.00x for 0-29 min, 1.10x for 30-59, 1.20x for 60-90.
    multiplierBands: [
      { minMinutes: 0, multiplierBp: 10_000 },
      { minMinutes: 30, multiplierBp: 11_000 },
      { minMinutes: 60, multiplierBp: 12_000 },
    ],
    roomBonusBp: 10_000,
    dailyCreditedMinutesCap: 240,
  },
  research: {
    initialUnlockMilestoneMinutes: 60,
    starterSpellMilestoneExempt: true,
    criticalLevels: [5, 10],
    criticalMilestoneMinutes: 60,
    maxSpellLevel: 10,
    upgradeCostGrowthBp: 13_500,
    mana: { baseMana: 40, manaPerLevel: 10, maxLevel: 10, costBase: 40, costGrowthBp: 15_000 },
  },
  combat: {
    loadoutSlots: 4,
    playerBaseHp: 100,
    hpPerRank: 10,
    playerSpeed: 10,
    manaRegenPerRound: 6,
    dailyXpCap: 600,
    matchIdleAbortHours: 24,
    rankXpThresholds: [0, 100, 300, 600, 1000, 1500, 2100, 2800, 3600, 4500],
  },
});

export function multiplierBpFor(rules: Ruleset, minutes: number): number {
  let bp = 10_000;
  for (const band of rules.rewards.multiplierBands) if (minutes >= band.minMinutes) bp = band.multiplierBp;
  return bp;
}

export const RANK_TITLES = ['Novice', 'Apprentice', 'Initiate', 'Adept', 'Conjurer', 'Magus', 'Sage', 'Archmage', 'Grand Archmage', 'Arch-Sovereign'];

export function rankFor(rules: Ruleset, xp: number): { level: number; title: string; xp: number; nextAt: number | null } {
  const thresholds = rules.combat.rankXpThresholds;
  let level = 1;
  thresholds.forEach((min, i) => {
    if (xp >= min) level = i + 1;
  });
  return {
    level,
    title: RANK_TITLES[Math.min(level, RANK_TITLES.length) - 1] ?? 'Wizard',
    xp,
    nextAt: thresholds[level] ?? null,
  };
}
