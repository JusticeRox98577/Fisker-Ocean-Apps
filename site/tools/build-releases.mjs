// Writes /releases (every version in CHANGELOG.md, newest first) and one page per release
// (/releases/3-4-0 etc.), from the committed CHANGELOG.md and nothing else. The "Unreleased"
// section is shown on /releases as what's coming next. Run whenever CHANGELOG.md changes.
// Usage (from site/): node tools/build-releases.mjs
import { readFileSync } from "node:fs";
import { REPO, esc, page, docHero, docPage, crumbs } from "./site-layout.mjs";

const changelog = readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8").replace(/\r\n?/g, "\n");

// "## x.y.z" (or "## Unreleased") sections, each a list of "* " bullets with indented continuation lines.
const sections = [];
for (const line of changelog.split("\n")) {
  const h = line.match(/^## (.+?)\s*$/);
  if (h) { sections.push({ title: h[1], bullets: [] }); continue; }
  const cur = sections[sections.length - 1];
  if (!cur) continue;
  if (/^\* /.test(line)) cur.bullets.push(line.slice(2).trim());
  else if (/^\s+\S/.test(line) && cur.bullets.length) cur.bullets[cur.bullets.length - 1] += " " + line.trim();
}
const VERSION = /^\d+\.\d+\.\d+$/;
const releases = sections.filter((s) => VERSION.test(s.title));
const upcoming = sections.find((s) => /^unreleased$/i.test(s.title));
if (releases.length < 3) throw new Error("too few releases parsed from CHANGELOG.md");
const cmp = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); return y[0] - x[0] || y[1] - x[1] || y[2] - x[2]; };
releases.sort((a, b) => cmp(a.title, b.title));
const slug = (v) => v.replace(/\./g, "-");
const latest = releases[0].title;

// Changelog markdown: **bold**, `code`, escape the rest. Bare oceanlive.org paths become links
// when they are pages on this site.
const inline = (s) => esc(s)
  .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/\boceanlive\.org\/(help|codes|news|privacy|preregistration-terms|calculators|releases|roadmap|about|press|glossary|modules|site-index)\b/g, '<a href="/$1">oceanlive.org/$1</a>');
const list = (bullets) => `<ul class="release-notes">\n${bullets.map((b) => `      <li>${inline(b)}</li>`).join("\n")}\n    </ul>`;
const summary = (bullets) => esc(bullets[0].replace(/\*\*|`/g, "").split(/[:.]/)[0]).slice(0, 120);

const getIt = `<h2 id="get">Get it</h2>
    <ul>
      <li>Android phone and Wear OS: the APKs in <a href="/#download">Downloads</a> (also on <a href="${REPO}/releases" rel="noopener">GitHub Releases</a>).</li>
      <li>Google Play: the open test. <a href="https://groups.google.com/g/Ocean-Live_Testing" rel="noopener">Join the testers group</a>, then <a href="https://play.google.com/apps/testing/com.justicemw.oceanlive" rel="noopener">join the test on Google Play</a>.</li>
      <li>iPhone and Apple Watch: <a href="https://testflight.apple.com/join/5CEUXxa2" rel="noopener">the TestFlight beta</a>.</li>
    </ul>`;

let count = 0;
page({
  file: "releases.html",
  title: "Releases · Ocean Live",
  description: `Every Ocean Live release, newest first: what changed in each version of the Fisker Ocean app. The latest is ${latest}.`,
  canonical: "https://oceanlive.org/releases",
  body: docPage(docHero("Releases", "What's new in Ocean Live", `Every version, newest first. The latest is ${latest}.`), `
    ${crumbs([["/", "Home"], [null, "Releases"]])}
    <ul class="toc" aria-label="Versions">
${upcoming && upcoming.bullets.length ? `      <li><a href="#next">Coming next</a></li>\n` : ""}${releases.map((r) => `      <li><a href="#v${slug(r.title)}">${r.title}</a></li>`).join("\n")}
    </ul>
${upcoming && upcoming.bullets.length ? `
    <h2 id="next">Coming next</h2>
    <p>Not released yet: what the changelog lists for the next version.</p>
    ${list(upcoming.bullets)}` : ""}
${releases.map((r, i) => `
    <h2 id="v${slug(r.title)}"><a href="/releases/${slug(r.title)}">${r.title}</a>${i === 0 ? ' <span class="tag-inline">Latest</span>' : ""}</h2>
    ${list(r.bullets)}
    <p class="file-meta"><a href="/releases/${slug(r.title)}">Page for ${r.title}</a></p>`).join("\n")}

    ${getIt}
    <p class="file-meta">Made from the <a href="${REPO}/blob/main/CHANGELOG.md" rel="noopener">changelog</a>. Want an email for each release? <a href="/news">News by email</a>. What's planned: <a href="/roadmap">Roadmap</a>.</p>`),
});
count++;

releases.forEach((r, i) => {
  const newer = releases[i - 1], older = releases[i + 1];
  page({
    file: `releases/${slug(r.title)}.html`,
    title: `Ocean Live ${r.title} · Releases`,
    description: `What changed in Ocean Live ${r.title} for the Fisker Ocean: ${summary(r.bullets)}.`,
    canonical: `https://oceanlive.org/releases/${slug(r.title)}`,
    body: docPage(docHero("Release", `Ocean Live ${r.title}`, i === 0 ? "The latest release." : `An earlier release. The latest is <a href="/releases/${slug(latest)}">${latest}</a>.`), `
    ${crumbs([["/", "Home"], ["/releases", "Releases"], [null, r.title]])}
    <h2 id="changes">What changed</h2>
    ${list(r.bullets)}
${i === 0 ? `
    ${getIt}` : `
    <div class="callout"><p>This isn't the latest version. Get <a href="/releases/${slug(latest)}">${latest}</a> from <a href="/#download">Downloads</a>.</p></div>`}

    <h2 id="more">Other versions</h2>
    <ul class="pager">
      ${newer ? `<li><a href="/releases/${slug(newer.title)}" rel="next">← ${newer.title} (newer)</a></li>` : ""}
      <li><a href="/releases">All releases</a></li>
      ${older ? `<li><a href="/releases/${slug(older.title)}" rel="prev">${older.title} (older) →</a></li>` : ""}
    </ul>
    <p class="file-meta">Made from the <a href="${REPO}/blob/main/CHANGELOG.md" rel="noopener">changelog</a>.</p>`),
  });
  count++;
});
console.log(`build-releases: ${count} pages (${releases.length} releases, latest ${latest})`);
