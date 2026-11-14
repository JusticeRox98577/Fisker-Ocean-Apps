# Ocean Live "Any questions?" proxy

A small Cloudflare Worker between the apps and Claude. It holds the Anthropic API key (the
apps never see it), limits each install to 20 questions a day and each network to 40, and
stops answering once $10 has been spent in a month. Questions and answers are not stored or
logged; the Worker only keeps those counters, with IP addresses hashed.

Claude (Claude Opus 5.5) answers from `knowledge/ocean-guide.md`, which is sent as a cached
system prompt, and looks fault codes up in a table you upload to Workers KV. The table is
never committed to this public repo.

## Deploy (you run these; nothing here deploys itself)

You need a free Cloudflare account and Node.js 20 or later.

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
| `DEVICE_DAILY_LIMIT` | `20` | Questions per app install per day |
| `IP_DAILY_LIMIT` | `40` | Questions per network per day |

The spend counter is worked out from the token counts Claude returns at Claude Opus 5.5 list
prices. KV is eventually consistent, so a burst of questions can go a few cents past the
cap. To be safe, also set a monthly spend limit for the key's workspace in the Anthropic
Console.

A typical question costs about 1 to 5 cents: the knowledge guide is about 3,000 tokens and is
read from the prompt cache when questions come within 5 minutes of each other.

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

* Data collected: **App activity > Other user-generated content** (the questions), and
  **App info and performance > Other** or **Device or other IDs** (the random install ID).
  If readings are shared: **Other info** (vehicle battery readings and fault codes).
* Purpose: **App functionality**. Not shared for advertising. Processed by a service provider
  (Anthropic) on your behalf, which Play treats as not "shared".
* Data is encrypted in transit: **Yes**. Collection is optional: **Yes** (only when a question
  is asked). Users can request deletion: nothing is stored, so say so.

**App Store, App Privacy:**

* **User Content > Other User Content** (questions and readings) and **Identifiers > Device
  ID** (the random install ID): used for **App Functionality**, **not linked** to the user,
  **not used for tracking**.
