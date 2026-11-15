# Ocean Live Status

The public status page for Ocean Live, at **https://status.oceanlive.org**.

It shows whether each part of Ocean Live is working:

| Service | What is checked |
|---|---|
| Website | oceanlive.org answers |
| App server | the server behind Ask, sign-in and accounts says it is healthy |
| Email | the mail service says it is healthy |

Every 5 minutes a Cloudflare Worker checks each service once (and once more straight away if the
first try fails, so a single dropped request is not shown as an outage). The page shows the current
state of each service, how quickly it answered, and bars for the last 24 hours (one per hour) and the
last 90 days (one per UTC day). It updates itself every minute while it is open.

The status page is a separate Worker from the app server, so it keeps working when the app server
does not.

## Privacy

The page sets no cookies, loads nothing from other sites and keeps nothing about visitors. The only
data stored is the check results: single checks for 48 hours, daily totals for 90 days.

## How it is built

- `src/` the Worker: `checks.ts` (what is checked and how), `store.ts` (saving, totals and clean-up in
  Cloudflare D1), `status.ts` (the answer for the page), `index.ts` (the scheduled run and
  `GET /api/status`).
- `public/` the page: plain HTML, CSS and one JavaScript module, in the oceanlive.org look.
- `migrations/` the database tables.
- `test/` tests that run in the Workers runtime.

`GET /api/status` returns the same JSON the page uses, if you want to read the status from your own
tools.
