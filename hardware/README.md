# Ocean Live Hardware

The Nova beta tester sign-up, at **https://hardware.oceanlive.org**.

People leave their email, a few optional details (car, phone, which Nova products they'd test,
whether they'd install it themselves) and pick **the five features that matter most to them, in
order**. Answers are saved in Cloudflare D1, and you download them as a spreadsheet.

## Editing the page

Everything people see is in `public/index.html`. Look for the `<!-- EDIT: ... -->` comments:

| What | Where |
| --- | --- |
| Headline and intro | the `doc-hero` section |
| The product cards | the `The line-up` section |
| Car, phone, product and install choices | the `<select>` options and the `chip` checkboxes |
| **The feature list** | the `features` block: one `<label class="feature">` per feature |
| Questions and answers | the `Questions` section |

Each choice has a `value`, a short id (lower case letters, numbers and dashes, up to 40 characters).
That id is what's saved and shown in the spreadsheet. To add a feature, copy a `<label
class="feature">` line and give it a new id. Keep an id the same once people have answered, so old
and new answers still count together. The Worker accepts any id in that shape, so changing the
page never needs a code change. `npm test` checks that every feature id on the page is one the
Worker accepts.

The number of picks (5) is `MAX` in `public/app.js` and `MAX_FEATURES` in `src/form.ts`.

To close sign-ups, set `CLOSED` to `"true"` in `wrangler.jsonc`. The page then says sign-ups are
closed, and the API refuses new ones.

## Reading the answers

Set a long random admin token once:

```sh
npx wrangler secret put ADMIN_TOKEN
```

Then:

```sh
# Every answer as CSV (opens in Excel, Numbers or Google Sheets)
curl -H "Authorization: Bearer $TOKEN" https://hardware.oceanlive.org/api/responses -o nova-beta.csv

# The feature ranking: 5 points for a #1 pick, 4 for #2 ... 1 for #5, plus how often each was picked
curl -H "Authorization: Bearer $TOKEN" "https://hardware.oceanlive.org/api/responses?format=summary"

# Every answer as JSON
curl -H "Authorization: Bearer $TOKEN" "https://hardware.oceanlive.org/api/responses?format=json"

# Remove someone who asks to be removed
curl -X DELETE -H "Authorization: Bearer $TOKEN" "https://hardware.oceanlive.org/api/responses?email=them@example.com"
```

Without `ADMIN_TOKEN` set, these endpoints don't exist (404).

## First deploy

1. Create the database: `npx wrangler d1 create ocean-live-hardware`. Put its id in the Cloudflare
   build variable `HARDWARE_D1_ID` (the committed `wrangler.jsonc` keeps a placeholder, filled in
   by `scripts/fill-ids.mjs` during the build, the same as `status/`).
2. In Cloudflare, connect this repository as a new Worker with the root directory `hardware`, build
   command `npm ci && npm run cf:build` and deploy command `npm run cf:deploy`. The custom domain
   `hardware.oceanlive.org` comes from `routes` in `wrangler.jsonc`.
3. Set the secret: `npx wrangler secret put ADMIN_TOKEN`.

## Privacy

The page sets no cookies and loads nothing from other sites. What's kept is what people type in. To
slow down spam, each sign-up counts against a hashed network address, and that counter is deleted
after an hour. A hidden field catches simple bots. Signing up again with the same email replaces the
earlier answer.

## How it is built

- `src/` the Worker: `form.ts` (checking an answer), `store.ts` (D1, the CSV and the ranking),
  `index.ts` (the API).
- `public/` the page: plain HTML, CSS and one JavaScript module, in the oceanlive.org look.
- `migrations/` the database tables.
- `test/` tests that run in the Workers runtime: `npm test`.

Try it locally:

```sh
npm ci
npx wrangler d1 migrations apply ocean-live-hardware --local
npx wrangler dev --var ADMIN_TOKEN:some-long-local-token
```
