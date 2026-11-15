// Writes the document pages (privacy, delete account, pre-registration terms, credits, help, fault
// codes, news, the mailing list's confirm and unsubscribe pages, 404) with the shared header and
// footer. The home page (public/index.html) is written by hand. Run after editing a page body here
// or the shared parts: node tools/build-pages.mjs   (from site/). The fault codes page reads
// public/data/ocean-codes.json: run tools/build-codes.mjs first when the owner guide changes.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

const PUB = new URL("../public/", import.meta.url);
const REPO = "https://github.com/JusticeRox98577/Fisker-Ocean-Apps";
const LOGO = `<picture class="brand-logo"><source srcset="/icons/logo-rounded-96.webp" type="image/webp"><img src="/icons/logo-rounded-96.png" width="34" height="34" alt="" decoding="async"></picture>`;

// The footer is shared with index.html: copy it from there so the two never drift apart.
const index = readFileSync(new URL("index.html", PUB), "utf8");
const footer = index.slice(index.indexOf('<footer class="site-footer">'), index.indexOf("</footer>") + "</footer>".length);
if (!footer.startsWith("<footer")) throw new Error("footer not found in index.html");

// The mailing list sign-up form is shared with index.html (#news) in the same way.
const LIST_START = "<!-- LIST FORM";
const LIST_END = "<!-- /LIST FORM -->";
const listForm = index.slice(index.indexOf("-->", index.indexOf(LIST_START)) + 3, index.indexOf(LIST_END)).trim();
if (!listForm.startsWith('<form class="list-form"')) throw new Error("mailing list form not found in index.html");
const LIST_JS = '<script type="module" src="/js/list.js"></script>';

// The confirmed Ocean codes, modules and suffixes, from the owner guide (tools/build-codes.mjs).
const CODES = JSON.parse(readFileSync(new URL("data/ocean-codes.json", PUB), "utf8"));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ACCOUNT = "https://account.oceanlive.org/";
const path = (...steps) => `<span class="path">${steps.map((s) => `<span>${s}</span>`).join("<i>→</i>")}</span>`;

function page({ file, title, description, canonical, body, noindex = false, scripts = "" }) {
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
${scripts ? `${scripts}\n` : ""}</head>
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
  // Always LF, whatever line endings the checkout (or index.html) has, so pages never end up mixed.
  mkdirSync(new URL(".", new URL(file, PUB)), { recursive: true });
  writeFileSync(new URL(file, PUB), html.replace(/\r\n?/g, "\n"));
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
  description: "How Ocean Live, the independent Fisker Ocean companion app, handles your data: what stays on your phone, what an account holds (including its balance and rewards), what &quot;Any questions?&quot; sends, the email list, and how to have it deleted.",
  canonical: "https://oceanlive.org/privacy",
  body: `
${docHero("Privacy policy", "Ocean Live privacy policy", "Last updated: 15 November 2026 (added: mailing list, tester invitations, account website, balance and pre-registration rewards)")}

<article class="doc">
  <div class="wrap narrow">
    <div class="sheet">
    <p>Ocean Live is an independent app made by an owner, Justice MontgomeryWalkup, for other Fisker Ocean owners. This policy covers the Android, Wear OS, iPhone and Apple Watch apps, and the Ocean Live mailing list.</p>

    <ul class="toc" aria-label="Sections">
      <li><a href="#short">The short version</a></li>
      <li><a href="#stored">What the app reads and stores</a></li>
      <li><a href="#permissions">Permissions</a></li>
      <li><a href="#questions">"Any questions?"</a></li>
      <li><a href="#research-log">Research log</a></li>
      <li><a href="#accounts">Accounts</a></li>
      <li><a href="#account-website">Account website</a></li>
      <li><a href="#balance-and-rewards">Balance and rewards</a></li>
      <li><a href="#abrp">ABRP</a></li>
      <li><a href="#watches">Watches, widgets and car screens</a></li>
      <li><a href="#mailing-list">Mailing list</a></li>
      <li><a href="#children">Children</a></li>
      <li><a href="#changes">Changes</a></li>
      <li><a href="#contact">Contact</a></li>
      <li><a href="#website">This website</a></li>
    </ul>

    <div class="summary-box">
      <h2 id="short">The short version</h2>
      <ul>
        <li>No ads, no tracking.</li>
        <li>From version 3.4, the app asks you to sign in once (with Google or a 6-digit email code, and on iPhone also with Sign in with Apple). The account holds your email address and a display name, and you can delete it at any time, in the app or at account.oceanlive.org. See <a href="#accounts">Accounts</a>.</li>
        <li>Your account can hold a balance of Ocean Live credit and badges, such as the US$5 and Early supporter badge for pre-registering on Google Play or pre-ordering on the App Store. See <a href="#balance-and-rewards">Balance and rewards</a>.</li>
        <li>What the app reads from your car stays on your phone, except what you choose to send below.</li>
        <li>Data leaves your phone only when you sign in or manage your account (opening the account settings checks it with the server), when you ask a question in "Any questions?", when the app claims a pre-registration or pre-order reward for your account, or if you turn on live data to A Better Route Planner (ABRP) yourself.</li>
        <li>The mailing list on oceanlive.org is separate from the app and only for people who sign up and confirm. It keeps your email address and language until you unsubscribe. Testers may be asked once by email whether they want to join. See <a href="#mailing-list">Mailing list</a>.</li>
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
    <p>The chat screen shows your install ID under "Show what's sent". To have your logged questions deleted, or to ask what is held, email <a href="mailto:justice@oceanlive.org">justice@oceanlive.org</a> with that ID; they are deleted within 30 days. You can also open an issue on GitHub, but issues are public: anyone can see what you post there, including the ID. If you don't want your questions logged, don't use "Any questions?". The legal basis in the EU and UK is the developer's legitimate interest in improving the feature you chose to use.</p>
    <p>Apart from the log, the question server keeps counters: questions per account (or per install ID before you sign in) and per network per day (the IP address is turned into a salted hash and never stored as is), deleted after about a day, and the month's total spend. Cloudflare and Anthropic see your IP address as part of the connection.</p>
    <p>Anthropic processes the question to produce the answer under its commercial terms, which do not allow it to train models on this data by default, and keeps it only for a limited time; see <a href="https://www.anthropic.com/legal/privacy" rel="noopener">https://www.anthropic.com/legal/privacy</a>. On your phone, the chat lives only in the app's memory and is gone when you close the app or tap "New chat".</p>
    <p>Don't put personal details in questions. Answers come from an AI and can be wrong; check anything important with a qualified EV shop.</p>

    <h2 id="accounts">Accounts</h2>
    <p>From version 3.4, the app asks you to sign in once before you use it, with Google or with a 6-digit code sent to your email address; the iPhone app also offers Sign in with Apple. There are no passwords. The account keeps your "Any questions?" questions, and their daily limit, secure and tied to you, also when you change phones. Your car data never goes to your account: it stays on your phone, and the app works offline after signing in.</p>
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
      <li><strong>Google Play</strong> checks a pre-registration reward when the app claims one (see <a href="#balance-and-rewards">Balance and rewards</a>).</li>
      <li><strong>Anthropic</strong> only receives questions, as described above.</li>
    </ul>
    <p>The account and its sign-in methods are kept until you delete the account. To delete it, open Ocean Live and go to <span class="path"><span>Settings</span><i>→</i><span>Account</span><i>→</i><span>Delete account</span></span>. This deletes, straight away, the account, its sign-in methods, all its sessions (every device is signed out), the logged questions linked to it, any personal question limit set for it, and its balance, ledger and badges (unused credit is lost; only the hashed store reference of a claimed reward stays, see <a href="#balance-and-rewards">Balance and rewards</a>). Car data on your phone is not affected. An email-code entry for your address (see Email codes) is removed too. The short-lived counters above expire on their own within about a day. You can also delete it on the <a href="#account-website">account website</a>. See <a href="/delete-account">Delete your Ocean Live account</a>.</p>
    ${/* Owner review: legal basis for account data. */ ""}<p>The legal basis in the EU and UK for account data is performance of a contract (providing the signed-in app and keeping your questions with your account); for the abuse and rate-limit counters it is the developer's legitimate interest.</p>

    <h3 id="account-website">The account website</h3>
    <p>You can also manage your account without the app at <a href="${ACCOUNT}" rel="noopener">account.oceanlive.org</a>: sign in with a 6-digit email code (or with Google, when it's offered there; Sign in with Apple isn't) to see your account and its sign-in methods, rename it, sign out or delete it. It uses the same account, the same server and the same processors as the app, described above.</p>
    <p>Signing in there sets one cookie. It is strictly necessary: it only keeps you signed in, holds the session token (the server keeps only its hash, as for the app) and is sent only to account.oceanlive.org. A session there lasts 30 days from its last use; signing out ends it and removes the cookie. The account website uses no analytics or trackers. If Sign in with Google is offered there, the page loads Google's sign-in button from Google, so Google sees your IP address when you open it.</p>

    <h3 id="balance-and-rewards">Balance and rewards</h3>
    <p>Your account can hold a balance of Ocean Live credit, and badges. The balance pays for extra "Any questions?" questions after the free daily ones (each costs what that answer cost the developer at Anthropic, rounded up to the next cent), and for Ocean Live add-ons when they're offered. If you pre-registered for Ocean Live on Google Play, or pre-ordered it on the App Store, the app claims US$5 of credit and an Early supporter badge for the account you're signed in to (see the <a href="/preregistration-terms">reward terms</a>).</p>
    <p>What the server stores for this, in the same database as the account:</p>
    <ul>
      <li><strong>Balance:</strong> the amount, in cents, and when it last changed.</li>
      <li><strong>Ledger:</strong> one line per credit or spend, with the amount, the kind (reward, question, add-on or a correction by the developer), a reference and the date. For a question the reference is the question's ID; the ledger line holds only the amount, not the question, and stays after the question itself is deleted at 90 days. For a reward the reference identifies the store purchase so it can't be claimed twice: for Google Play a SHA-256 hash of the purchase token, for the App Store a SHA-256 hash of Apple's ID for your download of the app (its app transaction ID).</li>
      <li><strong>Badges:</strong> which badge the account has and when it was added.</li>
    </ul>
    <p>How a reward is checked:</p>
    <ul>
      <li><strong>Google Play:</strong> Google Play gives the reward to the app as an item. The app confirms it with Google Play straight away, so Google doesn't take it back while you're not signed in yet. When you're signed in, the app sends the item's product ID and purchase token to the Ocean Live server, which asks Google Play's developer API whether it is genuine, and confirms it there if the app hasn't. Google receives only the purchase token it issued; the server tells Google nothing else about you.</li>
      <li><strong>App Store:</strong> the app sends the server the App Store's signed record of your download of the app, which says when you pre-ordered. It also holds the app version, the download date and a value for checking the device. The server checks Apple's signature itself, without contacting Apple, and keeps only a SHA-256 hash of the app transaction ID (in the ledger reference).</li>
    </ul>
    <p>The balance, ledger and badges are kept until you delete the account, and deleting it deletes them straight away. Only one thing stays after the account is deleted: the hashed store reference of a reward it claimed, with its date, in a separate list with no account ID and nothing else, kept with no end date so the same store purchase can never be rewarded twice. The legal basis for that is legitimate interest (preventing the same reward from being paid out twice). Credit has no cash value and can't be moved to another account. The legal basis in the EU and UK is performance of a contract (keeping your credit and badge and letting you spend it).</p>

    <h2 id="abrp">A Better Route Planner (optional)</h2>
    <p>If you enter your own ABRP token and API key, Ocean Live sends live telemetry (charge, power, voltage, current, battery temperature, odometer, charging state and, if you allow it, your location) to ABRP's servers (Iternio) so ABRP can plan your route. That data is handled under ABRP's own privacy policy. Remove the token and key to stop it at any time.</p>

    <h2 id="watches">Watches, widgets and CarPlay / Android Auto</h2>
    <p>The watch apps, widgets, Live Activity, CarPlay and Android Auto only show data your phone already has. The watch receives it directly from your phone through the platform's own phone-to-watch connection.</p>

    <h2 id="mailing-list">Mailing list (only if you sign up)</h2>
    <p>On oceanlive.org you can sign up for Ocean Live news: an email when there's a new release or an important fix, a few times a year. Nobody is added without confirming. After you sign up, you get an email with a link, and you are only on the list once you open it and press <strong>Confirm my subscription</strong>.</p>
    <p>What the Ocean Live mail server stores, in a Cloudflare D1 database that only the developer can read:</p>
    <ul>
      <li>your email address and the language for the emails (English, German, French, Spanish or Dutch, taken from your browser);</li>
      <li>whether you have confirmed, when you signed up and when you confirmed, and which version of the sign-up wording you agreed to;</li>
      <li>until you confirm: a hash of the confirmation code, when it expires and how many confirmation emails were sent;</li>
      <li>a random code for your unsubscribe link;</li>
      <li>for each news email: whether it was sent to you, and the delivery service's message ID or error.</li>
    </ul>
    <p>To limit abuse, the server also counts sign-ups per network for an hour, stored only as a salted hash of the IP address and deleted within about a day. That count is not linked to your email address.</p>
    <p>Why: only to send you Ocean Live news. Your address is never sold or shared, and never used for anything else. The emails have no ads. Like the sign-in email, they load their banner from oceanlive.org, so opening one with images shown sends a request to Cloudflare (your IP address and the time).</p>
    <p>Who processes it: <strong>Cloudflare</strong> stores it and runs the server; <strong>Resend</strong> delivers the emails, so it receives your email address and each email.</p>
    <p>How long: a sign-up that isn't confirmed is deleted after 7 days. Unsubscribing deletes your address straight away. Every email has an unsubscribe link, and mail apps that show an Unsubscribe button (such as Gmail) unsubscribe you in one click. You can also email <a href="mailto:justice@oceanlive.org">justice@oceanlive.org</a> to have your address deleted, or to ask what is held.</p>
    <p>The legal basis in the EU and UK is your consent, which you can withdraw at any time by unsubscribing.</p>
    <h3 id="invitations">Invitations for testers</h3>
    <p>People who test Ocean Live may get <strong>one</strong> email from the developer asking whether they want these news emails. To send it, their email address goes to Resend. It creates an unconfirmed sign-up like the one above: nothing more is sent unless they press <strong>Confirm my subscription</strong>, and if they don't, it is deleted after 7 days like any unconfirmed sign-up.</p>
    <p>So that nobody is invited twice, or after leaving the list, the server keeps a SHA-256 hash of the address (not the address itself) for everyone who was invited, unsubscribed, was removed, or let a sign-up lapse. It is kept with no end date and used for nothing else. A hash can't be read back, but someone who already knows an address can check it against the hash, so it still counts as personal data. Email <a href="mailto:justice@oceanlive.org">justice@oceanlive.org</a> to have it removed (you could then be invited again). The legal basis in the EU and UK is legitimate interests: asking testers once, and respecting the answer.</p>

    <h2 id="children">Children</h2>
    <p>Ocean Live is meant for vehicle owners and is not directed at children.</p>

    <h2 id="changes">Changes</h2>
    <p>If this policy changes, the new version will be posted here with a new date.</p>

    <h2 id="contact">Contact</h2>
    <p>Questions: email <a href="mailto:justice@oceanlive.org">justice@oceanlive.org</a>, or open an issue at <a href="${REPO}/issues" rel="noopener">${REPO.replace("https://", "")}/issues</a>. For a security problem, <a href="${REPO}/security/advisories/new" rel="noopener">report a vulnerability</a> privately instead.</p>

    <div class="callout sand">
      <h2 id="website">This website</h2>
      <p>oceanlive.org sets no cookies and uses no analytics or trackers. (The <a href="#account-website">account website</a>, account.oceanlive.org, sets one strictly necessary sign-in cookie.) The only thing it collects is what you type into the mailing list form, if you sign up (see <a href="#mailing-list">Mailing list</a>). Its fonts, scripts, styles, 3D model and the app downloads (APK files and their version details) are served from oceanlive.org itself, so your browser makes no requests to anyone else. Links to GitHub (source code, releases, issues) only contact GitHub when you follow them. Account deletion: see <a href="/delete-account">Delete your Ocean Live account</a>.</p>
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
      <p>From version 3.4, Ocean Live asks you to sign in once, with no password: with Google or a 6-digit email code, and on iPhone also with Sign in with Apple. The account keeps your "Any questions?" questions secure and tied to you, so you keep them when you change phones. Your car data never goes to your account: it stays on your phone.</p>
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
          <tr><td>Your balance of Ocean Live credit, its ledger of credits and spends, and badges such as Early supporter</td><td>Deleted. Unused credit is lost and can't be paid out</td></tr>
          <tr><td>The SHA-256 hash of the store purchase reference (Google Play purchase token or App Store app transaction ID) of a reward the account claimed, with its date</td><td>Kept, with no account ID or anything else, so the same store purchase can't be rewarded twice</td></tr>
          <tr><td>Short-lived counters (questions per day, email code requests per hour), stored only as hashes or IDs</td><td>Not deleted by this; they expire on their own within about a day</td></tr>
          <tr><td>A sign-in code entry (your email address and a hash of a code you asked for but didn't use)</td><td>Deleted. Unused entries are also removed automatically within a day after the code expires</td></tr>
          <tr><td>Car data on your phone (drives, charges, 12V and fault history, settings)</td><td>Not affected. It was never on the server. Clear it in the app or delete the app to remove it.</td></tr>
        </tbody>
      </table>
    </div>
    <p>Questions asked from an install that never signed in aren't linked to any account. They are kept under that install's random ID and deleted automatically after 90 days (see below to have them deleted sooner).</p>

    <h2 id="without-app">Without the app</h2>
    <p>Go to <a href="${ACCOUNT}" rel="noopener">account.oceanlive.org</a>, sign in with a 6-digit code sent to the email address on your account (or with Google, when it's offered there), and delete the account. It deletes the same data as the app, straight away. Sign in with Apple isn't available there. If you used Apple, ask for the code at the email address on your account: with "Hide My Email" that is Apple's private relay address, which forwards it to you. If the code doesn't arrive, use the app or ask below. That page can't create an account, so a sign-in that matches no account is refused instead of opening an empty one.</p>
    <p>If you can't sign in at all, ask the developer:</p>
    <ul>
      <li>Email <a href="mailto:justice@oceanlive.org">justice@oceanlive.org</a> from the address on your account, asking for your account to be deleted. Or open an issue at <a href="${REPO}/issues/new/choose" rel="noopener">${REPO.replace("https://", "")}/issues</a> (issues are public).</li>
      <li>Issues are public: anyone can see what you post there. You can include your <strong>account ID</strong> (shown under Settings, Account) or your <strong>install ID</strong> (shown in the chat under "Show what's sent") to speed things up, or leave them out and ask for a private way to send them.</li>
      <li><strong>Don't post your email address in a public issue.</strong> If it's needed to find your account, the developer will arrange a private way to send it.</li>
    </ul>

    <h2 id="questions-only">Only delete my logged questions</h2>
    <p>To have your logged questions deleted without deleting an account, or to ask what is held, email <a href="mailto:justice@oceanlive.org">justice@oceanlive.org</a> with your install ID from "Show what's sent" (or open an issue on GitHub; issues are public). They are deleted within 30 days. Full details are in the <a href="/privacy#research-log">privacy policy</a>.</p>
    </div>
  </div>
</article>`,
});

// ── Pre-registration reward terms (the Google Play pre-registration rewards URL) ──
page({
  file: "preregistration-terms.html",
  title: "Pre-registration reward terms · Ocean Live",
  description: "Terms for the Ocean Live pre-registration and pre-order reward: $5 of Ocean Live credit and an Early supporter badge.",
  canonical: "https://oceanlive.org/preregistration-terms",
  body: `
${docHero("Reward", "Pre-registration reward terms", "What you get for pre-registering for Ocean Live on Google Play or pre-ordering it on the App Store, and how it works.")}

<article class="doc">
  <div class="wrap narrow">
    <div class="sheet">
    <h2 id="reward">The reward</h2>
    <p>If you pre-register for Ocean Live on Google Play before it is released there, or pre-order it on the App Store before it is released there, you get:</p>
    <ul>
      <li><strong>US$5 of Ocean Live credit</strong> on your Ocean Live account</li>
      <li>An <strong>Early supporter badge</strong> on your account, shown in the app</li>
    </ul>

    <h2 id="claim">How to get it</h2>
    <h3 id="claim-play">On Google Play (Android)</h3>
    <ol>
      <li>Pre-register on the Ocean Live page on Google Play while pre-registration is open.</li>
      <li>Install Ocean Live from Google Play with the same Google account you pre-registered with.</li>
      <li>Open the app and sign in to your Ocean Live account. The reward is added to the account you're signed in to.</li>
    </ol>
    <p>Google Play hands the reward to the app when you install it, and the app accepts it straight away so Google keeps it for you. If you sign in later, it's added the first time you open the app signed in.</p>
    <h3 id="claim-app-store">On the App Store (iPhone)</h3>
    <ol>
      <li>Pre-order Ocean Live on the App Store while the pre-order is open.</li>
      <li>On release day, the App Store downloads Ocean Live for you. Use the same Apple Account you pre-ordered with.</li>
      <li>Open the app and sign in to your Ocean Live account. The reward is added to the account you're signed in to.</li>
    </ol>
    <p>Test versions from TestFlight don't count as a pre-order. Claim the reward within 12 months after Ocean Live is released on the store you used.</p>

    <h2 id="credit">Using the credit</h2>
    <ul>
      <li>You can spend it on extra "Any questions?" questions beyond the free daily ones, and on Ocean Live add-ons when they're available.</li>
      <li>An extra question costs what its answer cost Ocean Live at Anthropic, rounded up to the next cent (at least 1 cent). The app shows what each one cost and what's left. A question that fails costs nothing, and extra questions per day are limited.</li>
      <li>Extra questions are paid only from your credit. For add-ons, credit is used before any other payment.</li>
      <li>It has no cash value. It can't be exchanged for money, refunded, sold or moved to another account.</li>
      <li>It doesn't expire while Ocean Live offers things to spend it on. If Ocean Live ever stops offering paid features, unused credit ends with them, and we'll say so in the app first.</li>
    </ul>

    <h2 id="limits">Limits</h2>
    <ul>
      <li>One reward per Google account or Apple Account, and one per Ocean Live account, even if you pre-registered on both stores.</li>
      <li>The badge stays on your account until you delete the account. Deleting the account also deletes any unused credit.</li>
      <li>Rewards obtained by abuse (for example, many accounts made to collect credit) may be removed.</li>
      <li>Pre-registration closes when Ocean Live is released on Google Play, and pre-orders close when it is released on the App Store. Ocean Live is free: pre-registering or pre-ordering doesn't oblige you to keep it, and Google and Apple can't charge you for it.</li>
    </ul>

    <h2 id="who">Who runs this</h2>
    <p>Ocean Live is an independent app made by an Ocean owner. Google and Apple are not sponsors of this reward and are not responsible for it. Questions: <a href="mailto:justice@oceanlive.org">justice@oceanlive.org</a>. These terms are governed by the laws of the State of Washington, USA, except where the law where you live gives you rights that can't be waived.</p>
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

// ── News: the mailing list sign-up page ──
page({
  file: "news.html",
  title: "News by email · Ocean Live",
  description: "Get an email when there's a new Ocean Live release or an important fix. A few emails a year, no ads, unsubscribe in one click.",
  canonical: "https://oceanlive.org/news",
  scripts: LIST_JS,
  body: `
${docHero("News", "Ocean Live news by email", "New releases and important fixes, a few times a year.")}

<article class="doc">
  <div class="wrap narrow">
    <div class="sheet">
    ${listForm}

    <h2 id="what">What you get</h2>
    <ul>
      <li>An email when there's a new release of the apps, with what changed.</li>
      <li>An email when there's an important fix, for example one that affects your car's 12V battery or a security problem.</li>
      <li>Nothing else: no ads, and your address is never shared.</li>
    </ul>

    <h2 id="how">How it works</h2>
    <ul>
      <li>After you sign up, we email you a link. You're only on the list once you open it and confirm. If you don't, your address is deleted after 7 days.</li>
      <li>Every email has an unsubscribe link. Unsubscribing deletes your address straight away.</li>
      <li>Details are in the <a href="/privacy#mailing-list">privacy policy</a>. Prefer not to sign up? The <a href="${REPO}/releases" rel="noopener">releases on GitHub</a> and the <a href="${REPO}/blob/main/CHANGELOG.md" rel="noopener">changelog</a> have the same news.</li>
    </ul>
    </div>
  </div>
</article>`,
});

// ── Mailing list: confirm (the link in the confirmation email: /list/confirm#t=<token>) ──
page({
  file: "list/confirm.html",
  title: "Confirm your subscription · Ocean Live",
  description: "Confirm that you want Ocean Live news by email.",
  noindex: true,
  scripts: LIST_JS,
  body: `
${docHero("Mailing list", "Confirm your subscription", "One more step: confirm that you want Ocean Live news by email.")}

<article class="doc">
  <div class="wrap narrow">
    <div class="sheet">
    <div class="list-action" data-list="confirm">
      <p class="list-status" role="status" aria-live="polite" tabindex="-1"></p>
      <button class="btn btn-primary" type="button" hidden>Confirm my subscription</button>
    </div>
    <p class="list-nojs">Confirming needs JavaScript. Turn it on for oceanlive.org and open the link in the email again.</p>
    <p class="file-meta">Didn't sign up? Close this page and you won't hear from us. Unconfirmed sign-ups are deleted after 7 days. <a href="/privacy#mailing-list">Privacy policy</a>.</p>
    </div>
  </div>
</article>`,
});

// ── Mailing list: unsubscribe (the link in every news email: /list/unsubscribe#t=<token>) ──
page({
  file: "list/unsubscribe.html",
  title: "Unsubscribe · Ocean Live",
  description: "Stop Ocean Live news emails and delete your address from the list.",
  noindex: true,
  scripts: LIST_JS,
  body: `
${docHero("Mailing list", "Unsubscribe", "Stop Ocean Live news emails. Your email address is deleted from the list.")}

<article class="doc">
  <div class="wrap narrow">
    <div class="sheet">
    <div class="list-action" data-list="unsubscribe">
      <p class="list-status" role="status" aria-live="polite" tabindex="-1"></p>
      <button class="btn btn-primary" type="button" hidden>Unsubscribe</button>
    </div>
    <p class="list-nojs">Unsubscribing here needs JavaScript. Use the Unsubscribe button in your mail app instead, or email <a href="mailto:justice@oceanlive.org">justice@oceanlive.org</a> and we'll remove you.</p>
    <p class="file-meta">Changed your mind later? You can sign up again at <a href="/news">oceanlive.org/news</a>.</p>
    </div>
  </div>
</article>`,
});

// ── Fault codes: only what the owner guide says (data/ocean-codes.json), never the full code table ──
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const example = CODES.codes.find((e) => e.codes.includes("B208896"));
const suffixKeys = Object.keys(CODES.suffixes).sort();
page({
  file: "codes.html",
  title: "Fisker Ocean fault codes · Ocean Live",
  description: "How Fisker Ocean fault codes are built, the codes confirmed on real Ocean cars, the modules Ocean Live scans, and what to do about a code.",
  canonical: "https://oceanlive.org/codes",
  scripts: '<script type="module" src="/js/codes.js"></script>',
  body: `
${docHero("Fault codes", "Fisker Ocean fault codes", "How the codes are built, the ones confirmed on Ocean cars, and what to do about them.")}

<article class="doc">
  <div class="wrap narrow">
    <div class="sheet">
    <div class="callout sand">
      <p><strong>This is not a full code table.</strong> It lists only codes confirmed on real Ocean cars, and it is not a substitute for a qualified EV technician. When you scan in Ocean Live, the app also describes standard codes, and you can import your own description lists.</p>
    </div>

    <ul class="toc" aria-label="Sections">
      <li><a href="#built">How a code is built</a></li>
      <li><a href="#confirmed">Confirmed Ocean codes</a></li>
      <li><a href="#modules">Modules</a></li>
      <li><a href="#what-to-do">What to do</a></li>
    </ul>

    <h2 id="built">How a code is built</h2>
    <p>A code like <code>B208896</code> has three parts: a letter for the system, four characters for the base code, and two for the failure type. Some scan tools show only the first five characters, or put a dash before the failure type (<code>B2088-96</code>).</p>
    <ul>
      <li><code>B</code>: the system, here ${CODES.systems.B}</li>
      <li><code>2088</code>: the base code, which says what part or signal it is about</li>
      <li><code>96</code>: the failure type, here ${esc(CODES.suffixes["96"])}</li>
    </ul>
    ${example ? `<p>On the Ocean, <code>B208896</code> means: ${esc(example.meaning.toLowerCase())}.</p>` : ""}

    <h3 id="systems">The first letter</h3>
    <div class="table-wrap">
      <table>
        <thead><tr><th scope="col">Letter</th><th scope="col">System</th></tr></thead>
        <tbody>
${Object.entries(CODES.systems).map(([k, v]) => `          <tr><td><code>${esc(k)}</code></td><td>${esc(cap(v))}</td></tr>`).join("\n")}
        </tbody>
      </table>
    </div>

    <h3 id="suffixes">Common failure types (the last two characters)</h3>
    <div class="table-wrap">
      <table>
        <thead><tr><th scope="col">Ending</th><th scope="col">Usually means</th></tr></thead>
        <tbody>
${suffixKeys.map((k) => `          <tr><td><code>${esc(k)}</code></td><td>${esc(cap(CODES.suffixes[k]))}</td></tr>`).join("\n")}
        </tbody>
      </table>
    </div>

    <h3 id="states">Active, pending, stored</h3>
    <p>Ocean Live marks each code <strong>Active now</strong> (the fault is present now), <strong>Pending</strong>, <strong>Stored</strong> (it happened before) or <strong>Warning lamp</strong> (the module asked for a warning light).</p>

    <h2 id="confirmed">Codes confirmed on Ocean cars</h2>
    <p>These codes have been seen and confirmed on real Ocean cars. Search by code (paste one, with or without a dash) or by a word.</p>
    <form class="codes-search" role="search" hidden>
      <label class="codes-label" for="codes-q">Search the confirmed codes</label>
      <input class="codes-input" id="codes-q" type="search" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="search" placeholder="B208896 or steering">
      <p class="codes-status" role="status" aria-live="polite"></p>
    </form>
    <div class="table-wrap">
      <table class="codes-table">
        <thead><tr><th scope="col">Code</th><th scope="col">Meaning</th></tr></thead>
        <tbody>
${CODES.codes.map((e, i) => `          <tr data-i="${i}"><td>${e.codes.map((c) => `<code>${esc(c)}</code>`).join(" ")}</td><td>${esc(e.meaning)}${e.note ? `<span class="code-note">${esc(e.note)}</span>` : ""}</td></tr>`).join("\n")}
        </tbody>
      </table>
    </div>
    <p>Many U-codes (lost communication, signal outdated, integrity check failed) appear after a module was asleep, the 12V dipped, or software was updated, and often clear and stay clear. Codes that come back right after clearing, or that come with a warning on the car's screen, point to a real problem.</p>

    <h2 id="modules">The modules Ocean Live scans</h2>
    <p><strong>Scan all modules</strong> reads stored codes from 39 modules. Their short names, as the app shows them:</p>
    <ul class="modules-list">
${CODES.modules.map((m) => `      <li><strong>${esc(m.ids)}</strong>: ${esc(m.name)}</li>`).join("\n")}
    </ul>

    <h2 id="what-to-do">What to do about a code</h2>
    <ol>
      <li>Scan: open ${path("Faults", "Scan all modules")}. It takes about a minute. Tap <strong>Active now</strong> to see active codes first. <strong>New</strong> marks codes that weren't there in the last scan. Some lists may be incomplete; scanning again usually fills them in.</li>
      <li>Tap a code to see what it affects, possible causes and how it's fixed, when known.</li>
      <li>Tap <strong>Share report</strong> to keep a text report, or to send it to a shop. Do this before clearing anything.</li>
      <li>Not sure? Tap the round <strong>?</strong> at the top and ask "Any questions?". It can see the codes from your last scan (unless you turn off "Include my car's readings").</li>
    </ol>

    <h3 id="clearing">Clearing codes and restarting a module</h3>
    <p><strong>Clear codes</strong> (one module or every module) and <strong>Restart</strong> are the only things in Ocean Live that change anything in the car. Before you use them:</p>
    <ul>
      <li>The car is on and in Park, your foot is on the brake, the charging cable is unplugged and the climate is off.</li>
      <li>The app checks that the car is still and almost no power flows, and stops if that changes. Messages like "The car is moving. Park it first." mean a safety check stopped it.</li>
      <li>Restart is not offered for the brakes, steering, airbags, drive motors, gateway or battery management.</li>
      <li>Clearing erases the history a workshop would use, so share the report first. Clearing doesn't fix anything: codes for faults still present come back straight away. A restart is not a repair.</li>
    </ul>
    <div class="callout">
      <p>Airbag (ACU), brake (ESP, IBOOSTER), steering (EPS) and high-voltage (BMS, PDU, PIU, MCU) faults should go to a qualified EV shop. An insulation (isolation) fault is a safety issue: don't open anything.</p>
    </div>
    <p class="file-meta">This page is made from the <a href="${REPO}/blob/main/ask-proxy/knowledge/ocean-guide.md" rel="noopener">Ocean owner guide</a> that "Any questions?" answers from. More on using the app: <a href="/help">Help</a>.</p>
    </div>
  </div>
</article>`,
});

// ── Help: how to use the app, from the owner guide (ask-proxy/knowledge/ocean-guide.md) and the FAQ ──
page({
  file: "help.html",
  title: "Help · Ocean Live",
  description: "How to use Ocean Live with your Fisker Ocean: the adapter you need, getting connected, each tab, the 12V watch, car screens and watches, your account, and what to do when something doesn't work.",
  canonical: "https://oceanlive.org/help",
  body: `
${docHero("Help", "Using Ocean Live", "Getting connected, what each tab does, the 12V watch, and what to do when something doesn't work.")}

<article class="doc">
  <div class="wrap narrow">
    <div class="sheet">
    <ul class="toc" aria-label="Sections">
      <li><a href="#need">What you need</a></li>
      <li><a href="#connect">Getting connected</a></li>
      <li><a href="#tabs">The tabs</a></li>
      <li><a href="#readings">Readings</a></li>
      <li><a href="#sleep">12V and car sleep</a></li>
      <li><a href="#car-watch">Car screens and watches</a></li>
      <li><a href="#account">Your account</a></li>
      <li><a href="#privacy">Privacy</a></li>
      <li><a href="#trouble">Troubleshooting</a></li>
      <li><a href="#contact">Contact</a></li>
    </ul>

    <h2 id="need">What you need</h2>
    <ul>
      <li>A Bluetooth LE OBD adapter that speaks ELM327. The Vgate vLinker FD+ is the one most Ocean owners use; the OBDLink CX works too. Adapters that only do classic Bluetooth don't work on iPhone.</li>
      <li>Ocean Live on your phone: see <a href="/#download">Downloads</a>.</li>
    </ul>

    <h2 id="connect">Getting connected</h2>
    <ol>
      <li>Plug the adapter into the car's OBD port and turn the car on.</li>
      <li>Open Ocean Live. On the <strong>Live</strong> tab, tap <strong>Find adapter</strong> and pick your adapter.</li>
      <li>The app remembers it. Next time, tap <strong>Connect to</strong> and your adapter's name, or <strong>Choose a different adapter</strong>.</li>
    </ol>
    <p>In ${path("Settings", "Adapter")} you'll find <strong>Connect automatically when the app opens</strong> (on by default) and <strong>Forget saved adapter</strong>. The header shows the state: Connected, Connecting, Looking for adapters, Reconnecting or Not connected. In landscape, a <strong>Connect</strong> / <strong>Disconnect</strong> button sits at the top right.</p>

    <h2 id="tabs">The tabs</h2>
    <p>The Android and iPhone apps have the same five tabs at the bottom (on Android in landscape they move to a strip on the left): Live, Battery, Trips, Faults and Settings. The round <strong>?</strong> at the top opens "Any questions?".</p>

    <h3 id="live">Live</h3>
    <ul>
      <li>The charge ring with state of charge and estimated range, the power going in or out, and whether the car is charging, DC fast charging, driving or parked.</li>
      <li>While charging, <strong>This charge</strong>: energy added, charging time, start time, peak power and the time to your charge alert level. While driving, <strong>This drive</strong>: distance, energy used, efficiency and time.</li>
      <li><strong>Battery</strong>: pack voltage, current, battery temperature, cell spread, odometer and 12V (tap the 12V tile for the 12V screen).</li>
      <li><strong>While parked</strong>: how much charge was lost since the app last saw the car.</li>
      <li>Range is estimated from your own recent drives and the usable capacity set in ${path("Settings", "Car")}.</li>
    </ul>

    <h3 id="battery">Battery</h3>
    <ul>
      <li><strong>Battery health</strong>: measured capacity, usable now and rated usable. The car doesn't report battery health; the app measures it from charging. Keep the app connected through a charge that adds at least 20%. Until then it shows "Not measured yet".</li>
      <li><strong>Parked drain</strong>: the average loss per day while parked.</li>
      <li><strong>Cells</strong>: highest, average and lowest cell voltage and the spread.</li>
      <li><strong>Temperatures</strong> and <strong>High voltage</strong>: battery and coolant temperatures, pack voltage, current, power and isolation resistance, plus the VIN and charging totals.</li>
      <li><strong>Share battery report</strong>: a one-page PDF of all of this and the latest fault scan, for a buyer or a shop. It uses what the app already has and doesn't read from the car.</li>
      <li><strong>See the 12V history</strong>: the 12V graph for 24 hours to 90 days, resting voltages, how often the car charged the 12V and the overnight drop. <strong>Share 12V data</strong> as CSV, a picture or a PDF.</li>
    </ul>

    <h3 id="trips">Trips</h3>
    <ul>
      <li>Filter <strong>All</strong>, <strong>Drives</strong> or <strong>Charges</strong>, with totals, regen and this month's charging and its cost.</li>
      <li>Tap a charge for its <strong>Charging curve</strong> (kW against %), average power, implied capacity and cost. Drives show distance, energy, efficiency and regen.</li>
      <li>Costs need your prices in ${path("Settings", "Charging cost")}. <strong>Export CSV</strong> saves the history. <strong>Clear history</strong> deletes everything, including the data for measuring battery capacity, and can't be undone; you can also delete single entries.</li>
      <li>Drives and charges only appear if the app was connected during them.</li>
    </ul>

    <h3 id="faults">Faults</h3>
    <p><strong>Scan all modules</strong> reads stored fault codes from 39 modules in about a minute. Tap a code for what it affects and how it's fixed, when known. <strong>Share report</strong> sends a text report and <strong>Past scans</strong> keeps earlier ones. ${path("Faults", "Module versions", "Read module versions")} lists each module's software version and part number, and changes nothing. How codes work, the codes confirmed on Ocean cars, and when clearing codes is safe: <a href="/codes">Fault codes</a>.</p>

    <h3 id="settings">Settings</h3>
    <ul>
      <li><strong>Car</strong>: your model and usable battery in kWh, used for range and charge time estimates.</li>
      <li><strong>Charging cost</strong>: currency symbol, home price and DC fast price per kWh.</li>
      <li><strong>Units and screen</strong>: miles, Fahrenheit, and keeping the screen on while connected.</li>
      <li><strong>Adapter</strong>: connect automatically, the saved adapter, and the 12V watch (see <a href="#sleep">12V and car sleep</a>).</li>
      <li><strong>Alerts</strong>: charge alerts (at a high level, at a low level, when charging stops) and <strong>Battery warnings</strong> (12V low, uneven cells, hot pack). They work while the app is connected, also in the background; 12V warnings while the car sleeps need the 12V watch. Your phone must allow notifications.</li>
      <li><strong>ABRP</strong>: to send live data to A Better Route Planner, paste the ABRP generic token (in ABRP: open the car, Live data, Generic) and a free telemetry API key from ABRP. Both are needed. <strong>Include phone location</strong> is optional. ABRP only gets data while the app is connected.</li>
      <li><strong>Advanced</strong>: <strong>Flip current sign</strong>, only if charging shows as using power on your car.</li>
    </ul>

    <h2 id="readings">What some readings mean</h2>
    <ul>
      <li><strong>Cell spread</strong> (highest minus lowest cell voltage): under 60 mV is normal. It widens near empty and full and under heavy load. A spread that keeps growing over weeks is worth a shop check.</li>
      <li><strong>Insulation (isolation) resistance</strong>: how well the high-voltage system is isolated from the car body. Very large values are normal. A value that falls sharply, or an isolation fault code, is a safety issue for a qualified shop: don't open anything.</li>
      <li><strong>Pack temperatures</strong>: a cold pack limits charging and regen; a hot pack limits power.</li>
      <li><strong>Power and current</strong> are positive while energy flows into the pack (charging, regen).</li>
    </ul>

    <h2 id="sleep">12V and car sleep</h2>
    <p>The Ocean's 12V battery runs its computers, locks and contactors. If it goes flat, the car can't start its high-voltage system. Every diagnostic request wakes modules on the car's network, and a car kept awake drains its 12V, so Ocean Live stops talking to the car as soon as it stops answering, and after 10 minutes parked with the app in the background (unless CarPlay or Android Auto is showing it). It never sends keep-alive messages. Messages like "The car is asleep. Ocean Live stopped reading so it can sleep" are normal; opening the app connects again.</p>
    <p><strong>Watch 12V while the car sleeps</strong> (in ${path("Settings", "Adapter")}, off by default) asks only the adapter for its own supply voltage every 30 minutes (or 5 or 10), which puts nothing on the car's network, then disconnects so the adapter sleeps too. On iPhone, iOS only allows occasional background checks, so readings are less regular than on Android.</p>
    <ul>
      <li>12.4 V or more at rest (after the car has slept) is healthy.</li>
      <li>Under 12.4 V at rest means the 12V battery is weak or something draws power while parked. Under 12.0 V the car may not wake up.</li>
      <li>Over 13.2 V means the car is charging its 12V, which is normal while it's awake.</li>
      <li>A healthy car loses only a few hundredths of a volt a night.</li>
    </ul>
    <p>A plugged-in OBD adapter drains the 12V a little (a vLinker FD+ uses about 51 mA awake and 3 mA asleep, by Vgate's figures). If you park for weeks, unplug it. <strong>Keep the adapter connected</strong> is only for adapters that can't be woken over Bluetooth.</p>

    <h2 id="car-watch">Android Auto, CarPlay, watches and widgets</h2>
    <ul>
      <li><strong>Android Auto and CarPlay</strong> show live charge, power, the current charge or drive and the battery readings, updated every second. The phone app must be connected to the adapter.</li>
      <li><strong>Landscape and split screen</strong>: the charge ring on the left, readings and Connect on the right, made for running next to ABRP.</li>
      <li><strong>Wear OS and Apple Watch apps, and widgets</strong> only show what your phone already has; they never talk to the car. The Android widget and the iPhone Home and Lock Screen widgets show charge and range ("Tap to connect" opens the app).</li>
      <li>On iPhone (iOS 18 or later), a <strong>Live Activity</strong> shows charging progress on the Lock Screen and in the Dynamic Island.</li>
    </ul>

    <h2 id="account">Your account</h2>
    <p>From version 3.4, Ocean Live asks you to sign in once, with no password: with Google or a 6-digit code sent to your email, and on iPhone also with Sign in with Apple. The account keeps your "Any questions?" questions tied to you when you change phones. Your car data stays on your phone, and the app works offline after signing in.</p>
    <ul>
      <li>Rename or delete your account in ${path("Settings", "Account")}.</li>
      <li>${path("Settings", "Account")} also shows your balance of Ocean Live credit and any badges. When today's free questions are used up, further questions are paid from the balance, and the chat shows what each one cost and what's left. Pre-registered on Google Play or pre-ordered on the App Store? Sign in and the US$5 reward and Early supporter badge are added; see the <a href="/preregistration-terms">reward terms</a>.</li>
      <li>Without the app, sign in at <a href="${ACCOUNT}" rel="noopener">account.oceanlive.org</a> to see, rename or delete it.</li>
      <li>What deleting removes: <a href="/delete-account">Delete your Ocean Live account</a>.</li>
    </ul>

    <h2 id="privacy">Privacy</h2>
    <p>No ads, no tracking. What the app reads from your car stays on your phone. Data leaves it only when you sign in or manage your account, when you ask "Any questions?" (the chat shows exactly what's sent under <strong>Show what's sent</strong>), when the app claims a pre-registration or pre-order reward, or if you turn on ABRP yourself. Everything is in the <a href="/privacy">privacy policy</a>.</p>

    <h2 id="trouble">Troubleshooting</h2>
    <h3 id="cant-connect">Can't connect</h3>
    <ul>
      <li>Check that Bluetooth is on and Ocean Live has Bluetooth permission, the adapter is plugged in and lit, and the car is on (not asleep).</li>
      <li>Close other apps that may be holding the adapter, including other OBD apps, then tap <strong>Find adapter</strong> again.</li>
      <li>"This doesn't look like an OBD adapter" means a different Bluetooth device was picked.</li>
      <li>"The car was parked with the app closed for 10 minutes" is normal: the app stops on purpose so the 12V doesn't drain. Opening the app (or plugging in the car screen) connects again.</li>
    </ul>
    <h3 id="other-problems">Other messages</h3>
    <ul>
      <li>"The car is moving. Park it first.", "The car is charging. Unplug it first." or "Power is flowing into or out of the battery" mean a safety check stopped a clear or restart. See <a href="/codes#clearing">Clearing codes</a>.</li>
      <li>"Needs a security key Ocean Live doesn't have" means the app can't change that module.</li>
      <li>Battery health says "Not measured yet": keep the app connected through a charge that adds at least 20%.</li>
      <li>A drive or charge is missing: the app only records them while it's connected.</li>
      <li>Charging shows as using power: turn on <strong>Flip current sign</strong> in ${path("Settings", "Advanced")}.</li>
      <li>"Any questions?" or signing in doesn't work: check whether the Ocean Live server is up at <a href="https://status.oceanlive.org/" rel="noopener">status.oceanlive.org</a>.</li>
    </ul>
    <p>More guides are coming. Can't find what you need? Ask "Any questions?" in the app, or get in touch.</p>

    <h2 id="contact">Contact</h2>
    <p>Email <a href="mailto:justice@oceanlive.org">justice@oceanlive.org</a> or <a href="${REPO}/issues/new/choose" rel="noopener">open an issue on GitHub</a> (issues are public). Screenshots or photos from the car help a lot. For a security problem, <a href="${REPO}/security/advisories/new" rel="noopener">report a vulnerability</a> privately instead.</p>
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
