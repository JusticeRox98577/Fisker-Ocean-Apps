-- The admin page at admin.oceanlive.org. Admins sign in with Google only and are not app accounts.
-- Owners are the addresses in the secret ADMIN_EMAILS (never stored here); owners can add more admins.
CREATE TABLE IF NOT EXISTS admins (
  email TEXT PRIMARY KEY,      -- the admin's Google address, lower case
  added_by TEXT NOT NULL,      -- the owner who added it
  created TEXT NOT NULL
);

-- Admin sign-ins. Only a SHA-256 hash of each token is stored; a session lasts 12 hours.
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created TEXT NOT NULL,
  expires TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_sessions_email ON admin_sessions (email);

-- What admins did: sign-ins, balance and badge changes, admins added or removed.
-- Rows about an account (account_id) are deleted with that account.
CREATE TABLE IF NOT EXISTS admin_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,         -- the admin
  action TEXT NOT NULL,        -- signin, balance, badge, admin_add, admin_remove
  detail TEXT,                 -- JSON
  account_id TEXT,             -- the account changed, if any
  created TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_log_account ON admin_log (account_id);
CREATE INDEX IF NOT EXISTS admin_log_created ON admin_log (created);
