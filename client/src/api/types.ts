/** Response shapes of the REST v1 API (see server/src/modules/*). */

export type ElementId = 'fire' | 'lightning' | 'light' | 'water' | 'earth' | 'dark' | 'arcane';
export type Currency = 'RESEARCH_POINTS' | 'COMBAT_XP';

export interface Preferences {
  timezone: string;
  learningGoal: string | null;
  dailyGoalMinutes: number | null;
  notifications: { breakReminders: boolean; sessionComplete: boolean; quietHoursStart: string | null; quietHoursEnd: string | null };
  privacy: { statsVisibility: 'private' | 'friends'; analyticsOptIn: boolean };
  accessibility: { reducedMotion: boolean; highContrast: boolean; largeText: boolean };
}

export interface Rank {
  level: number;
  title: string;
  xp: number;
  nextAt: number | null;
}

export interface WizardProfile {
  id: string;
  name: string;
  element: ElementId;
  element_name: string;
  rank: Rank;
  stats: { max_hp: number; max_mana: number; mana_level: number; speed: number; mana_regen: number };
  balances: Record<Currency, number>;
  unlocked_spells: { id: string; name: string; level: number; element: ElementId }[];
  baseline_spells: string[];
  loadout: { revision: number; slots: (string | null)[] };
}

export interface Me {
  account: { id: string; email: string; email_verified: boolean; role: 'player' | 'admin'; created_at: string };
  preferences: Preferences;
  wizard: WizardProfile | null;
  balances: Record<Currency, number>;
  server_time: string;
}

export interface AwardBreakdown {
  ruleset_id: string;
  validated_minutes: number;
  eligible_minutes: number;
  daily_cap_minutes: number;
  daily_cap_deduction_minutes: number;
  credited_minutes: number;
  base_points: number;
  multiplier: number;
  room_bonus: number;
  awarded_points: number;
  milestone?: { spell_id: string; applied: boolean; code?: string; message?: string; leveled_up_to?: number | null } | null;
}

export type FocusState = 'CREATED' | 'ACTIVE' | 'COMPLETED' | 'INTERRUPTED' | 'INVALIDATED';

export interface FocusSession {
  id: string;
  state: FocusState;
  objective: string | null;
  research_target: { spell_id: string; name: string } | null;
  started_at: string;
  cap_at: string;
  ended_at: string | null;
  end_reason: 'finished' | 'cap_reached' | 'disconnected' | 'invalidated' | 'account_deleted' | null;
  elapsed_seconds: number;
  remaining_seconds: number;
  continuous_focus_before_seconds: number;
  validated_seconds: number | null;
  estimate: AwardBreakdown | null;
  award: AwardBreakdown | null;
  break_until: string | null;
  study_day: string;
  heartbeat_interval_seconds: number;
  heartbeat_grace_seconds: number;
  server_time: string;
}

export interface BreakStatus {
  break_required: boolean;
  break_until: string | null;
  break_remaining_seconds: number;
  chain_seconds: number;
  focus_available_seconds: number;
}

export interface CurrentFocus {
  active: FocusSession | null;
  last: FocusSession | null;
  break: BreakStatus;
  today: { study_day: string; sessions: number; focus_minutes: number; credited_minutes: number; daily_cap_remaining_minutes: number };
  rules: {
    ruleset_id: string;
    max_continuous_minutes: number;
    required_break_minutes: number;
    daily_cap_minutes: number;
    multiplier_bands: { min_minutes: number; multiplier: number }[];
    heartbeat_interval_seconds: number;
  };
  server_time: string;
}

export interface StudySummary {
  week: { study_day: string; focus_minutes: number; credited_minutes: number; sessions: number }[];
  week_focus_minutes: number;
  week_study_days: number;
  current_streak_days: number;
  daily_goal_minutes: number | null;
  today_goal_progress: number | null;
  total_sessions: number;
}

export type SpellEffect =
  | { type: 'damage'; power: number }
  | { type: 'heal'; power: number }
  | { type: 'shield'; power: number; turns: number }
  | { type: 'burn'; chanceBp: number; perTurn: number; turns: number }
  | { type: 'paralysis'; chanceBp: number; turns: number }
  | { type: 'guard'; manaRestore: number };

export type ResearchState = 'LOCKED' | 'AVAILABLE' | 'IN_PROGRESS' | 'MILESTONE_PENDING' | 'UNLOCKED' | 'MAXED';

export interface SpellNode {
  id: string;
  name: string;
  element: ElementId;
  tier: number;
  description: string;
  target: 'enemy' | 'self';
  mana_cost: number;
  cooldown: number;
  effects: SpellEffect[];
  prerequisites: { spell_id: string; name: string; min_level: number; met: boolean }[];
  level: number;
  max_level: number;
  state: ResearchState;
  next_level: number | null;
  next_cost: number | null;
  progress: number;
  milestone: { minutes: number; satisfied: boolean } | null;
}

export interface ResearchTree {
  content_version: string;
  ruleset_id: string;
  balance: number;
  elements: { id: ElementId; name: string; specialty: string; description: string; is_starter: boolean; spells: SpellNode[] }[];
  baseline: { id: string; name: string; description: string; effects: SpellEffect[]; mana_cost: number }[];
  mana: { level: number; max_level: number; max_mana: number; next_max_mana: number | null; next_cost: number | null };
}

export interface LedgerEntry {
  id: string;
  currency: Currency;
  delta: number;
  balance_after: number;
  reason: string;
  source_id: string | null;
  study_day: string;
  created_at: string;
}

export interface EncounterList {
  rank: Rank;
  open_match_id: string | null;
  daily_xp_cap: number;
  daily_xp_remaining: number;
  encounters: {
    id: string;
    name: string;
    description: string;
    tutorial: boolean;
    recommended_rank: number;
    xp_reward: number;
    enemy: { name: string; element: ElementId; max_hp: number };
    victories: number;
  }[];
  recent: { id: string; encounter_id: string; encounter_name: string; state: string; winner: string | null; reward: { xp: number } | null; created_at: string }[];
}

export interface Statuses {
  shield: { amount: number; turns: number } | null;
  burn: { perTurn: number; turns: number } | null;
  paralysis: { turns: number } | null;
  guarding: boolean;
}

export interface Match {
  id: string;
  encounter: { id: string; name: string; description: string };
  state: 'CREATED' | 'IN_PROGRESS' | 'SETTLING' | 'FINISHED' | 'ABORTED';
  turn_version: number;
  winner: 'player' | 'enemy' | null;
  reward: { xp: number; base_xp: number; daily_cap: number; capped: boolean } | null;
  player: { name: string; element: ElementId; hp: number; max_hp: number; mana: number; max_mana: number; statuses: Statuses };
  enemy: { name: string; element: ElementId; hp: number; max_hp: number; statuses: Statuses };
  actions: {
    spell_id: string;
    name: string;
    element: ElementId;
    mana_cost: number;
    cooldown: number;
    cooldown_remaining: number;
    effects: SpellEffect[];
    description: string;
    available: boolean;
    reason: string | null;
  }[];
  events: { sequence: number; turn: number; actor: string; kind: string; message: string }[];
}
