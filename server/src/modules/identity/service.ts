import type { AppContext } from '../../context.js';
import { isUniqueViolation, many, one, run, transaction } from '../../db/database.js';
import { iso } from '../../lib/clock.js';
import { conflict, unauthorized, unprocessable } from '../../lib/errors.js';
import { hashPassword, hashToken, newId, newToken, verifyPassword } from '../../lib/crypto.js';
import { assertValidTimezone } from '../../lib/time.js';
import { audit, track } from '../analytics/service.js';
import { defaultPreferences, mergePreferences, preferencesPatchSchema, preferencesSchema, type Preferences } from './preferences.js';
import type { z } from 'zod';

export const CONSENT_VERSION = '2026-11';
const RESET_TOKEN_TTL_MINUTES = 30;
const VERIFY_TOKEN_TTL_HOURS = 48;
const REFRESH_RACE_WINDOW_MS = 10_000;
// Verified against when the email is unknown so login timing does not reveal which emails exist.
const DUMMY_HASH = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==';

export interface AccountRow {
  id: string;
  email: string | null;
  password_hash: string | null;
  role: 'player' | 'admin';
  status: 'active' | 'deleted';
  email_verified_at: string | null;
  preferences: string;
  created_at: string;
  deleted_at: string | null;
}

export interface IssuedTokens {
  access_token: string;
  access_expires_at: string;
  refresh_token: string;
  refresh_expires_at: string;
}

export function getAccount(ctx: AppContext, accountId: string): AccountRow | undefined {
  return one<AccountRow>(ctx.db, 'SELECT * FROM accounts WHERE id = ?', accountId);
}

export function preferencesOf(ctx: AppContext, accountId: string): Preferences {
  const row = one<{ preferences: string }>(ctx.db, 'SELECT preferences FROM accounts WHERE id = ?', accountId);
  return preferencesSchema.parse(JSON.parse(row?.preferences ?? 'null'));
}

export async function register(
  ctx: AppContext,
  input: { email: string; password: string; timezone: string; acceptTerms: boolean; analyticsOptIn: boolean; deviceLabel?: string },
): Promise<{ accountId: string; tokens: IssuedTokens }> {
  assertValidTimezone(input.timezone);
  if (!input.acceptTerms) throw unprocessable('CONSENT_REQUIRED', 'Accept the terms and privacy notice to create an account');
  const passwordHash = await hashPassword(input.password);
  const accountId = newId();
  const now = iso(ctx.clock.now());
  const prefs = defaultPreferences(input.timezone);
  prefs.privacy.analyticsOptIn = input.analyticsOptIn;
  try {
    transaction(ctx.db, () => {
      run(
        ctx.db,
        'INSERT INTO accounts (id, email, password_hash, preferences, created_at) VALUES (?, ?, ?, ?, ?)',
        accountId, input.email.toLowerCase(), passwordHash, JSON.stringify(prefs), now,
      );
      recordConsent(ctx, accountId, 'terms', true);
      recordConsent(ctx, accountId, 'privacy', true);
      recordConsent(ctx, accountId, 'analytics', input.analyticsOptIn);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('EMAIL_TAKEN', 'An account with this email already exists');
    throw err;
  }
  issueEmailToken(ctx, accountId, 'email_verify');
  const tokens = issueSession(ctx, accountId, newId(), input.deviceLabel);
  track(ctx, accountId, 'account_registered');
  return { accountId, tokens };
}

export async function login(ctx: AppContext, input: { email: string; password: string; deviceLabel?: string }): Promise<IssuedTokens> {
  const account = one<AccountRow>(ctx.db, "SELECT * FROM accounts WHERE email = ? AND status = 'active'", input.email.toLowerCase());
  const ok = await verifyPassword(input.password, account?.password_hash ?? DUMMY_HASH);
  if (!account || !ok) throw unauthorized('Email or password is incorrect');
  return issueSession(ctx, account.id, newId(), input.deviceLabel);
}

function issueSession(ctx: AppContext, accountId: string, familyId: string, deviceLabel?: string): IssuedTokens {
  const now = ctx.clock.now();
  const access = newToken();
  const refresh = newToken();
  const accessExpires = iso(now + ctx.env.accessTokenTtlSeconds * 1000);
  const refreshExpires = iso(now + ctx.env.refreshTokenTtlDays * 86_400_000);
  run(
    ctx.db,
    `INSERT INTO auth_sessions (id, account_id, family_id, access_hash, refresh_hash, access_expires_at, refresh_expires_at, device_label, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId(), accountId, familyId, hashToken(access), hashToken(refresh), accessExpires, refreshExpires,
    deviceLabel?.slice(0, 80) ?? null, iso(now),
  );
  return { access_token: access, access_expires_at: accessExpires, refresh_token: refresh, refresh_expires_at: refreshExpires };
}

/**
 * Rotating refresh tokens (AUTH-002). Each refresh revokes the old row; presenting
 * an already-rotated token means it leaked, so the whole device family is revoked.
 */
export function refresh(ctx: AppContext, refreshToken: string): IssuedTokens {
  const tokens = transaction(ctx.db, (): IssuedTokens | 'reuse_detected' => {
    const row = one<{ id: string; account_id: string; family_id: string; refresh_expires_at: string; revoked_at: string | null; device_label: string | null }>(
      ctx.db,
      'SELECT id, account_id, family_id, refresh_expires_at, revoked_at, device_label FROM auth_sessions WHERE refresh_hash = ?',
      hashToken(refreshToken),
    );
    const now = ctx.clock.now();
    if (!row) throw unauthorized('Session expired, please sign in again');
    if (row.revoked_at) {
      // Two tabs refreshing at once: the loser presents a just-rotated token. Reject it, but do not
      // treat it as theft; the client retries with the cookie the winning request set.
      if (now - Date.parse(row.revoked_at) < REFRESH_RACE_WINDOW_MS) throw unauthorized('Session was just refreshed, retry');
      run(ctx.db, 'UPDATE auth_sessions SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL', iso(now), row.family_id);
      audit(ctx, { actorId: row.account_id, action: 'auth.refresh_reuse_detected', target: row.family_id });
      // Return instead of throwing so the revocation commits.
      return 'reuse_detected';
    }
    if (Date.parse(row.refresh_expires_at) <= now) throw unauthorized('Session expired, please sign in again');
    const account = getAccount(ctx, row.account_id);
    if (!account || account.status !== 'active') throw unauthorized();
    run(ctx.db, 'UPDATE auth_sessions SET revoked_at = ? WHERE id = ?', iso(now), row.id);
    return issueSession(ctx, row.account_id, row.family_id, row.device_label ?? undefined);
  });
  if (tokens === 'reuse_detected') throw unauthorized('Session expired, please sign in again');
  return tokens;
}

export function resolveAccessToken(ctx: AppContext, token: string): { accountId: string; role: 'player' | 'admin'; sessionId: string } | null {
  const row = one<{ id: string; account_id: string; access_expires_at: string; role: 'player' | 'admin' }>(
    ctx.db,
    `SELECT s.id, s.account_id, s.access_expires_at, a.role FROM auth_sessions s
     JOIN accounts a ON a.id = s.account_id
     WHERE s.access_hash = ? AND s.revoked_at IS NULL AND a.status = 'active'`,
    hashToken(token),
  );
  if (!row || Date.parse(row.access_expires_at) <= ctx.clock.now()) return null;
  return { accountId: row.account_id, role: row.role, sessionId: row.id };
}

export function logout(ctx: AppContext, accountId: string, sessionId: string, allDevices: boolean): void {
  const now = iso(ctx.clock.now());
  if (allDevices) run(ctx.db, 'UPDATE auth_sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL', now, accountId);
  else run(ctx.db, 'UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND account_id = ?', now, sessionId, accountId);
}

/** Creates a single-use token. MVP has no email provider, so dev mode logs the link. */
function issueEmailToken(ctx: AppContext, accountId: string, purpose: 'password_reset' | 'email_verify'): void {
  const token = newToken();
  const ttl = purpose === 'password_reset' ? RESET_TOKEN_TTL_MINUTES * 60_000 : VERIFY_TOKEN_TTL_HOURS * 3_600_000;
  run(
    ctx.db,
    'INSERT INTO auth_tokens (token_hash, account_id, purpose, expires_at) VALUES (?, ?, ?, ?)',
    hashToken(token), accountId, purpose, iso(ctx.clock.now() + ttl),
  );
  if (ctx.env.logEmailLinks) {
    const path = purpose === 'password_reset' ? '/auth/reset' : '/auth/verify';
    ctx.log.info('dev_email_link', { purpose, link: `${path}?token=${token}` });
  }
}

function consumeEmailToken(ctx: AppContext, token: string, purpose: 'password_reset' | 'email_verify'): string {
  const row = one<{ account_id: string; expires_at: string; used_at: string | null }>(
    ctx.db,
    'SELECT account_id, expires_at, used_at FROM auth_tokens WHERE token_hash = ? AND purpose = ?',
    hashToken(token), purpose,
  );
  if (!row || row.used_at || Date.parse(row.expires_at) <= ctx.clock.now()) {
    throw unprocessable('TOKEN_INVALID', 'This link is invalid or has expired');
  }
  run(ctx.db, 'UPDATE auth_tokens SET used_at = ? WHERE token_hash = ?', iso(ctx.clock.now()), hashToken(token));
  return row.account_id;
}

/** Always succeeds from the caller's view so the endpoint cannot be used to probe for accounts. */
export function requestPasswordReset(ctx: AppContext, email: string): void {
  const account = one<{ id: string }>(ctx.db, "SELECT id FROM accounts WHERE email = ? AND status = 'active'", email.toLowerCase());
  if (account) issueEmailToken(ctx, account.id, 'password_reset');
}

export async function resetPassword(ctx: AppContext, token: string, newPassword: string): Promise<void> {
  const passwordHash = await hashPassword(newPassword);
  transaction(ctx.db, () => {
    const accountId = consumeEmailToken(ctx, token, 'password_reset');
    run(ctx.db, 'UPDATE accounts SET password_hash = ? WHERE id = ?', passwordHash, accountId);
    // A reset signs out every device.
    run(ctx.db, 'UPDATE auth_sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL', iso(ctx.clock.now()), accountId);
    audit(ctx, { actorId: accountId, action: 'auth.password_reset', target: accountId });
  });
}

export function verifyEmail(ctx: AppContext, token: string): void {
  transaction(ctx.db, () => {
    const accountId = consumeEmailToken(ctx, token, 'email_verify');
    run(ctx.db, 'UPDATE accounts SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?', iso(ctx.clock.now()), accountId);
  });
}

export function resendVerification(ctx: AppContext, accountId: string): void {
  const account = getAccount(ctx, accountId);
  if (account && !account.email_verified_at) issueEmailToken(ctx, accountId, 'email_verify');
}

function recordConsent(ctx: AppContext, accountId: string, kind: string, granted: boolean): void {
  run(
    ctx.db,
    'INSERT INTO consents (id, account_id, kind, version, granted, recorded_at) VALUES (?, ?, ?, ?, ?, ?)',
    newId(), accountId, kind, CONSENT_VERSION, granted ? 1 : 0, iso(ctx.clock.now()),
  );
}

export function updatePreferences(ctx: AppContext, accountId: string, patch: z.infer<typeof preferencesPatchSchema>): Preferences {
  if (patch.timezone) assertValidTimezone(patch.timezone);
  return transaction(ctx.db, () => {
    const current = preferencesOf(ctx, accountId);
    const next = mergePreferences(current, patch);
    run(ctx.db, 'UPDATE accounts SET preferences = ? WHERE id = ?', JSON.stringify(next), accountId);
    if (next.privacy.analyticsOptIn !== current.privacy.analyticsOptIn) {
      recordConsent(ctx, accountId, 'analytics', next.privacy.analyticsOptIn);
    }
    return next;
  });
}

/** AUTH-006: a full machine-readable copy of everything stored about the account. */
export function exportAccount(ctx: AppContext, accountId: string) {
  const account = getAccount(ctx, accountId);
  const wizard = one<{ id: string }>(ctx.db, 'SELECT * FROM wizards WHERE account_id = ?', accountId);
  return {
    exported_at: iso(ctx.clock.now()),
    account: account && {
      id: account.id,
      email: account.email,
      email_verified_at: account.email_verified_at,
      created_at: account.created_at,
      preferences: JSON.parse(account.preferences),
    },
    consents: many(ctx.db, 'SELECT kind, version, granted, recorded_at FROM consents WHERE account_id = ? ORDER BY recorded_at', accountId),
    wizard,
    spells: wizard ? many(ctx.db, 'SELECT spell_id, level, research_progress, unlocked_at FROM wizard_spells WHERE wizard_id = ?', wizard.id) : [],
    loadout: wizard ? many(ctx.db, 'SELECT slot, spell_id FROM loadouts WHERE wizard_id = ? ORDER BY slot', wizard.id) : [],
    focus_sessions: many<Record<string, unknown> & { award: string | null }>(
      ctx.db,
      'SELECT id, state, objective, started_at, ended_at, end_reason, validated_seconds, credited_minutes, study_day, award FROM focus_sessions WHERE account_id = ? ORDER BY started_at',
      accountId,
    ).map((s) => ({ ...s, award: s.award ? JSON.parse(s.award) : null })),
    ledger: many(ctx.db, 'SELECT id, currency, delta, balance_after, reason, source_id, study_day, created_at FROM reward_ledger WHERE account_id = ? ORDER BY created_at', accountId),
    matches: many(ctx.db, 'SELECT id, encounter_id, state, winner, reward, created_at, settled_at FROM matches WHERE account_id = ? ORDER BY created_at', accountId),
  };
}

/**
 * AUTH-006 / BR-08: anonymise rather than hard-delete. Personal data (email,
 * password, preferences, study objectives, device ids) is erased; the ledger and
 * consent records are kept, unlinked from any identity, for audit obligations.
 */
export async function deleteAccount(ctx: AppContext, accountId: string, password: string, requestId: string): Promise<void> {
  const account = getAccount(ctx, accountId);
  if (!account || !(await verifyPassword(password, account.password_hash))) throw unauthorized('Password is incorrect');
  const now = iso(ctx.clock.now());
  transaction(ctx.db, () => {
    run(
      ctx.db,
      "UPDATE accounts SET email = NULL, password_hash = NULL, status = 'deleted', deleted_at = ?, preferences = ? WHERE id = ?",
      now, JSON.stringify(defaultPreferences('UTC')), accountId,
    );
    run(ctx.db, "UPDATE wizards SET name = 'deleted-' || substr(id, 1, 8) WHERE account_id = ?", accountId);
    run(ctx.db, 'UPDATE focus_sessions SET objective = NULL WHERE account_id = ?', accountId);
    run(ctx.db, 'UPDATE focus_heartbeats SET device_id = NULL WHERE session_id IN (SELECT id FROM focus_sessions WHERE account_id = ?)', accountId);
    run(ctx.db, 'UPDATE auth_sessions SET revoked_at = ?, device_label = NULL WHERE account_id = ?', now, accountId);
    run(ctx.db, 'DELETE FROM auth_tokens WHERE account_id = ?', accountId);
    run(ctx.db, 'DELETE FROM idempotency_requests WHERE account_id = ?', accountId);
    run(
      ctx.db,
      "UPDATE focus_sessions SET state = 'INTERRUPTED', ended_at = ?, end_reason = 'account_deleted', settled_at = ? WHERE account_id = ? AND state IN ('CREATED', 'ACTIVE')",
      now, now, accountId,
    );
    run(ctx.db, "UPDATE matches SET state = 'ABORTED', updated_at = ? WHERE account_id = ? AND state IN ('CREATED', 'IN_PROGRESS', 'SETTLING')", now, accountId);
    audit(ctx, { actorId: accountId, action: 'account.deleted', target: accountId, requestId });
  });
}
