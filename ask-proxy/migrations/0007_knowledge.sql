-- "Any questions?" learns from owners, with admin approval (see src/knowledge.ts).
-- Owners can offer fault code meanings, fixes and tips, and car facts in the chat; Claude passes them on
-- with the suggest_knowledge tool. Nothing reaches answers until an admin approves it on admin.oceanlive.org.
-- App feedback never becomes knowledge: it goes to the feedback table for admins.

-- What owners offered. Only approved suggestions turn into knowledge_items; pending and rejected ones are
-- never shown to the model. account_id is set for signed-in owners, device (the install ID) only for
-- questions asked without an account. Both and question_id are cleared when a suggestion is approved.
-- Deleting the account deletes its pending and rejected suggestions.
CREATE TABLE IF NOT EXISTS knowledge_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('fault_code', 'fix_tip', 'car_fact')),
  summary TEXT NOT NULL,       -- at most 200 characters
  details TEXT,                -- at most 2000 characters
  code TEXT,                   -- a fault code (fault_code only)
  question_id INTEGER,         -- the logged question it came from (questions.id), if logged
  account_id TEXT,
  device TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created TEXT NOT NULL,
  reviewed_by TEXT,            -- the admin's Google address
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS knowledge_suggestions_status ON knowledge_suggestions (status, id);
CREATE INDEX IF NOT EXISTS knowledge_suggestions_account ON knowledge_suggestions (account_id);

-- Approved notes, as edited by the admin. They hold no account, install or question link, so they stay
-- when the owner who offered them deletes their account. Non-retired items go into every answer's prompt.
CREATE TABLE IF NOT EXISTS knowledge_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('fault_code', 'fix_tip', 'car_fact')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  code TEXT,
  created TEXT NOT NULL,
  approved_by TEXT NOT NULL,   -- the admin's Google address
  updated TEXT,
  retired INTEGER NOT NULL DEFAULT 0 CHECK (retired IN (0, 1)),
  suggestion_id INTEGER        -- knowledge_suggestions.id
);
CREATE INDEX IF NOT EXISTS knowledge_items_live ON knowledge_items (retired, id);

-- App feedback sent through the chat. Deleted with the account.
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  summary TEXT NOT NULL,
  details TEXT,
  question_id INTEGER,
  account_id TEXT,
  device TEXT,
  created TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  handled_by TEXT,             -- the admin's Google address
  handled_at TEXT
);
CREATE INDEX IF NOT EXISTS feedback_status ON feedback (status, id);
CREATE INDEX IF NOT EXISTS feedback_account ON feedback (account_id);

-- Admin actions are written to admin_log: knowledge_approve, knowledge_reject, knowledge_edit,
-- knowledge_retire, knowledge_restore, feedback_done.
