import type { AppContext } from '../../context.js';
import { many, one, run, transaction } from '../../db/database.js';
import { iso } from '../../lib/clock.js';
import { conflict, unprocessable } from '../../lib/errors.js';
import { newId } from '../../lib/crypto.js';

export type Currency = 'RESEARCH_POINTS' | 'COMBAT_XP';
export const CURRENCIES: Currency[] = ['RESEARCH_POINTS', 'COMBAT_XP'];

export interface LedgerEntry {
  id: string;
  account_id: string;
  currency: Currency;
  delta: number;
  balance_after: number;
  reason: string;
  source_id: string | null;
  idempotency_key: string;
  ruleset_id: string | null;
  study_day: string;
  created_at: string;
}

export interface PostEntryInput {
  accountId: string;
  currency: Currency;
  delta: number;
  reason: string;
  sourceId: string | null;
  /** Globally unique. Re-posting the same key returns the original entry instead of a second credit. */
  idempotencyKey: string;
  rulesetId: string | null;
  studyDay: string;
}

/**
 * The only way balances change (ECON-001/002/003). The ledger row and the balance
 * projection are written in one transaction; the CHECK on balances makes
 * overdrafts impossible even if a caller forgets to validate.
 */
export function postEntry(ctx: AppContext, input: PostEntryInput): { entry: LedgerEntry; duplicate: boolean } {
  if (!Number.isInteger(input.delta) || input.delta === 0) throw new Error('Ledger delta must be a non-zero integer');
  return transaction(ctx.db, () => {
    const existing = one<LedgerEntry>(ctx.db, 'SELECT * FROM reward_ledger WHERE idempotency_key = ?', input.idempotencyKey);
    if (existing) {
      if (existing.account_id !== input.accountId || existing.currency !== input.currency || existing.delta !== input.delta) {
        throw conflict('IDEMPOTENCY_MISMATCH', 'Idempotency key was already used for a different ledger entry');
      }
      return { entry: existing, duplicate: true };
    }
    const next = balanceOf(ctx, input.accountId, input.currency) + input.delta;
    if (next < 0) {
      throw unprocessable('INSUFFICIENT_FUNDS', `Not enough ${input.currency}`, { currency: input.currency, short_by: -next });
    }
    run(
      ctx.db,
      `INSERT INTO balances (account_id, currency, amount) VALUES (?, ?, ?)
       ON CONFLICT (account_id, currency) DO UPDATE SET amount = excluded.amount`,
      input.accountId,
      input.currency,
      next,
    );
    const entry: LedgerEntry = {
      id: newId(),
      account_id: input.accountId,
      currency: input.currency,
      delta: input.delta,
      balance_after: next,
      reason: input.reason,
      source_id: input.sourceId,
      idempotency_key: input.idempotencyKey,
      ruleset_id: input.rulesetId,
      study_day: input.studyDay,
      created_at: iso(ctx.clock.now()),
    };
    run(
      ctx.db,
      `INSERT INTO reward_ledger (id, account_id, currency, delta, balance_after, reason, source_id, idempotency_key, ruleset_id, study_day, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      entry.id, entry.account_id, entry.currency, entry.delta, entry.balance_after, entry.reason,
      entry.source_id, entry.idempotency_key, entry.ruleset_id, entry.study_day, entry.created_at,
    );
    return { entry, duplicate: false };
  });
}

export function balanceOf(ctx: AppContext, accountId: string, currency: Currency): number {
  return one<{ amount: number }>(ctx.db, 'SELECT amount FROM balances WHERE account_id = ? AND currency = ?', accountId, currency)?.amount ?? 0;
}

export function balancesOf(ctx: AppContext, accountId: string): Record<Currency, number> {
  const result: Record<Currency, number> = { RESEARCH_POINTS: 0, COMBAT_XP: 0 };
  for (const row of many<{ currency: Currency; amount: number }>(ctx.db, 'SELECT currency, amount FROM balances WHERE account_id = ?', accountId)) {
    result[row.currency] = row.amount;
  }
  return result;
}

/** Sum of positive credits for one study day and reason, used for daily caps. */
export function creditedOnDay(ctx: AppContext, accountId: string, currency: Currency, studyDay: string, reason: string): number {
  const row = one<{ total: number | null }>(
    ctx.db,
    `SELECT SUM(delta) AS total FROM reward_ledger
     WHERE account_id = ? AND currency = ? AND study_day = ? AND reason = ? AND delta > 0`,
    accountId, currency, studyDay, reason,
  );
  return row?.total ?? 0;
}

/** Cursor pagination; the cursor is "<created_at>|<id>" of the last row returned. */
export function listEntries(ctx: AppContext, accountId: string, cursor: string | undefined, limit: number) {
  const [cAt, cId] = cursor ? cursor.split('|') : [];
  const rows =
    cAt && cId
      ? many<LedgerEntry>(
          ctx.db,
          `SELECT * FROM reward_ledger WHERE account_id = ? AND (created_at < ? OR (created_at = ? AND id < ?))
           ORDER BY created_at DESC, id DESC LIMIT ?`,
          accountId, cAt, cAt, cId, limit + 1,
        )
      : many<LedgerEntry>(ctx.db, 'SELECT * FROM reward_ledger WHERE account_id = ? ORDER BY created_at DESC, id DESC LIMIT ?', accountId, limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { entries: page, next_cursor: rows.length > limit && last ? `${last.created_at}|${last.id}` : null };
}

/** Admin reconciliation (ECON-006): the projection must equal the ledger sum for every account. */
export function reconcile(ctx: AppContext) {
  const mismatches = many<{ account_id: string; currency: string; ledger_total: number; projected: number }>(
    ctx.db,
    `SELECT l.account_id, l.currency, l.ledger_total, COALESCE(b.amount, 0) AS projected
     FROM (SELECT account_id, currency, SUM(delta) AS ledger_total FROM reward_ledger GROUP BY account_id, currency) l
     LEFT JOIN balances b ON b.account_id = l.account_id AND b.currency = l.currency
     WHERE l.ledger_total <> COALESCE(b.amount, 0)`,
  );
  const totals = one<{ entries: number }>(ctx.db, 'SELECT COUNT(*) AS entries FROM reward_ledger');
  return { clean: mismatches.length === 0, entries_checked: totals?.entries ?? 0, mismatches };
}
