import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RULESET } from '../src/config/ruleset.js';
import { many, one, run } from '../src/db/database.js';
import { PASSWORD, finish, focusFor, setup, startFocus } from './helpers.js';

const refreshCookie = (res: request.Response) =>
  ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('wsr_refresh='))!.split(';')[0]!;

describe('accounts and onboarding', () => {
  it('registers, records consent and exposes /me with no wizard until onboarding', async () => {
    const s = setup();
    const { api, accountId } = await s.player({ withWizard: false });
    const me = await api.get('/v1/me').expect(200);
    expect(me.body).toMatchObject({ wizard: null, account: { email_verified: false }, preferences: { timezone: 'UTC' } });
    expect(many<{ kind: string }>(s.db, 'SELECT kind FROM consents WHERE account_id = ?', accountId).map((c) => c.kind).sort()).toEqual(['analytics', 'privacy', 'terms']);
  });

  it('requires accepting terms and rejects duplicate emails and bad timezones', async () => {
    const s = setup();
    const body = { email: 'a@example.com', password: PASSWORD, timezone: 'UTC', accept_terms: true };
    await request(s.app).post('/v1/auth/register').send({ ...body, accept_terms: false }).expect(400);
    await request(s.app).post('/v1/auth/register').send({ ...body, timezone: 'Mars/Olympus' }).expect(422);
    await request(s.app).post('/v1/auth/register').send(body).expect(201);
    const dup = await request(s.app).post('/v1/auth/register').send({ ...body, email: 'A@Example.com' }).expect(409);
    expect(dup.body).toMatchObject({ code: 'EMAIL_TAKEN', request_id: expect.any(String) });
  });

  it('AUTH-004: one wizard per account with unique, filtered names', async () => {
    const s = setup();
    const a = await s.player({ withWizard: false });
    const b = await s.player({ withWizard: false });
    await a.api.post('/v1/wizard', { name: 'Merla', element: 'light' }).expect(201);
    expect((await a.api.post('/v1/wizard', { name: 'Other', element: 'fire' }).expect(409)).body.code).toBe('WIZARD_EXISTS');
    expect((await b.api.post('/v1/wizard', { name: 'merla', element: 'fire' }).expect(409)).body.code).toBe('NAME_TAKEN');
    expect((await b.api.post('/v1/wizard', { name: 'Sh1tWizard', element: 'fire' }).expect(422)).body.code).toBe('NAME_NOT_ALLOWED');
    expect((await b.api.post('/v1/wizard', { name: 'Tidecaller', element: 'water' }).expect(400)).body.code).toBe('VALIDATION_ERROR');
  });

  it('login failures do not reveal whether the email exists', async () => {
    const s = setup();
    const { email } = await s.player();
    const wrong = await request(s.app).post('/v1/auth/login').send({ email, password: 'wrong password!' }).expect(401);
    const unknown = await request(s.app).post('/v1/auth/login').send({ email: 'nobody@example.com', password: 'wrong password!' }).expect(401);
    expect(wrong.body.message).toBe(unknown.body.message);
  });

  it('AUTH-002: access tokens expire; refresh rotates; a reused refresh token revokes the device family', async () => {
    const s = setup({ accessTtlSeconds: 900 });
    const { agent, token, email } = await s.player();
    s.clock.advanceMinutes(16);
    await agent.get('/v1/me').set('Authorization', `Bearer ${token}`).expect(401);

    const login = await request(s.app).post('/v1/auth/login').send({ email, password: PASSWORD }).expect(200);
    const original = refreshCookie(login);
    const rotated = await request(s.app).post('/v1/auth/refresh').set('Cookie', original).expect(200);
    await request(s.app).get('/v1/me').set('Authorization', `Bearer ${rotated.body.access_token}`).expect(200);

    // Within seconds of rotation a replay is a benign multi-tab race: rejected, nothing revoked.
    await request(s.app).post('/v1/auth/refresh').set('Cookie', original).expect(401);
    await request(s.app).get('/v1/me').set('Authorization', `Bearer ${rotated.body.access_token}`).expect(200);

    // Later, replaying the already-rotated token looks like theft: everything in that family is revoked.
    s.clock.advanceMinutes(1);
    await request(s.app).post('/v1/auth/refresh').set('Cookie', original).expect(401);
    await request(s.app).get('/v1/me').set('Authorization', `Bearer ${rotated.body.access_token}`).expect(401);
    await request(s.app).post('/v1/auth/refresh').set('Cookie', refreshCookie(rotated)).expect(401);
  });

  it('logs out one device or all devices', async () => {
    const s = setup();
    const { api, email, token } = await s.player();
    const other = await request(s.app).post('/v1/auth/login').send({ email, password: PASSWORD }).expect(200);
    await api.post('/v1/auth/logout', { all_devices: true }).expect(204);
    await request(s.app).get('/v1/me').set('Authorization', `Bearer ${token}`).expect(401);
    await request(s.app).get('/v1/me').set('Authorization', `Bearer ${other.body.access_token}`).expect(401);
  });

  it('AUTH-003: password reset links are single-use and sign out every device', async () => {
    const s = setup();
    const { email, token } = await s.player();
    await request(s.app).post('/v1/auth/password-reset/request').send({ email }).expect(202);
    await request(s.app).post('/v1/auth/password-reset/request').send({ email: 'ghost@example.com' }).expect(202);
    const link = s.lines.filter((l) => l.msg === 'dev_email_link' && l.fields.purpose === 'password_reset').at(-1)!.fields.link as string;
    const resetToken = new URL(link, 'http://x').searchParams.get('token')!;

    await request(s.app).post('/v1/auth/password-reset/confirm').send({ token: resetToken, password: 'a brand new passphrase' }).expect(204);
    await request(s.app).post('/v1/auth/password-reset/confirm').send({ token: resetToken, password: 'another passphrase!!' }).expect(422);
    await request(s.app).get('/v1/me').set('Authorization', `Bearer ${token}`).expect(401);
    await request(s.app).post('/v1/auth/login').send({ email, password: 'a brand new passphrase' }).expect(200);
  });

  it('verifies email with a single-use token', async () => {
    const s = setup();
    const { api } = await s.player();
    const link = s.lines.find((l) => l.msg === 'dev_email_link' && l.fields.purpose === 'email_verify')!.fields.link as string;
    const verifyToken = new URL(link, 'http://x').searchParams.get('token')!;
    await request(s.app).post('/v1/auth/verify-email').send({ token: verifyToken }).expect(204);
    expect((await api.get('/v1/me').expect(200)).body.account.email_verified).toBe(true);
  });

  it('ACC-03: updates preferences with validation', async () => {
    const s = setup();
    const { api } = await s.player();
    const res = await api.patch('/v1/me/preferences', { timezone: 'Asia/Singapore', dailyGoalMinutes: 60, accessibility: { reducedMotion: true } }).expect(200);
    expect(res.body.preferences).toMatchObject({ timezone: 'Asia/Singapore', dailyGoalMinutes: 60, accessibility: { reducedMotion: true, largeText: false } });
    await api.patch('/v1/me/preferences', { timezone: 'Nowhere/Land' }).expect(422);
    await api.patch('/v1/me/preferences', { dailyGoalMinutes: 600 }).expect(400);
    await api.patch('/v1/me/preferences', { sneaky: true }).expect(400);
  });
});

describe('privacy (AUTH-006, BR-08)', () => {
  it('exports all personal data as JSON', async () => {
    const s = setup();
    const { api, email } = await s.player();
    const session = await startFocus(api, { objective: 'Organic chemistry' });
    await focusFor(api, s.clock, session.id, 30);
    await finish(api, session.id).expect(200);
    const res = await api.get('/v1/me/export').expect(200);
    expect(res.body.account.email).toBe(email);
    expect(res.body.focus_sessions[0]).toMatchObject({ objective: 'Organic chemistry', award: { awarded_points: 33 } });
    expect(res.body.ledger).toHaveLength(1);
  });

  it('AT-08: deletion erases personal data, keeps an anonymous ledger, and revokes access', async () => {
    const s = setup();
    const { api, email, accountId, token } = await s.player();
    const session = await startFocus(api, { objective: 'Secret thesis topic' });
    await focusFor(api, s.clock, session.id, 30);
    await finish(api, session.id).expect(200);

    await api.delete('/v1/me', { password: 'not my password' }).expect(401);
    await api.delete('/v1/me', { password: PASSWORD }).expect(202);

    await request(s.app).get('/v1/me').set('Authorization', `Bearer ${token}`).expect(401);
    await request(s.app).post('/v1/auth/login').send({ email, password: PASSWORD }).expect(401);
    const account = one<{ email: string | null; password_hash: string | null; status: string }>(s.db, 'SELECT email, password_hash, status FROM accounts WHERE id = ?', accountId)!;
    expect(account).toEqual({ email: null, password_hash: null, status: 'deleted' });
    expect(one<{ objective: string | null }>(s.db, 'SELECT objective FROM focus_sessions WHERE account_id = ?', accountId)?.objective).toBeNull();
    expect(one<{ name: string }>(s.db, 'SELECT name FROM wizards WHERE account_id = ?', accountId)?.name).toMatch(/^deleted-/);
    expect(many(s.db, 'SELECT * FROM reward_ledger WHERE account_id = ?', accountId)).toHaveLength(1);
    // The email can be used again for a fresh account.
    await request(s.app).post('/v1/auth/register').send({ email, password: PASSWORD, timezone: 'UTC', accept_terms: true }).expect(201);
  });

  it('records analytics only after opt-in, pseudonymously and without study content', async () => {
    const s = setup();
    const optedOut = await s.player({ analytics: false });
    const optedIn = await s.player({ analytics: true });
    for (const p of [optedOut, optedIn]) {
      const session = await startFocus(p.api, { objective: 'Calculus homework' });
      await focusFor(p.api, s.clock, session.id, 10);
      await finish(p.api, session.id).expect(200);
    }
    const events = many<{ name: string; user_pseudonym: string; properties: string }>(s.db, 'SELECT name, user_pseudonym, properties FROM analytics_events');
    expect(events.map((e) => e.name)).toEqual(expect.arrayContaining(['focus_started', 'focus_completed', 'points_granted']));
    expect(new Set(events.map((e) => e.user_pseudonym)).size).toBe(1);
    const raw = JSON.stringify(events);
    expect(raw).not.toContain('Calculus');
    expect(raw).not.toContain(optedIn.accountId);
  });
});

describe('administration', () => {
  it('requires the admin role, validates safety rules on publish, and reconciles the ledger', async () => {
    const s = setup();
    const player = await s.player();
    await player.api.get('/v1/admin/rulesets').expect(403);

    const admin = await s.player();
    run(s.db, "UPDATE accounts SET role = 'admin' WHERE id = ?", admin.accountId);

    const unsafe = { ...structuredClone(DEFAULT_RULESET), id: 'unsafe' };
    unsafe.focus.requiredBreakMinutes = 5;
    await admin.api.post('/v1/admin/rulesets', unsafe).expect(400);

    const tuned = { ...structuredClone(DEFAULT_RULESET), id: 'rules-beta-2' };
    tuned.rewards.dailyCreditedMinutesCap = 180;
    await admin.api.post('/v1/admin/rulesets', tuned).expect(201);
    await admin.api.post('/v1/admin/rulesets', tuned).expect(409);
    expect((await admin.api.get('/v1/admin/rulesets').expect(200)).body.active.id).toBe('rules-beta-2');

    // New sessions record the ruleset they were earned under.
    const session = await startFocus(player.api);
    await focusFor(player.api, s.clock, session.id, 10);
    expect((await finish(player.api, session.id).expect(200)).body.award.ruleset_id).toBe('rules-beta-2');

    const recon = await admin.api.get('/v1/admin/ledger/reconcile').expect(200);
    expect(recon.body).toMatchObject({ clean: true, entries_checked: 1 });
  });

  it('ADM-03: invalidating a rewarded session reverses its points with an audit trail', async () => {
    const s = setup();
    const player = await s.player();
    const admin = await s.player();
    run(s.db, "UPDATE accounts SET role = 'admin' WHERE id = ?", admin.accountId);
    const session = await startFocus(player.api);
    await focusFor(player.api, s.clock, session.id, 30);
    await finish(player.api, session.id).expect(200);

    const res = await admin.api.post(`/v1/admin/focus-sessions/${session.id}/invalidate`, { reason: 'Scripted heartbeats' }).expect(200);
    expect(res.body.state).toBe('INVALIDATED');
    expect((await player.api.get('/v1/ledger').expect(200)).body.balances.RESEARCH_POINTS).toBe(0);
    const audit = await admin.api.get('/v1/admin/audit').expect(200);
    expect(audit.body.events.some((e: { action: string }) => e.action === 'focus.invalidated')).toBe(true);
  });
});
