-- Only the car screen that started a pairing can see the phone's request and approve it: pair/start
-- hands it a secret (kept here as a SHA-256), and pair/poll and pair/finish need it.
ALTER TABLE pairings ADD COLUMN secret_hash TEXT;
