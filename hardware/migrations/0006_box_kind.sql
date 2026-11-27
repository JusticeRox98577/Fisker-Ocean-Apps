-- Nova Light boards check in too (Oceanlive-nova docs/nrf.md, "Light build"): which kind of box,
-- its car state (0 boot, 1 parked, 2 awake, 3 self-protect), data used this month and open 12 V alerts.
ALTER TABLE boxes ADD COLUMN kind TEXT NOT NULL DEFAULT 'supernova';
ALTER TABLE boxes ADD COLUMN state INTEGER NOT NULL DEFAULT 0;
ALTER TABLE boxes ADD COLUMN budget_kb INTEGER NOT NULL DEFAULT 0;
ALTER TABLE boxes ADD COLUMN alerts INTEGER NOT NULL DEFAULT 0;
-- a Light's stored 12 V readings arrive in batches and may be sent twice: one row per box and time
CREATE UNIQUE INDEX IF NOT EXISTS box_telemetry_uid_at ON box_telemetry (uid, at);
