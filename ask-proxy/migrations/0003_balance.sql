-- Account balance (US cents), its ledger and badges. Kept until the account is deleted.
CREATE TABLE IF NOT EXISTS balances (
  account_id TEXT PRIMARY KEY,
  cents INTEGER NOT NULL DEFAULT 0 CHECK (cents >= 0),
  updated TEXT
);

-- Every credit and spend. `ref` makes each one happen once: play:<sha256 of the purchase token>,
-- apple:<sha256 of the App Store app transaction ID>, question:<questions.id>.
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  delta_cents INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('reward', 'question', 'addon', 'adjust')),
  ref TEXT UNIQUE,
  note TEXT,
  created TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_account ON ledger (account_id);
-- One store reward per account.
CREATE UNIQUE INDEX IF NOT EXISTS ledger_one_reward ON ledger (account_id) WHERE kind = 'reward';

-- Badge ids: early_supporter.
CREATE TABLE IF NOT EXISTS badges (
  account_id TEXT NOT NULL,
  badge TEXT NOT NULL,
  created TEXT NOT NULL,
  PRIMARY KEY (account_id, badge)
);

-- Store rewards already claimed (hashed references only, no account). Stays when an account is deleted,
-- so one store purchase gives one reward, ever.
CREATE TABLE IF NOT EXISTS claimed_rewards (
  ref TEXT PRIMARY KEY,
  created TEXT NOT NULL
);
