// Writes /site-index (every page on oceanlive.org, grouped) and public/sitemap.xml, by reading the
// pages already in public/: every .html with a canonical URL and no "noindex" is listed. Run last,
// after the other build tools.   Usage (from site/): node tools/build-index.mjs
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { PUB, esc, page, docHero, docPage, crumbs } from "./site-layout.mjs";

const ROOT = fileURLToPath(PUB);
const SELF = "https://oceanlive.org/site-index";
const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : p.endsWith(".html") && files.push(p); } })(ROOT);

const pages = [];
for (const f of files) {
  const html = readFileSync(f, "utf8");
  const canonical = (html.match(/<link rel="canonical" href="([^"]+)">/) || [])[1];
  // community/note.html is a shell the site Worker fills per note (/community/<id>); the list page links them.
  if (!canonical || /<meta name="robots" content="noindex">/.test(html) || canonical === SELF || canonical.includes("__NOTE_")) continue;
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || canonical;
  pages.push({ url: canonical, path: new URL(canonical).pathname, title: title.replace(/\s*·\s*(Ocean Live|Fisker Ocean fault code|Fisker Ocean module|Ocean Live glossary|Releases|Fisker Ocean)\s*$/, ""), file: relative(ROOT, f) });
}
const at = (p) => pages.find((x) => x.path === p);
const under = (prefix) => pages.filter((x) => x.path.startsWith(prefix)).sort((a, b) => a.path.localeCompare(b.path, "en", { numeric: true }));
const byVersion = (a, b) => b.path.localeCompare(a.path, "en", { numeric: true });

const GROUPS = [
  ["start", "Start here", ["/", "/help", "/about", "/news"]],
  ["tools", "Tools", ["/calculators", "/roadmap", "/community"]],
  ["releases", "Releases", ["/releases"], under("/releases/").sort(byVersion)],
  ["codes", "Fault codes", ["/codes"], under("/codes/")],
  ["modules", "Modules", ["/modules"], under("/modules/")],
  ["glossary", "Glossary", ["/glossary"], under("/glossary/")],
  ["project", "Project", ["/press", "/credits"]],
  ["privacy", "Privacy and your account", ["/privacy", "/delete-account", "/preregistration-terms"]],
];
const listed = new Set();
const groups = GROUPS.map(([id, title, main, children = []]) => {
  const items = [...main.map(at).filter(Boolean), ...children];
  items.forEach((x) => listed.add(x.path));
  return { id, title, items };
});
const rest = pages.filter((x) => !listed.has(x.path)).sort((a, b) => a.path.localeCompare(b.path));
if (rest.length) groups.push({ id: "other", title: "Other pages", items: rest });

const homeTitle = (x) => (x.path === "/" ? "Home" : x.title);
page({
  file: "site-index.html",
  title: "All pages · Ocean Live",
  description: "Every page on oceanlive.org in one place: help, calculators, releases, the roadmap, community notes, fault codes, modules, the glossary, privacy and more.",
  canonical: SELF,
  body: docPage(docHero("All pages", "Everything on oceanlive.org", `${pages.length + 1} pages, grouped. Also: <a href="https://account.oceanlive.org/" rel="noopener">your account</a> and <a href="https://status.oceanlive.org/" rel="noopener">service status</a>.`), `
    ${crumbs([["/", "Home"], [null, "All pages"]])}
    <ul class="toc" aria-label="Groups">
${groups.map((g) => `      <li><a href="#${g.id}">${g.title}</a></li>`).join("\n")}
    </ul>
${groups.map((g) => `
    <h2 id="${g.id}">${g.title}</h2>
    <ul class="${g.items.length > 8 ? "index-list cols" : "index-list"}">
${g.items.map((x) => `      <li><a href="${x.path}">${esc(homeTitle(x)).replace(/&amp;(\w+);/g, "&$1;")}</a></li>`).join("\n")}
    </ul>`).join("\n")}`),
});

const urls = [...pages.map((x) => x.url), SELF].sort((a, b) => (a === "https://oceanlive.org/" ? -1 : b === "https://oceanlive.org/" ? 1 : a.localeCompare(b, "en", { numeric: true })));
writeFileSync(new URL("sitemap.xml", PUB), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join("\n")}
</urlset>
`.replace(/\n/g, "\r\n"));
console.log(`build-index: site-index with ${pages.length + 1} pages, sitemap.xml with ${urls.length} URLs`);
