/**
 * Forward-only migrations. SQL is kept close to PostgreSQL so the schema can be
 * ported when the pilot outgrows SQLite (TEXT ISO-8601 UTC timestamps, TEXT UUIDs).
 */
export const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: '001_init',
    sql: `
CREATE TABLE accounts (
  id               TEXT PRIMARY KEY,
  email            TEXT UNIQUE COLLATE NOCASE,          -- NULL once the account is deleted
  password_hash    TEXT,
  role             TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'admin')),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  email_verified_at TEXT,
  preferences      TEXT NOT NULL,                       -- JSON, validated by the identity module
  created_at       TEXT NOT NULL,
  deleted_at       TEXT
);

CREATE TABLE consents (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id),
  kind        TEXT NOT NULL,                            -- terms | privacy | analytics
  version     TEXT NOT NULL,
  granted     INTEGER NOT NULL CHECK (granted IN (0, 1)),
  recorded_at TEXT NOT NULL
);
CREATE INDEX consents_account ON consents(account_id);

-- One row per device login. Access + refresh tokens are stored only as SHA-256 hashes.
CREATE TABLE auth_sessions (
  id                 TEXT PRIMARY KEY,
  account_id         TEXT NOT NULL REFERENCES accounts(id),
  family_id          TEXT NOT NULL,                     -- rotation chain; reuse revokes the family
  access_hash        TEXT NOT NULL UNIQUE,
  refresh_hash       TEXT NOT NULL UNIQUE,
  access_expires_at  TEXT NOT NULL,
  refresh_expires_at TEXT NOT NULL,
  device_label       TEXT,
  created_at         TEXT NOT NULL,
  revoked_at         TEXT
);
CREATE INDEX auth_sessions_account ON auth_sessions(account_id);

CREATE TABLE auth_tokens (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  purpose    TEXT NOT NULL CHECK (purpose IN ('password_reset', 'email_verify')),
  expires_at TEXT NOT NULL,
  used_at    TEXT
);

-- Public profile, kept apart from personally identifying account data.
CREATE TABLE wizards (
  id               TEXT PRIMARY KEY,
  account_id       TEXT NOT NULL UNIQUE REFERENCES accounts(id),
  name             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  starter_element  TEXT NOT NULL,
  mana_level       INTEGER NOT NULL DEFAULT 1 CHECK (mana_level >= 1),
  loadout_revision INTEGER NOT NULL DEFAULT 0,
  revision         INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL
);

CREATE TABLE rulesets (
  id         TEXT PRIMARY KEY,
  config     TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX rulesets_one_active ON rulesets(active) WHERE active = 1;

CREATE TABLE focus_sessions (
  id                       TEXT PRIMARY KEY,
  account_id               TEXT NOT NULL REFERENCES accounts(id),
  state                    TEXT NOT NULL CHECK (state IN ('CREATED', 'ACTIVE', 'COMPLETED', 'INTERRUPTED', 'INVALIDATED')),
  objective                TEXT,                         -- private; never logged or sent to analytics
  research_target_spell_id TEXT,
  ruleset_id               TEXT NOT NULL REFERENCES rulesets(id),
  started_at               TEXT NOT NULL,
  cap_at                   TEXT NOT NULL,                -- when this session must auto-close
  chain_offset_seconds     INTEGER NOT NULL DEFAULT 0,   -- continuous focus carried in from earlier sessions
  last_seen_at             TEXT NOT NULL,
  ended_at                 TEXT,
  end_reason               TEXT,                         -- finished | cap_reached | disconnected | invalidated
  validated_seconds        INTEGER,
  credited_minutes         INTEGER,                      -- minutes that counted toward rewards after the daily cap
  study_day                TEXT NOT NULL,
  break_until              TEXT,
  award                    TEXT,                         -- JSON breakdown, written once at settlement
  settled_at               TEXT
);
-- FOCUS-001: at most one running session per account, enforced by the database itself.
CREATE UNIQUE INDEX focus_one_active ON focus_sessions(account_id) WHERE state IN ('CREATED', 'ACTIVE');
CREATE INDEX focus_account_started ON focus_sessions(account_id, started_at);
CREATE INDEX focus_unsettled ON focus_sessions(state, settled_at);

CREATE TABLE focus_heartbeats (
  session_id         TEXT NOT NULL REFERENCES focus_sessions(id),
  sequence           INTEGER NOT NULL,
  device_id          TEXT,
  server_received_at TEXT NOT NULL,
  PRIMARY KEY (session_id, sequence)
);

-- Append-only ledger (ECON-001). Rows are never updated or deleted.
CREATE TABLE reward_ledger (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES accounts(id),
  currency        TEXT NOT NULL CHECK (currency IN ('RESEARCH_POINTS', 'COMBAT_XP')),
  delta           INTEGER NOT NULL CHECK (delta <> 0),
  balance_after   INTEGER NOT NULL CHECK (balance_after >= 0),
  reason          TEXT NOT NULL,
  source_id       TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  ruleset_id      TEXT,
  study_day       TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX ledger_account_created ON reward_ledger(account_id, created_at);
CREATE INDEX ledger_account_day ON reward_ledger(account_id, currency, study_day);

-- Balance projection, updated in the same transaction as each ledger row.
CREATE TABLE balances (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  currency   TEXT NOT NULL,
  amount     INTEGER NOT NULL CHECK (amount >= 0),     -- ECON-002: negative balances are impossible
  PRIMARY KEY (account_id, currency)
);

CREATE TABLE wizard_spells (
  wizard_id         TEXT NOT NULL REFERENCES wizards(id),
  spell_id          TEXT NOT NULL,
  level             INTEGER NOT NULL DEFAULT 0 CHECK (level >= 0),
  research_progress INTEGER NOT NULL DEFAULT 0 CHECK (research_progress >= 0),
  unlocked_at       TEXT,
  updated_at        TEXT NOT NULL,
  PRIMARY KEY (wizard_id, spell_id)
);

CREATE TABLE research_milestones (
  id           TEXT PRIMARY KEY,
  wizard_id    TEXT NOT NULL REFERENCES wizards(id),
  spell_id     TEXT NOT NULL,
  target_level INTEGER NOT NULL,
  session_id   TEXT NOT NULL UNIQUE REFERENCES focus_sessions(id),  -- a session satisfies one milestone at most
  consumed_at  TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX milestones_wizard_spell ON research_milestones(wizard_id, spell_id, target_level);

CREATE TABLE loadouts (
  wizard_id TEXT NOT NULL REFERENCES wizards(id),
  slot      INTEGER NOT NULL,
  spell_id  TEXT NOT NULL,
  PRIMARY KEY (wizard_id, slot),
  UNIQUE (wizard_id, spell_id)
);

CREATE TABLE matches (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES accounts(id),
  encounter_id    TEXT NOT NULL,
  mode            TEXT NOT NULL DEFAULT 'pve',
  content_version TEXT NOT NULL,
  ruleset_id      TEXT NOT NULL,
  seed            TEXT NOT NULL,
  state           TEXT NOT NULL CHECK (state IN ('CREATED', 'IN_PROGRESS', 'SETTLING', 'FINISHED', 'ABORTED')),
  turn_version    INTEGER NOT NULL DEFAULT 0,
  snapshot        TEXT NOT NULL,                        -- immutable copy of stats/spells/enemy (COMBAT-001)
  battle_state    TEXT NOT NULL,
  winner          TEXT,
  reward          TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  settled_at      TEXT
);
CREATE INDEX matches_account ON matches(account_id, created_at);
CREATE UNIQUE INDEX matches_one_open ON matches(account_id) WHERE state IN ('CREATED', 'IN_PROGRESS');

CREATE TABLE combat_actions (
  match_id     TEXT NOT NULL REFERENCES matches(id),
  turn_version INTEGER NOT NULL,
  spell_id     TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (match_id, turn_version)
);

CREATE TABLE combat_events (
  match_id TEXT NOT NULL REFERENCES matches(id),
  sequence INTEGER NOT NULL,
  turn     INTEGER NOT NULL,
  actor    TEXT NOT NULL,
  kind     TEXT NOT NULL,
  payload  TEXT NOT NULL,
  PRIMARY KEY (match_id, sequence)
);

CREATE TABLE idempotency_requests (
  account_id   TEXT NOT NULL,
  key          TEXT NOT NULL,
  route        TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code  INTEGER NOT NULL,
  response     TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (account_id, key)
);

CREATE TABLE audit_events (
  id         TEXT PRIMARY KEY,
  actor_id   TEXT,
  action     TEXT NOT NULL,
  target     TEXT,
  details    TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL
);

-- Opt-in, pseudonymous product analytics (§13). No study content, no raw account IDs.
CREATE TABLE analytics_events (
  event_id       TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  occurred_at    TEXT NOT NULL,
  user_pseudonym TEXT NOT NULL,
  app_version    TEXT NOT NULL,
  ruleset_id     TEXT,
  properties     TEXT NOT NULL
);
`,
  },
];
