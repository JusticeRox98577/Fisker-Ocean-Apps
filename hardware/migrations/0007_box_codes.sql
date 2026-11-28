-- Nova Light boxes have no screen to pair a phone on: a code printed inside the box does it
-- (Oceanlive-nova docs/nrf.md). Made in /admin for the board's device ID; only its hash is kept.
CREATE TABLE box_codes (
  uid TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
