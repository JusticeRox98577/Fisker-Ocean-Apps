# oceanlive.org

The Ocean Live website: plain HTML, CSS and JavaScript ES modules in `public/`, with no build
step, no frameworks, no cookies, no analytics and no third-party requests (except GitHub's API
for the download links). It is served by a Cloudflare Worker with static
assets only (no Worker script), configured in `wrangler.jsonc`.

| File | What it is |
| --- | --- |
| `public/index.html` | Home page: the scroll story over the 3D blueprint (hero, live data, doors, "the real thing", 12V, fault codes, platforms, what you need, downloads, privacy, car sleep, FAQ) |
| `public/privacy.html` | Privacy policy, from `PRIVACY.md` (the store privacy policy URL: `https://oceanlive.org/privacy`) |
| `public/delete-account.html` | How to delete an account (the Google Play URL: `https://oceanlive.org/delete-account`) |
| `public/credits.html` | Credits and licences: the 3D model (CC BY 4.0), three.js, GSAP, fonts |
| `public/404.html` | Not found page |
| `public/styles.css`, `public/app.js` | Shared styles and script (reveals, count-ups, progress bar, and the download links from the latest GitHub release) |
| `public/js/blueprint.js`, `public/js/scene/*.js` | The 3D blueprint (home page only), see below |
| `public/models/ocean.glb` | The car, made by `tools/build-model.mjs` |
| `public/img/ocean-blueprint.svg` | Static side elevation shown without 3D, made by `tools/make-blueprint-svg.mjs` |
| `public/vendor/` | three.js 0.186.1 and GSAP 3.15.0 (pinned, with their licences), made by `tools/vendor.mjs` |
| `public/fonts/` | Space Grotesk, Inter and Architects Daughter (woff2, SIL OFL), self-hosted |
| `public/_headers` | Security and cache headers. The CSP allows the inline import map in `index.html` by its hash: if you change the import map, update the hash (`tools/check-site.mjs` tells you) |

Design: `design-system/ocean-live/MASTER.md`, overridden by `design-system/ocean-live/pages/home.md`.

## The 3D blueprint

`js/blueprint.js` starts after the first paint, only with WebGL 2, and never with reduced motion or
Save-Data (those visitors keep the static drawing). The modules in `js/scene/`:

| Module | Does |
| --- | --- |
| `main.js` | Puts it together; renders on demand (scrolling, tweens, springs, draw-in, a short idle drift), pauses when the tab is hidden, disposes on `pagehide` |
| `renderer.js` | Renderer, performance tiers (high: bloom, shadows, transmission glass; medium: physical materials, sprite glow; low: "lite-lit", standard materials, hemisphere + key light, glow sprites, DPR 1; software renderers start there and the watchdog never drops below it), timing probe and the 20 ms frame-time watchdog |
| `model.js` | Loads `ocean.glb`, bakes the transforms, cuts the doors, makes the shaded materials (materialise sweep and x-ray) |
| `doorcut.js` | The door outlines and triangle selection (pure functions; `tools/measure-doors.mjs` checks them against the model) |
| `lines.js` | Hand-drawn line shader: double stroke, wobble, overshoot, draw-in, scan band |
| `doors.js` | Weighted door motion (under-damped spring) |
| `lighting.js` | Environment, moving lights, light bar and headlight boot-up, floor reflection, contact shadow, light shafts, solid x-ray batteries (high-voltage pack and 12V), bloom |
| `story.js` | The GSAP ScrollTrigger timeline (`scrub: 1`) between the `data-scene` sections |
| `overlays.js` | Handwritten callouts, dimension lines and module dots |

Add `?debug` to the URL to get `window.__oceanLive`, and `?tier=low|medium|high` to pin a tier.

## Tools

One-off Node scripts in `tools/` (never deployed). Their npm packages live in `tools/.cache`
(`npm install` there): `@gltf-transform/*`, `meshoptimizer`, `three@0.186.1`, `gsap@3.15.0`, `esbuild`.

| Script | Does |
| --- | --- |
| `build-model.mjs` | `tools/source/ocean-source.glb` (the original, with `LICENSE-CREDIT.txt`) to `public/models/ocean.glb` |
| `measure-doors.mjs` | Prints the door cut on the real geometry (box values, triangle counts, ASCII side view) |
| `measure-batteries.mjs` | Prints the wheel centres, underbody height, windshield base (cowl) and bonnet height used to place the x-ray batteries |
| `make-blueprint-svg.mjs` | Draws `public/img/ocean-blueprint.svg` from the model |
| `vendor.mjs` | Copies the pinned three.js and GSAP files into `public/vendor/` |
| `build-pages.mjs` | Writes privacy, delete-account, credits and 404 with the shared header and footer |
| `check-site.mjs` | Checks every local reference, anchors, the CSP hash and that nothing loads from a third party |
| `serve.mjs` | Local preview with the `_headers` applied (`node tools/serve.mjs`, then open http://localhost:8787) |

When `PRIVACY.md` changes, update the privacy page in `tools/build-pages.mjs` to match and run it.

## Preview

```bash
cd site
npx wrangler dev
```

## Deploy

You need Node.js 20 or later and access to the Cloudflare account that holds `oceanlive.org`.

```bash
cd site
npx wrangler login
npx wrangler deploy
```

The routes in `wrangler.jsonc` attach `oceanlive.org` and `www.oceanlive.org` to the Worker as
custom domains; Cloudflare creates the DNS records and certificates on the first deploy.

## Licences

The site is part of Ocean Live and falls under the repository's `LICENSE`, except these
third-party works, which stay under their own licences: the 3D model and everything drawn from
it (`public/models/ocean.glb`, `public/img/ocean-blueprint.svg`, `public/email/header.*`, and
`tools/source/ocean-source.glb`) under CC BY 4.0 (see `tools/source/LICENSE-CREDIT.txt`),
three.js under MIT and GSAP under its Standard License (`public/vendor/`), and the fonts under
the SIL Open Font License (`public/fonts/`). `public/credits.html` lists them with links.
