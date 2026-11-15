-- Ocean Live news: a double opt-in mailing list (sign-up on oceanlive.org, sending from the webmail).

CREATE TABLE list_subscribers (
  id              TEXT PRIMARY KEY,          -- time-sortable id (newId)
  email           TEXT NOT NULL UNIQUE,      -- trimmed, lowercase
  lang            TEXT NOT NULL DEFAULT 'en',-- en | de | fr | es | nl
  status          TEXT NOT NULL CHECK (status IN ('pending', 'confirmed')),
  source          TEXT NOT NULL DEFAULT 'site',
  consent         TEXT NOT NULL,             -- version of the consent wording shown, e.g. site-v1
  confirm_hash    TEXT,                      -- SHA-256 hex of the confirm token; NULL once confirmed
  confirm_expires INTEGER,
  confirm_sent_at INTEGER,
  confirm_sends   INTEGER NOT NULL DEFAULT 0,
  unsub_token     TEXT NOT NULL UNIQUE,      -- random, base64url, in every email's unsubscribe link
  created_at      INTEGER NOT NULL,
  confirmed_at    INTEGER
);
CREATE INDEX list_subscribers_by_status ON list_subscribers (status, id);
CREATE INDEX list_subscribers_by_confirm ON list_subscribers (confirm_hash);

CREATE TABLE list_campaigns (
  id         TEXT PRIMARY KEY,
  subject    TEXT NOT NULL,
  body_text  TEXT NOT NULL,
  created_by TEXT NOT NULL,                  -- the mailbox that sent it
  created_at INTEGER NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('sending', 'done')),
  total      INTEGER NOT NULL DEFAULT 0,     -- the counts live here so deleting a subscriber keeps the stats
  sent       INTEGER NOT NULL DEFAULT 0,
  failed     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE list_deliveries (
  campaign_id   TEXT NOT NULL,
  subscriber_id TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'failed')),
  resend_id     TEXT,
  error         TEXT,
  sent_at       INTEGER,
  PRIMARY KEY (campaign_id, subscriber_id)
);
CREATE INDEX list_deliveries_by_status ON list_deliveries (campaign_id, status, subscriber_id);
CREATE INDEX list_deliveries_by_subscriber ON list_deliveries (subscriber_id);
