import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MIGRATIONS } from './migrations.js';

export type Db = DatabaseSync;
export type Params = SQLInputValue[];

export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(db.prepare('SELECT id FROM schema_migrations').all().map((r) => String(r.id)));
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    transaction(db, () => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(m.id, new Date().toISOString());
    });
  }
}

const depth = new WeakMap<Db, number>();

/**
 * Runs `fn` atomically. Nested calls become savepoints, so services can compose
 * (e.g. focus settlement -> ledger credit -> research milestone) inside one commit.
 * node:sqlite is synchronous, so nothing else can interleave inside `fn` (keep it sync).
 */
export function transaction<T>(db: Db, fn: () => T): T {
  const level = depth.get(db) ?? 0;
  const savepoint = `sp_${level}`;
  db.exec(level === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
  depth.set(db, level + 1);
  try {
    const result = fn();
    db.exec(level === 0 ? 'COMMIT' : `RELEASE ${savepoint}`);
    return result;
  } catch (err) {
    db.exec(level === 0 ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
    throw err;
  } finally {
    depth.set(db, level);
  }
}

/** Small typed helpers over prepared statements. */
export const one = <T>(db: Db, sql: string, ...params: Params): T | undefined =>
  db.prepare(sql).get(...params) as T | undefined;

export const many = <T>(db: Db, sql: string, ...params: Params): T[] => db.prepare(sql).all(...params) as T[];

export const run = (db: Db, sql: string, ...params: Params) => db.prepare(sql).run(...params);

export const isUniqueViolation = (err: unknown): boolean =>
  err instanceof Error && /UNIQUE constraint failed/i.test(err.message);

export const isCheckViolation = (err: unknown): boolean =>
  err instanceof Error && /CHECK constraint failed/i.test(err.message);
