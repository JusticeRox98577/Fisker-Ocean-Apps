-- SuperNova boxes (Oceanlive-nova docs/nrf.md): check-ins from the nRF9151, phones paired in the car,
-- and signed remote commands waiting for the car.
CREATE TABLE boxes (
  uid TEXT PRIMARY KEY,            -- the nRF9151's device ID (24 hex digits)
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  fw INTEGER NOT NULL DEFAULT 0,
  lat REAL, lon REAL, fix INTEGER NOT NULL DEFAULT 0,
  rsrp INTEGER NOT NULL DEFAULT 0,
  gear INTEGER NOT NULL DEFAULT 0, speed INTEGER NOT NULL DEFAULT 0, ignition INTEGER NOT NULL DEFAULT 0,
  v12 INTEGER NOT NULL DEFAULT 0,
  phones INTEGER NOT NULL DEFAULT 0,
  counter INTEGER NOT NULL DEFAULT 0, -- last remote-command counter the car used
  last_cmd_action INTEGER NOT NULL DEFAULT 0, last_cmd_result INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE box_telemetry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL, at INTEGER NOT NULL,
  lat REAL, lon REAL, v12 INTEGER, gear INTEGER, speed INTEGER, ignition INTEGER, rsrp INTEGER
);
CREATE INDEX box_telemetry_uid ON box_telemetry (uid, at);

-- pairing codes shown on the car screen; a phone answers with its key; the owner approves in the car
CREATE TABLE pairings (
  code TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting', -- waiting, requested, paired, refused
  phone_pub TEXT, phone_name TEXT,
  slot INTEGER
);

CREATE TABLE phones (
  uid TEXT NOT NULL, slot INTEGER NOT NULL,
  pub TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', paired_at INTEGER NOT NULL,
  PRIMARY KEY (uid, slot)
);

CREATE TABLE commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL,
  cmd TEXT NOT NULL,               -- the signed 104-byte command (hex), exactly as the phone made it
  action INTEGER NOT NULL, counter INTEGER NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, -- ms
  result INTEGER                   -- reported by the car (enum nl_tx_result, or 0x80 | novacmd error)
);
CREATE INDEX commands_uid ON commands (uid, expires_at);
