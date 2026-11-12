import { describe, expect, it } from 'vitest';
import { BREAK_MINUTES, SESSION_MAX_MINUTES, SESSION_MIN_MINUTES } from '../src/game/config';
import { getUpgrade, potionFor } from '../src/game/content';
import { levelFromXp, sessionRewards, upgradeCost } from '../src/game/progression';
import {
  breakRemainingMs,
  computeStats,
  createInitialState,
  gameReducer,
  investBlock,
  maxInvestAmount,
  sessionProgress,
  upgradeState,
  type GameAction,
  type GameState,
} from '../src/game/state';
import { sanitizeState } from '../src/game/storage';

const T0 = new Date(2026, 10, 11, 9, 0, 0).getTime();
const MIN = 60_000;

function run(state: GameState, ...actions: GameAction[]): GameState {
  return actions.reduce(gameReducer, state);
}

function fresh(): GameState {
  return run(createInitialState(T0), { type: 'setName', name: 'Merlin' });
}

const start = (minutes: number, now = T0): GameAction => ({ type: 'startSession', minutes, now, station: 'potion', id: `s-${now}` });

describe('first launch', () => {
  it('starts with no name, level 1 and nothing to spend', () => {
    const s = createInitialState(T0);
    expect(s.name).toBeNull();
    expect(levelFromXp(s.xpTotal).level).toBe(1);
    expect(s.xpUnspent).toBe(0);
    expect(s.gold).toBe(0);
  });

  it('stores a trimmed name and ignores blank names', () => {
    expect(run(createInitialState(T0), { type: 'setName', name: '  Luna  ' }).name).toBe('Luna');
    expect(run(createInitialState(T0), { type: 'setName', name: '   ' }).name).toBeNull();
  });
});

describe('study session', () => {
  it('clamps the slider to 5..90 minutes (max one and a half hours)', () => {
    expect(run(fresh(), start(500)).activeSession!.plannedMinutes).toBe(SESSION_MAX_MINUTES);
    expect(run(fresh(), start(1)).activeSession!.plannedMinutes).toBe(SESSION_MIN_MINUTES);
  });

  it('only allows one session at a time', () => {
    const s = run(fresh(), start(25), start(60, T0 + 1000));
    expect(s.activeSession!.plannedMinutes).toBe(25);
  });

  it('does not complete before time is up', () => {
    const s = run(fresh(), start(25), { type: 'completeSession', now: T0 + 24 * MIN });
    expect(s.activeSession).not.toBeNull();
    expect(s.pendingResult).toBeNull();
  });

  it('completes with full rewards, focus bonus and a potion', () => {
    const s = run(fresh(), start(60), { type: 'completeSession', now: T0 + 60 * MIN });
    expect(s.activeSession).toBeNull();
    const r = s.pendingResult!;
    expect(r.completed).toBe(true);
    expect(r.minutes).toBe(60);
    expect(r.xp).toBe(72); // 60 + 20% focus bonus
    expect(r.bonusXp).toBe(12);
    expect(r.gold).toBe(35); // 60/2 + 5 completion gold
    expect(r.potion).toBe('clarity');
    expect(s.xpUnspent).toBe(72);
    expect(s.xpTotal).toBe(72);
    expect(s.gold).toBe(35);
    expect(s.potions.clarity).toBe(1);
    expect(r.levelBefore).toBe(1);
    expect(r.levelAfter).toBe(2);
  });

  it('credits the session at its scheduled end even if the app was closed for hours', () => {
    const s = run(fresh(), start(25), { type: 'completeSession', now: T0 + 6 * 60 * MIN });
    expect(s.pendingResult!.minutes).toBe(25);
    expect(s.sessions[0]!.endedAt).toBe(T0 + 25 * MIN);
  });

  it('ending early keeps XP for full minutes but no bonus or potion', () => {
    const s = run(fresh(), start(45), { type: 'endSessionEarly', now: T0 + 20.7 * MIN });
    const r = s.pendingResult!;
    expect(r.completed).toBe(false);
    expect(r.minutes).toBe(20);
    expect(r.xp).toBe(20);
    expect(r.bonusXp).toBe(0);
    expect(r.gold).toBe(10);
    expect(r.potion).toBeNull();
    expect(s.potions).toEqual({});
  });

  it('ending under a minute earns nothing and offers no break', () => {
    let s = run(fresh(), start(25), { type: 'endSessionEarly', now: T0 + 30_000 });
    expect(s.pendingResult!.xp).toBe(0);
    s = run(s, { type: 'acknowledgeResult', takeBreak: true, now: T0 + MIN });
    expect(s.breakEndsAt).toBeNull();
  });

  it('reports sand progress from 0 to 1', () => {
    const s = run(fresh(), start(30)).activeSession!;
    expect(sessionProgress(s, T0)).toBe(0);
    expect(sessionProgress(s, T0 + 15 * MIN)).toBeCloseTo(0.5);
    expect(sessionProgress(s, T0 + 99 * MIN)).toBe(1);
  });

  it('demo speed makes one minute pass per second', () => {
    let s = run(fresh(), { type: 'updateSettings', settings: { demoSpeed: true } }, start(25));
    expect(s.activeSession!.speed).toBe(60);
    s = run(s, { type: 'completeSession', now: T0 + 25_000 });
    expect(s.pendingResult!.minutes).toBe(25);
  });

  it('remembers the last chosen duration for the slider', () => {
    expect(run(fresh(), start(40)).settings.lastSessionMinutes).toBe(40);
  });
});

describe('break', () => {
  const done = () => run(fresh(), start(25), { type: 'completeSession', now: T0 + 25 * MIN });

  it(`starts a ${BREAK_MINUTES}-minute break when chosen`, () => {
    const s = run(done(), { type: 'acknowledgeResult', takeBreak: true, now: T0 + 26 * MIN });
    expect(s.pendingResult).toBeNull();
    expect(s.breakEndsAt).toBe(T0 + 26 * MIN + BREAK_MINUTES * MIN);
  });

  it('shows break time in break minutes, even at demo speed', () => {
    const demo = run(fresh(), { type: 'updateSettings', settings: { demoSpeed: true } }, start(25), { type: 'completeSession', now: T0 + 25_000 });
    const s = run(demo, { type: 'acknowledgeResult', takeBreak: true, now: T0 + 30_000 });
    expect(breakRemainingMs(s, T0 + 30_000)).toBe(BREAK_MINUTES * MIN);
    expect(breakRemainingMs(s, T0 + 35_000)).toBe(5 * MIN);
  });

  it('can be skipped up front or mid-way', () => {
    expect(run(done(), { type: 'acknowledgeResult', takeBreak: false, now: T0 }).breakEndsAt).toBeNull();
    const s = run(done(), { type: 'acknowledgeResult', takeBreak: true, now: T0 }, { type: 'skipBreak' });
    expect(s.breakEndsAt).toBeNull();
  });

  it('is cancelled by starting the next session', () => {
    const s = run(done(), { type: 'acknowledgeResult', takeBreak: true, now: T0 + 26 * MIN }, start(25, T0 + 27 * MIN));
    expect(s.breakEndsAt).toBeNull();
    expect(s.activeSession).not.toBeNull();
  });

  it('cannot start a new session until the result has been seen', () => {
    const s = run(done(), start(25, T0 + 26 * MIN));
    expect(s.activeSession).toBeNull();
  });
});

describe('library: investing XP', () => {
  const withXp = (xp: number): GameState => ({ ...fresh(), xpTotal: xp, xpUnspent: xp });
  const ember = getUpgrade('fire-ember')!;

  it('"Invest 1" adds one XP to the bar', () => {
    const s = run(withXp(5), { type: 'invest', id: 'fire-ember', amount: 1 });
    expect(upgradeState(s, 'fire-ember')).toEqual({ level: 0, progress: 1 });
    expect(s.xpUnspent).toBe(4);
  });

  it('"Invest max" fills exactly to the next level, then the bar resets to empty', () => {
    const cost0 = upgradeCost(ember, 0);
    const s = run(withXp(100), { type: 'invest', id: 'fire-ember', amount: 'max' });
    expect(upgradeState(s, 'fire-ember')).toEqual({ level: 1, progress: 0 });
    expect(s.xpUnspent).toBe(100 - cost0);
  });

  it('"Invest max" uses all remaining XP when it is not enough to level', () => {
    const s = run(withXp(4), { type: 'invest', id: 'fire-ember', amount: 'max' });
    expect(upgradeState(s, 'fire-ember')).toEqual({ level: 0, progress: 4 });
    expect(s.xpUnspent).toBe(0);
  });

  it('pressing max repeatedly levels up one level at a time', () => {
    let s = withXp(1000);
    for (let i = 0; i < 3; i++) s = run(s, { type: 'invest', id: 'fire-ember', amount: 'max' });
    expect(upgradeState(s, 'fire-ember').level).toBe(3);
    expect(s.xpUnspent).toBe(1000 - upgradeCost(ember, 0) - upgradeCost(ember, 1) - upgradeCost(ember, 2));
  });

  it('spending XP never lowers the wizard level', () => {
    const before = levelFromXp(withXp(500).xpTotal).level;
    const s = run(withXp(500), { type: 'invest', id: 'fire-ember', amount: 'max' });
    expect(levelFromXp(s.xpTotal).level).toBe(before);
  });

  it('locks later spells until the previous one is learned', () => {
    let s = withXp(500);
    expect(investBlock(s, 'fire-lash')).toBe('requires');
    expect(run(s, { type: 'invest', id: 'fire-lash', amount: 'max' })).toBe(s);
    s = run(s, { type: 'invest', id: 'fire-ember', amount: 'max' });
    expect(investBlock(s, 'fire-lash')).toBeNull();
  });

  it('cannot invest in sealed elements or unknown ids', () => {
    expect(investBlock(withXp(50), 'nope')).toBe('unknown');
    expect(investBlock(withXp(50), 'fire-ember')).toBeNull();
    expect(investBlock(withXp(50), 'water-bubble')).toBeNull();
  });

  it('cannot invest without XP', () => {
    expect(investBlock(fresh(), 'fire-ember')).toBe('no-xp');
    expect(maxInvestAmount(fresh(), 'fire-ember')).toBe(0);
  });

  it('stops at the max level', () => {
    let s = withXp(1_000_000);
    for (let i = 0; i < 20; i++) s = run(s, { type: 'invest', id: 'mana-pool', amount: 'max' });
    expect(upgradeState(s, 'mana-pool').level).toBe(10);
    expect(investBlock(s, 'mana-pool')).toBe('maxed');
  });

  it('works for mana scrolls too', () => {
    const s = run(withXp(100), { type: 'invest', id: 'mana-pool', amount: 'max' });
    expect(upgradeState(s, 'mana-pool').level).toBe(1);
  });
});

describe('progression numbers', () => {
  it('levels up the wizard on a rising curve', () => {
    expect(levelFromXp(0)).toEqual({ level: 1, into: 0, needed: 50 });
    expect(levelFromXp(50).level).toBe(2);
    expect(levelFromXp(124).level).toBe(2);
    expect(levelFromXp(125).level).toBe(3);
  });

  it('gives a 90-minute session 108 XP and 50 gold', () => {
    expect(sessionRewards(90, true)).toMatchObject({ xp: 108, gold: 50 });
  });

  it('brews rarer potions for longer sessions', () => {
    expect(potionFor(10).id).toBe('minor');
    expect(potionFor(25).id).toBe('focus');
    expect(potionFor(60).id).toBe('clarity');
    expect(potionFor(90).id).toBe('grand');
  });
});

describe('stats', () => {
  it('totals time, completed sessions and the day streak', () => {
    const day = 24 * 60 * MIN;
    let s = fresh();
    for (const offset of [-2 * day, -day, 0]) {
      s = run(s, start(30, T0 + offset), { type: 'completeSession', now: T0 + offset + 30 * MIN }, { type: 'acknowledgeResult', takeBreak: false, now: T0 + offset + 31 * MIN });
    }
    const stats = computeStats(s, T0 + 60 * MIN);
    expect(stats.totalMinutes).toBe(90);
    expect(stats.sessionsCompleted).toBe(3);
    expect(stats.streakDays).toBe(3);
    expect(stats.last7Days).toHaveLength(7);
    expect(stats.last7Days[6]!.minutes).toBe(30);
  });
});

describe('save file', () => {
  it('round-trips through JSON', () => {
    const s = run(fresh(), start(25), { type: 'completeSession', now: T0 + 25 * MIN });
    expect(sanitizeState(JSON.parse(JSON.stringify(s)), T0)).toEqual(s);
  });

  it('rejects junk and repairs bad fields', () => {
    expect(sanitizeState(null, T0)).toBeNull();
    expect(sanitizeState({ version: 2 }, T0)).toBeNull();
    const repaired = sanitizeState({ version: 1, name: 'X', xpTotal: -5, gold: 'lots', upgrades: { 'fire-ember': { level: 2, progress: 'x' } } }, T0)!;
    expect(repaired.xpTotal).toBe(0);
    expect(repaired.gold).toBe(0);
    expect(repaired.upgrades['fire-ember']).toEqual({ level: 2, progress: 0 });
    expect(repaired.settings.sound).toBe(true);
  });

  it('keeps a running session across a reload', () => {
    const s = run(fresh(), start(25));
    const loaded = sanitizeState(JSON.parse(JSON.stringify(s)), T0 + 5 * MIN)!;
    expect(loaded.activeSession).toEqual(s.activeSession);
  });
});
