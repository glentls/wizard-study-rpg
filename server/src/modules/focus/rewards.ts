import { multiplierBpFor, type Ruleset } from '../../config/ruleset.js';

/**
 * The player-visible reward breakdown (FOCUS-008). Pure function of the ruleset,
 * the validated session length and what was already credited that study day.
 *
 *   eligible_minutes = min(maxContinuousMinutes, validated_minutes)
 *   credited_minutes = min(eligible_minutes, daily cap remaining)
 *   multiplier       = band for eligible_minutes (session length rewards focus, not the cap)
 *   awarded_points   = floor(credited_minutes x pointsPerMinute x multiplier x room bonus)
 */
export interface AwardBreakdown {
  ruleset_id: string;
  validated_seconds: number;
  validated_minutes: number;
  eligible_minutes: number;
  daily_cap_minutes: number;
  credited_today_before: number;
  daily_cap_deduction_minutes: number;
  credited_minutes: number;
  points_per_minute: number;
  base_points: number;
  multiplier: number;
  multiplier_bp: number;
  room_bonus: number;
  awarded_points: number;
}

export function calculateAward(rules: Ruleset, validatedSeconds: number, creditedTodayMinutes: number): AwardBreakdown {
  const validatedMinutes = Math.floor(Math.max(0, validatedSeconds) / 60);
  const eligible = Math.min(rules.focus.maxContinuousMinutes, validatedMinutes);
  const capRemaining = Math.max(0, rules.rewards.dailyCreditedMinutesCap - creditedTodayMinutes);
  const credited = Math.min(eligible, capRemaining);
  const multiplierBp = multiplierBpFor(rules, eligible);
  const basePoints = credited * rules.rewards.pointsPerMinute;
  // Integer basis-point maths: no floating point drift in awards.
  const awarded = Math.floor((basePoints * multiplierBp * rules.rewards.roomBonusBp) / 100_000_000);
  return {
    ruleset_id: rules.id,
    validated_seconds: Math.max(0, Math.floor(validatedSeconds)),
    validated_minutes: validatedMinutes,
    eligible_minutes: eligible,
    daily_cap_minutes: rules.rewards.dailyCreditedMinutesCap,
    credited_today_before: creditedTodayMinutes,
    daily_cap_deduction_minutes: eligible - credited,
    credited_minutes: credited,
    points_per_minute: rules.rewards.pointsPerMinute,
    base_points: basePoints,
    multiplier: multiplierBp / 10_000,
    multiplier_bp: multiplierBp,
    room_bonus: rules.rewards.roomBonusBp / 10_000,
    awarded_points: awarded,
  };
}
