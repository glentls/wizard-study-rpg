import { describe, expect, it } from 'vitest';
import { many } from '../src/db/database.js';
import { postEntry } from '../src/modules/ledger/service.js';
import { finish, focusFor, key, setup, startFocus, type Api } from './helpers.js';

function grant(s: ReturnType<typeof setup>, accountId: string, amount: number) {
  postEntry(s.ctx, {
    accountId, currency: 'RESEARCH_POINTS', delta: amount, reason: 'TEST_GRANT', sourceId: null,
    idempotencyKey: `grant:${key()}`, rulesetId: null, studyDay: '2026-01-05',
  });
}

async function spell(api: Api, id: string) {
  const tree = await api.get('/v1/research/tree').expect(200);
  for (const element of tree.body.elements) {
    const found = element.spells.find((sp: { id: string }) => sp.id === id);
    if (found) return { ...found, balance: tree.body.balance as number };
  }
  throw new Error(`spell ${id} not in tree`);
}

const allocate = (api: Api, spellId: string, points: number, expectedLevel: number, idempotencyKey = key()) =>
  api.post('/v1/research/allocate', { spell_id: spellId, points, expected_level: expectedLevel }, idempotencyKey);

describe('research and spell progression', () => {
  it('first-time journey: a guided 25-minute session funds the starter spell, which auto-equips', async () => {
    const s = setup();
    const { api } = await s.player({ element: 'fire' });
    const session = await startFocus(api);
    await focusFor(api, s.clock, session.id, 25);
    await finish(api, session.id).expect(200);

    expect(await spell(api, 'ember_lance')).toMatchObject({ state: 'AVAILABLE', next_cost: 25, milestone: null, balance: 25 });
    const res = await allocate(api, 'ember_lance', 25, 0).expect(200);
    expect(res.body).toMatchObject({ allocated: 25, leveled_up_to: 1, balance: 0 });
    expect(res.body.spell.state).toBe('UNLOCKED');

    const wizard = await api.get('/v1/wizard').expect(200);
    expect(wizard.body.loadout.slots[0]).toBe('ember_lance');
  });

  it('AT-05: locked spells and insufficient funds change neither state nor balance', async () => {
    const s = setup();
    const { api, accountId } = await s.player({ element: 'fire' });
    grant(s, accountId, 20);

    const locked = await allocate(api, 'fireball', 10, 0).expect(422);
    expect(locked.body.code).toBe('PREREQUISITES_NOT_MET');

    const broke = await allocate(api, 'ember_lance', 25, 0).expect(422);
    expect(broke.body.code).toBe('INSUFFICIENT_FUNDS');

    expect(await spell(api, 'ember_lance')).toMatchObject({ progress: 0, level: 0, balance: 20 });
    expect(await spell(api, 'fireball')).toMatchObject({ state: 'LOCKED', progress: 0 });
    expect(many(s.db, "SELECT * FROM reward_ledger WHERE reason = 'RESEARCH_ALLOCATION'")).toHaveLength(0);
  });

  it('allocation is incremental and clamps to the remaining cost', async () => {
    const s = setup();
    const { api, accountId } = await s.player({ element: 'fire' });
    grant(s, accountId, 100);
    await allocate(api, 'ember_lance', 10, 0).expect(200);
    expect(await spell(api, 'ember_lance')).toMatchObject({ state: 'IN_PROGRESS', progress: 10 });
    const res = await allocate(api, 'ember_lance', 50, 0).expect(200);
    expect(res.body).toMatchObject({ allocated: 15, leveled_up_to: 1, balance: 75 });
  });

  it('MAGIC-004: stale requests are rejected and retried requests debit once', async () => {
    const s = setup();
    const { api, accountId } = await s.player({ element: 'fire' });
    grant(s, accountId, 100);
    const k = key();
    await allocate(api, 'ember_lance', 25, 0, k).expect(200);
    const replay = await allocate(api, 'ember_lance', 25, 0, k).expect(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect((await spell(api, 'ember_lance')).balance).toBe(75);

    const stale = await allocate(api, 'ember_lance', 25, 0).expect(409);
    expect(stale.body.code).toBe('STALE_RESEARCH_STATE');

    const reused = await api.post('/v1/research/allocate', { spell_id: 'ember_lance', points: 5, expected_level: 1 }, k).expect(422);
    expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('MAGIC-002: a non-starter initial unlock waits on a 60-minute milestone once funded', async () => {
    const s = setup();
    const { api, accountId } = await s.player({ element: 'fire' });
    grant(s, accountId, 25);
    const res = await allocate(api, 'static_spark', 25, 0).expect(200);
    expect(res.body.leveled_up_to).toBeNull();
    expect(res.body.spell).toMatchObject({ state: 'MILESTONE_PENDING', level: 0, milestone: { minutes: 60, satisfied: false } });
  });

  it('AT-04: an interrupted 55-minute milestone attempt keeps study points but not the milestone', async () => {
    const s = setup();
    const { api, accountId } = await s.player({ element: 'fire' });
    grant(s, accountId, 25);
    await allocate(api, 'static_spark', 25, 0).expect(200);

    const session = await startFocus(api, { research_target_spell_id: 'static_spark' });
    await focusFor(api, s.clock, session.id, 55, 1);
    s.clock.advanceMinutes(10); // connection lost mid-milestone

    const current = await api.get('/v1/focus-sessions/current').expect(200);
    expect(current.body.last.state).toBe('INTERRUPTED');
    expect(current.body.last.award).toMatchObject({ validated_minutes: 55, awarded_points: 60 });
    expect(current.body.last.award.milestone).toMatchObject({ applied: false, code: 'MILESTONE_INTERRUPTED' });
    expect(await spell(api, 'static_spark')).toMatchObject({ state: 'MILESTONE_PENDING', level: 0, progress: 25, balance: 60 });
  });

  it('finishing a milestone session early is non-punitive, and a full 60 minutes unlocks the spell', async () => {
    const s = setup();
    const { api, accountId } = await s.player({ element: 'fire' });
    grant(s, accountId, 25);
    await allocate(api, 'static_spark', 25, 0).expect(200);

    const short = await startFocus(api, { research_target_spell_id: 'static_spark' });
    await focusFor(api, s.clock, short.id, 40);
    const early = await finish(api, short.id).expect(200);
    expect(early.body.award.milestone).toMatchObject({ applied: false, code: 'MILESTONE_TOO_SHORT' });

    s.clock.advanceMinutes(20);
    const full = await startFocus(api, { research_target_spell_id: 'static_spark' });
    await focusFor(api, s.clock, full.id, 60);
    const done = await finish(api, full.id).expect(200);
    expect(done.body.award.milestone).toMatchObject({ applied: true, leveled_up_to: 1 });
    expect(await spell(api, 'static_spark')).toMatchObject({ state: 'UNLOCKED', level: 1 });
  });

  it('refuses to start a milestone session that cannot fit before the next required break', async () => {
    const s = setup();
    const { api } = await s.player({ element: 'fire' });
    const first = await startFocus(api);
    await focusFor(api, s.clock, first.id, 40);
    await finish(api, first.id).expect(200);
    const res = await api.post('/v1/focus-sessions', { research_target_spell_id: 'static_spark' }).expect(422);
    expect(res.body.code).toBe('MILESTONE_NOT_POSSIBLE');
  });

  it('a qualifying session can be applied after the fact, but only once', async () => {
    const s = setup();
    const { api } = await s.player({ element: 'light' });
    const session = await startFocus(api);
    await focusFor(api, s.clock, session.id, 60);
    await finish(api, session.id).expect(200);

    const applied = await api.post('/v1/research/milestones', { spell_id: 'ember_lance', session_id: session.id }).expect(200);
    expect(applied.body).toMatchObject({ satisfied: true, target_level: 1, leveled_up_to: null });
    const again = await api.post('/v1/research/milestones', { spell_id: 'static_spark', session_id: session.id }).expect(409);
    expect(again.body.code).toBe('SESSION_ALREADY_USED');

    // Points arrive later: the stored milestone is consumed at unlock.
    const res = await allocate(api, 'ember_lance', 25, 0).expect(200);
    expect(res.body.leveled_up_to).toBe(1);
  });

  it('RES-04: critical level 5 needs a milestone; normal levels do not', async () => {
    const s = setup();
    const { api, accountId } = await s.player({ element: 'fire' });
    grant(s, accountId, 1000);
    for (let level = 0; level < 4; level++) {
      const res = await allocate(api, 'ember_lance', 1000, level).expect(200);
      expect(res.body.leveled_up_to).toBe(level + 1);
    }
    const res = await allocate(api, 'ember_lance', 1000, 4).expect(200);
    expect(res.body.leveled_up_to).toBeNull();
    expect(res.body.spell).toMatchObject({ state: 'MILESTONE_PENDING', level: 4, next_level: 5 });
  });

  it('MAGIC-006: mana capacity is a separate track with scaling cost', async () => {
    const s = setup();
    const { api, accountId } = await s.player();
    grant(s, accountId, 100);
    const res = await api.post('/v1/research/mana', { expected_level: 1 }, key()).expect(200);
    expect(res.body).toMatchObject({ level: 2, max_mana: 50, spent: 40, balance: 60 });
    const tree = await api.get('/v1/research/tree').expect(200);
    expect(tree.body.mana).toMatchObject({ level: 2, next_cost: 60 });
    await api.post('/v1/research/mana', { expected_level: 1 }, key()).expect(409);
  });
});

describe('wizard loadout (MAGIC-007)', () => {
  it('rejects locked spells, duplicates and stale revisions', async () => {
    const s = setup();
    const { api, accountId } = await s.player({ element: 'fire' });
    grant(s, accountId, 25);
    await allocate(api, 'ember_lance', 25, 0).expect(200);
    const wizard = (await api.get('/v1/wizard').expect(200)).body;

    expect((await api.put('/v1/wizard/loadout', { spell_ids: ['fireball'], revision: wizard.loadout.revision }).expect(422)).body.code).toBe('SPELL_LOCKED');
    expect((await api.put('/v1/wizard/loadout', { spell_ids: ['ember_lance', 'ember_lance'], revision: wizard.loadout.revision }).expect(422)).body.code).toBe('DUPLICATE_SPELL');
    expect((await api.put('/v1/wizard/loadout', { spell_ids: ['arcane_bolt'], revision: wizard.loadout.revision }).expect(422)).body.code).toBe('SPELL_NOT_EQUIPPABLE');

    const ok = await api.put('/v1/wizard/loadout', { spell_ids: [], revision: wizard.loadout.revision }).expect(200);
    expect(ok.body.slots).toEqual([null, null, null, null]);
    const stale = await api.put('/v1/wizard/loadout', { spell_ids: ['ember_lance'], revision: wizard.loadout.revision }).expect(409);
    expect(stale.body.code).toBe('LOADOUT_REVISION_CONFLICT');
  });
});
