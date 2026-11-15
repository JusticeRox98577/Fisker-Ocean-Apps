-- The public roadmap (see src/roadmap.ts). Admins write the items on admin.oceanlive.org; anyone can read
-- them with their vote counts (GET /roadmap, also shown on oceanlive.org/roadmap); signed-in Ocean Live
-- accounts vote on account.oceanlive.org/roadmap, one vote per account per item.

-- Roadmap items. They hold no personal data: created_by is the admin's Google address and is never
-- shown publicly. feedback_id is the feedback row an admin promoted it from (cleared when that feedback
-- is deleted with its account).
CREATE TABLE IF NOT EXISTS roadmap_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,           -- 3 to 120 characters
  description TEXT NOT NULL DEFAULT '',  -- at most 600 characters
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'done')),
  position INTEGER NOT NULL DEFAULT 0,   -- order on the page, smallest first
  created TEXT NOT NULL,
  created_by TEXT NOT NULL,      -- the admin's Google address
  updated TEXT NOT NULL,
  feedback_id INTEGER            -- feedback.id it was promoted from, if any
);
CREATE INDEX IF NOT EXISTS roadmap_items_order ON roadmap_items (position, id);

-- Votes: one per account per item. Never shown with who voted; deleted with the account or the item.
CREATE TABLE IF NOT EXISTS roadmap_votes (
  item_id INTEGER NOT NULL,
  account_id TEXT NOT NULL,
  created TEXT NOT NULL,
  PRIMARY KEY (item_id, account_id)
);
CREATE INDEX IF NOT EXISTS roadmap_votes_account ON roadmap_votes (account_id);

-- Admin actions are written to admin_log: roadmap_create, roadmap_edit, roadmap_order, roadmap_delete,
-- roadmap_promote.
