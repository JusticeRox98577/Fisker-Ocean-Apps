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
- **Mailing list:** Ocean Live news, double opt-in, sent from the webmail. See [Mailing list](#mailing-list-ocean-live-news).

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

## Mailing list (Ocean Live news)

A double opt-in list for news about Ocean Live (new releases, important fixes). People sign up on
oceanlive.org; you write and send from this webmail under **Mailing list**. Nobody is added without
confirming by email, and every email has a one-click unsubscribe.

**How it works**

- **Sign-up:** the site posts to `oceanlive.org/api/list/subscribe`. The site Worker forwards
  `/api/list/*` to this Worker through a service binding (`MAIL`), so the page stays same-origin.
  A new address is stored as *pending* and gets a confirmation email (English, German, French,
  Spanish or Dutch). Its link is `oceanlive.org/list/confirm#t=<token>`: the token sits in the
  `#fragment`, so it never reaches server logs or link scanners, and the page only confirms when the
  person presses the button. Only the token's SHA-256 is stored. The link works for 7 days.
- **No enumeration:** for any valid address the answer is the same `{ ok: true }`, whether it is new,
  pending or confirmed. A pending address gets at most one new email per 10 minutes and 5 in total;
  a confirmed one gets nothing. If a confirmation email can't be sent, every sign-up answers the
  same error for the next 10 minutes, whatever the address, so an outage reveals nothing either.
- **Limits:** `LIST_SIGNUPS_PER_IP_HOUR` sign-ups per network per hour (an IPv4 address, or an IPv6
  /64; the counter key is a salted hash, never the IP itself), `LIST_CONFIRMS_PER_DAY` confirmation
  emails per UTC day in total, and a hidden `website` field that bots fill in. Confirmation emails
  also count against `LIST_SEND_PER_DAY` (see below). If a request arrives without
  `CF-Connecting-IP`, the per-network limit is skipped and a warning is logged; after the first
  deploy, check `npx.cmd wrangler tail` shows no "without CF-Connecting-IP" warnings for sign-ups
  through oceanlive.org.
- **Unsubscribe deletes the address** (and its queued deliveries) at once. There is no suppression
  list: an address can only come back by signing up and confirming again. Unconfirmed sign-ups are
  deleted by the daily cron after 7 days.
- **Sending news:** **Mailing list** → write a subject and plain text → **Send test to me** →
  **Send to N subscribers**. The campaign queues every *confirmed* subscriber at that moment. Each
  request sends up to `LIST_BATCH` emails in one Resend batch call (fewer for a long email, so one
  request stays a few MB; the email is at most 20,000 characters); the page keeps calling
  **Continue** until it is done. A delivery is marked sent only after Resend accepts it; addresses
  Resend rejects one by one are marked failed and not retried. If Resend refuses the whole request
  (400/422, usually a setting such as `LIST_FROM`), nobody is marked failed: the campaign pauses with
  Resend's message; fix the setting and continue. Each chunk has an `Idempotency-Key` built from the
  campaign and its recipients, so a retried chunk is never sent twice. If a setting that changes the
  email (sender, reply address, postal address, site) changes between a failed try and the retry,
  Resend refuses the old key for 24 hours and the campaign says so.
- **Daily cap:** at most `LIST_SEND_PER_DAY` list emails per UTC day: news, tests and confirmation
  emails together. When the cap is reached the campaign pauses ("Daily limit reached; continue
  tomorrow"); press **Continue sending** under **Sent news** the next day. Sign-ups get "We've had a
  lot of sign-ups today" once the day's budget is used up.
- **Every news email** has a plain-text and an HTML part, a footer saying why they get it, an
  unsubscribe link (`oceanlive.org/list/unsubscribe#t=…`), the postal address if set, and the headers
  `List-Unsubscribe: <https://oceanlive.org/api/list/unsubscribe?t=…>` and
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, so Gmail and Yahoo show their own one-click
  unsubscribe (RFC 8058). That POST needs no login and answers 200. Opening the same URL in a browser
  redirects to the unsubscribe page and does not unsubscribe by itself.
- **One-click unsubscribe must get past bot protection.** Mail providers send that POST from their
  own servers, which oceanlive.org's bot protection may challenge or block (it already answers
  GitHub's runners with 403). Before the first campaign, from a cloud machine (not a browser), run
  `curl -i -X POST -d 'List-Unsubscribe=One-Click' 'https://oceanlive.org/api/list/unsubscribe?t=xxxxxxxxxxxxxxxxxxxxxxxx'`
  and check for `200` and `{"ok":true}`. If it is blocked, either add a WAF custom rule that skips
  bot protection for `http.request.uri.path eq "/api/list/unsubscribe" and http.request.method eq "POST"`
  (Super Bot Fight Mode can be skipped; the free plan's Bot Fight Mode cannot, so switch or turn it
  off), or set `LIST_UNSUB_BASE` to a host without the challenge that forwards `/api/list/unsubscribe`
  here (for example the site Worker's workers.dev address). `LIST_UNSUB_BASE` changes only the
  header's URL; the unsubscribe link in the email text stays on `LIST_SITE`.

**Endpoints**

| | |
|---|---|
| `POST /api/list/subscribe` `{ email, lang?, website? }` | public |
| `POST /api/list/confirm` `{ token }` | public |
| `POST /api/list/unsubscribe` `{ token }` or `?t=` + `List-Unsubscribe=One-Click` | public, always 200 |
| `GET /api/list/unsubscribe?t=` | public, 303 to the unsubscribe page |
| `GET /api/list`, `GET /api/list/subscribers?status=&q=&cursor=` | session |
| `DELETE /api/list/subscribers/:id`, `POST /api/list/test`, `POST /api/list/campaigns`, `POST /api/list/campaigns/:id/continue` | session + CSRF |

**Settings** (`vars` in `wrangler.jsonc`): `LIST_SITE` (links in emails), `LIST_FROM`
(`Ocean Live <news@oceanlive.org>`), `LIST_REPLY_TO` (`justice@oceanlive.org`), `LIST_POSTAL_ADDRESS`,
`LIST_UNSUB_BASE` (empty: `LIST_SITE`), `LIST_SEND_PER_DAY` (60), `LIST_BATCH` (50),
`LIST_SIGNUPS_PER_IP_HOUR` (5), `LIST_CONFIRMS_PER_DAY` (20). It uses the same `RESEND_API_KEY`
secret as the webmail. Optional secret `LIST_IP_SALT` (any long random string) salts the hashed
sign-up counter; without it the API key is used as the salt.

- `news@oceanlive.org` needs no mailbox: it only sends. Replies go to `LIST_REPLY_TO`. Resend must be
  allowed to send for the oceanlive.org domain (it already is for the webmail).
- **Postal address:** US anti-spam law (CAN-SPAM) asks for a valid postal address (street address,
  USPS P.O. box or registered private mailbox) in marketing email. The webmail warns while
  `LIST_POSTAL_ADDRESS` is empty.
- **Resend free plan:** 100 emails a day and 3,000 a month, shared by everything on the account: news,
  confirmation emails, webmail sends and the app's sign-in codes. When it is used up, Resend refuses
  every send until UTC midnight, including the app's sign-in codes, and the app needs an account.
  So the list stays inside its own share: `LIST_SEND_PER_DAY` = 60 covers news, tests and
  confirmations together (`LIST_CONFIRMS_PER_DAY` = 20 of them at most), leaving 40 a day for
  sign-in codes and webmail. The webmail's own `SEND_PER_DAY` (150) is a separate counter and does
  not know about the list: on a day you send news, send little from the webmail. Raise these only
  on a paid plan. With 3,000 a month, a list of more than about 2,000 needs a paid plan. If Resend
  itself says the quota is used up, the campaign pauses and can be continued later.
- **Never import addresses** from Google Groups, TestFlight, App Store or Play testers, support mail
  or anywhere else. Only people who signed up and confirmed may be on this list.

**Deploy order.** Do both steps here **before** the site changes are pushed or merged to `main`:
a push to `main` deploys the site automatically, and `ocean-live-mail` already exists, so nothing
stops the site from going live first. Until this Worker has the list code, sign-ups would reach the
old Worker (the site turns that into "The mailing list isn't available right now"); without the
migration they fail with a server error.

```
npx.cmd wrangler d1 migrations apply ocean-live-mail --remote
npx.cmd wrangler deploy            # this Worker
# only then push/merge the site (site/), which forwards /api/list/* here
```

## Develop

```
npm install
npm test             # vitest in the Workers runtime: parsing, sanitizing, sign-in, sending, mailing list
npm run check        # TypeScript
npx.cmd wrangler d1 migrations apply ocean-live-mail --local
npx.cmd wrangler dev # put MAIL_PIN="..." in .dev.vars (git-ignored)
```

Send a test message to the local Worker:
`curl -X POST "http://127.0.0.1:8787/cdn-cgi/handler/email?from=a@example.com&to=justice@oceanlive.org" --data-binary @message.eml`
