-- One row per email address. Signing up again with the same address replaces the earlier answer
-- (but keeps whether the person was picked as a tester).
CREATE TABLE responses (
  email TEXT PRIMARY KEY,         -- lower-cased
  name TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  car TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '', -- iphone, android, both
  products TEXT NOT NULL DEFAULT '[]', -- JSON array of product ids the person is interested in
  features TEXT NOT NULL DEFAULT '[]', -- JSON array of up to 5 feature ids, most important first
  other_feature TEXT NOT NULL DEFAULT '',
  install TEXT NOT NULL DEFAULT '',    -- yes, help, no
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,    -- first sign-up (ms since 1970, UTC)
  updated_at INTEGER NOT NULL,    -- latest answer
  -- Picking testers: '' not picked, invited (emailed, no answer yet), accepted, declined.
  pick TEXT NOT NULL DEFAULT '',
  pick_token_hash TEXT,           -- SHA-256 of the link in the invitation email
  picked_at INTEGER,
  answered_at INTEGER
);
CREATE UNIQUE INDEX responses_pick_token ON responses (pick_token_hash) WHERE pick_token_hash IS NOT NULL;

-- Admin sign-in: one-time links emailed to ADMIN_EMAIL, and the sessions they start. Only hashes are kept.
CREATE TABLE login_links (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;

-- Fixed-window counters for rate limits. Rows expire on their own (reset_at).
CREATE TABLE counters (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
) WITHOUT ROWID;
