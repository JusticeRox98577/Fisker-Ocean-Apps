-- Flare and Quasar need a Nova Light: reserving one also reserves a Light at the bundle price
-- (src/preorders.ts). On a Flare/Quasar row: 'light' (a Light was reserved with it) or 'has-light'
-- (they already have one). On a Light row: the product it was reserved with, '' when on its own.
ALTER TABLE preorders ADD COLUMN bundle TEXT NOT NULL DEFAULT '';

-- The first-generation disclosure each person signs before reserving: typed full name, the drawn
-- signature (PNG), when, and which version of the disclosure (DISCLOSURE_VERSION in src/preorders.ts).
ALTER TABLE preorders ADD COLUMN sig_name TEXT NOT NULL DEFAULT '';
ALTER TABLE preorders ADD COLUMN sig_png BLOB;
ALTER TABLE preorders ADD COLUMN sig_at INTEGER;
ALTER TABLE preorders ADD COLUMN sig_version TEXT NOT NULL DEFAULT '';
-- The second payment: the rest of the price, asked for right before the parts are ordered.
ALTER TABLE preorders ADD COLUMN balance_requested_at INTEGER;
ALTER TABLE preorders ADD COLUMN balance_paid_at INTEGER;

-- Build batches: a batch gets its number when the rest of the price is asked for (right before the
-- parts are ordered). Its build steps (BUILD_STEPS in src/preorders.ts) are ticked off in /admin and
-- shown on the build trackers and each order's status page.
ALTER TABLE preorders ADD COLUMN batch INTEGER;
CREATE TABLE build_steps (
  product TEXT NOT NULL,
  batch INTEGER NOT NULL,
  step TEXT NOT NULL,
  done_at INTEGER NOT NULL,
  PRIMARY KEY (product, batch, step)
) WITHOUT ROWID;
