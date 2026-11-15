// The shared page shell for every generated page on oceanlive.org: head, header with the main
// navigation, and the footer (copied from public/index.html so the two never drift apart).
// Used by build-pages.mjs, build-reference.mjs, build-releases.mjs, build-more.mjs and
// build-index.mjs. The home page (public/index.html) is written by hand.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

export const PUB = new URL("../public/", import.meta.url);
export const REPO = "https://github.com/JusticeRox98577/Fisker-Ocean-Apps";
export const GUIDE_URL = `${REPO}/blob/main/ask-proxy/knowledge/ocean-guide.md`;
export const ACCOUNT = "https://account.oceanlive.org/";
const LOGO = `<picture class="brand-logo"><source srcset="/icons/logo-rounded-96.webp" type="image/webp"><img src="/icons/logo-rounded-96.png" width="34" height="34" alt="" decoding="async"></picture>`;

export const index = readFileSync(new URL("index.html", PUB), "utf8");
const footer = index.slice(index.indexOf('<footer class="site-footer">'), index.indexOf("</footer>") + "</footer>".length);
if (!footer.startsWith("<footer")) throw new Error("footer not found in index.html");

export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const path = (...steps) => `<span class="path">${steps.map((s) => `<span>${s}</span>`).join("<i>→</i>")}</span>`;

// The main navigation on every generated page (the home page has its own, with in-page anchors).
const NAV = [
  ["/#features", "Features"],
  ["/help", "Help"],
  ["/codes", "Fault codes"],
  ["/calculators", "Calculators"],
  ["/releases", "Releases"],
  ["/roadmap", "Roadmap"],
  ["/site-index", "All pages"],
];

// A breadcrumb for the top of a sheet: [[href, label], ..., [null, current label]].
export const crumbs = (list) => `<nav class="crumbs" aria-label="Breadcrumb"><ol>${list.map(([href, label]) => href ? `<li><a href="${href}">${label}</a></li>` : `<li aria-current="page">${label}</li>`).join("")}</ol></nav>`;

export function page({ file, title, description, canonical, body, noindex = false, scripts = "" }) {
  const current = canonical ? new URL(canonical).pathname : "";
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
${NAV.map(([href, label]) => `      <li><a href="${href}"${current === href ? ' aria-current="page"' : ""}>${label}</a></li>`).join("\n")}
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

export const docHero = (eyebrow, h1, sub) => `<section class="doc-hero">
  <div class="wrap narrow">
    <div class="lightbar" aria-hidden="true"></div>
    <div class="eyebrow">${eyebrow}</div>
    <h1>${h1}</h1>
    <p>${sub}</p>
  </div>
</section>`;

// A document page body: hero plus one sheet.
export const docPage = (hero, inner) => `
${hero}

<article class="doc">
  <div class="wrap narrow">
    <div class="sheet">
${inner.trim()}
    </div>
  </div>
</article>`;

// ── The owner guide (ask-proxy/knowledge/ocean-guide.md), the source of the reference pages ──
export const guide = readFileSync(new URL("../../ask-proxy/knowledge/ocean-guide.md", import.meta.url), "utf8").replace(/\r\n?/g, "\n");

// The lines under a heading, up to the next heading of any level.
export function guideSection(title) {
  const lines = guide.split("\n");
  const start = lines.findIndex((l) => /^#{2,3} /.test(l) && l.replace(/^#+ /, "").trim() === title);
  if (start < 0) throw new Error(`"${title}" not found in ocean-guide.md`);
  const end = lines.findIndex((l, i) => i > start && /^#{1,3} /.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
}

// The top-level "* " bullets of a section, each joined into one line. Nested "  * " bullets stay as
// "\n* item" lines after it, which md() and mdQuote() render as a list.
export function guideBullets(title) {
  const out = [];
  for (const line of guideSection(title).split("\n")) {
    if (/^\* /.test(line)) out.push(line.slice(2).trim());
    else if (/^\s+\* /.test(line) && out.length) out[out.length - 1] += "\n* " + line.trim().slice(2).trim();
    else if (/^\s+\S/.test(line) && out.length) out[out.length - 1] += " " + line.trim();
  }
  return out;
}

// The one bullet in a section that starts with (or, failing that, contains) the given text.
export function guideBullet(title, text) {
  const all = guideBullets(title);
  const hit = all.find((b) => b.startsWith(text)) || all.find((b) => b.includes(text));
  if (!hit) throw new Error(`no bullet with "${text}" under "${title}" in ocean-guide.md`);
  return hit;
}

// Guide markdown (bold, code) to HTML, escaping everything else.
const mdInline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");
const subList = (subs) => (subs.length ? `<ul>${subs.map((x) => `<li>${mdInline(x)}</li>`).join("")}</ul>` : "");
// A guide bullet's text, with any nested bullets as a <ul> after it (fine inside an <li>, not inside a <p>).
export const md = (s) => {
  const [head, ...subs] = s.split("\n* ");
  return mdInline(head) + subList(subs);
};
// A guide bullet as block content: its text in a <p>, nested bullets as a <ul> after the paragraph.
export const mdQuote = (s) => {
  const [head, ...subs] = s.split("\n* ");
  return `<p>${mdInline(head)}</p>${subList(subs)}`;
};

// ── The modules the app scans, from the app's own code (android/.../obd/Pids.kt: Ecus.scanList) ──
// Each: { id, name, restart: "offered" | "safety" | "unsupported" }.
export function scannedModules() {
  const src = readFileSync(new URL("../../android/app/src/main/java/com/justicemw/oceanlive/obd/Pids.kt", import.meta.url), "utf8");
  const defs = new Map();
  for (const m of src.matchAll(/(?:val (\w+) = )?Ecu\("([A-Z0-9_]+)", "([^"]+)", "[0-9A-F]{3}", "[0-9A-F]{3}"([^)]*)\)/g)) {
    const flags = m[4];
    defs.set(m[1] || m[2], {
      id: m[2], name: m[3],
      restart: /safetyCritical = true/.test(flags) ? "safety" : /canRestart = false/.test(flags) ? "unsupported" : "offered",
    });
  }
  const list = src.slice(src.indexOf("val scanList = listOf("));
  const body = list.slice(0, list.indexOf("\n    )"));
  const out = [];
  for (const m of body.matchAll(/Ecu\("([A-Z0-9_]+)"|\b([A-Z]{2,})\b(?=,)/g)) {
    const key = m[1] || m[2];
    const def = defs.get(key) || [...defs.values()].find((d) => d.id === key);
    if (def && !out.includes(def)) out.push(def);
  }
  if (out.length < 30) throw new Error(`only ${out.length} modules parsed from Pids.kt`);
  return out;
}
export const moduleSlug = (id) => id.toLowerCase().replace(/_/g, "-");
export const codeSlug = (code) => code.toLowerCase();
