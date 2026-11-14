# Ocean Live Mail

Private webmail for the `@oceanlive.org` mailboxes, at **https://mail.oceanlive.org**.
Each address (justice@, support@, any you add) is its own inbox with its own sign-in:
the mailbox address plus a PIN. One PIN is shared by all mailboxes (secret `MAIL_PIN`).

- **In:** Cloudflare Email Routing hands mail for oceanlive.org to this Worker's `email()` handler.
  Mail for an address that is a mailbox is parsed ([postal-mime](https://github.com/postalsys/postal-mime))
  and stored: message list in D1 (`ocean-live-mail`), original, bodies and attachments in R2
  (`ocean-live-mail`). Mail for any other address is rejected (`550 5.1.1`). `+tags` work:
  `justice+fsk@oceanlive.org` lands in justice@.
- **Out:** the [Resend](https://resend.com) API, always from the signed-in mailbox. A copy is kept in Sent.
- **Web app:** `public/` (plain HTML, CSS and JS, the oceanlive.org look). Inbox, Sent, Trash, search,
  unread filter, read, reply, reply all, forward (with the original's attachments), attachments up
  to 25 MB, download the original `.eml`, add mailboxes, set the name people see.

## Security

- **Sign-in:** address + PIN. Wrong PINs: 5 per network per 15 minutes, then that network waits;
  50 per day in total, then sign-in pauses for everyone until the next UTC day. Use a long PIN
  (8+ digits): a 4-digit PIN has only 10,000 possibilities.
- **Sessions:** a random token in a `__Host-` cookie (`Secure; HttpOnly; SameSite=Strict`, 30 days);
  only its SHA-256 is stored. Every change (send, move, delete, add mailbox) also needs the session's
  CSRF token in `X-CSRF-Token` and must come from this origin.
- **Mailboxes are separate:** every API call is limited to the signed-in mailbox.
- **Mail HTML** is sanitized (scripts, frames, forms, event handlers, `javascript:` links removed;
  links open in a new tab with no referrer) and shown in a sandboxed iframe from its own URL with a
  strict CSP (`sandbox`, no scripts, `default-src 'none'`). Pictures from the internet are blocked
  until you press **Show pictures** for that message; inline (`cid:`) pictures are embedded.
- **Attachments** always download (`application/octet-stream`, `Content-Disposition: attachment`),
  never open on this site.
- **No open relay:** only signed-in mailboxes can send, only as themselves. Limits: 30 per mailbox per
  hour, 150 per day in total, 50 recipients per message.
- **Spoofing:** when Cloudflare reports DMARC failed (or SPF failed without DKIM) the message shows a warning.
- Trash empties itself after 30 days. Limits live in `wrangler.jsonc` under `vars`.

## Owner setup (once)

Run these in PowerShell from the `mail` folder of the repo (`npx.cmd`, because `npx.ps1` is blocked).

1. **Deploy** (already done once; repeat after changes):
   ```
   npm install
   npx.cmd wrangler d1 migrations apply ocean-live-mail --remote
   npx.cmd wrangler deploy
   ```
2. **Secrets.** Each command asks for the value; type it there, never in a chat or a file.
   ```
   npx.cmd wrangler secret put MAIL_PIN
   npx.cmd wrangler secret put RESEND_API_KEY
   ```
   For `RESEND_API_KEY`, make a key at https://resend.com/api-keys with **Sending access** limited to
   the domain `oceanlive.org` (or reuse the one the ask-proxy uses).
3. **Email Routing → this Worker.** Cloudflare dashboard → oceanlive.org → **Email** → **Email Routing**
   → **Routing rules** (https://dash.cloudflare.com/?to=/:account/:zone/email/routing/routes):
   - Edit the rule for `justice@oceanlive.org`: Action **Send to a Worker**, Destination **ocean-live-mail**. Save.
     (This stops the copy to Gmail.)
   - **Catch-all address** → Edit → Action **Send to a Worker**, Destination **ocean-live-mail** → Save,
     and make sure it is **enabled**. Now support@ and every mailbox you add later arrives, and
     addresses that are not mailboxes are rejected.
   - Leave the MX, SPF, DKIM and DMARC records alone.
4. Open https://mail.oceanlive.org, sign in with `justice@oceanlive.org` and your PIN.

To add an address later: **Mailboxes** (top right) → **New mailbox**. Nothing to change in Cloudflare,
the catch-all already sends it here.

## Develop

```
npm install
npm test             # vitest in the Workers runtime: parsing, sanitizing, sign-in, sending
npm run check        # TypeScript
npx.cmd wrangler d1 migrations apply ocean-live-mail --local
npx.cmd wrangler dev # put MAIL_PIN="..." in .dev.vars (git-ignored)
```

Send a test message to the local Worker:
`curl -X POST "http://127.0.0.1:8787/cdn-cgi/handler/email?from=a@example.com&to=justice@oceanlive.org" --data-binary @message.eml`
