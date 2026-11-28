-- Beta testers sign the same first-generation disclosure as pre-orders before saying yes (src/testers.ts):
-- typed full name, the drawn signature (PNG), when, and which version (DISCLOSURE_VERSION).
ALTER TABLE responses ADD COLUMN sig_name TEXT NOT NULL DEFAULT '';
ALTER TABLE responses ADD COLUMN sig_png BLOB;
ALTER TABLE responses ADD COLUMN sig_at INTEGER;
ALTER TABLE responses ADD COLUMN sig_version TEXT NOT NULL DEFAULT '';
