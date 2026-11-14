// Writes the document pages (privacy, delete account, credits, 404) with the shared header and
// footer. The home page (public/index.html) is written by hand. Run after editing a page body here
// or the shared parts: node tools/build-pages.mjs   (from site/)
import { writeFileSync, readFileSync } from "node:fs";

const PUB = new URL("../public/", import.meta.url);
const REPO = "https://github.com/JusticeRox98577/Fisker-Ocean-Apps";
const LOGO = `<picture class="brand-logo"><source srcset="/icons/logo-rounded-96.webp" type="image/webp"><img src="/icons/logo-rounded-96.png" width="34" height="34" alt="" decoding="async"></picture>`;

// The footer is shared with index.html: copy it from there so the two never drift apart.
const index = readFileSync(new URL("index.html", PUB), "utf8");
const footer = index.slice(index.indexOf('<footer class="site-footer">'), index.indexOf("</footer>") + "</footer>".length);
if (!footer.startsWith("<footer")) throw new Error("footer not found in index.html");

function page({ file, title, description, canonical, body, noindex = false }) {
  const html = `<!doctype html>
<html lang="en" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${description}">
${canonical ? `<link rel="canonical" href="${canonical}">\n<meta property="og:url" content="${canonical}">\n` : ""}${noindex ? '<meta name="robots" content="noindex">\n' : ""}<meta name="theme-color" content="#0B2545">
<meta name="color-scheme" content="dark">
<link rel="icon" href="/icons/favicon-32.png" sizes="32x32" type="image/png">
<link rel="icon" href="/icons/favicon-16.png" sizes="16x16" type="image/png">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Ocean Live">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="https://oceanlive.org/icons/icon-512.png">
<meta property="og:image:width" content="512">
<meta property="og:image:height" content="512">
<meta property="og:image:alt" content="The Ocean Live app icon">
<meta name="twitter:card" content="summary">
<link rel="preload" href="/fonts/space-grotesk-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/styles.css">
<script src="/app.js" defer></script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="paper" aria-hidden="true"></div>
<div class="progress" aria-hidden="true"><i></i></div>

<header class="site-header" id="top">
  <nav class="wrap nav" aria-label="Main">
    <a class="brand" href="/" aria-label="Ocean Live home">
      ${LOGO}
      Ocean Live
    </a>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="nav-links">Menu</button>
    <ul class="nav-links" id="nav-links">
      <li><a href="/#live">Live data</a></li>
      <li><a href="/#features">Features</a></li>
      <li><a href="/#battery">12V</a></li>
      <li><a href="/#faults">Fault codes</a></li>
      <li><a href="/#privacy">Privacy</a></li>
      <li><a href="/#faq">FAQ</a></li>
      <li class="nav-menu-only"><a href="/#download">Downloads</a></li>
    </ul>
    <a class="btn btn-primary btn-small nav-cta" href="/#download">Downloads</a>
  </nav>
</header>

<main id="main">
${body.trim()}
</main>

${footer}
</body>
</html>
`;
  writeFileSync(new URL(file, PUB), html);
  console.log("wrote", file, html.length, "bytes");
}

const docHero = (eyebrow, h1, sub) => `<section class="doc-hero">
  <div class="wrap narrow">
    <div class="lightbar" aria-hidden="true"></div>
    <div class="eyebrow">${eyebrow}</div>
    <h1>${h1}</h1>
    <p>${sub}</p>
  </div>
</section>`;

// ── Privacy policy (keep in step with PRIVACY.md in the repository root) ──
page({
  file: "privacy.html",
  title: "Privacy policy · Ocean Live",
  description: "How Ocean Live, the independent Fisker Ocean companion app, handles your data: what stays on your phone, what an account holds, what &quot;Any questions?&quot; sends, and how to have it deleted.",
  canonical: "https://oceanlive.org/privacy",
  body: `
${docHero("Privacy policy", "Ocean Live privacy policy", "Last updated: 13 November 2026 (added: accounts)")}

<article class="doc">
  <div class="wrap narrow">
    <div class="sheet">
    <p>Ocean Live is an independent app made by an owner, Justice MontgomeryWalkup, for other Fisker Ocean owners. This policy covers the Android, Wear OS, iPhone and Apple Watch apps.</p>

    <ul class="toc" aria-label="Sections">
      <li><a href="#short">The short version</a></li>
      <li><a href="#stored">What the app reads and stores</a></li>
      <li><a href="#permissions">Permissions</a></li>
      <li><a href="#questions">"Any questions?"</a></li>
      <li><a href="#research-log">Research log</a></li>
      <li><a href="#accounts">Accounts</a></li>
      <li><a href="#abrp">ABRP</a></li>
      <li><a href="#watches">Watches, widgets and car screens</a></li>
      <li><a href="#children">Children</a></li>
      <li><a href="#changes">Changes</a></li>
      <li><a href="#contact">Contact</a></li>
      <li><a href="#website">This website</a></li>
    </ul>

    <div class="summary-box">
      <h2 id="short">The short version</h2>
      <ul>
        <li>No ads, no tracking.</li>
        <li>Version 3.4 has no account. From the next version, the app asks you to sign in once (with Google or a 6-digit email code, and on iPhone also with Sign in with Apple). The account holds your email address and a display name, and you can delete it in the app at any time. See <a href="#accounts">Accounts</a>.</li>
        <li>What the app reads from your car stays on your phone, except what you choose to send below.</li>
        <li>Data leaves your phone only when you sign in or manage your account (opening the account settings checks it with the server), when you ask a question in "Any questions?", or if you turn on live data to A Better Route Planner (ABRP) yourself.</li>
        <li>Questions (and, unless you turn it off, your car's latest readings) are answered by Claude, an AI made by Anthropic, through a small server the developer runs. For research, the developer keeps each question, its answer, the readings sent with it and a random install ID for 90 days, then deletes them.</li>
      </ul>
    </div>

    <h2 id="stored">What the app reads and stores</h2>
    <p>Through your Bluetooth OBD adapter, Ocean Live reads your car's battery data (charge, voltages, current, temperatures, cell voltages, insulation resistance), the 12V battery voltage, the odometer, the VIN and stored fault codes. It keeps your drive, charge, 12V and fault scan history, your settings and any fault code description lists you import.</p>
    <p>All of this is stored only in the app's private storage on your device. It is removed when you delete the app, and you can clear history in the app at any time. Files you choose to share (CSV exports, reports, fault reports) are shared only where you send them.</p>

    <h2 id="permissions">Permissions</h2>
    <ul>
      <li><strong>Bluetooth:</strong> to connect to the OBD adapter. This is how the app gets its data.</li>
      <li><strong>Location:</strong> only if you turn on location sharing for ABRP. It is used only to include your position in the data sent to ABRP, and only while that setting is on.</li>
      <li><strong>Notifications:</strong> for charge alerts and 12V battery warnings, if you turn them on.</li>
      <li><strong>Background activity:</strong> to keep reading during a drive or charge, and, only if you turn on "Watch 12V while the car sleeps", to briefly check the 12V voltage while the car sleeps.</li>
    </ul>

    <h2 id="questions">"Any questions?" (only when you use it)</h2>
    <p>When you send a question, Ocean Live sends it over an encrypted connection to the Ocean Live question server (a Cloudflare Worker run by the developer), which passes it to Anthropic's Claude API to be answered. With the question go:</p>
    <ul>
      <li>the earlier messages of the same chat, so Claude can follow the conversation;</li>
      <li>unless you turn off "Include my car's readings" (on by default): the latest readings the app already has (charge, pack voltage and current, temperatures, cell voltages, insulation resistance, 12V voltage, odometer, driving or charging state), your car model and unit settings, and the fault codes from your last scan in this session. The chat screen shows exactly this text under "Show what's sent". Your VIN and location are never included, and asking never connects to or wakes the car;</li>
      <li>a random ID made for this install. It is not linked to your name, phone or car. If you are signed in, your session goes with it, so the server links the question to your account (see <a href="#accounts">Accounts</a>).</li>
    </ul>

    <h3 id="research-log">Research log</h3>
    <p>Every question is logged for research: to see what owners ask and how good the answers are, and to improve the knowledge Claude answers from. Each log entry holds the date and time, the install ID, your account ID if you are signed in, your phone's language, the question, the earlier messages of that chat, the readings and fault codes sent with it (if any), the answer and its cost. Entries are kept in a database at Cloudflare that only the developer can read, and are deleted automatically after 90 days. Your IP address, VIN and location are never logged. The log is never sold, shared or published, and is not used for advertising.</p>
    <p>The chat screen shows your install ID under "Show what's sent". To have your logged questions deleted, or to ask what is held, open an issue on GitHub with that ID; they are deleted within 30 days. Issues are public: anyone can see what you post there, including the ID. If you'd rather not post the ID publicly, open an issue asking for a private way to send it, without the ID in it. If you don't want your questions logged, don't use "Any questions?". The legal basis in the EU and UK is the developer's legitimate interest in improving the feature you chose to use.</p>
    <p>Apart from the log, the question server keeps counters: questions per account (or per install ID before you sign in) and per network per day (the IP address is turned into a salted hash and never stored as is), deleted after about a day, and the month's total spend. Cloudflare and Anthropic see your IP address as part of the connection.</p>
    <p>Anthropic processes the question to produce the answer under its commercial terms, which do not allow it to train models on this data by default, and keeps it only for a limited time; see <a href="https://www.anthropic.com/legal/privacy" rel="noopener">https://www.anthropic.com/legal/privacy</a>. On your phone, the chat lives only in the app's memory and is gone when you close the app or tap "New chat".</p>
    <p>Don't put personal details in questions. Answers come from an AI and can be wrong; check anything important with a qualified EV shop.</p>

    <h2 id="accounts">Accounts</h2>
    <p>Version 3.4 has no account. From the next version, the app asks you to sign in once before you use it, with Google or with a 6-digit code sent to your email address; the iPhone app also offers Sign in with Apple. There are no passwords. The account keeps your "Any questions?" questions, and their daily limit, secure and tied to you, also when you change phones. Your car data never goes to your account: it stays on your phone, and the app works offline after signing in.</p>
    <p>What the Ocean Live server stores for an account, in the same Cloudflare D1 database as the research log, which only the developer can read:</p>
    <ul>
      <li><strong>The account:</strong> a random account ID, your email address (as verified by Google, by the email code, or by Apple, which may give a private relay address instead), a display name (from Google or Apple at first; you can change it in the app), and when the account was created and last used.</li>
      <li><strong>Sign-in methods:</strong> for each method you have used, the provider (Google, Apple or email) and that provider's ID for you (for email, the address). Signing in with another method that has the same verified email address uses the same account.</li>
      <li><strong>Sessions:</strong> after you sign in, the server gives the app a random session token and keeps only a SHA-256 hash of it, with when it was created and last used. A session lasts 365 days from its last use. Signing out deletes it (if your phone is offline at that moment, the session simply expires).</li>
      <li><strong>Your questions:</strong> questions you ask while signed in are linked to your account, and when you sign in, the questions this install asked before are linked to it too. They are still deleted after 90 days (see <a href="#research-log">Research log</a>).</li>
      <li><strong>Email codes:</strong> when you ask for a code, the server keeps your email address with a hash of the code. The code works for 10 minutes and allows 5 tries. The entry is kept until you use the code or, if unused, removed within a day after it expires; deleting your account also removes it. To limit abuse, the server counts code requests for an hour per email address and per network, stored only as hashes. The sign-in email loads its banner and the app icon from oceanlive.org, so opening it with images shown sends a request to Cloudflare (your IP address and the time), as a visit to the website would.</li>
    </ul>
    <p>Who processes it:</p>
    <ul>
      <li><strong>Cloudflare</strong> runs the server and its database and storage.</li>
      <li><strong>Resend</strong> delivers the sign-in code emails, so it receives your email address and the code.</li>
      <li><strong>Google</strong>, when you sign in with Google: Google tells the server your Google account ID, email address and name, signed so the server can check it is genuine. <strong>Apple</strong> does the same when you use Sign in with Apple on iPhone. The server only downloads Google's and Apple's public keys to check these; it sends them nothing about you.</li>
      <li><strong>Anthropic</strong> only receives questions, as described above.</li>
    </ul>
    <p>The account and its sign-in methods are kept until you delete the account. To delete it, open Ocean Live and go to <span class="path"><span>Settings</span><i>→</i><span>Account</span><i>→</i><span>Delete account</span></span>. This deletes, straight away, the account, its sign-in methods, all its sessions (every device is signed out), the logged questions linked to it and any personal question limit set for it. Car data on your phone is not affected. An email-code entry for your address (see Email codes) is removed too. The short-lived counters above expire on their own within about a day. If you can't use the app any more, see <a href="/delete-account">Delete your Ocean Live account</a>.</p>
    ${/* Owner review: legal basis for account data. */ ""}<p>The legal basis in the EU and UK for account data is performance of a contract (providing the signed-in app and keeping your questions with your account); for the abuse and rate-limit counters it is the developer's legitimate interest.</p>

    <h2 id="abrp">A Better Route Planner (optional)</h2>
    <p>If you enter your own ABRP token and API key, Ocean Live sends live telemetry (charge, power, voltage, current, battery temperature, odometer, charging state and, if you allow it, your location) to ABRP's servers (Iternio) so ABRP can plan your route. That data is handled under ABRP's own privacy policy. Remove the token and key to stop it at any time.</p>

    <h2 id="watches">Watches, widgets and CarPlay / Android Auto</h2>
    <p>The watch apps, widgets, Live Activity, CarPlay and Android Auto only show data your phone already has. The watch receives it directly from your phone through the platform's own phone-to-watch connection.</p>

    <h2 id="children">Children</h2>
    <p>Ocean Live is meant for vehicle owners and is not directed at children.</p>

    <h2 id="changes">Changes</h2>
    <p>If this policy changes, the new version will be posted here with a new date.</p>

    <h2 id="contact">Contact</h2>
    <p>Questions: open an issue at <a href="${REPO}/issues" rel="noopener">${REPO.replace("https://", "")}/issues</a>. For a security problem, <a href="${REPO}/security/advisories/new" rel="noopener">report a vulnerability</a> privately instead.</p>

    <div class="callout sand">
      <h2 id="website">This website</h2>
      <p>oceanlive.org sets no cookies and uses no analytics or trackers. Its fonts, scripts, styles and 3D model are served from oceanlive.org itself, so your browser makes no requests to font or script services. The only request to anyone else: the download section asks GitHub's public API for the latest release, from your browser, so GitHub sees that request (and the download buttons link to GitHub). Account deletion: see <a href="/delete-account">Delete your Ocean Live account</a>.</p>
    </div>
    </div>
  </div>
</article>`,
});

// ── Delete account ──
page({
  file: "delete-account.html",
  title: "Delete your account · Ocean Live",
  description: "How to delete your Ocean Live account in the app, and what is deleted with it.",
  canonical: "https://oceanlive.org/delete-account",
  body: `
${docHero("Account", "Delete your Ocean Live account", "How to delete your account and what gets deleted with it.")}

<article class="doc">
  <div class="wrap narrow">
    <div class="sheet">
    <div class="callout">
      <p>Version 3.4 has no account. From the next version, Ocean Live asks you to sign in once, with no password: with Google or a 6-digit email code, and on iPhone also with Sign in with Apple. The account keeps your "Any questions?" questions secure and tied to you, so you keep them when you change phones. Your car data never goes to your account: it stays on your phone.</p>
    </div>

    <h2 id="in-app">Delete it in the app</h2>
    <p>This is the quickest way, and it takes effect straight away.</p>
    <ol>
      <li>Open Ocean Live and go to <span class="path"><span>Settings</span><i>→</i><span>Account</span><i>→</i><span>Delete account</span></span></li>
      <li>Confirm <strong>Delete your account?</strong></li>
    </ol>
    <p>The app asks the Ocean Live server to delete the account and signs you out on this phone once the server confirms. Deleting can't be undone. If you sign in again later, a new, empty account is made.</p>

    <h2 id="what">What gets deleted</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th scope="col">Data</th><th scope="col">What happens</th></tr></thead>
        <tbody>
          <tr><td>Your account: account ID, email address, display name, created and last-used dates</td><td>Deleted from the Ocean Live server</td></tr>
          <tr><td>Linked sign-in methods (Google, Apple, email) and the provider's ID for you</td><td>Deleted</td></tr>
          <tr><td>Sign-in sessions on all your devices</td><td>Deleted, so every device is signed out</td></tr>
          <tr><td>Logged "Any questions?" questions linked to the account, with their answers and the readings sent with them (this includes questions the phone asked before you signed in, which are linked at sign-in)</td><td>Deleted</td></tr>
          <tr><td>Any personal daily question limit set for your account</td><td>Deleted</td></tr>
          <tr><td>Short-lived counters (questions per day, email code requests per hour), stored only as hashes or IDs</td><td>Not deleted by this; they expire on their own within about a day</td></tr>
          <tr><td>A sign-in code entry (your email address and a hash of a code you asked for but didn't use)</td><td>Deleted. Unused entries are also removed automatically within a day after the code expires</td></tr>
          <tr><td>Car data on your phone (drives, charges, 12V and fault history, settings)</td><td>Not affected. It was never on the server. Clear it in the app or delete the app to remove it.</td></tr>
        </tbody>
      </table>
    </div>
    <p>Questions asked from an install that never signed in aren't linked to any account. They are kept under that install's random ID and deleted automatically after 90 days (see below to have them deleted sooner).</p>

    <h2 id="without-app">Without the app</h2>
    <p>If you no longer have the app, or can't sign in, ask the developer through GitHub:</p>
    <ul>
      <li>Open an issue at <a href="${REPO}/issues/new/choose" rel="noopener">${REPO.replace("https://", "")}/issues</a> asking for your account to be deleted.</li>
      <li>Issues are public: anyone can see what you post there. You can include your <strong>account ID</strong> (shown under Settings, Account) or your <strong>install ID</strong> (shown in the chat under "Show what's sent") to speed things up, or leave them out and ask for a private way to send them.</li>
      <li><strong>Don't post your email address in a public issue.</strong> If it's needed to find your account, the developer will arrange a private way to send it.</li>
    </ul>

    <h2 id="questions-only">Only delete my logged questions</h2>
    <p>To have your logged questions deleted without deleting an account, or to ask what is held, open an issue on GitHub with your install ID from "Show what's sent" (issues are public; to keep the ID private, ask for a private way to send it instead). They are deleted within 30 days. Full details are in the <a href="/privacy#research-log">privacy policy</a>.</p>
    </div>
  </div>
</article>`,
});

// ── Credits ──
page({
  file: "credits.html",
  title: "Credits · Ocean Live",
  description: "Credits and licences for the Ocean Live website: the 3D model, three.js, GSAP and the fonts.",
  canonical: "https://oceanlive.org/credits",
  body: `
${docHero("Credits", "Credits and licences", "The work this website is built with, and the licences it is used under.")}

<article class="doc">
  <div class="wrap narrow">
    <div class="sheet">
    <figure class="page-figure" aria-hidden="true"><img src="/img/ocean-blueprint.svg" width="1526" height="633" alt="" loading="lazy" decoding="async"></figure>

    <h2 id="model">3D model</h2>
    <p><a href="https://sketchfab.com/3d-models/fisker-ocean-low-poly-f506bfe876864c04b68bdfc59070739a" rel="noopener">"Fisker Ocean (low-poly)"</a> by <a href="https://sketchfab.com/LagzDesign" rel="noopener">LagzDesign</a>, from Sketchfab, licensed under <a href="https://creativecommons.org/licenses/by/4.0/" rel="noopener">Creative Commons Attribution 4.0 International (CC BY 4.0)</a>.</p>
    <p>Changes made for this website:</p>
    <ul>
      <li>Texture coordinates and material extensions removed; only positions and normals kept.</li>
      <li>Tyres simplified: the four identical tyres share one mesh with about half the original's vertices (about 89% fewer tyre triangles in total). Meshes welded, deduplicated, quantized and compressed with meshopt.</li>
      <li>On the page: drawn as hand-drawn style lines, the near-side front and rear door panels cut out of the body so they can open, the wheels turned, and the car shaded with this site's own materials and lights.</li>
      <li>The static drawing (<a href="/img/ocean-blueprint.svg">ocean-blueprint.svg</a>) is a side view projected from the model.</li>
      <li>The banner of the sign-in code email (<a href="/email/header.png">header.png</a>) is made from that drawing.</li>
    </ul>
    <p>Neither the model's author nor Fisker Inc. made or endorses this website. No Fisker logos, wordmarks or photos are used.</p>

    <h2 id="three">three.js</h2>
    <p>3D rendering by <a href="https://threejs.org/" rel="noopener">three.js</a> 0.186.1, including its GLTFLoader, meshopt decoder, RoomEnvironment and post-processing add-ons. Copyright 2010-2026 three.js authors. <a href="/vendor/three/LICENSE">MIT licence</a>.</p>

    <h2 id="gsap">GSAP</h2>
    <p>Scroll animation by <a href="https://gsap.com/" rel="noopener">GSAP</a> 3.15.0 and its ScrollTrigger plugin, copyright GreenSock, used unmodified under GSAP's <a href="https://gsap.com/standard-license" rel="noopener">Standard "No Charge" License</a> (<a href="/vendor/gsap/LICENSE.txt">notice</a>).</p>

    <h2 id="fonts">Fonts</h2>
    <p>All three fonts are served from this site and licensed under the SIL Open Font License 1.1:</p>
    <ul>
      <li><strong>Space Grotesk</strong>, copyright 2020 The Space Grotesk Project Authors. <a href="/fonts/OFL-spacegrotesk.txt">Licence</a>.</li>
      <li><strong>Inter</strong>, copyright 2020 The Inter Project Authors. <a href="/fonts/OFL-inter.txt">Licence</a>.</li>
      <li><strong>Architects Daughter</strong>, copyright 2010 Kimberly Geswein. <a href="/fonts/OFL-architectsdaughter.txt">Licence</a>.</li>
    </ul>

    <h2 id="app">Ocean Live</h2>
    <p>The Ocean Live apps and this website are source-available under the Ocean Live <a href="${REPO}/blob/main/LICENSE" rel="noopener">LICENSE</a>, except the third-party works listed above, which stay under their own licences: the 3D model and everything drawn from it (models/ocean.glb, the blueprint drawing and the email banner) under CC BY 4.0, three.js under MIT, GSAP under its Standard License, and the fonts under the SIL Open Font License. Ocean Live is an independent, owner-made app, not affiliated with or endorsed by Fisker Inc.</p>
    </div>
  </div>
</article>`,
});

// ── 404 ──
page({
  file: "404.html",
  title: "Page not found · Ocean Live",
  description: "This page doesn't exist on oceanlive.org.",
  noindex: true,
  body: `
<section class="lost">
  <div class="wrap">
    <figure class="page-figure" aria-hidden="true"><img src="/img/ocean-blueprint.svg" width="1526" height="633" alt="" decoding="async"></figure>
    <h1 class="big">404</h1>
    <p class="note-hand" aria-hidden="true">not on this drawing</p>
    <p>This page drifted out to sea. It may have moved, or the link is wrong.</p>
    <div class="btns">
      <a class="btn btn-primary" href="/">Back to Ocean Live</a>
      <a class="btn btn-ghost" href="/#download">Downloads</a>
    </div>
  </div>
</section>`,
});
