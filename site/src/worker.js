// oceanlive.org: the static site plus tiny proxies for the mailing list and the public roadmap, the
// community notes pages and the APK downloads.
//
// wrangler.jsonc runs this script first only for /api/*, /community* and /downloads/*; every other path is served straight from
// public/ by the assets binding. The mailing list itself lives in the mail Worker (ocean-live-mail,
// bound as MAIL): this script only forwards its three public endpoints to it, so the pages can call
// them same-origin and the site's CSP (connect-src 'self') stays as it is.
//
//   POST /api/list/subscribe     {email, lang, website}  -> {ok:true} or {error:"..."}
//   POST /api/list/confirm       {token}
//   POST /api/list/unsubscribe   {token}, or RFC 8058 one-click (?t=<token>, List-Unsubscribe=One-Click)
//   GET  /api/list/unsubscribe?t=<token>  -> 303 to the unsubscribe page (a GET never unsubscribes)
//   GET  /api/roadmap            -> the public roadmap, from the Ocean Live server (ocean-live-ask,
//                                   bound as ASK, path /roadmap): {items:[{id,title,description,status,votes}]}
//   anything else under /api/    -> 404 JSON
//   GET  /community              -> public/community.html with the approved owner notes listed (from the
//                                   Ocean Live server, ASK binding, path /knowledge); the page's own
//                                   fallback text when the server can't be reached
//   GET  /community/<id>         -> public/community/note.html filled in for that note; 404 page if none
//   GET  /downloads/OceanLive-Android.apk, /downloads/OceanLive-Wear.apk, /downloads/latest.json
//                                -> the APK downloads, from R2 (bucket ocean-live-downloads, bound as DOWNLOADS);
//                                   the same under /downloads/preview/ (unlisted); anything else there is a 404
//
// Plain JS, no dependencies. Tested by tools/worker.test.mjs (node --test).

const PUBLIC = new Set(["/api/list/subscribe", "/api/list/confirm", "/api/list/unsubscribe"]);
const MAX_BODY = 16 * 1024;
const UNAVAILABLE = "The mailing list isn't available right now. Try again later."; // the requests are a few hundred bytes

const API_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};

function json(data, status, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...API_HEADERS, "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}

async function proxy(request, env, url) {
  if (request.method === "GET" && url.pathname === "/api/list/unsubscribe") {
    // Someone opened the List-Unsubscribe link in a browser: show the page with the button. The
    // token moves to the fragment, so it stays out of the page's logs and referrers.
    const t = url.searchParams.get("t") || "";
    const to = new URL("/list/unsubscribe", url.origin);
    if (/^[A-Za-z0-9_-]{1,200}$/.test(t)) to.hash = "t=" + t;
    return new Response(null, { status: 303, headers: { ...API_HEADERS, Location: to.toString() } });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { Allow: "POST" });
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_BODY) return json({ error: "Request too large." }, 413);
  if (!env.MAIL) return json({ error: UNAVAILABLE }, 503);

  // Forward as is (method, query, body and headers, including CF-Connecting-IP for the mail
  // Worker's rate limits), minus the visitor's cookies and credentials: the list needs none.
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY) return json({ error: "Request too large." }, 413);
  const headers = new Headers(request.headers);
  headers.delete("Cookie");
  headers.delete("Authorization");
  headers.delete("Content-Length");
  let res;
  try {
    res = await env.MAIL.fetch(new Request(url.toString(), { method: "POST", headers, body }));
  } catch {
    return json({ error: UNAVAILABLE }, 503);
  }
  // The list's public endpoints never answer 401 or 404. Those come from a mail Worker without the list
  // code (the old one answers "Signed out."), so visitors get the plain "not available" message instead.
  if (res.status === 401 || res.status === 404) return json({ error: UNAVAILABLE }, 503);
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(API_HEADERS)) if (!out.headers.has(k)) out.headers.set(k, v);
  out.headers.delete("Set-Cookie");
  return out;
}

// The roadmap: read-only. Only the fields the page shows are passed on, so nothing else the
// server might add reaches the page. Voting is on account.oceanlive.org, never here.
const ROADMAP = "/api/roadmap";
const ROADMAP_UNAVAILABLE = "The roadmap isn't available right now. Try again later.";
const ROADMAP_STATUSES = new Set(["planned", "in_progress", "done"]);
const MAX_ROADMAP = 512 * 1024;
const text = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

async function roadmap(request, env) {
  if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "Method not allowed." }, 405, { Allow: "GET, HEAD" });
  if (!env.ASK) return json({ error: ROADMAP_UNAVAILABLE }, 503);
  // A fresh request: no cookies, credentials, query or body from the visitor, only their IP for rate limits.
  const headers = new Headers({ Accept: "application/json" });
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) headers.set("CF-Connecting-IP", ip);
  let data;
  try {
    const res = await env.ASK.fetch(new Request("https://api.oceanlive.org/roadmap", { method: "GET", headers }));
    if (!res.ok) return json({ error: ROADMAP_UNAVAILABLE }, 503);
    const raw = await res.text();
    if (raw.length > MAX_ROADMAP) return json({ error: ROADMAP_UNAVAILABLE }, 503);
    data = JSON.parse(raw);
  } catch {
    return json({ error: ROADMAP_UNAVAILABLE }, 503);
  }
  if (!data || !Array.isArray(data.items)) return json({ error: ROADMAP_UNAVAILABLE }, 503);
  const items = data.items
    .filter((i) => i && typeof i === "object" && ROADMAP_STATUSES.has(i.status) && typeof i.title === "string" && i.title.trim())
    .slice(0, 500)
    .map((i) => ({
      id: typeof i.id === "number" || typeof i.id === "string" ? i.id : null,
      title: text(i.title, 200),
      description: text(i.description, 2000),
      status: i.status,
      votes: Number.isFinite(Number(i.votes)) ? Math.max(0, Math.floor(Number(i.votes))) : 0,
    }));
  const res = json({ items }, 200, { "Cache-Control": "public, max-age=60" });
  return request.method === "HEAD" ? new Response(null, { status: 200, headers: res.headers }) : res;
}

// ── Community notes: approved on admin.oceanlive.org, read-only here ──
const NOTE_KINDS = { fault_code: "Fault code", fix_tip: "Fix or tip", car_fact: "Car fact" };
const MAX_NOTES = 512 * 1024;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const day = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : "");

/** The approved notes from the Ocean Live server, cleaned to the fields the pages show; null when unavailable. */
async function fetchNotes(request, env) {
  if (!env.ASK) return null;
  const headers = new Headers({ Accept: "application/json" });
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) headers.set("CF-Connecting-IP", ip);
  try {
    const res = await env.ASK.fetch(new Request("https://api.oceanlive.org/knowledge", { method: "GET", headers }));
    if (!res.ok) return null;
    const raw = await res.text();
    if (raw.length > MAX_NOTES) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.items)) return null;
    return data.items
      .filter((i) => i && typeof i === "object" && Number.isSafeInteger(i.id) && i.id > 0 && NOTE_KINDS[i.kind] && typeof i.title === "string" && i.title.trim())
      .slice(0, 500)
      .map((i) => ({
        id: i.id,
        kind: i.kind,
        title: text(i.title, 200).trim(),
        body: text(i.body, 4000),
        code: typeof i.code === "string" && /^[PCBU][0-9A-F]{4}([0-9A-F]{2})?$/.test(i.code) ? i.code : "",
        created: day(i.created),
        updated: day(i.updated),
      }));
  } catch {
    return null;
  }
}

const label = (n) => `${NOTE_KINDS[n.kind]}${n.code ? ` ${n.code}` : ""}`;
const paragraphs = (body) =>
  body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
// Replaces the text between <!--name--> and <!--/name--> (markers kept out of the result).
const fill = (html, name, inner) => {
  const a = html.indexOf(`<!--${name}-->`), b = html.indexOf(`<!--/${name}-->`);
  return a < 0 || b < a ? html : html.slice(0, a) + inner + html.slice(b + `<!--/${name}-->`.length);
};
const tokens = (html, map) => html.replace(/__NOTE_([A-Z]+)__/g, (m, k) => (k in map ? map[k] : m));

// public/_headers isn't applied to what this script returns, so the pages it fills carry the "/*" block's
// headers themselves. tools/worker.test.mjs checks they match _headers.
const PAGE_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'sha256-pwxGLHz2ww9Fb1OMpo72qpIrr+gd9A5qJ4erId6yMj8='; style-src 'self'; font-src 'self'; img-src 'self'; manifest-src 'self'; connect-src 'self'; worker-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'; object-src 'none'; upgrade-insecure-requests",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "accelerometer=(self), camera=(), geolocation=(), gyroscope=(self), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
};

function htmlResponse(body, status, cache) {
  return new Response(body, {
    status,
    headers: { ...PAGE_HEADERS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": cache },
  });
}

async function asset(env, url, path) {
  return env.ASSETS.fetch(new Request(new URL(path, url.origin).toString(), { method: "GET" }));
}

async function notFound(env, url) {
  const res = await asset(env, url, "/404");
  return htmlResponse(await res.text(), 404, "no-store");
}

async function community(request, env, url) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed.", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const head = request.method === "HEAD";
  const p = url.pathname.replace(/\/+$/, "") || "/";
  if (p === "/community.html") return new Response(null, { status: 301, headers: { Location: "/community", "Cache-Control": "public, max-age=3600" } });
  if (p === "/community") {
    const shell = await (await asset(env, url, "/community")).text();
    const notes = await fetchNotes(request, env);
    if (!notes) return htmlResponse(head ? null : shell, 200, "no-store");
    const list = notes.length
      ? `<ul class="index-list">\n${notes.map((n) => `      <li><a href="/community/${n.id}"><strong>${esc(label(n))}</strong>: ${esc(n.title)}</a></li>`).join("\n")}\n    </ul>`
      : `<p>No notes yet. The first ones appear here once they're approved.</p>`;
    const html = fill(shell, "notes", `<p>${notes.length} note${notes.length === 1 ? "" : "s"}, newest first.</p>\n    ${list}`);
    return htmlResponse(head ? null : html, 200, "public, max-age=300");
  }
  const m = p.match(/^\/community\/([1-9]\d{0,14})$/);
  if (!m) return notFound(env, url);
  const notes = await fetchNotes(request, env);
  if (!notes) return htmlResponse(head ? null : (await (await asset(env, url, "/404")).text()), 503, "no-store");
  const note = notes.find((n) => n.id === Number(m[1]));
  if (!note) return notFound(env, url);
  const shell = await (await asset(env, url, "/community/note")).text();
  const description = note.body.replace(/\s+/g, " ").trim();
  const dates = note.updated && note.updated !== note.created ? `Added ${note.created}, updated ${note.updated}.` : note.created ? `Added ${note.created}.` : "";
  // Tokens first, so text inside the note is never read as a token.
  let html = tokens(shell, {
    TITLE: esc(note.title),
    KIND: esc(label(note)),
    ID: String(note.id),
    DESCRIPTION: esc(description.length > 155 ? `${description.slice(0, 154).trimEnd()}…` : description || note.title),
  });
  html = fill(html, "note", `${paragraphs(note.body)}\n    ${dates ? `<p class="file-meta">${esc(dates)}</p>` : ""}`);
  return htmlResponse(head ? null : html, 200, "public, max-age=300");
}

// ── APK downloads: /downloads/ (stable, the one the pages use) and /downloads/preview/ (unlisted) ──
// The files are in R2. tools/downloads.mjs uploads every build to its own objects, then writes
// <channel>/latest.json last: the public latest.json plus, per file, "object", the R2 key its fixed URL
// serves. So one write switches both files and the version and SHA-256 the pages show, all at once.
// A channel with no latest.json in R2 yet is served from public/ (env.ASSETS), as before R2.
const DOWNLOAD = /^\/downloads\/(preview\/)?(OceanLive-Android\.apk|OceanLive-Wear\.apk|latest\.json)$/;
const DOWNLOAD_KEYS = { "OceanLive-Android.apk": "android", "OceanLive-Wear.apk": "wear" };
// The only objects ever served: one build's folder in the same channel, and the requested file.
// tools/downloads-lib.mjs writes keys of exactly this form.
const DOWNLOAD_OBJECT = /^(stable|preview)\/b\d{1,9}-[0-9a-f]{7,8}\/(OceanLive-(?:Android|Wear)\.apk)$/;
const APK_TYPE = "application/vnd.android.package-archive";
const MAX_LATEST = 64 * 1024;
const DOWNLOAD_UNAVAILABLE = "This download isn't available right now. Try again later.";

// No-cache everywhere: the APK names never change, so a cached copy could be an older build than the
// version and SHA-256 that latest.json and the pages show. Revalidating by ETag is cheap.
function downloadHeaders(channel, extra) {
  const headers = new Headers({ ...PAGE_HEADERS, "Cache-Control": "no-cache", ...extra });
  if (channel === "preview") headers.set("X-Robots-Tag", "noindex");
  return headers;
}

function downloadUnavailable(channel) {
  return new Response(DOWNLOAD_UNAVAILABLE, {
    status: 503,
    headers: downloadHeaders(channel, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "60" }),
  });
}

// If-None-Match compares weakly (W/"x" matches "x"), If-Match strongly. Both take a list, or "*".
function etagListHas(header, etag, weak) {
  return header.split(",").some((t) => {
    t = t.trim();
    return t === "*" || t === etag || (weak && t.replace(/^W\//, "") === etag);
  });
}

// One "bytes=" range: {offset, length}, "unsatisfiable", or null to send the whole file (no Range, several
// ranges or a malformed one, which a server may ignore).
function parseRange(header, size) {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") {
    const n = Number(m[2]);
    if (n === 0) return "unsatisfiable";
    const length = Math.min(n, size);
    return { offset: size - length, length };
  }
  const start = Number(m[1]);
  const end = m[2] === "" ? Infinity : Number(m[2]);
  if (end < start) return null;
  if (start >= size) return "unsatisfiable";
  return { offset: start, length: Math.min(end, size - 1) - start + 1 };
}

// A channel R2 doesn't have yet: whatever public/downloads/ was deployed with, given the headers
// public/_headers used to give it. Anything else from the assets (their 404 page) passes through.
async function downloadFromAssets(request, env, channel, file) {
  const res = await env.ASSETS.fetch(request);
  if (res.status !== 200 && res.status !== 304) return res;
  const out = new Response(res.body, res);
  const set = file === "latest.json"
    ? { "Content-Type": "application/json", "Cache-Control": "no-cache" }
    : { "Content-Type": APK_TYPE, "Content-Disposition": "attachment", "Cache-Control": "no-cache" };
  for (const [k, v] of Object.entries(set)) out.headers.set(k, v);
  out.headers.set("X-Content-Type-Options", "nosniff");
  if (channel === "preview") out.headers.set("X-Robots-Tag", "noindex");
  return out;
}

async function download(request, env, url) {
  const m = DOWNLOAD.exec(url.pathname);
  if (!m) return notFound(env, url);
  const head = request.method === "HEAD";
  if (!head && request.method !== "GET") return new Response("Method not allowed.", { status: 405, headers: { Allow: "GET, HEAD" } });
  const channel = m[1] ? "preview" : "stable";
  const file = m[2];
  if (!env.DOWNLOADS) return downloadFromAssets(request, env, channel, file);
  let latest, raw;
  try {
    latest = await env.DOWNLOADS.get(`${channel}/latest.json`);
    if (latest && latest.size <= MAX_LATEST) raw = await latest.text();
    else if (latest && latest.body) await latest.body.cancel();
  } catch {
    return downloadUnavailable(channel);
  }
  if (!latest) return downloadFromAssets(request, env, channel, file);
  if (raw === undefined) return downloadUnavailable(channel);

  if (file === "latest.json") {
    const headers = downloadHeaders(channel, { "Content-Type": "application/json; charset=utf-8", ETag: latest.httpEtag });
    const inm = request.headers.get("If-None-Match");
    if (inm && etagListHas(inm, latest.httpEtag, true)) return new Response(null, { status: 304, headers });
    return new Response(head ? null : raw, { status: 200, headers });
  }

  // The APK: only the object latest.json names for this file, and only one of the expected form.
  let info;
  try {
    info = JSON.parse(raw);
  } catch {
    return downloadUnavailable(channel);
  }
  const f = info && typeof info.files === "object" && info.files ? info.files[DOWNLOAD_KEYS[file]] : null;
  const o = f && typeof f.object === "string" ? DOWNLOAD_OBJECT.exec(f.object) : null;
  if (!o || o[1] !== channel || o[2] !== file || !Number.isSafeInteger(f.size) || f.size <= 0) return downloadUnavailable(channel);
  const name = typeof f.name === "string" && /^[\w.-]{1,100}\.apk$/.test(f.name) ? f.name : file;
  return downloadApk(request, env.DOWNLOADS, channel, f.object, f.size, name, head);
}

async function downloadApk(request, bucket, channel, key, size, name, head) {
  const fixed = { "Content-Type": APK_TYPE, "Content-Disposition": `attachment; filename="${name}"`, "Accept-Ranges": "bytes" };
  const ifMatch = request.headers.get("If-Match");
  const ifNoneMatch = request.headers.get("If-None-Match");
  let range = head ? null : parseRange(request.headers.get("Range"), size);
  try {
    // HEAD, conditional and range requests look at the object first; a plain GET streams it straight away.
    let meta = null;
    if (head || ifMatch || ifNoneMatch || range) {
      meta = await bucket.head(key);
      // The size latest.json gives must be the object's: a mismatch is never served.
      if (!meta || meta.size !== size) return downloadUnavailable(channel);
      const headers = downloadHeaders(channel, { ...fixed, ETag: meta.httpEtag });
      if (ifMatch && !etagListHas(ifMatch, meta.httpEtag, false)) return new Response(null, { status: 412, headers });
      if (ifNoneMatch && etagListHas(ifNoneMatch, meta.httpEtag, true)) return new Response(null, { status: 304, headers });
      // Resuming a download of another build gets the whole new file, never a mix of two builds.
      const ifRange = request.headers.get("If-Range");
      if (range && ifRange && ifRange.trim() !== meta.httpEtag) range = null;
      if (range === "unsatisfiable") {
        headers.set("Content-Range", `bytes */${size}`);
        return new Response(null, { status: 416, headers });
      }
      if (head) {
        headers.set("Content-Length", String(size));
        return new Response(null, { status: 200, headers });
      }
    }
    const obj = await bucket.get(key, range ? { range: { offset: range.offset, length: range.length } } : {});
    if (!obj || !obj.body || obj.size !== size || (meta && obj.etag !== meta.etag)) {
      if (obj && obj.body) await obj.body.cancel();
      return downloadUnavailable(channel);
    }
    const headers = downloadHeaders(channel, { ...fixed, ETag: obj.httpEtag });
    if (!range) {
      headers.set("Content-Length", String(size));
      return new Response(obj.body, { status: 200, headers });
    }
    headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`);
    headers.set("Content-Length", String(range.length));
    return new Response(obj.body, { status: 206, headers });
  } catch {
    return downloadUnavailable(channel);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/downloads/")) return download(request, env, url);
    if (url.pathname === "/community" || url.pathname.startsWith("/community/") || url.pathname === "/community.html") return community(request, env, url);
    if (url.pathname === ROADMAP) return roadmap(request, env);
    if (PUBLIC.has(url.pathname)) return proxy(request, env, url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return json({ error: "Not found." }, 404);
    return env.ASSETS.fetch(request);
  },
};
