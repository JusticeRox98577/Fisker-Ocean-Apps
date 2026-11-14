// Static checks for public/: every local reference resolves to a file, in-page anchors exist,
// the CSP hash matches the inline import map, and nothing loads from a third party (the CSP's
// connect-src is 'self' only and every fetch is same-origin).
// Usage (from site/): node tools/check-site.mjs
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative, resolve, extname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../public/", import.meta.url));
const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); } })(ROOT);
const rel = (p) => relative(ROOT, p).split("\\").join("/");
let problems = 0, checked = 0;
const fail = (where, msg) => { problems++; console.log(`FAIL ${where}: ${msg}`); };

// Map a site URL path to a file the static-assets Worker would serve.
function resolveUrl(path) {
  const clean = decodeURIComponent(path.split("#")[0].split("?")[0]);
  if (clean === "" || clean === "/") return join(ROOT, "index.html");
  const p = join(ROOT, clean);
  if (existsSync(p) && statSync(p).isFile()) return p;
  if (existsSync(p + ".html")) return p + ".html";
  if (existsSync(join(p, "index.html"))) return join(p, "index.html");
  return null;
}
const ids = new Map();
const idsOf = (file) => {
  if (!ids.has(file)) ids.set(file, new Set([...readFileSync(file, "utf8").matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  return ids.get(file);
};
function checkRef(where, url, base) {
  if (/^(mailto:|tel:|data:|javascript:)/.test(url)) return;
  if (/^https?:\/\//.test(url)) return;
  checked++;
  let target;
  if (url.startsWith("#")) target = base;
  else if (url.startsWith("/")) target = resolveUrl(url);
  else target = resolveUrl("/" + rel(resolve(dirname(base), url.split("#")[0])));
  if (!target) return fail(where, `${url} does not resolve`);
  const hash = url.includes("#") ? url.split("#")[1] : "";
  if (hash && target.endsWith(".html") && !idsOf(target).has(hash)) fail(where, `${url}: no id="${hash}" in ${rel(target)}`);
}

// HTML: src, href, import map, inline styles/scripts, third-party loads.
const ALLOWED_LINKS = /^https:\/\/(github\.com|play\.google\.com|sketchfab\.com|creativecommons\.org|www\.anthropic\.com|threejs\.org|gsap\.com|oceanlive\.org|testflight\.apple\.com|groups\.google\.com)\//;
for (const f of files.filter((f) => f.endsWith(".html"))) {
  const html = readFileSync(f, "utf8");
  const where = rel(f);
  for (const m of html.matchAll(/\s(src|href)="([^"]+)"/g)) {
    const [, attr, url] = m;
    if (/^https?:/.test(url)) {
      const tag = html.slice(html.lastIndexOf("<", m.index), m.index + 1);
      const loads = attr === "src" || /<link[^>]*rel="(stylesheet|preload|modulepreload|icon)"/.test(tag + html.slice(m.index, html.indexOf(">", m.index)));
      if (loads) fail(where, `third-party resource ${url}`);
      else if (!ALLOWED_LINKS.test(url)) fail(where, `unexpected external link ${url}`);
      continue;
    }
    checkRef(where, url, f);
  }
  if (/\sstyle="/.test(html)) fail(where, "inline style attribute (blocked by the CSP)");
  if (/<style[\s>]/.test(html)) fail(where, "inline <style> (blocked by the CSP)");
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/type="(application\/ld\+json)"/.test(m[1])) continue;
    if (/type="importmap"/.test(m[1])) {
      const hash = "sha256-" + createHash("sha256").update(m[2]).digest("base64");
      const headers = readFileSync(join(ROOT, "_headers"), "utf8");
      if (!headers.includes(`'${hash}'`)) fail(where, `import map hash ${hash} is not in the CSP`);
      for (const [k, v] of Object.entries(JSON.parse(m[2]).imports)) {
        if (k.endsWith("/")) { if (!existsSync(join(ROOT, v))) fail(where, `import map ${k} -> ${v} missing`); }
        else checkRef(where + " importmap", v, f);
      }
      continue;
    }
    fail(where, "inline script (blocked by the CSP)");
  }
  if (/@(gmail|googlemail)\.com/i.test(html)) fail(where, "personal email address");
  if (!/not affiliated with or endorsed by Fisker Inc\./.test(html)) fail(where, "missing the Fisker disclaimer");
  if (!html.includes('href="/credits"')) fail(where, "no link to /credits");
  if (!html.includes("security/advisories/new")) fail(where, "no Report a vulnerability link");
  if (/SECURITY\.md" rel="noopener">Report a vulnerability/.test(html)) fail(where, "Report a vulnerability points at SECURITY.md");
}

// JS modules: static imports, dynamic imports, fetch and loaded scripts.
const importMap = JSON.parse(readFileSync(join(ROOT, "index.html"), "utf8").match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
function resolveSpecifier(spec, from) {
  if (spec.startsWith("/")) return join(ROOT, spec);
  if (spec.startsWith(".")) return resolve(dirname(from), spec);
  for (const [k, v] of Object.entries(importMap)) {
    if (k.endsWith("/") ? spec.startsWith(k) : spec === k) return join(ROOT, k.endsWith("/") ? v + spec.slice(k.length) : v);
  }
  return null;
}
for (const f of files.filter((f) => f.endsWith(".js") && !rel(f).startsWith("vendor/gsap/"))) {
  const src = readFileSync(f, "utf8");
  const where = rel(f);
  const specs = [
    ...[...src.matchAll(/(?:^|[;\s}])(?:import|export)\s*(?:[^'"`;]*?from\s*)?["']([^"']+)["']/g)].map((m) => m[1]),
    ...[...src.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
  ];
  for (const s of specs) {
    checked++;
    const target = resolveSpecifier(s, f);
    if (!target || !existsSync(target)) fail(where, `import "${s}" does not resolve`);
  }
  for (const m of src.matchAll(/(?:fetch|loadModel|load)\(\s*["'](\/[^/"'][^"']*)["']/g)) {
    // /downloads/ is staged by tools/deploy.mjs at deploy time and is never in git.
    if (m[1].startsWith("/downloads/")) {
      if (m[1].startsWith("/downloads/preview/")) fail(where, `the pages must not use the preview channel (${m[1]})`);
      continue;
    }
    checked++;
    if (!resolveUrl(m[1])) fail(where, `${m[1]} does not resolve`);
  }
  // Same origin only: no fetch to a full or protocol-relative URL, and no GitHub API any more.
  for (const m of src.matchAll(/fetch\(\s*["'`]((?:https?:)?\/\/[^"'`]+)["'`]/g)) fail(where, `fetch to another origin ${m[1]}`);
  if (!rel(f).startsWith("vendor/") && /api\.github\.com/.test(src)) fail(where, "uses the GitHub API (the site makes no third-party requests)");
}

// CSP: no third-party connections, and the download headers are in place.
{
  const headers = readFileSync(join(ROOT, "_headers"), "utf8");
  const csp = (headers.match(/Content-Security-Policy:([^\n]*)/) || [])[1] || "";
  const connect = ((csp.match(/connect-src([^;]*)/) || [])[1] || "").trim();
  if (connect !== "'self'") fail("_headers", `connect-src must be 'self' only, got "${connect}"`);
  for (const rule of ["/downloads/*.apk", "/downloads/*latest.json"]) {
    if (!new RegExp("^" + rule.replace(/[.*]/g, "\\$&") + "\\r?$", "m").test(headers)) fail("_headers", `no ${rule} rule`);
  }
  if (!headers.includes("application/vnd.android.package-archive")) fail("_headers", "APKs need Content-Type application/vnd.android.package-archive");
}

// CSS url(...)
for (const f of files.filter((f) => f.endsWith(".css"))) {
  for (const m of readFileSync(f, "utf8").matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
    if (m[1].startsWith("data:") || m[1].startsWith("#")) continue;
    if (/^https?:/.test(m[1])) { fail(rel(f), `third-party url ${m[1]}`); continue; }
    checkRef(rel(f), m[1], f);
  }
}

// Sizes worth watching.
const size = (p) => statSync(join(ROOT, p)).size;
console.log(`model ${size("models/ocean.glb")} bytes, three ${size("vendor/three/three.module.min.js")} bytes`);
if (existsSync(join(ROOT, "models/ocean-source.glb"))) fail("models", "ocean-source.glb must not be in public/");
if (size("models/ocean.glb") > 600 * 1024) fail("models", "ocean.glb is over 600 KB");
console.log(`${files.length} files, ${checked} references checked, ${problems} problem(s)`);
process.exit(problems ? 1 : 0);
