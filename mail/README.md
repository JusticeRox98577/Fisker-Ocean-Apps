# Ocean Live Mail

Private webmail for the `@oceanlive.org` mailboxes, and the sender of the Ocean Live news mailing
list. It is a Cloudflare Worker with a small web app; only the people who run Ocean Live can sign
in.

## What it does

- **Receives mail** for oceanlive.org. Mail for a known mailbox is parsed
  ([postal-mime](https://github.com/postalsys/postal-mime)) and stored; mail for any other address
  is rejected. `+tags` work: `name+tag@oceanlive.org` lands in `name@`.
- **Sends mail** through the [Resend](https://resend.com) API, always from the signed-in mailbox,
  with a copy kept in Sent.
- **Web app** (`public/`, plain HTML, CSS and JS in the oceanlive.org look): Inbox, Sent, Trash,
  search, unread filter, reply, reply all, forward, attachments, download the original `.eml`, add
  mailboxes and set the name people see.
- **Mailing list** (Ocean Live news: new releases and important fixes, a few emails a year).
  People sign up on oceanlive.org and must confirm by email before they are added (double opt-in).
  Every news email says why it was sent and has an unsubscribe link plus a one-click unsubscribe
  header (RFC 8058); unsubscribing deletes the address. App testers may get one email asking if
  they want the news, and are added only if they click its link.
- **Sending for other Workers:** the `Notify` entry point (`src/notify.ts`), reached only over a service
  binding, sends one email from a mailbox here through the same path as webmail (same limits, copy in
  Sent). The hardware beta (`hardware/`) uses it for sign-in links and tester invitations.
- **Health check:** `GET /api/health` answers `{ "ok": true, "service": "mail" }` for the status page.

## Privacy and security

- Each mailbox is separate: every request is limited to the signed-in mailbox.
- Sessions use an `HttpOnly`, `Secure`, `SameSite=Strict` cookie, and every change also needs a
  CSRF token from this origin. Only hashes of session and confirmation tokens are stored.
- Mail HTML is sanitized and shown in a sandboxed frame with no scripts; pictures from the internet
  stay blocked until you choose to show them. Attachments always download instead of opening.
- Only signed-in mailboxes can send, only as themselves, within sending limits (no open relay).
- Mailing-list confirmation and unsubscribe tokens travel in the link's `#fragment`, so they don't
  reach server logs. Sign-up answers are the same for every address, so the list can't be probed.
  Testers get at most one invitation, and never after leaving the list: for everyone invited,
  unsubscribed, removed or with a lapsed sign-up, only a hash of the address is kept.
- Trash empties itself after 30 days; unconfirmed sign-ups are deleted after 7 days.

## Code

- `src/index.ts`: routes (`fetch` for the API, `email` for incoming mail, `scheduled` for clean-up).
- `src/receive.ts`, `src/messages.ts`, `src/sanitize.ts`, `src/send.ts`: mail in, storage, safe display, mail out.
- `src/auth.ts`, `src/limits.ts`: sign-in, sessions and rate limits.
- `src/list.ts`, `src/list-email.ts`: the mailing list and its emails.
- `migrations/`: the D1 database schema. `test/`: vitest tests that run in the Workers runtime.

Contributions are welcome: please add or update tests with each change.
