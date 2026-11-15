-- One row per check. Kept 48 hours.
CREATE TABLE checks (
  at INTEGER NOT NULL,          -- when the run started (ms since 1970, UTC)
  service TEXT NOT NULL,        -- site, api, mail
  ok INTEGER NOT NULL,          -- 1 up, 0 down
  status INTEGER,               -- HTTP status, NULL when there was no answer
  latency_ms INTEGER NOT NULL,
  error TEXT,                   -- short reason when down
  PRIMARY KEY (at, service)
) WITHOUT ROWID;

-- Checks per service per hour. Kept 48 hours.
CREATE TABLE hourly (
  hour INTEGER NOT NULL,        -- start of the hour (ms since 1970, UTC)
  service TEXT NOT NULL,
  total INTEGER NOT NULL,
  up INTEGER NOT NULL,
  PRIMARY KEY (hour, service)
) WITHOUT ROWID;

-- Checks per service per UTC day. Kept 90 days.
CREATE TABLE daily (
  day TEXT NOT NULL,            -- YYYY-MM-DD
  service TEXT NOT NULL,
  total INTEGER NOT NULL,
  up INTEGER NOT NULL,
  latency_sum INTEGER NOT NULL, -- of the checks that were up
  PRIMARY KEY (day, service)
) WITHOUT ROWID;
