import { BREAK_MINUTES, DEMO_SPEED, MAX_UPGRADE_LEVEL, SESSION_DEFAULT_MINUTES, SESSION_MAX_MINUTES, SESSION_MIN_MINUTES } from './config';
import { elementDef, getUpgrade, potionFor, type PotionId } from './content';
import { levelFromXp, sessionRewards, upgradeCost } from './progression';

export type Station = 'potion' | 'enchant';

export interface ActiveSession {
  id: string;
  startedAt: number;
  plannedMinutes: number;
  /** Time multiplier frozen at start (1 normally, 60 in demo mode). */
  speed: number;
  station: Station;
}

export interface SessionRecord {
  id: string;
  startedAt: number;
  endedAt: number;
  plannedMinutes: number;
  minutes: number;
  completed: boolean;
  xp: number;
  bonusXp: number;
  gold: number;
  potion: PotionId | null;
}

export interface SessionResult extends SessionRecord {
  levelBefore: number;
  levelAfter: number;
}

export interface UpgradeProgress {
  level: number;
  /** XP invested towards the next level. Resets to 0 on level up. */
  progress: number;
}

export interface Settings {
  sound: boolean;
  notifications: boolean;
  demoSpeed: boolean;
  lastSessionMinutes: number;
}

export interface GameState {
  version: 1;
  name: string | null;
  createdAt: number;
  /** Lifetime XP. Drives the wizard level and never goes down. */
  xpTotal: number;
  /** XP not yet invested in the library. */
  xpUnspent: number;
  gold: number;
  upgrades: Record<string, UpgradeProgress>;
  potions: Partial<Record<PotionId, number>>;
  sessions: SessionRecord[];
  activeSession: ActiveSession | null;
  /** Result waiting to be shown after a session ends (survives a refresh). */
  pendingResult: SessionResult | null;
  breakEndsAt: number | null;
  /** Time multiplier of the current break (60 in demo mode), so its clock shows break minutes. */
  breakSpeed: number;
  settings: Settings;
}

export function createInitialState(now: number): GameState {
  return {
    version: 1,
    name: null,
    createdAt: now,
    xpTotal: 0,
    xpUnspent: 0,
    gold: 0,
    upgrades: {},
    potions: {},
    sessions: [],
    activeSession: null,
    pendingResult: null,
    breakEndsAt: null,
    breakSpeed: 1,
    settings: { sound: true, notifications: false, demoSpeed: false, lastSessionMinutes: SESSION_DEFAULT_MINUTES },
  };
}

// ---------------------------------------------------------------------------
// Session timing
// ---------------------------------------------------------------------------

export function sessionDurationMs(s: ActiveSession): number {
  return (s.plannedMinutes * 60_000) / s.speed;
}

export function sessionEndsAt(s: ActiveSession): number {
  return s.startedAt + sessionDurationMs(s);
}

/** Study minutes elapsed (in game time), clamped to the planned length. */
export function studiedMinutes(s: ActiveSession, now: number): number {
  const ms = Math.min(Math.max(0, now - s.startedAt), sessionDurationMs(s));
  return (ms * s.speed) / 60_000;
}

export function sessionProgress(s: ActiveSession, now: number): number {
  return Math.min(1, studiedMinutes(s, now) / s.plannedMinutes);
}

export function isSessionDue(s: ActiveSession, now: number): boolean {
  return now >= sessionEndsAt(s);
}

/** Break time left, in break minutes (so demo mode shows 10:00 counting down, not 0:10). */
export function breakRemainingMs(state: GameState, now: number): number {
  return state.breakEndsAt === null ? 0 : Math.max(0, state.breakEndsAt - now) * state.breakSpeed;
}

// ---------------------------------------------------------------------------
// Library helpers
// ---------------------------------------------------------------------------

export function upgradeState(state: GameState, id: string): UpgradeProgress {
  return state.upgrades[id] ?? { level: 0, progress: 0 };
}

export type InvestBlock = 'unknown' | 'sealed' | 'requires' | 'maxed' | 'no-xp';

/** Why an upgrade cannot take XP right now, or null if it can. */
export function investBlock(state: GameState, id: string): InvestBlock | null {
  const def = getUpgrade(id);
  if (!def) return 'unknown';
  if (def.element && !elementDef(def.element).available) return 'sealed';
  if (def.requires && upgradeState(state, def.requires).level < 1) return 'requires';
  if (upgradeState(state, id).level >= MAX_UPGRADE_LEVEL) return 'maxed';
  if (state.xpUnspent <= 0) return 'no-xp';
  return null;
}

/** How much a "max" press would invest: everything left, or just enough to reach the next level. */
export function maxInvestAmount(state: GameState, id: string): number {
  const def = getUpgrade(id);
  if (!def || investBlock(state, id)) return 0;
  const cur = upgradeState(state, id);
  return Math.min(state.xpUnspent, upgradeCost(def, cur.level) - cur.progress);
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export type GameAction =
  | { type: 'setName'; name: string }
  | { type: 'startSession'; minutes: number; now: number; station: Station; id: string }
  | { type: 'completeSession'; now: number }
  | { type: 'endSessionEarly'; now: number }
  | { type: 'acknowledgeResult'; takeBreak: boolean; now: number }
  | { type: 'skipBreak' }
  | { type: 'invest'; id: string; amount: number | 'max' }
  | { type: 'updateSettings'; settings: Partial<Settings> }
  | { type: 'replace'; state: GameState };

function clampMinutes(m: number): number {
  if (!Number.isFinite(m)) return SESSION_DEFAULT_MINUTES;
  return Math.min(SESSION_MAX_MINUTES, Math.max(SESSION_MIN_MINUTES, Math.round(m)));
}

function finishSession(state: GameState, endedAt: number, completed: boolean): GameState {
  const s = state.activeSession;
  if (!s) return state;
  const minutesFloat = completed ? s.plannedMinutes : studiedMinutes(s, endedAt);
  const rewards = sessionRewards(minutesFloat, completed);
  const potion = completed ? potionFor(s.plannedMinutes).id : null;
  const levelBefore = levelFromXp(state.xpTotal).level;
  const xpTotal = state.xpTotal + rewards.xp;
  const record: SessionRecord = {
    id: s.id,
    startedAt: s.startedAt,
    endedAt,
    plannedMinutes: s.plannedMinutes,
    minutes: rewards.minutes,
    completed,
    xp: rewards.xp,
    bonusXp: rewards.bonusXp,
    gold: rewards.gold,
    potion,
  };
  return {
    ...state,
    xpTotal,
    xpUnspent: state.xpUnspent + rewards.xp,
    gold: state.gold + rewards.gold,
    potions: potion ? { ...state.potions, [potion]: (state.potions[potion] ?? 0) + 1 } : state.potions,
    sessions: [...state.sessions, record],
    activeSession: null,
    pendingResult: { ...record, levelBefore, levelAfter: levelFromXp(xpTotal).level },
  };
}

function invest(state: GameState, id: string, amount: number | 'max'): GameState {
  const def = getUpgrade(id);
  if (!def || investBlock(state, id)) return state;
  const cur = upgradeState(state, id);
  const toNext = upgradeCost(def, cur.level) - cur.progress;
  const wanted = amount === 'max' ? toNext : Math.floor(amount);
  const spend = Math.min(wanted, toNext, state.xpUnspent);
  if (spend <= 0) return state;
  const progress = cur.progress + spend;
  const next: UpgradeProgress = progress >= upgradeCost(def, cur.level) ? { level: cur.level + 1, progress: 0 } : { level: cur.level, progress };
  return { ...state, xpUnspent: state.xpUnspent - spend, upgrades: { ...state.upgrades, [id]: next } };
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'setName': {
      const name = action.name.trim().slice(0, 24);
      return name ? { ...state, name } : state;
    }
    case 'startSession': {
      if (state.activeSession || state.pendingResult) return state;
      const minutes = clampMinutes(action.minutes);
      const speed = state.settings.demoSpeed ? DEMO_SPEED : 1;
      return {
        ...state,
        breakEndsAt: null,
        activeSession: { id: action.id, startedAt: action.now, plannedMinutes: minutes, speed, station: action.station },
        settings: { ...state.settings, lastSessionMinutes: minutes },
      };
    }
    case 'completeSession': {
      const s = state.activeSession;
      if (!s || !isSessionDue(s, action.now)) return state;
      // Credit the session at its scheduled end, even if the app was closed when it finished.
      return finishSession(state, sessionEndsAt(s), true);
    }
    case 'endSessionEarly': {
      const s = state.activeSession;
      if (!s) return state;
      if (isSessionDue(s, action.now)) return finishSession(state, sessionEndsAt(s), true);
      return finishSession(state, action.now, false);
    }
    case 'acknowledgeResult': {
      if (!state.pendingResult) return state;
      const speed = state.settings.demoSpeed ? DEMO_SPEED : 1;
      const offerBreak = action.takeBreak && state.pendingResult.minutes > 0;
      return {
        ...state,
        pendingResult: null,
        breakEndsAt: offerBreak ? action.now + (BREAK_MINUTES * 60_000) / speed : null,
        breakSpeed: speed,
      };
    }
    case 'skipBreak':
      return state.breakEndsAt === null ? state : { ...state, breakEndsAt: null };
    case 'invest':
      return invest(state, action.id, action.amount);
    case 'updateSettings':
      return { ...state, settings: { ...state.settings, ...action.settings } };
    case 'replace':
      return action.state;
  }
}

// ---------------------------------------------------------------------------
// Stats for the profile page
// ---------------------------------------------------------------------------

export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface Stats {
  totalMinutes: number;
  sessionsCompleted: number;
  longestSession: number;
  streakDays: number;
  spellsLearned: number;
  potionsBrewed: number;
  last7Days: { key: string; label: string; minutes: number }[];
}

export function computeStats(state: GameState, now: number): Stats {
  const byDay = new Map<string, number>();
  let totalMinutes = 0;
  let longestSession = 0;
  let sessionsCompleted = 0;
  for (const s of state.sessions) {
    totalMinutes += s.minutes;
    longestSession = Math.max(longestSession, s.minutes);
    if (s.completed) sessionsCompleted += 1;
    if (s.minutes > 0) byDay.set(dayKey(s.endedAt), (byDay.get(dayKey(s.endedAt)) ?? 0) + s.minutes);
  }

  // Streak: consecutive days with study, counting back from today (or yesterday if today is still empty).
  let streakDays = 0;
  const cursor = new Date(now);
  cursor.setHours(12, 0, 0, 0);
  if (!byDay.has(dayKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
  while (byDay.has(dayKey(cursor.getTime()))) {
    streakDays += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  const last7Days: Stats['last7Days'] = [];
  const day = new Date(now);
  day.setHours(12, 0, 0, 0);
  day.setDate(day.getDate() - 6);
  for (let i = 0; i < 7; i++) {
    const key = dayKey(day.getTime());
    last7Days.push({ key, label: day.toLocaleDateString(undefined, { weekday: 'short' }), minutes: byDay.get(key) ?? 0 });
    day.setDate(day.getDate() + 1);
  }

  const spellsLearned = Object.entries(state.upgrades).filter(([id, u]) => u.level > 0 && getUpgrade(id)?.kind === 'spell').length;
  const potionsBrewed = Object.values(state.potions).reduce((a, b) => a + (b ?? 0), 0);

  return { totalMinutes, sessionsCompleted, longestSession, streakDays, spellsLearned, potionsBrewed, last7Days };
}
