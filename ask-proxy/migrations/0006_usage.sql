-- The Usage tab of the admin page (admin.oceanlive.org): reports can be resolved, and the usage numbers
-- read through indexes over bounded date ranges.

-- When and by which admin (their Google address) a report was dealt with. NULL: still open.
ALTER TABLE reports ADD COLUMN resolved_at TEXT;
ALTER TABLE reports ADD COLUMN resolved_by TEXT;
CREATE INDEX IF NOT EXISTS reports_open ON reports (resolved_at);
-- Resolving is written to admin_log as action 'report_resolve' (detail: the report and question IDs).

-- Paid questions (kind 'question') today / this month.
CREATE INDEX IF NOT EXISTS ledger_kind_created ON ledger (kind, created);
-- New accounts in the last 7 days.
CREATE INDEX IF NOT EXISTS accounts_created ON accounts (created);
-- questions.ts already has an index (questions_ts, 0001).
