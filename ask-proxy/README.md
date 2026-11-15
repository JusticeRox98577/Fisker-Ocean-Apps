# Ocean Live app server

A small Cloudflare Worker that the Ocean Live apps talk to. It does three things:

* **"Any questions?"**: the apps send a question here and the Worker asks Claude. It holds the
  Anthropic API key, so the apps never see it, and keeps use within fair limits.
* **Accounts**: sign-in with Apple (iPhone), Google or a 6-digit email code. There are no
  passwords.
* **The web account page** at [account.oceanlive.org](https://account.oceanlive.org), where an
  owner can see, rename, sign out of or delete their account without the app.

It answers on `api.oceanlive.org`.

## How "Any questions?" answers

Claude (Claude Opus 5.5) answers from [`knowledge/ocean-guide.md`](knowledge/ocean-guide.md),
and looks fault codes up on demand in a table kept on the server. That table is not part of this
public repo.

For research into what owners ask and how good the answers are, each answered question is logged
with its answer, the readings sent with it and the install ID (and the account, once signed in).
Entries are deleted automatically after 90 days. IP addresses are never logged; the daily counters
only keep salted hashes of them. [PRIVACY.md](../PRIVACY.md) has the details.

## Accounts

The Worker checks each sign-in itself: Apple and Google identity tokens are verified against the
providers' published keys (signature, issuer, audience, expiry, and the nonce when the app sent
one), and email codes expire after a few minutes and allow only a few tries. It then issues its own
random session token. Only a SHA-256 hash of each token is stored.

The apps keep the token and send it as `Authorization: Bearer <token>`. An email that Google or
Apple says is verified links to an existing account with the same address.

Deleting an account removes the account, its sign-in methods, every session (so all devices are
signed out), its logged questions, its balance, ledger and badges, and any personal question limit.
Only the hashed reference of a store reward it claimed is kept, so that purchase can't be claimed
again. Car data is never on the
server.

## Balance and rewards

An account can have a balance in US dollars. It pays for extra "Any questions?" questions after the
free ones each day: each costs what Claude charged for that answer, rounded up to the next cent, and
a question that fails costs nothing. Anonymous installs never use a balance.

Owners who pre-registered on Google Play or pre-ordered on the App Store get US$5 and an "Early
supporter" badge, once per store account and once per Ocean Live account. The Worker checks a Play
reward with the Google Play Developer API, and verifies an App Store `AppTransaction` itself: its
ES256 signature and certificate chain up to Apple Root CA - G3, the bundle ID and the pre-order date.
Every credit and spend is a ledger row with a unique reference, so nothing is credited or charged
twice. Store references are stored as SHA-256 hashes.

## The web account page

`account.oceanlive.org` is served by this same Worker from the files in [`account/`](account/):
plain HTML, CSS and one script module, with no third-party code except Google's sign-in button.
Those files are only served on that host.

* **Sign in** with an email code or with Google. Sign in with Apple is not offered on the web.
  Owners who use Apple in the app can sign in with an email code sent to the address their
  account has (for "Hide My Email", the private relay address, which forwards it).
  The page never creates an account: a sign-in that matches no account is refused, so nobody
  ends up in a new, empty account by mistake.
* **See** the account's email, name, created date, linked sign-in methods, balance and badges. **Rename** it,
  **sign out** of this browser, or **delete** the account (after typing a confirmation).

The page never sees the session token. After sign-in the Worker sets one cookie,
`__Host-olaccount`: `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, no `Domain`, so it is
only ever sent back to `account.oceanlive.org`. It lasts 30 days from last use: the Worker sends
it again whenever the page loads or renames the account. Every request that changes
something (sign-in, rename, sign-out, delete) must carry the page's own `Origin`, so another site
can't act with it. The page has a strict Content Security Policy: same-origin only, plus exactly
what Google's sign-in button needs when Google is on. Bearer tokens are not accepted on this host,
and the cookie is not accepted on the API host.

## Endpoints

| Method and path | What it does |
| --- | --- |
| `POST /ask` | Ask a question (apps) |
| `GET /health` | `{"ok":true,"service":"api","time":...}`, no auth, never cached. Used by the status page |
| `GET /auth/config` | Which sign-in methods are set up |
| `POST /auth/email/start`, `POST /auth/email/verify` | Email a 6-digit code, then sign in with it |
| `POST /auth/google`, `POST /auth/apple` | Sign in with a Google or Apple identity token (Apple: apps only) |
| `GET`, `PATCH`, `DELETE /account` | Show, rename or delete the signed-in account |
| `POST /auth/signout` | End this session |
| `POST /rewards/play`, `POST /rewards/apple` | Claim the pre-registration / pre-order reward (apps) |

## Code

* [`src/index.ts`](src/index.ts): routing by host, `/ask`, `/health`, the daily cleanup.
* [`src/auth.ts`](src/auth.ts): sign-in, sessions (bearer and cookie) and the account endpoints.
* [`src/email.ts`](src/email.ts): the sign-in code email.
* [`src/balance.ts`](src/balance.ts), [`src/rewards.ts`](src/rewards.ts): the balance, ledger, badges and reward endpoints.
* [`src/play.ts`](src/play.ts), [`src/apple.ts`](src/apple.ts), [`src/x509.ts`](src/x509.ts): checking Google Play and App Store rewards.
* [`account/`](account/): the web account page.
* [`migrations/`](migrations/): the D1 tables.
* [`test/`](test/): tests that run in the Workers runtime.
