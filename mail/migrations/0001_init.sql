-- Ocean Live Mail: mailboxes, messages, attachments, sessions, counters.

CREATE TABLE mailboxes (
  address      TEXT PRIMARY KEY,          -- lowercase, e.g. justice@oceanlive.org
  display_name TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL
);

CREATE TABLE messages (
  id              TEXT PRIMARY KEY,        -- time-sortable id; R2 keys live under m/<id>/
  mailbox         TEXT NOT NULL,
  folder          TEXT NOT NULL,           -- inbox | sent | trash
  prev_folder     TEXT,                    -- where a trashed message came from
  trashed_at      INTEGER,
  message_id      TEXT,                    -- the Message-ID header
  in_reply_to     TEXT,
  refs            TEXT,
  provider_id     TEXT,                    -- Resend email id, for sent mail
  from_addr       TEXT NOT NULL DEFAULT '',
  from_name       TEXT NOT NULL DEFAULT '',
  reply_to        TEXT NOT NULL DEFAULT '',
  to_json         TEXT NOT NULL DEFAULT '[]',
  cc_json         TEXT NOT NULL DEFAULT '[]',
  subject         TEXT NOT NULL DEFAULT '',
  snippet         TEXT NOT NULL DEFAULT '',
  date            INTEGER NOT NULL,        -- the Date header (ms)
  created_at      INTEGER NOT NULL,        -- when it arrived or was sent (ms)
  seen            INTEGER NOT NULL DEFAULT 0,
  has_html        INTEGER NOT NULL DEFAULT 0,
  has_text        INTEGER NOT NULL DEFAULT 0,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  size            INTEGER NOT NULL DEFAULT 0,
  auth_warning    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX messages_by_folder ON messages (mailbox, folder, created_at DESC);
CREATE INDEX messages_by_message_id ON messages (mailbox, message_id);

CREATE TABLE attachments (
  id           TEXT PRIMARY KEY,
  message      TEXT NOT NULL,              -- messages.id
  idx          INTEGER NOT NULL,
  filename     TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size         INTEGER NOT NULL DEFAULT 0,
  content_id   TEXT NOT NULL DEFAULT '',   -- without < >
  inline       INTEGER NOT NULL DEFAULT 0,
  r2_key       TEXT NOT NULL
);
CREATE INDEX attachments_by_message ON attachments (message, idx);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,             -- SHA-256 of the cookie value
  mailbox    TEXT NOT NULL,
  csrf       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE counters (
  key      TEXT PRIMARY KEY,
  count    INTEGER NOT NULL,
  reset_at INTEGER NOT NULL                -- ms
);

INSERT INTO mailboxes (address, display_name, created_at) VALUES
  ('justice@oceanlive.org', 'Justice', unixepoch() * 1000),
  ('support@oceanlive.org', 'Ocean Live Support', unixepoch() * 1000);
