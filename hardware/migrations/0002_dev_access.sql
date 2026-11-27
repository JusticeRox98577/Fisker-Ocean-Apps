-- Developer access to Nova boxes (Oceanlive-nova docs/updates.md): the certificates issued, and what
-- the boxes running them report.
CREATE TABLE dev_certs (
  serial INTEGER PRIMARY KEY,       -- the certificate serial, chosen by the owner
  uid TEXT NOT NULL,                -- the box's STM32 unique ID (24 hex digits)
  holder TEXT NOT NULL,
  dev_pub TEXT NOT NULL,            -- the developer's public key (hex)
  targets INTEGER NOT NULL,         -- bit 1 supervisor, bit 2 video card
  lease INTEGER NOT NULL,           -- starts allowed per renewal (0 = no lease)
  cert TEXT NOT NULL,               -- the certificate itself (hex), as signed by the owner key
  status TEXT NOT NULL DEFAULT 'active', -- active, revoked
  notes TEXT NOT NULL DEFAULT '',
  registered_at INTEGER NOT NULL,
  revoked_at INTEGER,
  revoke_reason TEXT NOT NULL DEFAULT ''
);

-- One row per check-in from a box that runs (or holds) a developer certificate.
CREATE TABLE dev_checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serial INTEGER NOT NULL,          -- certificate serial reported by the bootloader (0 = none)
  uid TEXT NOT NULL,
  at INTEGER NOT NULL,              -- server time, ms
  signer INTEGER NOT NULL,          -- running image: 0 owner firmware, 1 developer firmware
  fw_version INTEGER NOT NULL,      -- running image version (major << 24 | minor << 16 | patch)
  dev_starts INTEGER NOT NULL,      -- developer-firmware starts counted by the bootloader
  lease_until INTEGER NOT NULL,
  start_check INTEGER NOT NULL,     -- the bootloader's verdict (0 = may start)
  app_version TEXT NOT NULL DEFAULT '',
  android TEXT NOT NULL DEFAULT '',
  uptime_s INTEGER NOT NULL DEFAULT 0,
  power_state INTEGER NOT NULL DEFAULT 0,
  nova_on_screen INTEGER NOT NULL DEFAULT 0,
  token TEXT NOT NULL DEFAULT ''    -- what was sent back: '', renew, revoke
);
CREATE INDEX dev_checkins_serial ON dev_checkins (serial, at);
