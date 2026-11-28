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
closed, and the API refuses new ones. The invitation email's wording is in `src/testers.ts`
(`invitation`), and the yes/no page is `public/invite.html`.

## Who sees what

- **Everyone** sees counts only, on the sign-up page (`GET /api/stats`): how many people signed up,
  how many are interested in each product, and how many of the test boards are spoken for. Never
  names, emails or answers.
- **Only `ADMIN_EMAIL`** (justice@oceanlive.org) sees the answers, at
  **https://hardware.oceanlive.org/admin**. There's no password: press *Email me a sign-in link*, and a
  one-time link (good for 15 minutes) goes to that address and nowhere else. The session lasts 30
  days in that browser, or until *Sign out*.

## The admin page

- **Test boards:** one box per board (`BOARDS`, 4), showing who has it: invited (no answer yet) or
  said yes.
- **Most important features:** everyone's top 5 added up: 5 points for a #1 pick down to 1 for #5.
- **Interest:** how many people want to test each product.
- **People:** every answer, newest first, with search and a filter. For each person:
  - **Pick as tester** emails them that they've been picked, with a link to a page where they say
    yes or no. It's refused when all boards are taken, and a board is only taken once the email has
    gone out.
  - **Re-send invitation** sends a new link (the old one stops working).
  - **Un-pick** frees their board; their link stops working. No email is sent, so write to them
    yourself if needed.
  - **Delete** removes their answer, for example when someone asks to be removed.
- **Download CSV** gets every answer as a spreadsheet.

When a picked person answers, you get an email ("said yes" or "said no"). Replying to it writes to
them. A no frees the board straight away; once their board has gone to someone else, they can't
take it back.

## Pre-orders (preorder.oceanlive.org)

The same Worker answers on `preorder.oceanlive.org`, where the home page is `public/preorder.html`.
People reserve the Nova Light, SuperNova, Nova Flare or Nova Quasar for free: they sign the
first-generation disclosure in a window on the page (typed name and a drawn signature, kept with the
reservation), then confirm by email. The link in that email (`/reservation#token`) is their order
status page: place, current price, payments, their batch's build progress, and cancelling. Anyone
can get fresh links from "Check your order" on the page.

* **Volume prices, deposits and goals** are in `PRODUCTS` in `src/preorders.ts`. Each product's price
  steps down as its open batch grows (Light $179 → $149, SuperNova $599 → $499, Flare $470 → $399,
  Quasar $500 → $429 at 25 / 50 / 100); everyone in a batch pays its lowest reached price, never more
  than when they reserved. Deposit $100, goal 10 each.
* **Flare and Quasar need a Nova Light.** Reserving one also reserves a Light at $50 off
  (`LIGHT_BUNDLE_OFF`), confirmed and cancelled with it, unless they tick that they already have one.
  At the first step that's $599 (Flare + Light) and $629 (Quasar + Light).
* **Nobody is charged by this site.** In /admin, Pre-orders:
  1. at 10 confirmed reservations (you get an email), paste a $100 deposit payment link from your
     payment provider (for example a Stripe payment link): everyone reserved gets it;
  2. mark deposits paid as they arrive;
  3. right before ordering the parts, ask everyone whose deposit is paid for the rest. That closes the
     batch at its current volume price and gives it a number. Each email states that person's amount
     (prices can differ: bundled Lights, earlier lower locks), so use a payment link where the customer
     enters the amount, or one link per amount;
  4. mark them paid in full, and tick the batch's **build tracker** steps (`BUILD_STEPS`) as you go.
     The trackers are public (a button on each product) and on each order's status page.
* **Cancelling** from the status page emails you; if they had paid, the email says what to refund.
  The disclosure text is in `public/preorder.html`; bump `DISCLOSURE_VERSION` when you change it.
* `PREORDERS_CLOSED` = `"true"` stops new reservations. Unconfirmed reservations are deleted after
  7 days.
* The text of the page, the terms and the emails are marked `EDIT` in `public/preorder.html` and
  `src/preorders.ts`.

## First deploy

1. Create the database: `npx wrangler d1 create ocean-live-hardware`. Put its id in the Cloudflare
   build variable `HARDWARE_D1_ID` (the committed `wrangler.jsonc` keeps a placeholder, filled in
   by `scripts/fill-ids.mjs` during the build, the same as `status/`).
2. In Cloudflare, connect this repository as a new Worker (Workers Builds) with the root directory
   `hardware`, build command `npm ci && npm run cf:build` and deploy command `npm run cf:deploy`.
   The custom domain `hardware.oceanlive.org` comes from `routes` in `wrangler.jsonc`.
3. Deploy the mail Worker (`mail/`) first, or with the same push: emails go out through its
   `Notify` entry point (`mail/src/notify.ts`) over a service binding, using its Resend key. This
   Worker has no key of its own. Each email is sent from `MAIL_FROM` (justice@oceanlive.org), and a
   copy is kept in that mailbox's Sent folder in webmail.

## Privacy

The page sets no cookies and loads nothing from other sites. What's kept is what people type in. To
slow down spam, each sign-up counts against a hashed network address, and that counter is deleted
after an hour. A hidden field catches simple bots. Signing up again with the same email replaces the
earlier answer.

## How it is built

- `src/` the Worker: `form.ts` (checking an answer), `store.ts` (D1, the CSV, the ranking and the
  public counts), `auth.ts` (admin sign-in), `testers.ts` (picking testers and their answers),
  `mail.ts` (sending through the mail Worker), `index.ts` (the API).
- `public/` the pages: `index.html` (sign-up), `admin.html`, `invite.html`. Plain HTML, CSS and
  JavaScript modules, in the oceanlive.org look.
- `migrations/` the database tables.
- `test/` tests that run in the Workers runtime: `npm test`.

Try it locally, with the mail Worker alongside (emails stop at the mail Worker without its Resend key):

```sh
npm ci
npx wrangler d1 migrations apply ocean-live-hardware --local
npx wrangler dev -c wrangler.jsonc -c ../mail/wrangler.jsonc
```
