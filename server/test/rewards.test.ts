import { describe, expect, it } from 'vitest';
import { DEFAULT_RULESET, rulesetSchema } from '../src/config/ruleset.js';
import { calculateAward } from '../src/modules/focus/rewards.js';

const award = (minutes: number, creditedToday = 0) => calculateAward(DEFAULT_RULESET, minutes * 60, creditedToday);

describe('reward formula (spec §6)', () => {
  it.each([
    [10, 10, 1.0],
    [25, 25, 1.0],
    [29, 29, 1.0],
    [30, 33, 1.1],
    [35, 38, 1.1], // BR-02: a valid 35-minute session gets base points x 1.10
    [59, 64, 1.1],
    [60, 72, 1.2],
    [90, 108, 1.2],
  ])('%i minutes -> %i points at %sx', (minutes, points, multiplier) => {
    const result = award(minutes);
    expect(result.awarded_points).toBe(points);
    expect(result.multiplier).toBe(multiplier);
  });

  it('never credits beyond the 90-minute maximum', () => {
    const result = award(150);
    expect(result.eligible_minutes).toBe(90);
    expect(result.awarded_points).toBe(108);
  });

  it('counts whole minutes only', () => {
    expect(calculateAward(DEFAULT_RULESET, 29 * 60 + 59, 0).validated_minutes).toBe(29);
  });

  it('applies the daily soft cap and reports the deduction', () => {
    const result = award(60, 220);
    expect(result.credited_minutes).toBe(20);
    expect(result.daily_cap_deduction_minutes).toBe(40);
    // Multiplier still reflects the focused session length.
    expect(result.multiplier).toBe(1.2);
    expect(result.awarded_points).toBe(24);
    expect(award(30, 240).awarded_points).toBe(0);
  });
});

describe('ruleset safety invariants (A/B tests must not weaken safety)', () => {
  const withChange = (path: string[], value: unknown) => {
    const copy = structuredClone(DEFAULT_RULESET) as Record<string, any>;
    let node = copy;
    for (const p of path.slice(0, -1)) node = node[p];
    node[path[path.length - 1]!] = value;
    return rulesetSchema.safeParse(copy);
  };

  it('accepts the default ruleset', () => {
    expect(rulesetSchema.safeParse(DEFAULT_RULESET).success).toBe(true);
  });

  it('rejects a focus cap above 90 minutes', () => {
    expect(withChange(['focus', 'maxContinuousMinutes'], 120).success).toBe(false);
  });

  it('rejects a break shorter than 20 minutes', () => {
    expect(withChange(['focus', 'requiredBreakMinutes'], 10).success).toBe(false);
  });

  it('rejects a milestone longer than one permitted session (§7.4)', () => {
    const copy = structuredClone(DEFAULT_RULESET);
    copy.focus.maxContinuousMinutes = 45;
    expect(rulesetSchema.safeParse(copy).success).toBe(false);
  });

  it('rejects a fatigue gap longer than the break', () => {
    expect(withChange(['focus', 'fatigueChainGapMinutes'], 30).success).toBe(false);
  });

  it('rejects unordered multiplier bands and room bonuses above 1.05x', () => {
    expect(withChange(['rewards', 'multiplierBands'], [{ minMinutes: 30, multiplierBp: 11000 }, { minMinutes: 0, multiplierBp: 10000 }]).success).toBe(false);
    expect(withChange(['rewards', 'roomBonusBp'], 11_000).success).toBe(false);
  });
});
