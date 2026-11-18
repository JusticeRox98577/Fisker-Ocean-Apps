# Ocean Live app server

A small Cloudflare Worker that the Ocean Live apps talk to. It does five things:

* **"Any questions?"**: the apps send a question here and the Worker asks Claude. It holds the
  Anthropic API key, so the apps never see it, and keeps use within fair limits.
* **Accounts**: sign-in with Apple (iPhone), Google or a 6-digit email code. There are no
  passwords.
* **The web account page** at [account.oceanlive.org](https://account.oceanlive.org), where an
  owner can see, rename, sign out of or delete their account without the app, and vote on the
  roadmap.
* **The roadmap**: what's planned, in progress and done, with a vote count per item. Anyone can
  read it (it's shown on [oceanlive.org/roadmap](https://oceanlive.org/roadmap)); owners with an
  account vote on the account page, once per item. Only counts are public, never who voted.
* **An admin page** at `admin.oceanlive.org` for the people who run Ocean Live: Sign in with
  Google, admins only. It shows usage (questions, AI cost, accounts, credit) and the logged
  questions and reports without who asked, looks an account up and changes its balance or badge,
  and reviews what owners shared in the chat (Knowledge) and their app feedback (Feedback),
  which can become a roadmap item. Its Home tab has every link the team uses, the live status and
  what needs a look; the Roadmap tab adds, edits, orders and deletes roadmap items. Every change is
  recorded with the admin who made it.

It answers on `api.oceanlive.org`.

## How "Any questions?" answers

Claude (Claude Opus 5.5) answers from [`knowledge/ocean-guide.md`](knowledge/ocean-guide.md),
and looks fault codes up on demand in a table kept on the server. That table is not part of this
public repo.

When the guide doesn't cover something, or it changes over time (recalls, parts, service options,
news), Claude can search the web and read pages. For questions about Ocean Live itself it can read
this public GitHub repository: its issues, pull requests, releases and files. Both are for signed-in
accounts; older app builds without an account keep the guide and the fault code table. The sources an
answer used are listed under it. Web pages and GitHub content are treated as information, never as
instructions, and once a question has read them, knowledge can't be suggested in it. Claude is told to
search with general words only, never the car's readings, the balance or the owner's account details,
and GitHub lookups that contain the install ID, account details, an email address or a VIN are
refused. Each question has a budget: a few searches and pages, a cost ceiling and a time limit, after
which Claude answers with what it has.

For research into what owners ask and how good the answers are, each answered question is logged
with its answer, the readings sent with it and the install ID (and the account, once signed in).
Entries are deleted automatically after 90 days. IP addresses are never logged; the daily counters
only keep salted hashes of them. [PRIVACY.md](../PRIVACY.md) has the details.

Owners can also share what they know in the chat: what a fault code meant, a fix that worked, a
fact about the car, or feedback about the app. Claude passes it on for review; nothing is used in
answers until an admin approves it, usually after editing it, and approved notes are kept without
anything that says who sent them. App feedback never goes into answers.

## Accounts

The Worker checks each sign-in itself: Apple and Google identity tokens are verified against the
providers' published keys (signature, issuer, audience, expiry, and the nonce when the app sent
one), and email codes expire after a few minutes and allow only a few tries. It then issues its own
random session token. Only a SHA-256 hash of each token is stored.

The apps keep the token and send it as `Authorization: Bearer <token>`. An email that Google or
Apple says is verified links to an existing account with the same address.

Deleting an account removes the account, its sign-in methods, every session (so all devices are
signed out), its logged questions and their reports, its balance, ledger and badges, what it shared in the chat that
wasn't approved, its app feedback, its roadmap votes, and any personal question limit.
Only the hashed reference of a store reward it claimed is kept, so that purchase can't be claimed
again. Car data is never on the
server.

## Reporting an answer

Each answer from `/ask` carries the logged question's ID (`questionId`). The apps let the owner
report an answer as offensive, harmful, wrong or other, with an optional note, through
`POST /ask/report`. Only whoever asked the question can report it (the same account, or the same
install for apps without an account). A report is kept with its question and deleted with it.

## Balance and rewards

An account can have a balance in US dollars. It pays for extra "Any questions?" questions after the
free ones each day: each costs what Claude charged for that answer (web searches included), rounded
up to the next cent, and a question that fails costs nothing. Anonymous installs never use a balance.

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
* **Vote** on the roadmap (also at `account.oceanlive.org/roadmap`): one vote per item, which can be
  taken back. Signed out, the list is shown without voting.

The page never sees the session token. After sign-in the Worker sets one cookie,
`__Host-olaccount`: `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, no `Domain`, so it is
only ever sent back to `account.oceanlive.org`. It lasts 30 days from last use: the Worker sends
it again whenever the page loads or renames the account. Every request that changes
something (sign-in, rename, sign-out, delete, a vote) must carry the page's own `Origin`, so another site
can't act with it. The page has a strict Content Security Policy: same-origin only, plus exactly
what Google's sign-in button needs when Google is on. Bearer tokens are not accepted on this host,
and the cookie is not accepted on the API host.

## Endpoints

| Method and path | What it does |
| --- | --- |
| `POST /ask` | Ask a question (apps) |
| `POST /ask/report` | Report an answer: `{questionId, reason, note?}` (apps) |
| `GET /health` | `{"ok":true,"service":"api","time":...}`, no auth, never cached. Used by the status page |
| `GET /auth/config` | Which sign-in methods are set up |
| `POST /auth/email/start`, `POST /auth/email/verify` | Email a 6-digit code, then sign in with it |
| `POST /auth/google`, `POST /auth/apple` | Sign in with a Google or Apple identity token (Apple: apps only) |
| `GET`, `PATCH`, `DELETE /account` | Show, rename or delete the signed-in account |
| `POST /auth/signout` | End this session |
| `POST /rewards/play`, `POST /rewards/apple` | Claim the pre-registration / pre-order reward (apps) |
| `GET /roadmap` | The public roadmap: `{items: [{id, title, description, status, votes, updated}]}`, no auth, cacheable for a minute |
| `GET /roadmap/items`, `POST /roadmap/vote`, `POST /roadmap/unvote` | The roadmap with this account's votes, and voting `{itemId}` (account page only) |

## Code

* [`src/index.ts`](src/index.ts): routing by host, `/ask`, `/health`, the daily cleanup.
* [`src/auth.ts`](src/auth.ts): sign-in, sessions (bearer and cookie) and the account endpoints.
* [`src/email.ts`](src/email.ts): the sign-in code email.
* [`src/reports.ts`](src/reports.ts): reporting an answer.
* [`src/knowledge.ts`](src/knowledge.ts): what owners share in the chat, its review, and the approved notes in answers.
* [`src/roadmap.ts`](src/roadmap.ts): the public roadmap, votes, and the admin page's Roadmap tab.
* [`src/admin.ts`](src/admin.ts), [`admin/`](admin/): the admin page.
* [`src/balance.ts`](src/balance.ts), [`src/rewards.ts`](src/rewards.ts): the balance, ledger, badges and reward endpoints.
* [`src/play.ts`](src/play.ts), [`src/apple.ts`](src/apple.ts), [`src/x509.ts`](src/x509.ts): checking Google Play and App Store rewards.
* [`account/`](account/): the web account page.
* [`migrations/`](migrations/): the D1 tables.
* [`test/`](test/): tests that run in the Workers runtime.
