import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { many } from '../src/db/database.js';
import { runMaintenance } from '../src/worker.js';
import { PASSWORD, finish, focusFor, key, setup, startFocus } from './helpers.js';

const ledgerCredits = (s: ReturnType<typeof setup>, accountId: string) =>
  many<{ delta: number; reason: string }>(s.db, "SELECT delta, reason FROM reward_ledger WHERE account_id = ? AND currency = 'RESEARCH_POINTS'", accountId);

describe('focus sessions', () => {
  it('AT-01: a second start from another device is rejected and one session remains', async () => {
    const s = setup();
    const { api, email } = await s.player();
    const otherDevice = request.agent(s.app);
    const login = await otherDevice.post('/v1/auth/login').send({ email, password: PASSWORD }).expect(200);

    const first = await startFocus(api);
    const second = await otherDevice
      .post('/v1/focus-sessions')
      .set('Authorization', `Bearer ${login.body.access_token}`)
      .send({})
      .expect(409);
    expect(second.body.code).toBe('SESSION_ALREADY_ACTIVE');
    expect(second.body.details.session_id).toBe(first.id);
    expect(many(s.db, "SELECT id FROM focus_sessions WHERE state = 'ACTIVE'")).toHaveLength(1);
  });

  it('BR-02: ending a 35-minute session early grants base x multiplier exactly once', async () => {
    const s = setup();
    const { api, accountId } = await s.player();
    const session = await startFocus(api, { objective: 'Chapter 4 problems' });
    await focusFor(api, s.clock, session.id, 35);
    const res = await finish(api, session.id).expect(200);
    expect(res.body.state).toBe('COMPLETED');
    expect(res.body.end_reason).toBe('finished');
    expect(res.body.award).toMatchObject({ validated_minutes: 35, multiplier: 1.1, awarded_points: 38 });
    expect(ledgerCredits(s, accountId)).toEqual([{ delta: 38, reason: 'FOCUS_SESSION' }]);
  });

  it('AT-02 / BR-01: the server closes the session at 90 minutes and a 20-minute break gates the next rewarded session', async () => {
    const s = setup();
    const { api } = await s.player();
    const session = await startFocus(api);
    const stopped = await focusFor(api, s.clock, session.id, 95);
    // The heartbeat after the cap is told the session has ended.
    expect(stopped?.status).toBe(409);

    const current = await api.get('/v1/focus-sessions/current').expect(200);
    expect(current.body.active).toBeNull();
    expect(current.body.last).toMatchObject({ state: 'COMPLETED', end_reason: 'cap_reached', validated_seconds: 90 * 60 });
    expect(current.body.last.award.awarded_points).toBe(108);
    expect(current.body.break.break_required).toBe(true);

    const blocked = await api.post('/v1/focus-sessions', {}).expect(422);
    expect(blocked.body.code).toBe('BREAK_REQUIRED');

    s.clock.advanceMinutes(19);
    await api.post('/v1/focus-sessions', {}).expect(422);
    s.clock.advanceMinutes(1); // exactly 20 minutes after the cap
    await startFocus(api);
  });

  it('FOCUS-004: auto-closes at the cap even if the client disconnects just before it', async () => {
    const s = setup();
    const { api, accountId } = await s.player();
    const session = await startFocus(api);
    await focusFor(api, s.clock, session.id, 88);
    s.clock.advanceMinutes(30); // client gone; no more heartbeats or requests
    runMaintenance(s.ctx);

    const row = many<{ state: string; end_reason: string; validated_seconds: number }>(s.db, 'SELECT state, end_reason, validated_seconds FROM focus_sessions')[0]!;
    expect(row).toMatchObject({ state: 'COMPLETED', end_reason: 'cap_reached', validated_seconds: 5400 });
    expect(ledgerCredits(s, accountId)).toEqual([{ delta: 108, reason: 'FOCUS_SESSION' }]);
  });

  it('AT-03 / BR-03: a finish retried 10x with one key creates exactly one ledger credit', async () => {
    const s = setup();
    const { api, accountId } = await s.player();
    const session = await startFocus(api);
    await focusFor(api, s.clock, session.id, 30);
    const idempotencyKey = key();
    const responses = [];
    for (let i = 0; i < 10; i++) responses.push(await finish(api, session.id, idempotencyKey).expect(200));
    expect(new Set(responses.map((r) => r.body.award.awarded_points))).toEqual(new Set([33]));
    expect(responses[1]!.headers['idempotent-replayed']).toBe('true');
    // Even with fresh keys the domain guarantees a single credit.
    await finish(api, session.id, key()).expect(200);
    expect(ledgerCredits(s, accountId)).toHaveLength(1);
  });

  it('rejects reward mutations without an Idempotency-Key', async () => {
    const s = setup();
    const { api } = await s.player();
    const session = await startFocus(api);
    const res = await api.post(`/v1/focus-sessions/${session.id}/finish`, {}).expect(400);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('FOCUS-007: a disconnect beyond the grace window interrupts the session but keeps earned progress', async () => {
    const s = setup();
    const { api, accountId } = await s.player();
    const session = await startFocus(api);
    await focusFor(api, s.clock, session.id, 20);
    s.clock.advanceMinutes(30); // phone locked, no heartbeats

    const current = await api.get('/v1/focus-sessions/current').expect(200);
    expect(current.body.last).toMatchObject({ state: 'INTERRUPTED', end_reason: 'disconnected', validated_seconds: 20 * 60 });
    expect(ledgerCredits(s, accountId)).toEqual([{ delta: 20, reason: 'FOCUS_SESSION' }]);

    const late = await api.post(`/v1/focus-sessions/${session.id}/heartbeat`, { sequence: 999 }).expect(409);
    expect(late.body.code).toBe('SESSION_NOT_ACTIVE');
  });

  it('a short network blip within the grace window is credited in full', async () => {
    const s = setup();
    const { api } = await s.player();
    const session = await startFocus(api);
    await focusFor(api, s.clock, session.id, 10);
    s.clock.advanceMinutes(3); // silent for 4 minutes in total: within the 5-minute grace window
    await focusFor(api, s.clock, session.id, 7, 1);
    const res = await finish(api, session.id).expect(200);
    expect(res.body.validated_seconds).toBe(20 * 60);
  });

  it('fatigue rule: back-to-back sessions share one continuous 90-minute budget', async () => {
    const s = setup();
    const { api } = await s.player();
    const first = await startFocus(api);
    await focusFor(api, s.clock, first.id, 60);
    await finish(api, first.id).expect(200);

    s.clock.advanceMinutes(5); // shorter than the 20-minute break
    const second = await startFocus(api);
    expect(second.continuous_focus_before_seconds).toBe(60 * 60);
    expect(Date.parse(second.cap_at) - Date.parse(second.started_at)).toBe(30 * 60_000);

    await focusFor(api, s.clock, second.id, 35);
    const current = await api.get('/v1/focus-sessions/current').expect(200);
    expect(current.body.last).toMatchObject({ end_reason: 'cap_reached', validated_seconds: 30 * 60 });
    expect(current.body.break.break_required).toBe(true);
  });

  it('a real break resets the continuous budget', async () => {
    const s = setup();
    const { api } = await s.player();
    const first = await startFocus(api);
    await focusFor(api, s.clock, first.id, 50);
    await finish(api, first.id).expect(200);
    s.clock.advanceMinutes(20);
    const second = await startFocus(api);
    expect(second.continuous_focus_before_seconds).toBe(0);
    expect(Date.parse(second.cap_at) - Date.parse(second.started_at)).toBe(90 * 60_000);
  });

  it('enforces the 240-minute daily soft cap: excess time is tracked but not rewarded', async () => {
    const s = setup();
    const { api, accountId } = await s.player();
    for (let i = 0; i < 3; i++) {
      const session = await startFocus(api);
      await focusFor(api, s.clock, session.id, 90);
      s.clock.advanceMinutes(20);
    }
    const history = await api.get('/v1/focus-sessions').expect(200);
    const third = history.body.sessions[0];
    expect(third.validated_seconds).toBe(90 * 60);
    expect(third.award).toMatchObject({ credited_minutes: 60, daily_cap_deduction_minutes: 30, awarded_points: 72 });
    expect(ledgerCredits(s, accountId).reduce((sum, e) => sum + e.delta, 0)).toBe(108 + 108 + 72);
  });

  it('summarises the week and today without exposing objectives', async () => {
    const s = setup();
    const { api } = await s.player();
    const session = await startFocus(api, { objective: 'private notes' });
    await focusFor(api, s.clock, session.id, 25);
    await finish(api, session.id).expect(200);
    const summary = await api.get('/v1/me/summary').expect(200);
    expect(summary.body.week).toHaveLength(7);
    expect(summary.body.week[6].focus_minutes).toBe(25);
    expect(summary.body.current_streak_days).toBe(1);
    expect(JSON.stringify(summary.body)).not.toContain('private notes');
  });

  it("cannot read or finish someone else's session", async () => {
    const s = setup();
    const alice = await s.player();
    const bob = await s.player();
    const session = await startFocus(alice.api);
    await bob.api.get(`/v1/focus-sessions/${session.id}`).expect(404);
    await finish(bob.api, session.id).expect(404);
  });
});
