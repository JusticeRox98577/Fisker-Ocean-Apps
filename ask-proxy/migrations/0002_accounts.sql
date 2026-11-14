-- Ocean Live accounts. Sign-in is with Apple, Google or an email code; there are no passwords.
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,         -- random UUID
  email TEXT,                  -- verified email (or Apple's private relay address), lower case
  name TEXT,                   -- display name, editable by the owner
  created TEXT NOT NULL,
  last_seen TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS accounts_email ON accounts (email);

-- One row per sign-in method linked to an account.
CREATE TABLE IF NOT EXISTS identities (
  provider TEXT NOT NULL,      -- apple, google or email
  subject TEXT NOT NULL,       -- the provider's stable user ID (the address for email)
  account_id TEXT NOT NULL,
  created TEXT NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX IF NOT EXISTS identities_account ON identities (account_id);

-- Only a SHA-256 hash of each session token is stored.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  created TEXT NOT NULL,
  last_used TEXT NOT NULL,
  expires TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_account ON sessions (account_id);

-- Pending 6-digit email codes (hashed), valid 10 minutes, 5 tries.
CREATE TABLE IF NOT EXISTS email_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires TEXT NOT NULL,
  attempts INTEGER NOT NULL
);

-- Logged questions belong to an account once the owner signs in.
ALTER TABLE questions ADD COLUMN account_id TEXT;
CREATE INDEX IF NOT EXISTS questions_account ON questions (account_id);
