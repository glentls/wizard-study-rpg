import { describe, expect, it } from 'vitest';
import { many, one, run } from '../src/db/database.js';
import { initialState, replay, resolveTurn, type MatchSnapshot } from '../src/modules/combat/engine.js';
import { settleMatch } from '../src/modules/combat/service.js';
import { runMaintenance } from '../src/worker.js';
import { setup, type Api } from './helpers.js';

const xpEntries = (s: ReturnType<typeof setup>) => many<{ delta: number }>(s.db, "SELECT delta FROM reward_ledger WHERE currency = 'COMBAT_XP'");

/** Plays Arcane Bolt until the battle ends. */
async function playOut(api: Api, matchId: string) {
  let match = (await api.get(`/v1/matches/${matchId}`).expect(200)).body;
  for (let i = 0; i < 60 && match.state === 'IN_PROGRESS'; i++) {
    match = (await api.post(`/v1/matches/${matchId}/actions`, { turn_version: match.turn_version, spell_id: 'arcane_bolt' }).expect(200)).body;
  }
  return match;
}

describe('turn-based PvE', () => {
  it('tutorial battle: server resolves turns, settles once and grants XP', async () => {
    const s = setup();
    const { api } = await s.player();
    const start = await api.post('/v1/encounters', { encounter_id: 'training_golem' }).expect(201);
    expect(start.body).toMatchObject({ state: 'IN_PROGRESS', turn_version: 0 });
    expect(start.body).not.toHaveProperty('seed');

    const end = await playOut(api, start.body.id);
    expect(end).toMatchObject({ state: 'FINISHED', winner: 'player', reward: { xp: 20 } });
    expect(end.events.at(-1).kind).toBe('outcome');
    expect(xpEntries(s)).toEqual([{ delta: 20 }]);

    const encounters = await api.get('/v1/encounters').expect(200);
    expect(encounters.body.encounters.find((e: { id: string }) => e.id === 'training_golem').victories).toBe(1);
    expect(encounters.body.daily_xp_remaining).toBe(580);
  });

  it('AT-06: a forged victory claim is rejected and grants nothing', async () => {
    const s = setup();
    const { api } = await s.player();
    const match = (await api.post('/v1/encounters', { encounter_id: 'hollow_archivist' }).expect(201)).body;

    const forged = await api.post(`/v1/matches/${match.id}/actions`, { turn_version: 0, spell_id: 'arcane_bolt', result: 'victory', winner: 'player' }).expect(400);
    expect(forged.body.code).toBe('VALIDATION_ERROR');
    await api.post(`/v1/matches/${match.id}/settle`, { winner: 'player' }).expect(404);

    const after = (await api.get(`/v1/matches/${match.id}`).expect(200)).body;
    expect(after).toMatchObject({ state: 'IN_PROGRESS', turn_version: 0, winner: null });
    expect(xpEntries(s)).toHaveLength(0);
  });

  it('AT-07: a repeated action with a stale turn version is rejected without a duplicate effect', async () => {
    const s = setup();
    const { api } = await s.player();
    const match = (await api.post('/v1/encounters', { encounter_id: 'hollow_archivist' }).expect(201)).body;
    const turn1 = (await api.post(`/v1/matches/${match.id}/actions`, { turn_version: 0, spell_id: 'arcane_bolt' }).expect(200)).body;

    const retry = await api.post(`/v1/matches/${match.id}/actions`, { turn_version: 0, spell_id: 'arcane_bolt' }).expect(409);
    expect(retry.body).toMatchObject({ code: 'STALE_TURN', details: { current_turn_version: 1 } });

    const after = (await api.get(`/v1/matches/${match.id}`).expect(200)).body;
    expect(after.enemy.hp).toBe(turn1.enemy.hp);
    expect(after.events).toHaveLength(turn1.events.length);
  });

  it('rejects spells that are not in the loadout or not affordable', async () => {
    const s = setup();
    const { api } = await s.player();
    const match = (await api.post('/v1/encounters', { encounter_id: 'ember_imp' }).expect(201)).body;
    const res = await api.post(`/v1/matches/${match.id}/actions`, { turn_version: 0, spell_id: 'inferno' }).expect(422);
    expect(res.body.code).toBe('SPELL_NOT_IN_LOADOUT');
  });

  it('allows only one open battle at a time; forfeit settles as a loss with no XP', async () => {
    const s = setup();
    const { api } = await s.player();
    const match = (await api.post('/v1/encounters', { encounter_id: 'ember_imp' }).expect(201)).body;
    const second = await api.post('/v1/encounters', { encounter_id: 'storm_wisp' }).expect(409);
    expect(second.body).toMatchObject({ code: 'MATCH_IN_PROGRESS', details: { match_id: match.id } });

    const lost = (await api.post(`/v1/matches/${match.id}/forfeit`).expect(200)).body;
    expect(lost).toMatchObject({ state: 'FINISHED', winner: 'enemy', reward: { xp: 0 } });
    await api.post(`/v1/matches/${match.id}/forfeit`).expect(409);
    expect(xpEntries(s)).toHaveLength(0);
  });

  it('AT-10: a worker retrying settlement of a completed match credits exactly once', async () => {
    const s = setup();
    const { api } = await s.player();
    const match = (await api.post('/v1/encounters', { encounter_id: 'training_golem' }).expect(201)).body;
    // Simulate a crash after the outcome was decided but before settlement committed.
    run(s.db, "UPDATE matches SET state = 'SETTLING', winner = 'player' WHERE id = ?", match.id);

    runMaintenance(s.ctx);
    runMaintenance(s.ctx);
    settleMatch(s.ctx, match.id);
    expect(xpEntries(s)).toEqual([{ delta: 20 }]);
    expect(one<{ state: string }>(s.db, 'SELECT state FROM matches WHERE id = ?', match.id)?.state).toBe('FINISHED');
  });

  it('caps combat XP per study day', async () => {
    const s = setup();
    const { api } = await s.player();
    for (let i = 0; i < 31; i++) {
      const match = (await api.post('/v1/encounters', { encounter_id: 'training_golem' }).expect(201)).body;
      run(s.db, "UPDATE matches SET state = 'SETTLING', winner = 'player' WHERE id = ?", match.id);
      settleMatch(s.ctx, match.id);
    }
    expect(xpEntries(s).reduce((sum, e) => sum + e.delta, 0)).toBe(600);
  });

  it('battles are deterministic: replaying seed + actions reproduces the stored outcome', async () => {
    const s = setup();
    const { api } = await s.player();
    const match = (await api.post('/v1/encounters', { encounter_id: 'storm_wisp' }).expect(201)).body;
    const finished = await playOut(api, match.id);
    const row = one<{ snapshot: string; seed: string; battle_state: string }>(s.db, 'SELECT snapshot, seed, battle_state FROM matches WHERE id = ?', match.id)!;
    const actions = many<{ spell_id: string }>(s.db, 'SELECT spell_id FROM combat_actions WHERE match_id = ? ORDER BY turn_version', match.id).map((a) => a.spell_id);

    const replayed = replay(JSON.parse(row.snapshot), row.seed, actions);
    expect(replayed.state).toEqual(JSON.parse(row.battle_state));
    expect(replayed.events.map((e) => e.message)).toEqual(finished.events.map((e: { message: string }) => e.message));
  });
});

describe('combat engine rules', () => {
  const snapshot = (overrides: Partial<MatchSnapshot['enemy']> = {}, spells: MatchSnapshot['player']['spells'] = []): MatchSnapshot => ({
    contentVersion: 'test',
    rulesetId: 'test',
    encounterId: 'test',
    player: {
      name: 'Tester', element: 'fire', maxHp: 100, maxMana: 100, speed: 10, manaRegen: 0,
      spells: [
        { id: 'arcane_bolt', name: 'Arcane Bolt', element: 'arcane', manaCost: 0, cooldown: 0, effects: [{ type: 'damage', power: 20 }] },
        { id: 'guard', name: 'Guard', element: 'arcane', manaCost: 0, cooldown: 0, effects: [{ type: 'guard', manaRestore: 0 }] },
        ...spells,
      ],
    },
    enemy: {
      name: 'Dummy', element: 'arcane', maxHp: 1000, speed: 1,
      moves: [{ id: 'hit', name: 'Hit', element: 'arcane', manaCost: 0, cooldown: 0, effects: [{ type: 'damage', power: 20 }] }],
      ...overrides,
    },
  });
  const damageDealt = (events: { kind: string; actor: string; data?: Record<string, unknown> }[], actor: string) =>
    events.filter((e) => e.kind === 'damage' && e.actor === actor).reduce((sum, e) => sum + Number(e.data?.amount ?? 0), 0);

  it('COMBAT-004: element effectiveness comes from the data matrix', () => {
    const fireBolt = [{ id: 'fire_bolt', name: 'Fire Bolt', element: 'fire' as const, manaCost: 0, cooldown: 0, effects: [{ type: 'damage' as const, power: 40 }] }];
    const vsEarth = resolveTurn(snapshot({ element: 'earth' }, fireBolt), 'seed', initialState(snapshot({ element: 'earth' }, fireBolt)), 'fire_bolt');
    const vsWater = resolveTurn(snapshot({ element: 'water' }, fireBolt), 'seed', initialState(snapshot({ element: 'water' }, fireBolt)), 'fire_bolt');
    expect(damageDealt(vsEarth.events, 'player')).toBeGreaterThan(damageDealt(vsWater.events, 'player') * 2);
  });

  it('guard halves incoming damage and resolves before a faster enemy', () => {
    const snap = snapshot({ speed: 50 });
    const normal = resolveTurn(snap, 'seed-a', initialState(snap), 'arcane_bolt');
    const guarded = resolveTurn(snap, 'seed-a', initialState(snap), 'guard');
    expect(damageDealt(guarded.events, 'enemy')).toBeLessThan(damageDealt(normal.events, 'enemy'));
  });

  it('COMBAT-005: burn ticks at end of round and refreshes instead of stacking', () => {
    const burn = [{ id: 'ignite', name: 'Ignite', element: 'fire' as const, manaCost: 0, cooldown: 0, effects: [{ type: 'burn' as const, chanceBp: 10_000, perTurn: 5, turns: 2 }] }];
    const snap = snapshot({}, burn);
    const t1 = resolveTurn(snap, 'seed', initialState(snap), 'ignite');
    expect(t1.events.some((e) => e.kind === 'burn_tick')).toBe(true);
    const t2 = resolveTurn(snap, 'seed', t1.state, 'ignite');
    expect(t2.state.enemy.burn).toEqual({ perTurn: 5, turns: 1 });
  });

  it('the same seed and actions always produce the same result', () => {
    const snap = snapshot();
    const a = replay(snap, 'fixed-seed', ['arcane_bolt', 'guard', 'arcane_bolt']);
    const b = replay(snap, 'fixed-seed', ['arcane_bolt', 'guard', 'arcane_bolt']);
    expect(a).toEqual(b);
  });
});
