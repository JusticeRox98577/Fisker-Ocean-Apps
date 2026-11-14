-- Research log of "Any questions?". Entries older than LOG_RETENTION_DAYS (90) are deleted daily.
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,            -- ISO 8601 UTC
  device TEXT NOT NULL,        -- random install ID made by the app
  lang TEXT,                   -- phone language (Accept-Language)
  question TEXT NOT NULL,      -- the latest question
  history TEXT NOT NULL,       -- earlier messages of the chat, JSON [{role, text}]
  car TEXT,                    -- readings and fault codes sent with the question, if any
  answer TEXT,                 -- null when Claude declined
  cost_micros INTEGER NOT NULL,-- US dollars x 1,000,000
  model TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS questions_ts ON questions (ts);
CREATE INDEX IF NOT EXISTS questions_device ON questions (device);
