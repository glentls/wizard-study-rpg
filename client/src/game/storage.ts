/**
 * Local save. The meeting agreed: single player for now, no accounts and no cloud database,
 * so progress lives in this browser. Export/import gives players a manual backup in the
 * meantime, so clearing site data does not have to mean losing everything.
 */
import { SAVE_KEY, SESSION_DEFAULT_MINUTES } from './config';
import { createInitialState, type GameState } from './state';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback);

/** Accepts anything and returns a valid GameState, keeping whatever parts of the input are sound. */
export function sanitizeState(raw: unknown, now: number): GameState | null {
  if (!isObj(raw) || raw.version !== 1) return null;
  const base = createInitialState(now);
  const settings = isObj(raw.settings) ? raw.settings : {};

  const upgrades: GameState['upgrades'] = {};
  if (isObj(raw.upgrades)) {
    for (const [id, u] of Object.entries(raw.upgrades)) {
      if (isObj(u)) upgrades[id] = { level: Math.floor(num(u.level, 0)), progress: Math.floor(num(u.progress, 0)) };
    }
  }

  const potions: GameState['potions'] = {};
  if (isObj(raw.potions)) {
    for (const [id, n] of Object.entries(raw.potions)) {
      if (['minor', 'focus', 'clarity', 'grand'].includes(id)) potions[id as keyof GameState['potions']] = Math.floor(num(n, 0));
    }
  }

  const sessions = Array.isArray(raw.sessions)
    ? (raw.sessions.filter((s) => isObj(s) && typeof s.id === 'string' && typeof s.endedAt === 'number' && typeof s.minutes === 'number') as unknown as GameState['sessions'])
    : [];

  const a = raw.activeSession;
  const activeSession =
    isObj(a) && typeof a.id === 'string' && typeof a.startedAt === 'number' && typeof a.plannedMinutes === 'number' && typeof a.speed === 'number' && a.speed > 0
      ? { id: a.id, startedAt: a.startedAt, plannedMinutes: a.plannedMinutes, speed: a.speed, station: a.station === 'enchant' ? ('enchant' as const) : ('potion' as const) }
      : null;

  const p = raw.pendingResult;
  const pendingResult = isObj(p) && typeof p.id === 'string' && typeof p.minutes === 'number' ? (p as unknown as GameState['pendingResult']) : null;

  return {
    version: 1,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 24) : null,
    createdAt: num(raw.createdAt, now),
    xpTotal: Math.floor(num(raw.xpTotal, 0)),
    xpUnspent: Math.floor(num(raw.xpUnspent, 0)),
    gold: Math.floor(num(raw.gold, 0)),
    upgrades,
    potions,
    sessions,
    activeSession,
    pendingResult,
    breakEndsAt: typeof raw.breakEndsAt === 'number' ? raw.breakEndsAt : null,
    breakSpeed: typeof raw.breakSpeed === 'number' && raw.breakSpeed > 0 ? raw.breakSpeed : 1,
    settings: {
      sound: typeof settings.sound === 'boolean' ? settings.sound : base.settings.sound,
      notifications: typeof settings.notifications === 'boolean' ? settings.notifications : false,
      demoSpeed: typeof settings.demoSpeed === 'boolean' ? settings.demoSpeed : false,
      lastSessionMinutes: num(settings.lastSessionMinutes, SESSION_DEFAULT_MINUTES),
    },
  };
}

export function loadState(now: number): GameState {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return createInitialState(now);
    const parsed = sanitizeState(JSON.parse(raw), now);
    if (parsed) return parsed;
    // Keep the unreadable save aside instead of silently destroying it.
    localStorage.setItem(`${SAVE_KEY}:corrupt:${now}`, raw);
  } catch {
    /* storage unavailable or JSON broken: fall through to a fresh game */
  }
  return createInitialState(now);
}

export function saveState(state: GameState): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch {
    /* private mode or quota: the game keeps running in memory */
  }
}

export function exportSave(state: GameState): void {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wizard-study-save-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readSaveFile(file: File, now: number): Promise<GameState | null> {
  try {
    return sanitizeState(JSON.parse(await file.text()), now);
  } catch {
    return null;
  }
}
