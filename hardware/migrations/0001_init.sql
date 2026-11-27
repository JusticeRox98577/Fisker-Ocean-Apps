-- One row per email address. Signing up again with the same address replaces the earlier answer.
CREATE TABLE responses (
  email TEXT PRIMARY KEY,         -- lower-cased
  name TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  car TEXT NOT NULL DEFAULT '',   -- trim / model year, as typed or picked
  phone TEXT NOT NULL DEFAULT '', -- iphone, android, both, none
  products TEXT NOT NULL DEFAULT '[]', -- JSON array of product ids the person is interested in
  features TEXT NOT NULL DEFAULT '[]', -- JSON array of up to 5 feature ids, most important first
  other_feature TEXT NOT NULL DEFAULT '',
  install TEXT NOT NULL DEFAULT '',    -- comfortable installing it themselves: yes, help, no
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,    -- first sign-up (ms since 1970, UTC)
  updated_at INTEGER NOT NULL     -- latest answer
);

-- Fixed-window counters for the per-network limit. Rows expire on their own (reset_at).
CREATE TABLE counters (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
) WITHOUT ROWID;
