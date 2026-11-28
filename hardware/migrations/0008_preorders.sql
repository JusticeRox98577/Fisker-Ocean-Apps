-- Pre-orders (src/preorders.ts). A reservation costs nothing. It counts once the person confirms it from
-- the email; when a product reaches its goal, the admin asks those people for a refundable deposit.
CREATE TABLE preorders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product TEXT NOT NULL,               -- light, supernova
  email TEXT NOT NULL,                 -- lower-cased
  name TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  car TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  -- unconfirmed (email not clicked yet), confirmed, deposit_requested, deposit_paid, cancelled
  status TEXT NOT NULL DEFAULT 'unconfirmed',
  token_hash TEXT,                     -- SHA-256 of the link in the emails (confirm, then manage)
  price_cents INTEGER NOT NULL,        -- the price when they reserved: theirs to keep
  deposit_cents INTEGER NOT NULL,
  created_at INTEGER NOT NULL,         -- ms since 1970, UTC
  confirmed_at INTEGER,
  deposit_requested_at INTEGER,
  paid_at INTEGER,
  cancelled_at INTEGER
);
CREATE UNIQUE INDEX preorders_email_product ON preorders (email, product);
CREATE UNIQUE INDEX preorders_token ON preorders (token_hash) WHERE token_hash IS NOT NULL;
CREATE INDEX preorders_product_status ON preorders (product, status);
