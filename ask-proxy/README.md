# Ocean Live "Any questions?" proxy

A small Cloudflare Worker between the apps and Claude. It holds the Anthropic API key (the
apps never see it), limits each install to 10 questions a day and each network to 40, and
stops answering once $10 has been spent in a month. For research, it logs every question with
its answer, the readings sent with it and the install ID to a D1 database, and deletes
entries after 90 days. IP addresses are only kept as salted hashes in the daily counters,
never in the log.

Claude (Claude Opus 5.5) answers from `knowledge/ocean-guide.md`, which is sent as a cached
system prompt, and looks fault codes up in a table you upload to Workers KV. The table is
never committed to this public repo.

## Deploy (you run these; nothing here deploys itself)

You need a free Cloudflare account and Node.js 20 or later.

**One step on Windows:** `setup.ps1` runs everything below in order (install, sign-in, KV,
D1, secrets, fault code table, deploy, a test question) and prints the address for
`OCEAN_ASK_URL`. It asks you to sign in to Cloudflare in the browser and to paste your
Anthropic API key; it never stores or shows the key. Safe to run again.

```powershell
cd ask-proxy
powershell -ExecutionPolicy Bypass -File .setup.ps1
```

The same steps by hand:

```bash
cd ask-proxy
npm install
npx wrangler login
npx wrangler kv namespace create ASK_KV
```

Put the `id` it prints into `wrangler.toml` in place of `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`.
Then set the two secrets (each one asks you to paste the value):

```bash
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put IP_SALT
```

`IP_SALT` can be any long random string. Upload the fault code table (any of the JSON
formats Ocean Live imports; several files can be given, the first one wins):

```bash
node scripts/build-dtc-kv.mjs "path/to/fisker-dtc-descriptions.json"
npx wrangler kv bulk put dtc-kv.json --binding ASK_KV --remote
```

Create the research log database and its table:

```bash
npx wrangler d1 create ocean-live-ask-log
```

Put the `database_id` it prints into `wrangler.toml` in place of
`REPLACE_WITH_YOUR_D1_DATABASE_ID`, then:

```bash
npx wrangler d1 migrations apply ocean-live-ask-log --remote
```

Deploy:

```bash
npx wrangler deploy
```

Wrangler prints the address, such as `https://ocean-live-ask.<your-subdomain>.workers.dev`.
The apps use that address followed by `/ask`.

## Point the apps at it

The address isn't secret, but it's yours, so it isn't hard-coded. Builds without it hide the
"Any questions?" button.

* **GitHub Actions:** add a repository variable (Settings, Secrets and variables, Actions,
  Variables) named `OCEAN_ASK_URL` with the full address ending in `/ask`. Both workflows
  pass it to the builds.
* **Local Android builds:** add `oceanAskUrl=https://.../ask` to `android/local.properties`
  or set the `OCEAN_ASK_URL` environment variable.
* **Local iPhone builds:** set `OCEAN_ASK_URL` before `xcodegen generate`, or pass
  `OCEAN_ASK_URL=https://.../ask` to `xcodebuild`.

## Test it

```bash
curl -s https://ocean-live-ask.<your-subdomain>.workers.dev/ask \
  -H "content-type: application/json" \
  -d '{"device":"test-device-1","messages":[{"role":"user","text":"What does B208896 mean?"}]}'
```

## Limits and cost

Change the limits in `[vars]` in `wrangler.toml` and deploy again:

| Variable | Default | Meaning |
| --- | --- | --- |
| `MONTHLY_CAP_USD` | `10` | Stop answering after this many dollars in a calendar month (UTC) |
| `DEVICE_DAILY_LIMIT` | `10` | Questions per app install per day |
| `IP_DAILY_LIMIT` | `40` | Questions per network per day |

The spend counter is worked out from the token counts Claude returns at Claude Opus 5.5 list
prices. KV is eventually consistent, so a burst of questions can go a few cents past the
cap. To be safe, also set a monthly spend limit for the key's workspace in the Anthropic
Console.

A typical question costs about 1 to 5 cents: the knowledge guide is about 3,000 tokens and is
read from the prompt cache when questions come within 5 minutes of each other.

### More (or fewer) questions for one device

Owners see their install ID under "Show what's sent" in the chat. Give that device its own
daily limit (it takes effect within about a minute, no redeploy or app update needed):

```bash
npx wrangler kv key put "limit:THEIR-INSTALL-ID" 100 --binding ASK_KV --remote
```

`0` blocks the device. A device with its own limit isn't held back by the per-network limit,
but the monthly spend cap still applies to everyone together, so raise `MONTHLY_CAP_USD` if
you hand out a lot. See who has their own limit, or go back to the default:

```bash
npx wrangler kv key list --prefix "limit:" --binding ASK_KV --remote
```

```bash
npx wrangler kv key delete "limit:THEIR-INSTALL-ID" --binding ASK_KV --remote
```

## Research log

Each answered question is a row in the `questions` table: time (UTC), install ID, phone
language, the question, the earlier messages of the chat, the car readings and fault codes
sent with it, the answer (empty when Claude declined), cost and model. A daily cron job
deletes rows older than `LOG_RETENTION_DAYS` (90). PRIVACY.md promises that period, so
change both together.

Latest questions:

```bash
npx wrangler d1 execute ocean-live-ask-log --remote --command "SELECT ts, lang, question, answer FROM questions ORDER BY ts DESC LIMIT 20"
```

Everything, as a SQL file to analyse offline (keep it private; it holds owners' data):

```bash
npx wrangler d1 export ocean-live-ask-log --remote --output questions.sql
```

**Deletion requests.** The chat screen shows each owner their install ID under "Show what's
sent". When someone asks you to delete their questions:

```bash
npx wrangler d1 execute ocean-live-ask-log --remote --command "DELETE FROM questions WHERE device = 'THEIR-INSTALL-ID'"
```

Use the log only for research into what owners ask and how good the answers are. Don't
publish raw entries or try to work out who someone is.

## Updating the knowledge

Edit `knowledge/ocean-guide.md` and run `npx wrangler deploy`. Keep it to facts you are
allowed to share; it is public in this repo.

## Check it compiles

```bash
npm run check
npx wrangler deploy --dry-run --outdir dist
```

## Store listings: what to change when this ships

The current listings say the only network use is ABRP. Once a build with the button goes out,
update them (the apps can't do this for you):

**Description, both stores** (replace the "only ABRP" sentence):

> No account and no tracking. Data leaves your phone only when you ask a question in "Any
> questions?" (answered by Claude, Anthropic's AI, with your latest readings unless you turn
> that off) or send live data to A Better Route Planner.

**Google Play, Data safety:**

* Data collected: **App activity > Other user-generated content** (questions and answers),
  **Device or other IDs** (the random install ID) and, when readings are shared, **Other
  info** (vehicle battery readings and fault codes).
* Purposes: **App functionality** and **Analytics** (the research log). Not used for
  advertising. Processed by a service provider (Anthropic) on your behalf, which Play treats
  as not "shared".
* Data is encrypted in transit: **Yes**. Collection is optional: **Yes** (only when a question
  is asked). Users can request deletion: **Yes**, by sending their install ID (see Research
  log above). Kept for 90 days.

**App Store, App Privacy:**

* **User Content > Other User Content** (questions, answers and readings) and **Identifiers >
  Device ID** (the random install ID): used for **App Functionality** and **Analytics**,
  **linked to the user** (through the install ID), **not used for tracking**.
