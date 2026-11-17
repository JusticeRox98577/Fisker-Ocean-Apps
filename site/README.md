# oceanlive.org

The Ocean Live website: what the app does, the Android downloads, help, fault codes, the
mailing list sign-up, and the privacy policy and account pages the app stores link to.

It is plain HTML, CSS and JavaScript ES modules, with no frameworks, no cookies, no analytics
and no third-party requests: fonts, scripts, the 3D model and the downloads are all served from
oceanlive.org. A small Cloudflare Worker serves the files and passes the mailing list's public
endpoints on to the mail Worker (`mail/`) and the public roadmap on to the app server
(`ask-proxy/`), fills the community notes pages from the app server and serves the APK
downloads from Cloudflare R2, so the pages only ever talk to oceanlive.org.

## Pages

| Page | What it is |
| --- | --- |
| `/` (`public/index.html`) | Home page: the scroll story over a hand-drawn 3D blueprint of the Ocean (live data, doors, 12V, fault codes, platforms, what you need, downloads, privacy, car sleep, FAQ) |
| `/help` | How to use the app: the adapter, getting connected, each tab, the 12V watch, car screens and watches, your account, troubleshooting |
| `/codes` | How Ocean fault codes are built, the codes confirmed on real Ocean cars (with search), the modules the app scans and when clearing codes is safe |
| `/news`, `/list/confirm`, `/list/unsubscribe` | Mailing list sign-up, and the pages its emails link to |
| `/privacy` | Privacy policy, the same text as `PRIVACY.md` |
| `/delete-account` | How to delete an account and what is deleted |
| `/preregistration-terms` | Terms of the Google Play pre-registration reward |
| `/credits` | Credits and licences |
| `/codes/<code>` | One page per fault code confirmed on Ocean cars |
| `/modules`, `/modules/<id>` | The 39 modules the app scans, one page each |
| `/glossary`, `/glossary/<term>` | What the readings in the app mean, one page each |
| `/releases`, `/releases/<version>` | Every release from `CHANGELOG.md`, one page each |
| `/calculators` | Charging time and cost, and a 12V battery check |
| `/roadmap` | What is planned, in progress and done, with vote counts (voting is on account.oceanlive.org) |
| `/community`, `/community/<id>` | Notes from Ocean owners, approved on the admin page (filled in by the Worker) |
| `/about`, `/press` | Who makes Ocean Live, and the press kit |
| `/site-index` | Every page, grouped |

The fault code, module and glossary pages are made only from the public owner guide
(`ask-proxy/knowledge/ocean-guide.md`) and the app's own module list; they are not a full code table.

## How it is organised

| Path | What it is |
| --- | --- |
| `public/` | Everything the site serves |
| `public/styles.css`, `public/app.js` | Shared styles and script |
| `public/js/` | Page modules: the mailing list forms, the fault code search, the calculators, the roadmap and the 3D blueprint (`js/scene/`) |
| `public/data/ocean-codes.json` | The data behind `/codes` |
| `src/worker.js` | The Worker script for `/api/*` (the mailing list and the roadmap), the community notes pages and the APK downloads |
| `tools/` | Node scripts that write the generated pages, the code data, the 3D model and the blueprint drawing, and check the site |
| `design-system/` | The site's design notes |

The 3D blueprint only starts with WebGL 2, and never with reduced motion or Save-Data; those
visitors see a static drawing instead.

## Licences

The site is part of Ocean Live and falls under the repository's `LICENSE`, except these
third-party works, which stay under their own licences: the 3D model and everything drawn from
it (`public/models/ocean.glb`, `public/img/ocean-blueprint.svg`, `public/email/header.*`, and
`tools/source/ocean-source.glb`) under CC BY 4.0 (see `tools/source/LICENSE-CREDIT.txt`),
three.js under MIT and GSAP under its Standard License (`public/vendor/`), and the fonts under
the SIL Open Font License (`public/fonts/`). `public/credits.html` lists them with links.
