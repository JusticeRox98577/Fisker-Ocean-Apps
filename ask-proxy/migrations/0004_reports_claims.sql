-- Reports of "Any questions?" answers, sent from the apps ("Report this answer").
-- A report belongs to its question: it is deleted with the question (90-day log cleanup) and with the
-- account. The reporter is the signed-in account, or the install ID for apps without an account.
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL,  -- questions.id
  account_id TEXT,               -- reporter when signed in
  device TEXT,                   -- reporter's install ID when not signed in
  reason TEXT NOT NULL CHECK (reason IN ('offensive', 'harmful', 'wrong', 'other')),
  note TEXT,                     -- optional, at most 500 characters
  created TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reports_question ON reports (question_id);
CREATE INDEX IF NOT EXISTS reports_created ON reports (created);
-- One report per question and reporter: sending it again changes nothing.
CREATE UNIQUE INDEX IF NOT EXISTS reports_once ON reports (question_id, IFNULL(account_id, ''), IFNULL(device, ''));

-- Store rewards already claimed: the hashed store reference only (play:<sha256>, apple:<sha256>), with no
-- link to an account. Kept when an account is deleted, so one store purchase gives one reward, ever.
CREATE TABLE IF NOT EXISTS reward_claims (
  ref TEXT PRIMARY KEY,
  claimed TEXT NOT NULL
);
-- Backfill: every store reference already in the ledger (rewards, and purchases recorded against an
-- account that already had its reward), and the earlier table this one replaces.
INSERT OR IGNORE INTO reward_claims (ref, claimed)
  SELECT ref, created FROM ledger WHERE ref LIKE 'play:%' OR ref LIKE 'apple:%';
INSERT OR IGNORE INTO reward_claims (ref, claimed) SELECT ref, created FROM claimed_rewards;
DROP TABLE IF EXISTS claimed_rewards;
