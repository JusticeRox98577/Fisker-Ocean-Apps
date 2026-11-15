-- Addresses that must never get a tester invitation for the mailing list: one row per address ever invited,
-- and per address that unsubscribed, was removed, or let a sign-up lapse. So an invitation is sent once at most,
-- and never to someone who left or chose not to confirm.
-- Only a SHA-256 of the lowercase address is kept, with no end date. It is not readable, but it still identifies
-- the person (anyone holding a candidate address can check it), so it is personal data; PRIVACY.md covers it.

CREATE TABLE list_invites (
  email_hash TEXT PRIMARY KEY,               -- sha256hex("invite:" + lowercase email)
  invited_at INTEGER NOT NULL                -- when it was added (invited, unsubscribed, removed or lapsed)
);
