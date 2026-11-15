// Writes /calculators, /roadmap, /community (shells), /about and /press, and copies the press kit files into
// public/press/. Facts come from the owner guide (ask-proxy/knowledge/ocean-guide.md), the site's
// own colours and fonts (public/styles.css) and the committed README; the calculators only do
// arithmetic on what the visitor types and say what they assume.
// Usage (from site/): node tools/build-more.mjs
// The press kit source files live outside the repository (OceanLiveV3/play-assets and badge);
// when they aren't there, the copies already in public/press/ are kept.
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { PUB, REPO, GUIDE_URL, ACCOUNT, esc, path, page, docHero, docPage, crumbs, guideBullet, md } from "./site-layout.mjs";

// ── Numbers the calculators default to, quoted from the guide ──
const trims = guideBullet("The car", "Trims:");
const sportKwh = Number((trims.match(/Sport:\*\*[^*]*?about ([\d.]+) kWh usable/) || [])[1]);
const awdKwh = Number((trims.match(/Ultra\*\*[^*]*?\*\*Extreme\*\*[\s\S]*?about ([\d.]+) kWh usable/) || [])[1]);
if (!(sportKwh > 0 && awdKwh > 0)) throw new Error("usable capacities not found in the guide");
// Just the two "assumes about … kWh usable" sub-bullets of "Trims:", as a list (md renders "\n* " items).
const capacityBullets = trims.split("\n* ").slice(1).filter((x) => /kWh usable/.test(x)).map((x) => `\n* ${x}`).join("");
if (capacityBullets.split("\n* ").length !== 3) throw new Error("expected two capacity bullets under Trims: in the guide");
const charging = guideBullet("The car", "Charging: CCS1");
const acKw = Number((charging.match(/AC charging up to about ([\d.]+) kW/) || [])[1]);
if (!(acKw > 0)) throw new Error("AC charging power not found in the guide");
const twelve = guideBullet("Sleep and the 12 V battery", "What the app says about 12 V voltage");
for (const v of ["12.4 V or more is healthy", "Under 12.0 V the car may", "Over 13.2 V"]) if (!twelve.includes(v)) throw new Error(`12V threshold "${v}" not in the guide`);
const twelveBasics = guideBullet("The car", "The Ocean has a conventional 12 V battery");
const adapterDrain = guideBullet("Sleep and the 12 V battery", "Leaving an OBD adapter plugged in");

let count = 0;
const write = (o) => { page(o); count++; };

// ── /calculators ──
write({
  file: "calculators.html",
  title: "Charging and 12V calculators · Ocean Live",
  description: "Work out how long a Fisker Ocean charge takes and what it costs, and check what a 12V battery voltage means, using the figures in Ocean Live's owner guide.",
  canonical: "https://oceanlive.org/calculators",
  scripts: '<script type="module" src="/js/calculators.js"></script>',
  body: docPage(docHero("Calculators", "Charging and 12V calculators", "Rough numbers from what you type in. Ocean Live itself measures what your own car does."), `
    ${crumbs([["/", "Home"], [null, "Calculators"]])}
    <ul class="toc" aria-label="Calculators">
      <li><a href="#charge">Charging time and cost</a></li>
      <li><a href="#twelve">12V battery check</a></li>
    </ul>

    <h2 id="charge">Charging time and cost</h2>
    <p class="calc-nojs">The calculators need JavaScript. The sums are written out under <a href="#charge-assumptions">What it assumes</a>, if you'd rather do them by hand.</p>
    <form class="calc" id="charge-calc" data-calc="charge" novalidate>
      <div class="calc-grid">
        <div class="field">
          <label for="c-model">Car</label>
          <select id="c-model" class="calc-input">
            <option value="${awdKwh}">Ultra, Extreme or One (about ${awdKwh} kWh usable)</option>
            <option value="${sportKwh}">Sport (about ${sportKwh} kWh usable)</option>
            <option value="custom">My own figure</option>
          </select>
        </div>
        <div class="field">
          <label for="c-kwh">Usable battery (kWh)</label>
          <input id="c-kwh" class="calc-input" type="number" inputmode="decimal" min="1" max="200" step="0.1" value="${awdKwh}">
        </div>
        <div class="field">
          <label for="c-start">Start charge (%)</label>
          <input id="c-start" class="calc-input" type="number" inputmode="numeric" min="0" max="100" step="1" value="20">
        </div>
        <div class="field">
          <label for="c-end">End charge (%)</label>
          <input id="c-end" class="calc-input" type="number" inputmode="numeric" min="0" max="100" step="1" value="80">
        </div>
        <div class="field">
          <label for="c-kw">Average charging power (kW)</label>
          <input id="c-kw" class="calc-input" type="number" inputmode="decimal" min="0.5" max="400" step="0.1" value="${acKw}">
        </div>
        <div class="field">
          <label for="c-loss">Charging losses (%)</label>
          <input id="c-loss" class="calc-input" type="number" inputmode="decimal" min="0" max="50" step="1" value="0">
        </div>
        <div class="field">
          <label for="c-price">Price per kWh</label>
          <input id="c-price" class="calc-input" type="number" inputmode="decimal" min="0" max="10" step="0.01" placeholder="Your price">
        </div>
        <div class="field">
          <label for="c-cur">Currency symbol</label>
          <input id="c-cur" class="calc-input" type="text" maxlength="4" value="$" autocomplete="off">
        </div>
      </div>
      <output class="calc-out" for="c-kwh c-start c-end c-kw c-loss c-price" aria-live="polite"></output>
    </form>
    <h3 id="charge-assumptions">What it assumes</h3>
    <ul>
      <li>Energy into the battery = usable battery × (end % − start %). The default capacities are the ones Ocean Live assumes (from the <a href="${GUIDE_URL}" rel="noopener">owner guide</a>): ${md(capacityBullets)}</li>
      <li>Energy from the charger = energy into the battery ÷ (1 − losses). Losses are 0 unless you enter a figure: some energy is always lost as heat, and how much varies, so the real cost is a bit higher.</li>
      <li>Time = energy from the charger ÷ the average power you enter. Real charging isn't constant: ${md(charging.slice(charging.indexOf("DC fast charging")))} On AC, the guide says the Ocean charges at up to about ${acKw} kW on a suitable charger, so a bigger AC charger won't be faster than that.</li>
      <li>Cost = energy from the charger × your price per kWh (shown once you enter a price). Prices and fees vary by charger and network; nothing here knows your tariff.</li>
      <li>Your own numbers: the app's ${path("Trips")} tab shows each charge's curve, average power and cost, and ${path("Battery", "Battery health")} measures your car's usable capacity.</li>
    </ul>

    <h2 id="twelve">12V battery check</h2>
    <p>${md(twelveBasics)}</p>
    <form class="calc" id="twelve-calc" data-calc="twelve" novalidate>
      <div class="calc-grid">
        <div class="field">
          <label for="t-volts">12V reading (volts)</label>
          <input id="t-volts" class="calc-input" type="number" inputmode="decimal" min="0" max="20" step="0.01" placeholder="12.55">
        </div>
        <fieldset class="field">
          <legend>When was it read?</legend>
          <label class="choice"><input type="radio" name="t-when" value="rest" checked> At rest, after the car slept</label>
          <label class="choice"><input type="radio" name="t-when" value="awake"> While the car was awake or charging</label>
        </fieldset>
      </div>
      <output class="calc-out" for="t-volts" aria-live="polite"></output>
    </form>
    <h3 id="twelve-meaning">What the voltages mean</h3>
    <p>From the owner guide: ${md(twelve.replace(/^What the app says about 12 V voltage:\s*/, ""))}</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th scope="col">Reading</th><th scope="col">What it means</th></tr></thead>
        <tbody>
          <tr><td>12.4 V or more, at rest</td><td>Healthy</td></tr>
          <tr><td>Under 12.4 V, at rest</td><td>The 12V battery is weak or something draws power while parked</td></tr>
          <tr><td>Under 12.0 V</td><td>The car may not wake up</td></tr>
          <tr><td>Over 13.2 V</td><td>The car's DC-DC converter is charging the 12V, normal while it's awake</td></tr>
        </tbody>
      </table>
    </div>
    <p>${md(adapterDrain)} Ocean Live's 12V screen and <strong>Watch 12V while the car sleeps</strong> read this for you: see <a href="/glossary/12v-resting-voltage">12V resting voltage</a>.</p>
    <p class="file-meta">These calculators run in your browser and send nothing anywhere. Not a dealer diagnosis.</p>`),
});

// ── /roadmap ──
write({
  file: "roadmap.html",
  title: "Roadmap · Ocean Live",
  description: "What's planned for Ocean Live, what's being worked on and what's done, with how many owners voted for each.",
  canonical: "https://oceanlive.org/roadmap",
  scripts: '<script type="module" src="/js/roadmap.js"></script>',
  body: docPage(docHero("Roadmap", "What's coming to Ocean Live", "Planned, in progress and done. Owners vote for what matters most to them."), `
    ${crumbs([["/", "Home"], [null, "Roadmap"]])}
    <div class="callout">
      <p><strong>Vote with your Ocean Live account.</strong> Sign in at <a href="${ACCOUNT}roadmap" rel="noopener">account.oceanlive.org</a> to vote for the items you want (one vote per item; you can take it back). Have an idea that isn't here? Tell "Any questions?" in the app, or <a href="${REPO}/issues/new/choose" rel="noopener">open an issue</a>.</p>
    </div>
    <div class="roadmap" data-roadmap>
      <p class="roadmap-status" role="status" aria-live="polite">Loading the roadmap…</p>
      <section class="roadmap-col" data-status="in_progress" aria-labelledby="rm-progress" hidden>
        <h2 id="rm-progress">In progress</h2>
        <ul class="roadmap-list"></ul>
      </section>
      <section class="roadmap-col" data-status="planned" aria-labelledby="rm-planned" hidden>
        <h2 id="rm-planned">Planned</h2>
        <ul class="roadmap-list"></ul>
      </section>
      <section class="roadmap-col" data-status="done" aria-labelledby="rm-done" hidden>
        <h2 id="rm-done">Done</h2>
        <ul class="roadmap-list"></ul>
      </section>
    </div>
    <p class="calc-nojs">The roadmap list needs JavaScript. What's already shipped is on <a href="/releases">Releases</a>.</p>
    <p class="file-meta">Items and vote counts come from the Ocean Live server. Plans can change. What's already out: <a href="/releases">Releases</a>.</p>`),
});

// ── /community and /community/<id>: owner notes approved on admin.oceanlive.org ──
// These two files are shells: src/worker.js fills them on every request with the approved notes from the
// Ocean Live server (GET /knowledge through the ASK binding), between the <!--notes--> markers and in the
// __NOTE_*__ tokens. Without the server, the list page shows the fallback text that's here.
const NOTE_CAVEAT = "Reported by Fisker Ocean owners and reviewed by Ocean Live before it appears here. Notes may be incomplete; where one disagrees with the <a href=\"" + GUIDE_URL + "\" rel=\"noopener\">owner guide</a>, go with the guide. They are also used in \"Any questions?\" answers.";
write({
  file: "community.html",
  title: "Community notes · Ocean Live",
  description: "Fault code meanings, fixes, tips and car facts shared by Fisker Ocean owners and reviewed by Ocean Live.",
  canonical: "https://oceanlive.org/community",
  body: docPage(docHero("Community", "Notes from Ocean owners", "Fault code meanings, fixes and car facts owners shared in \"Any questions?\", reviewed before they appear."), `
    ${crumbs([["/", "Home"], [null, "Community notes"]])}
    <div class="callout"><p>${NOTE_CAVEAT}</p></div>
    <!--notes--><p>The notes aren't available right now. Try again later, or see <a href="/codes">Fault codes</a> and <a href="/help">Help</a>.</p><!--/notes-->
    <h2 id="share">Share what you know</h2>
    <p>Tell "Any questions?" in the app what a fault code meant on your car, a fix that worked or a fact about the Ocean. It's sent to Ocean Live for review and appears here only once it's approved, without your name. See the <a href="/privacy#sharing">privacy policy</a>.</p>`),
});
write({
  file: "community/note.html",
  title: "__NOTE_TITLE__ · Ocean Live community notes",
  description: "__NOTE_DESCRIPTION__",
  canonical: "https://oceanlive.org/community/__NOTE_ID__",
  body: docPage(docHero("__NOTE_KIND__", "__NOTE_TITLE__", "A note from an Ocean owner, reviewed by Ocean Live."), `
    ${crumbs([["/", "Home"], ["/community", "Community notes"], [null, "__NOTE_TITLE__"]])}
    <!--note--><p>This note isn't available.</p><!--/note-->
    <div class="callout"><p>${NOTE_CAVEAT}</p></div>
    <p class="file-meta">More: <a href="/community">all community notes</a>, <a href="/codes">fault codes</a>, <a href="/glossary">glossary</a>.</p>`),
});

// ── /about ──
write({
  file: "about.html",
  title: "About Ocean Live",
  description: "Ocean Live is an independent, owner-made app for the Fisker Ocean: who makes it, what it does, and how to get in touch.",
  canonical: "https://oceanlive.org/about",
  body: docPage(docHero("About", "About Ocean Live", "An independent app for the Fisker Ocean, made by an Ocean owner."), `
    ${crumbs([["/", "Home"], [null, "About"]])}
    <h2 id="what">What it is</h2>
    <p>Ocean Live shows battery, 12V, trips and fault codes for the Fisker Ocean, read from the car through a Bluetooth OBD adapter. There's an Android app with a Wear OS app, widget and Android Auto, and an iPhone app with an Apple Watch app, widgets, a charging Live Activity and CarPlay. Both phone apps have the same features.</p>
    <ul>
      <li><strong>Live</strong>: charge, range, power, and the current charge or drive.</li>
      <li><strong>Battery</strong>: battery health measured from your own charging, cells, temperatures, insulation resistance and a shareable report.</li>
      <li><strong>12V</strong>: the 12V history and an optional watch while the car sleeps, without keeping the car awake.</li>
      <li><strong>Trips</strong>: drives, charges, charging curves and costs.</li>
      <li><strong>Faults</strong>: fault codes from 39 modules, with descriptions when known. See <a href="/codes">Fault codes</a>.</li>
      <li><strong>"Any questions?"</strong>: ask about your Ocean or the app; answers come from an owner guide and can be wrong.</li>
    </ul>
    <p>More in <a href="/help">Help</a> and on the <a href="/">home page</a>.</p>

    <h2 id="who">Who makes it</h2>
    <p>Ocean Live is made by an independent Fisker Ocean owner, for other owners. It isn't made by Fisker, a dealer or a workshop.</p>
    <div class="callout sand">
      <p>Ocean Live is not affiliated with or endorsed by Fisker Inc. "Fisker" and "Fisker Ocean" are trademarks of their respective owners and are used only to describe the car the app works with.</p>
    </div>

    <h2 id="principles">How it works</h2>
    <ul>
      <li>No ads and no tracking. What the app reads from your car stays on your phone, apart from what you choose to send (see the <a href="/privacy">privacy policy</a>).</li>
      <li>${md(guideBullet("Sleep and the 12 V battery", "Ocean Live stops talking to the car"))}</li>
      <li>The source is public on <a href="${REPO}" rel="noopener">GitHub</a> under the Ocean Live <a href="${REPO}/blob/main/LICENSE" rel="noopener">licence</a>.</li>
    </ul>

    <h2 id="contact">Contact</h2>
    <p>Email <a href="mailto:justice@oceanlive.org">justice@oceanlive.org</a>, or <a href="${REPO}/issues/new/choose" rel="noopener">open an issue on GitHub</a> (issues are public). For a security problem, <a href="${REPO}/security/advisories/new" rel="noopener">report a vulnerability</a> privately. Writing about Ocean Live? See the <a href="/press">press kit</a>.</p>
    <p class="file-meta">Service status: <a href="https://status.oceanlive.org/" rel="noopener">status.oceanlive.org</a>. What's new: <a href="/releases">Releases</a>. What's next: <a href="/roadmap">Roadmap</a>.</p>`),
});

// ── /press: copy the kit, then the page ──
const OCEANLIVE = new URL("../../../../OceanLiveV3/", import.meta.url);
const KIT = [
  ["play-assets/play-icon-512.png", "ocean-live-icon-512.png", "App icon", "512 × 512 PNG"],
  ["play-assets/feature-graphic-1024x500.png", "ocean-live-feature-graphic-1024x500.png", "Feature graphic", "1024 × 500 PNG"],
  ["play-assets/feature-graphic.svg", "ocean-live-feature-graphic.svg", "Feature graphic", "SVG"],
  ["badge/early-supporter-badge-512.png", "early-supporter-badge-512.png", "Early supporter badge", "512 × 512 PNG"],
  ["badge/early-supporter-badge.svg", "early-supporter-badge.svg", "Early supporter badge", "SVG"],
];
const PRESS = new URL("press/", PUB);
mkdirSync(PRESS, { recursive: true });
for (const [from, to] of KIT) {
  const src = new URL(from, OCEANLIVE);
  if (existsSync(src)) copyFileSync(src, new URL(to, PRESS));
  if (!existsSync(new URL(to, PRESS))) throw new Error(`press kit file missing: ${to} (from ${from})`);
}
const kb = (f) => Math.round(statSync(new URL(f, PRESS)).size / 1024);

// Colours and fonts from the site's own stylesheet.
const css = readFileSync(new URL("styles.css", PUB), "utf8");
const token = (name) => { const m = css.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`)); if (!m) throw new Error(`--${name} not in styles.css`); return m[1].toUpperCase(); };
const COLOURS = [["paper", "Deep navy (background)"], ["paper-deep", "Darker navy"], ["ink", "Ink (text)"], ["ink-muted", "Muted ink"], ["cyan", "Cyan (accent)"], ["amber", "Amber"], ["red", "Coral red"], ["green", "Green"]]
  .map(([n, label]) => ({ label, hex: token(n), cls: `sw-${n}` }));

const SHORT = "Battery, 12V, trips and fault codes for the Fisker Ocean, read from the car through a Bluetooth OBD adapter.";
write({
  file: "press.html",
  title: "Press kit · Ocean Live",
  description: "The Ocean Live press kit: app icon, feature graphic, Early supporter badge, colours, fonts, descriptions and contact.",
  canonical: "https://oceanlive.org/press",
  body: docPage(docHero("Press", "Press kit", "Logos, artwork, colours, fonts and descriptions for writing about Ocean Live."), `
    ${crumbs([["/", "Home"], ["/about", "About"], [null, "Press kit"]])}
    <ul class="toc" aria-label="Sections">
      <li><a href="#artwork">Artwork</a></li>
      <li><a href="#descriptions">Descriptions</a></li>
      <li><a href="#colours">Colours</a></li>
      <li><a href="#fonts">Fonts</a></li>
      <li><a href="#contact">Contact</a></li>
    </ul>

    <h2 id="artwork">Artwork</h2>
    <div class="press-grid">
      <figure class="press-item">
        <img src="/press/ocean-live-icon-512.png" width="512" height="512" alt="The Ocean Live app icon" loading="lazy" decoding="async">
        <figcaption>App icon · <a href="/press/ocean-live-icon-512.png" download>PNG, 512 × 512 (${kb("ocean-live-icon-512.png")} KB)</a></figcaption>
      </figure>
      <figure class="press-item wide">
        <img src="/press/ocean-live-feature-graphic-1024x500.png" width="1024" height="500" alt="The Ocean Live feature graphic" loading="lazy" decoding="async">
        <figcaption>Feature graphic · <a href="/press/ocean-live-feature-graphic-1024x500.png" download>PNG, 1024 × 500 (${kb("ocean-live-feature-graphic-1024x500.png")} KB)</a> · <a href="/press/ocean-live-feature-graphic.svg" download>SVG</a></figcaption>
      </figure>
      <figure class="press-item">
        <img src="/press/early-supporter-badge.svg" width="512" height="512" alt="The Early supporter badge" loading="lazy" decoding="async">
        <figcaption>Early supporter badge, for owners who pre-registered or pre-ordered (<a href="/preregistration-terms">terms</a>) · <a href="/press/early-supporter-badge-512.png" download>PNG, 512 × 512</a> · <a href="/press/early-supporter-badge.svg" download>SVG</a></figcaption>
      </figure>
    </div>
    <p>Please don't change the artwork or combine it with Fisker logos. Ocean Live uses no Fisker logos, wordmarks or photos.</p>

    <h2 id="descriptions">Descriptions</h2>
    <h3 id="short">Short</h3>
    <blockquote class="guide-quote"><p>${SHORT}</p></blockquote>
    <h3 id="long">Long</h3>
    <blockquote class="guide-quote">
      <p>Ocean Live is an independent, owner-made app for the Fisker Ocean. Through a Bluetooth OBD adapter it shows live charge, battery health measured from your own charging, a 12V battery monitor, trips and charging costs, and fault codes from 39 modules, with Android Auto, CarPlay, widgets and Wear OS and Apple Watch apps. "Any questions?" answers questions about the car and the app from an owner guide. No ads, no tracking: what the app reads from your car stays on your phone.</p>
      <p>Ocean Live is not affiliated with or endorsed by Fisker Inc.</p>
    </blockquote>
    <p>Name: <strong>Ocean Live</strong> (two words). Platforms: Android, Wear OS, iPhone and Apple Watch. Website: oceanlive.org.</p>

    <h2 id="colours">Colours</h2>
    <ul class="swatches">
${COLOURS.map((c) => `      <li><span class="swatch ${c.cls}" aria-hidden="true"></span><strong>${c.label}</strong> <code>${c.hex}</code></li>`).join("\n")}
    </ul>

    <h2 id="fonts">Fonts</h2>
    <ul>
      <li><strong>Space Grotesk</strong> for headings, <strong>Inter</strong> for text and <strong>Architects Daughter</strong> for hand-drawn notes. All three are under the SIL Open Font License (see <a href="/credits#fonts">Credits</a>).</li>
    </ul>

    <h2 id="contact">Contact</h2>
    <p>Email <a href="mailto:justice@oceanlive.org">justice@oceanlive.org</a>. More about who makes Ocean Live: <a href="/about">About</a>.</p>`),
});

console.log(`build-more: ${count} pages, press kit ${KIT.length} files`);
