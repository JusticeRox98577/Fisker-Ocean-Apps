-- Nova releases (Oceanlive-nova docs/updates.md): what boxes update to. Files live in R2 (RELEASES).
CREATE TABLE releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target TEXT NOT NULL,             -- supervisor, card, app, android
  version INTEGER NOT NULL,         -- firmware: major << 24 | minor << 16 | patch; app: versionCode; android: build time (s)
  label TEXT NOT NULL DEFAULT '',   -- shown to people, e.g. "0.3.0"
  channel TEXT NOT NULL DEFAULT 'stable', -- stable, beta
  r2_key TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL DEFAULT '',  -- of the whole file ('' for Android OTA: update_engine checks its own hashes)
  payload_offset INTEGER,           -- android: where payload.bin starts in the OTA zip
  payload_size INTEGER,
  payload_props TEXT,               -- android: payload_properties.txt (headers for update_engine)
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  retired INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX releases_target ON releases (target, retired, version);
