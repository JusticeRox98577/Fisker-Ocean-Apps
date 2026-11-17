// Tests for src/worker.js (the /api/list/* and /api/roadmap proxies, the /community pages and the /downloads/ files),
// with fake MAIL, ASK, ASSETS and DOWNLOADS (R2) bindings.
// Usage (from site/): node --test tools/worker.test.mjs   (Node 20+, no dependencies)
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";

function fakeEnv(reply = () => Response.json({ ok: true })) {
  const calls = { mail: [], assets: [] };
  return {
    calls,
    MAIL: { fetch: async (req) => { calls.mail.push({ req, body: await req.text() }); return reply(req); } },
    ASSETS: { fetch: async (req) => { calls.assets.push(req); return new Response("asset"); } },
  };
}
const post = (path, body, headers = {}) =>
  new Request("https://oceanlive.org" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("subscribe is forwarded with its body, IP header and query, without cookies", async () => {
  const env = fakeEnv();
  const res = await worker.fetch(
    post("/api/list/subscribe", { email: "a@example.com", lang: "de", website: "" }, { "CF-Connecting-IP": "203.0.113.7", Cookie: "s=1" }),
    env,
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.equal(env.calls.mail.length, 1);
  const { req, body } = env.calls.mail[0];
  assert.equal(req.method, "POST");
  assert.equal(new URL(req.url).pathname, "/api/list/subscribe");
  assert.equal(req.headers.get("CF-Connecting-IP"), "203.0.113.7");
  assert.equal(req.headers.get("Content-Type"), "application/json");
  assert.equal(req.headers.get("Cookie"), null);
  assert.deepEqual(JSON.parse(body), { email: "a@example.com", lang: "de", website: "" });
});

test("errors from the mail Worker pass through unchanged", async () => {
  const env = fakeEnv(() => Response.json({ error: "Too many sign-ups from this network. Try again later." }, { status: 429 }));
  const res = await worker.fetch(post("/api/list/subscribe", { email: "a@example.com" }), env);
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: "Too many sign-ups from this network. Try again later." });
});

test("confirm and unsubscribe are forwarded", async () => {
  for (const path of ["/api/list/confirm", "/api/list/unsubscribe"]) {
    const env = fakeEnv();
    const res = await worker.fetch(post(path, { token: "abc" }), env);
    assert.equal(res.status, 200, path);
    assert.equal(new URL(env.calls.mail[0].req.url).pathname, path);
  }
});

test("one-click unsubscribe (RFC 8058) keeps its query and form body", async () => {
  const env = fakeEnv();
  const req = new Request("https://oceanlive.org/api/list/unsubscribe?t=tok_EN-123", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "List-Unsubscribe=One-Click",
  });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 200);
  const sent = env.calls.mail[0];
  assert.equal(new URL(sent.req.url).searchParams.get("t"), "tok_EN-123");
  assert.equal(sent.req.headers.get("Content-Type"), "application/x-www-form-urlencoded");
  assert.equal(sent.body, "List-Unsubscribe=One-Click");
});

test("opening the unsubscribe link with GET goes to the page and unsubscribes nobody", async () => {
  const env = fakeEnv();
  const res = await worker.fetch(new Request("https://oceanlive.org/api/list/unsubscribe?t=tok_123"), env);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("Location"), "https://oceanlive.org/list/unsubscribe#t=tok_123");
  assert.equal(env.calls.mail.length, 0);
  const bad = await worker.fetch(new Request("https://oceanlive.org/api/list/unsubscribe?t=<x>"), env);
  assert.equal(bad.headers.get("Location"), "https://oceanlive.org/list/unsubscribe");
});

test("other methods are refused", async () => {
  const env = fakeEnv();
  const res = await worker.fetch(new Request("https://oceanlive.org/api/list/subscribe"), env);
  assert.equal(res.status, 405);
  assert.equal(res.headers.get("Allow"), "POST");
  assert.ok((await res.json()).error);
  assert.equal(env.calls.mail.length, 0);
});

test("other /api/ paths, including the owner's list endpoints, are 404 JSON", async () => {
  for (const path of ["/api", "/api/", "/api/list", "/api/list/subscribers", "/api/list/campaigns", "/api/me", "/api/list/subscribe/x"]) {
    const env = fakeEnv();
    const res = await worker.fetch(post(path, {}), env);
    assert.equal(res.status, 404, path);
    assert.match(res.headers.get("Content-Type"), /^application\/json/);
    assert.deepEqual(await res.json(), { error: "Not found." });
    assert.equal(env.calls.mail.length, 0, path);
  }
});

test("large bodies are refused before reaching the mail Worker", async () => {
  const env = fakeEnv();
  const res = await worker.fetch(post("/api/list/subscribe", "x".repeat(20000)), env);
  assert.equal(res.status, 413);
  assert.equal(env.calls.mail.length, 0);
});

test("a missing or failing mail Worker gives 503 JSON", async () => {
  const res = await worker.fetch(post("/api/list/subscribe", { email: "a@example.com" }), { ASSETS: fakeEnv().ASSETS });
  assert.equal(res.status, 503);
  assert.ok((await res.json()).error);
  const env = fakeEnv(() => { throw new Error("binding down"); });
  const res2 = await worker.fetch(post("/api/list/subscribe", { email: "a@example.com" }), env);
  assert.equal(res2.status, 503);
});

test("an old mail Worker's 401 or 404 becomes the 503 'not available' message", async () => {
  for (const status of [401, 404]) {
    const env = fakeEnv(() => Response.json({ error: "Signed out." }, { status }));
    const res = await worker.fetch(post("/api/list/subscribe", { email: "a@example.com" }), env);
    assert.equal(res.status, 503, String(status));
    const body = await res.json();
    assert.equal(body.error, "The mailing list isn't available right now. Try again later.");
    assert.equal(res.headers.get("Cache-Control"), "no-store");
  }
});

test("everything else is served from the assets", async () => {
  const env = fakeEnv();
  const res = await worker.fetch(new Request("https://oceanlive.org/news"), env);
  assert.equal(await res.text(), "asset");
  assert.equal(env.calls.assets.length, 1);
  assert.equal(env.calls.mail.length, 0);
});

// ── /api/roadmap -> the ASK binding (ocean-live-ask, path /roadmap) ──
function askEnv(reply) {
  const calls = [];
  return {
    calls,
    ASSETS: { fetch: async () => new Response("asset") },
    ASK: { fetch: async (req) => { calls.push(req); return reply(req); } },
  };
}
const ITEMS = [
  { id: 1, title: "Tyre pressures", description: "Show them on Live", status: "planned", votes: 4 },
  { id: 2, title: "Charging history", description: "", status: "done", votes: 0 },
];

test("roadmap GET is forwarded to the ASK binding at /roadmap without cookies or query", async () => {
  const env = askEnv(() => Response.json({ items: ITEMS }));
  const res = await worker.fetch(new Request("https://oceanlive.org/api/roadmap?x=1", {
    headers: { Cookie: "s=1", Authorization: "Bearer t", "CF-Connecting-IP": "203.0.113.9" },
  }), env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { items: ITEMS });
  assert.match(res.headers.get("Content-Type"), /^application\/json/);
  assert.equal(env.calls.length, 1);
  const req = env.calls[0];
  assert.equal(req.method, "GET");
  assert.equal(new URL(req.url).pathname, "/roadmap");
  assert.equal(new URL(req.url).search, "");
  assert.equal(req.headers.get("Cookie"), null);
  assert.equal(req.headers.get("Authorization"), null);
  assert.equal(req.headers.get("CF-Connecting-IP"), "203.0.113.9");
});

test("roadmap passes on only the contract's fields and valid items", async () => {
  const env = askEnv(() => Response.json({
    items: [
      { id: 3, title: "<b>Watch</b>", description: 5, status: "in_progress", votes: "7", email: "x@example.com", accountId: "a1" },
      { id: 4, title: "Bad status", status: "secret", votes: 1 },
      { id: 5, title: "", status: "planned", votes: 1 },
      null,
      { id: 6, title: "Negative", status: "done", votes: -3 },
    ],
    voters: ["a@example.com"],
  }));
  const res = await worker.fetch(new Request("https://oceanlive.org/api/roadmap"), env);
  assert.deepEqual(await res.json(), {
    items: [
      { id: 3, title: "<b>Watch</b>", description: "", status: "in_progress", votes: 7 },
      { id: 6, title: "Negative", description: "", status: "done", votes: 0 },
    ],
  });
});

test("roadmap errors become a 503 JSON message", async () => {
  const cases = [
    () => Response.json({ error: "not_found" }, { status: 404 }),
    () => new Response("oops", { status: 500 }),
    () => new Response("not json"),
    () => Response.json({ nope: true }),
    () => { throw new Error("binding down"); },
  ];
  for (const reply of cases) {
    const res = await worker.fetch(new Request("https://oceanlive.org/api/roadmap"), askEnv(reply));
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: "The roadmap isn't available right now. Try again later." });
    assert.equal(res.headers.get("Cache-Control"), "no-store");
  }
  const missing = await worker.fetch(new Request("https://oceanlive.org/api/roadmap"), { ASSETS: fakeEnv().ASSETS });
  assert.equal(missing.status, 503);
});

test("roadmap is read-only: other methods and sub-paths never reach the server", async () => {
  for (const method of ["POST", "PUT", "DELETE"]) {
    const env = askEnv(() => Response.json({ items: [] }));
    const res = await worker.fetch(new Request("https://oceanlive.org/api/roadmap", { method, body: "{}" }), env);
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get("Allow"), "GET, HEAD");
    assert.equal(env.calls.length, 0, method);
  }
  for (const path of ["/api/roadmap/1/vote", "/api/roadmap/", "/api/roadmaps"]) {
    const env = askEnv(() => Response.json({ items: [] }));
    const res = await worker.fetch(new Request("https://oceanlive.org" + path), env);
    assert.equal(res.status, 404, path);
    assert.equal(env.calls.length, 0, path);
  }
});

test("the list proxy still never touches the ASK binding", async () => {
  const env = { ...fakeEnv(), ASK: { fetch: async () => { throw new Error("must not be called"); } } };
  const res = await worker.fetch(post("/api/list/subscribe", { email: "a@example.com" }), env);
  assert.equal(res.status, 200);
});

// ── /community and /community/<id>: the shells in public/ filled from the ASK binding (path /knowledge) ──
import { readFileSync } from "node:fs";
const PUBLIC_DIR = new URL("../public/", import.meta.url);
function communityEnv(reply) {
  const calls = { ask: [], assets: [] };
  return {
    calls,
    ASSETS: {
      fetch: async (req) => {
        const p = new URL(req.url).pathname;
        calls.assets.push(p);
        const file = p === "/community" ? "community.html" : p === "/community/note" ? "community/note.html" : p === "/404" ? "404.html" : null;
        return file ? new Response(readFileSync(new URL(file, PUBLIC_DIR), "utf8")) : new Response("nope", { status: 404 });
      },
    },
    ASK: { fetch: async (req) => { calls.ask.push(req); return reply(req); } },
  };
}
const NOTES = [
  { id: 7, kind: "fault_code", title: "B208896 <after> a 12V swap", body: "Went away after a new 12 V battery.\n\nCheck __NOTE_TITLE__ & <script>", code: "B208896", created: "2026-11-01T10:00:00Z", updated: "2026-11-03T10:00:00Z", approvedBy: "x@example.com" },
  { id: 5, kind: "car_fact", title: "Frunk", body: "There's a small frunk.", code: null, created: "2026-10-01T10:00:00Z", updated: "2026-10-01T10:00:00Z" },
  { id: 6, kind: "secret", title: "Bad kind", body: "x" },
];

test("/community lists the approved notes from the ASK binding, escaped, with the site's security headers", async () => {
  const env = communityEnv(() => Response.json({ items: NOTES }));
  const res = await worker.fetch(new Request("https://oceanlive.org/community", { headers: { Cookie: "s=1", "CF-Connecting-IP": "203.0.113.4" } }), env);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.equal(new URL(env.calls.ask[0].url).pathname, "/knowledge");
  assert.equal(env.calls.ask[0].headers.get("Cookie"), null);
  assert.match(html, /href="\/community\/7"/);
  assert.match(html, /href="\/community\/5"/);
  assert.ok(html.includes("B208896 &lt;after&gt; a 12V swap"));
  assert.ok(!html.includes("Bad kind"));
  assert.ok(!html.includes("x@example.com"));
  assert.ok(!html.includes("aren't available right now"));
  // public/_headers isn't applied to Worker responses: the same headers are set here.
  const block = readFileSync(new URL("_headers", PUBLIC_DIR), "utf8").split(/\r?\n\r?\n/)[0].split(/\r?\n/).slice(1);
  for (const line of block) {
    const [k, ...v] = line.trim().split(":");
    if (k === "Cache-Control") continue;
    assert.equal(res.headers.get(k), v.join(":").trim(), k);
  }
});

test("/community/<id> fills the note shell; text in the note is escaped and never read as a token", async () => {
  const env = communityEnv(() => Response.json({ items: NOTES }));
  const res = await worker.fetch(new Request("https://oceanlive.org/community/7"), env);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(!/__NOTE_[A-Z]+__/.test(html.replaceAll("Check __NOTE_TITLE__", "")));
  assert.ok(html.includes("Check __NOTE_TITLE__ &amp; &lt;script&gt;"));
  assert.ok(html.includes("<title>B208896 &lt;after&gt; a 12V swap · Ocean Live community notes</title>"));
  assert.ok(html.includes('<link rel="canonical" href="https://oceanlive.org/community/7">'));
  assert.ok(html.includes("Fault code B208896"));
  assert.ok(html.includes("Added 2026-11-01, updated 2026-11-03."));
  assert.ok(!html.includes("This note isn't available."));
  assert.ok(!html.includes("<script>"));
});

test("/community/<id> is a 404 for unknown or malformed ids, and the shell itself is never served", async () => {
  for (const path of ["/community/99", "/community/6", "/community/note", "/community/0", "/community/7/x"]) {
    const res = await worker.fetch(new Request("https://oceanlive.org" + path), communityEnv(() => Response.json({ items: NOTES })));
    assert.equal(res.status, 404, path);
  }
  const html = await worker.fetch(new Request("https://oceanlive.org/community.html"), communityEnv(() => Response.json({ items: [] })));
  assert.equal(html.status, 301);
  assert.equal(html.headers.get("Location"), "/community");
});

test("/community falls back to the page's own text when the server can't be reached; read-only", async () => {
  for (const reply of [() => new Response("x", { status: 500 }), () => new Response("not json"), () => { throw new Error("down"); }]) {
    const res = await worker.fetch(new Request("https://oceanlive.org/community"), communityEnv(reply));
    assert.equal(res.status, 200);
    assert.ok((await res.text()).includes("aren't available right now"));
  }
  const empty = await worker.fetch(new Request("https://oceanlive.org/community"), communityEnv(() => Response.json({ items: [] })));
  assert.ok((await empty.text()).includes("No notes yet"));
  const env = communityEnv(() => Response.json({ items: NOTES }));
  const post = await worker.fetch(new Request("https://oceanlive.org/community", { method: "POST", body: "{}" }), env);
  assert.equal(post.status, 405);
  assert.equal(env.calls.ask.length, 0);
});

// ── /downloads/ and /downloads/preview/: the APKs and latest.json from the DOWNLOADS (R2) binding ──
import { createHash } from "node:crypto";
import { publish } from "./downloads-lib.mjs";

const hex = (data) => createHash("sha256").update(data).digest("hex");
const APKS = {
  android: Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.from("android-apk-".repeat(10))]),
  wear: Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.from("wear-apk-".repeat(7))]),
};
const FILE_OF = { android: "OceanLive-Android.apk", wear: "OceanLive-Wear.apk" };
const PREFIX = { stable: "/downloads/", preview: "/downloads/preview/" };

// An R2 bucket in memory: head() and get() with {range}, as the Workers R2 binding has them.
function fakeBucket(objects) {
  const calls = [];
  const meta = (key) => {
    const etag = createHash("md5").update(objects.get(key)).digest("hex");
    return { key, size: objects.get(key).length, etag, httpEtag: `"${etag}"` };
  };
  return {
    calls,
    async head(key) {
      calls.push(["head", key]);
      return objects.has(key) ? meta(key) : null;
    },
    async get(key, options = {}) {
      calls.push(["get", key, options]);
      if (!objects.has(key)) return null;
      let data = objects.get(key);
      if (options.range) data = data.subarray(options.range.offset, options.range.offset + options.range.length);
      return { ...meta(key), body: new Response(data).body, text: async () => Buffer.from(data).toString("utf8") };
    },
  };
}

// Puts one build of a channel into the bucket the way tools/downloads.mjs lays it out.
function putChannel(objects, channel, { build = 7, files: edit = {} } = {}) {
  const files = {};
  for (const [key, file] of Object.entries(FILE_OF)) {
    const object = `${channel}/b${build}-0123abcd/${file}`;
    objects.set(object, APKS[key]);
    files[key] = {
      name: `OceanLive-1.4-${key === "android" ? "Android" : "Wear"}.apk`,
      path: PREFIX[channel] + file,
      size: APKS[key].length,
      sha256: hex(APKS[key]),
      object,
      ...edit[key],
    };
  }
  const info = { version: "1.4.0", short: "1.4", build, commit: "0123abcd" + "0".repeat(32), date: "2026-11-17T00:00:00.000Z", files, previous: null };
  objects.set(`${channel}/latest.json`, Buffer.from(JSON.stringify(info, null, 2) + "\n"));
  return info;
}

// statics: the files public/ would have (the old static downloads); "/404" is the 404 page.
function downloadsEnv(objects = new Map(), statics = {}) {
  const assets = [];
  return {
    assets,
    DOWNLOADS: fakeBucket(objects),
    ASSETS: {
      fetch: async (req) => {
        const p = new URL(req.url).pathname;
        assets.push(p);
        if (p === "/404") return new Response("<h1>Not found</h1>", { headers: { "Content-Type": "text/html" } });
        if (p in statics) return new Response(statics[p], { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "public, max-age=300" } });
        return new Response("<h1>Not found</h1>", { status: 404, headers: { "Content-Type": "text/html" } });
      },
    },
  };
}
const get = (path, headers = {}, method = "GET") => new Request("https://oceanlive.org" + path, { method, headers });
const etagOf = (data) => `"${createHash("md5").update(data).digest("hex")}"`;

test("both channels stream each APK that latest.json names, as a no-cache attachment", async () => {
  const objects = new Map();
  putChannel(objects, "stable", { build: 7 });
  putChannel(objects, "preview", { build: 9 });
  for (const channel of ["stable", "preview"]) {
    for (const [key, file] of Object.entries(FILE_OF)) {
      const env = downloadsEnv(objects);
      const res = await worker.fetch(get(PREFIX[channel] + file), env);
      const where = `${channel} ${file}`;
      assert.equal(res.status, 200, where);
      assert.deepEqual(Buffer.from(await res.arrayBuffer()), APKS[key], where);
      assert.equal(res.headers.get("Content-Type"), "application/vnd.android.package-archive", where);
      assert.equal(res.headers.get("Content-Disposition"), `attachment; filename="OceanLive-1.4-${key === "android" ? "Android" : "Wear"}.apk"`, where);
      assert.equal(res.headers.get("Cache-Control"), "no-cache", where);
      assert.equal(res.headers.get("ETag"), etagOf(APKS[key]), where);
      assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff", where);
      assert.equal(res.headers.get("Content-Length"), String(APKS[key].length), where);
      assert.equal(res.headers.get("Accept-Ranges"), "bytes", where);
      assert.equal(res.headers.get("X-Robots-Tag"), channel === "preview" ? "noindex" : null, where);
      const build = channel === "stable" ? 7 : 9;
      assert.deepEqual(env.DOWNLOADS.calls.map((c) => c[1]), [`${channel}/latest.json`, `${channel}/b${build}-0123abcd/${file}`], where);
      assert.deepEqual(env.assets, [], where);
    }
  }
});

test("latest.json is served as stored, no-cache, with a 304 for a matching ETag", async () => {
  const objects = new Map();
  putChannel(objects, "stable");
  putChannel(objects, "preview");
  for (const channel of ["stable", "preview"]) {
    const stored = objects.get(`${channel}/latest.json`);
    const path = PREFIX[channel] + "latest.json";
    const res = await worker.fetch(get(path), downloadsEnv(objects));
    assert.equal(res.status, 200);
    assert.equal(await res.text(), stored.toString("utf8"));
    assert.match(res.headers.get("Content-Type"), /^application\/json/);
    assert.equal(res.headers.get("Cache-Control"), "no-cache");
    assert.equal(res.headers.get("X-Robots-Tag"), channel === "preview" ? "noindex" : null);
    const etag = res.headers.get("ETag");
    assert.equal(etag, etagOf(stored));
    for (const inm of [etag, `W/${etag}`, `"x", ${etag}`, "*"]) {
      const again = await worker.fetch(get(path, { "If-None-Match": inm }), downloadsEnv(objects));
      assert.equal(again.status, 304, inm);
      assert.equal(await again.text(), "");
    }
    const changed = await worker.fetch(get(path, { "If-None-Match": '"older"' }), downloadsEnv(objects));
    assert.equal(changed.status, 200);
    const head = await worker.fetch(get(path, {}, "HEAD"), downloadsEnv(objects));
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  }
});

test("HEAD on an APK gives its headers and length without reading the file", async () => {
  const objects = new Map();
  putChannel(objects, "stable");
  const env = downloadsEnv(objects);
  const res = await worker.fetch(get("/downloads/OceanLive-Wear.apk", {}, "HEAD"), env);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "");
  assert.equal(res.headers.get("Content-Length"), String(APKS.wear.length));
  assert.equal(res.headers.get("ETag"), etagOf(APKS.wear));
  assert.equal(res.headers.get("Content-Type"), "application/vnd.android.package-archive");
  assert.deepEqual(env.DOWNLOADS.calls.map((c) => c[0] + " " + c[1]), ["get stable/latest.json", "head stable/b7-0123abcd/OceanLive-Wear.apk"]);
});

test("If-None-Match gives 304 and a failed If-Match 412 on an APK", async () => {
  const objects = new Map();
  putChannel(objects, "preview");
  const path = "/downloads/preview/OceanLive-Android.apk";
  const etag = etagOf(APKS.android);
  for (const inm of [etag, `W/${etag}`, `"a", ${etag}`, "*"]) {
    const env = downloadsEnv(objects);
    const res = await worker.fetch(get(path, { "If-None-Match": inm }), env);
    assert.equal(res.status, 304, inm);
    assert.equal(await res.text(), "");
    assert.equal(res.headers.get("ETag"), etag);
    assert.ok(!env.DOWNLOADS.calls.some((c) => c[0] === "get" && c[1].endsWith(".apk")), "the file is never read for a 304");
  }
  const other = await worker.fetch(get(path, { "If-None-Match": '"an-older-build"' }), downloadsEnv(objects));
  assert.equal(other.status, 200);
  assert.deepEqual(Buffer.from(await other.arrayBuffer()), APKS.android);
  const failed = await worker.fetch(get(path, { "If-Match": `W/${etag}` }), downloadsEnv(objects));
  assert.equal(failed.status, 412);
  const matched = await worker.fetch(get(path, { "If-Match": etag }), downloadsEnv(objects));
  assert.equal(matched.status, 200);
});

test("a single Range gets 206 with Content-Range, an unsatisfiable one 416, anything else the whole file", async () => {
  const objects = new Map();
  putChannel(objects, "stable");
  const data = APKS.android;
  const size = data.length;
  const path = "/downloads/OceanLive-Android.apk";
  const partial = [
    ["bytes=0-3", 0, 3],
    ["bytes=10-", 10, size - 1],
    ["bytes=-5", size - 5, size - 1],
    [`bytes=0-${size + 100}`, 0, size - 1],
    [`bytes=-${size + 100}`, 0, size - 1],
    [` bytes=4-4 `, 4, 4],
  ];
  for (const [range, start, end] of partial) {
    const env = downloadsEnv(objects);
    const res = await worker.fetch(get(path, { Range: range }), env);
    assert.equal(res.status, 206, range);
    assert.equal(res.headers.get("Content-Range"), `bytes ${start}-${end}/${size}`, range);
    assert.equal(res.headers.get("Content-Length"), String(end - start + 1), range);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), data.subarray(start, end + 1), range);
    const read = env.DOWNLOADS.calls.find((c) => c[0] === "get" && c[1].endsWith(".apk"));
    assert.deepEqual(read[2], { range: { offset: start, length: end - start + 1 } }, range);
  }
  for (const range of [`bytes=${size}-`, `bytes=${size + 5}-${size + 9}`, "bytes=-0"]) {
    const res = await worker.fetch(get(path, { Range: range }), downloadsEnv(objects));
    assert.equal(res.status, 416, range);
    assert.equal(res.headers.get("Content-Range"), `bytes */${size}`, range);
    assert.equal(await res.text(), "");
  }
  for (const range of ["bytes=0-1,4-5", "bytes=5-2", "items=0-1", "bytes=-", "bytes=a-b"]) {
    const res = await worker.fetch(get(path, { Range: range }), downloadsEnv(objects));
    assert.equal(res.status, 200, range);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), data, range);
  }
  // Resuming with If-Range: only the same build gets the rest; another build is sent whole.
  const resumed = await worker.fetch(get(path, { Range: "bytes=10-", "If-Range": etagOf(data) }), downloadsEnv(objects));
  assert.equal(resumed.status, 206);
  const stale = await worker.fetch(get(path, { Range: "bytes=10-", "If-Range": '"an-older-build"' }), downloadsEnv(objects));
  assert.equal(stale.status, 200);
  assert.deepEqual(Buffer.from(await stale.arrayBuffer()), data);
  const staleBeyond = await worker.fetch(get(path, { Range: `bytes=${size}-`, "If-Range": '"an-older-build"' }), downloadsEnv(objects));
  assert.equal(staleBeyond.status, 200);
});

test("any other path under /downloads/ is the 404 page and never reaches R2", async () => {
  const objects = new Map();
  putChannel(objects, "stable");
  putChannel(objects, "preview");
  const paths = [
    "/downloads/",
    "/downloads/preview/",
    "/downloads/preview",
    "/downloads/OceanLive.apk",
    "/downloads/oceanlive-android.apk",
    "/downloads/OceanLive-Android.apk/",
    "/downloads/latest.json/x",
    "/downloads/preview/preview/latest.json",
    "/downloads/stable/latest.json",
    "/downloads/b7-0123abcd/OceanLive-Android.apk",
    "/downloads/preview/b7-0123abcd/OceanLive-Android.apk",
    "/downloads/OceanLive-1.4-Android.apk",
    "/downloads/latest.json%00",
  ];
  for (const path of paths) {
    const env = downloadsEnv(objects);
    const res = await worker.fetch(get(path), env);
    assert.equal(res.status, 404, path);
    assert.match(await res.text(), /Not found/, path);
    assert.deepEqual(env.DOWNLOADS.calls, [], path);
    assert.deepEqual(env.assets, ["/404"], path);
  }
  const env = downloadsEnv(objects);
  const post = await worker.fetch(get("/downloads/OceanLive-Android.apk", {}, "POST"), env);
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("Allow"), "GET, HEAD");
  assert.deepEqual(env.DOWNLOADS.calls, []);
});

test("a channel with no latest.json in R2 (or no binding) is served from public/, with the download headers", async () => {
  const objects = new Map();
  putChannel(objects, "stable");
  const statics = {
    "/downloads/preview/latest.json": '{"version":"1.3.0"}',
    "/downloads/preview/OceanLive-Android.apk": "old static apk",
    "/downloads/OceanLive-Android.apk": "old static stable apk",
  };
  const env = downloadsEnv(objects, statics);
  const json = await worker.fetch(get("/downloads/preview/latest.json"), env);
  assert.equal(json.status, 200);
  assert.equal(await json.text(), '{"version":"1.3.0"}');
  assert.equal(json.headers.get("Content-Type"), "application/json");
  assert.equal(json.headers.get("Cache-Control"), "no-cache");
  assert.equal(json.headers.get("X-Robots-Tag"), "noindex");
  const apk = await worker.fetch(get("/downloads/preview/OceanLive-Android.apk"), env);
  assert.equal(apk.status, 200);
  assert.equal(await apk.text(), "old static apk");
  assert.equal(apk.headers.get("Content-Type"), "application/vnd.android.package-archive");
  assert.equal(apk.headers.get("Content-Disposition"), "attachment");
  assert.equal(apk.headers.get("Cache-Control"), "no-cache");
  assert.deepEqual(env.assets, ["/downloads/preview/latest.json", "/downloads/preview/OceanLive-Android.apk"]);
  // Not in public/ either: the assets' own 404 passes through.
  const missing = await worker.fetch(get("/downloads/preview/OceanLive-Wear.apk"), env);
  assert.equal(missing.status, 404);
  // The stable channel is in R2, so its static copy is never used.
  const stable = await worker.fetch(get("/downloads/OceanLive-Android.apk"), env);
  assert.deepEqual(Buffer.from(await stable.arrayBuffer()), APKS.android);
  // No R2 binding at all: everything comes from public/.
  const bare = downloadsEnv(objects, statics);
  delete bare.DOWNLOADS;
  const old = await worker.fetch(get("/downloads/OceanLive-Android.apk"), bare);
  assert.equal(await old.text(), "old static stable apk");
  assert.equal(old.headers.get("Content-Type"), "application/vnd.android.package-archive");
});

test("an object key in latest.json that isn't this channel's file is refused, and nothing else is read", async () => {
  const hostile = [
    "preview/b7-0123abcd/OceanLive-Android.apk",
    "stable/b7-0123abcd/OceanLive-Wear.apk",
    "stable/latest.json",
    "preview/latest.json",
    "stable/b7-0123abcd/../../preview/latest.json",
    "stable/b7-0123abcd/OceanLive-Android.apk/../../secret",
    "stable/b7-0123abcd/OceanLive-Android.apk\nX-Evil: 1",
    "/stable/b7-0123abcd/OceanLive-Android.apk",
    "stable//b7-0123abcd/OceanLive-Android.apk",
    "stable/b7-0123ABCD/OceanLive-Android.apk",
    "stable/b1234567890-0123abcd/OceanLive-Android.apk",
    "stable/b7-0123abcd/OceanLive-Android.apk ",
    "secret.txt",
    "",
    42,
    null,
    ["stable/b7-0123abcd/OceanLive-Android.apk"],
    { toString: "stable/b7-0123abcd/OceanLive-Android.apk" },
  ];
  for (const object of hostile) {
    const objects = new Map();
    putChannel(objects, "stable", { files: { android: { object } } });
    putChannel(objects, "preview");
    objects.set("secret.txt", Buffer.from("secret"));
    const env = downloadsEnv(objects);
    const res = await worker.fetch(get("/downloads/OceanLive-Android.apk"), env);
    const where = JSON.stringify(object);
    assert.equal(res.status, 503, where);
    assert.equal(await res.text(), "This download isn't available right now. Try again later.", where);
    assert.equal(res.headers.get("Cache-Control"), "no-store", where);
    assert.deepEqual(env.DOWNLOADS.calls.map((c) => c[1]), ["stable/latest.json"], where);
  }
  // A missing object key, or a latest.json that isn't JSON, is refused the same way.
  const objects = new Map();
  putChannel(objects, "stable", { files: { android: { object: undefined } } });
  assert.equal((await worker.fetch(get("/downloads/OceanLive-Android.apk"), downloadsEnv(objects))).status, 503);
  objects.set("stable/latest.json", Buffer.from("{not json"));
  assert.equal((await worker.fetch(get("/downloads/OceanLive-Android.apk"), downloadsEnv(objects))).status, 503);
  objects.set("stable/latest.json", Buffer.from('{"files":null}'));
  assert.equal((await worker.fetch(get("/downloads/OceanLive-Android.apk"), downloadsEnv(objects))).status, 503);
});

test("an APK is only served when its size matches latest.json; a bad name falls back to the fixed one", async () => {
  for (const size of [APKS.android.length + 1, 0, -1, "12", 1.5, null]) {
    const objects = new Map();
    putChannel(objects, "stable", { files: { android: { size } } });
    for (const headers of [{}, { Range: "bytes=0-3" }]) {
      const res = await worker.fetch(get("/downloads/OceanLive-Android.apk", headers), downloadsEnv(objects));
      assert.equal(res.status, 503, `${size} ${JSON.stringify(headers)}`);
      assert.equal(await res.text(), "This download isn't available right now. Try again later.");
    }
  }
  const objects = new Map();
  putChannel(objects, "stable");
  objects.delete("stable/b7-0123abcd/OceanLive-Android.apk");
  assert.equal((await worker.fetch(get("/downloads/OceanLive-Android.apk"), downloadsEnv(objects))).status, 503);
  assert.equal((await worker.fetch(get("/downloads/OceanLive-Android.apk", {}, "HEAD"), downloadsEnv(objects))).status, 503);
  for (const name of ['x"; filename="evil.exe', "evil\r\nSet-Cookie: a=b.apk", "../x.apk", "x.exe", 7]) {
    const named = new Map();
    putChannel(named, "stable", { files: { android: { name } } });
    const res = await worker.fetch(get("/downloads/OceanLive-Android.apk"), downloadsEnv(named));
    assert.equal(res.status, 200, String(name));
    assert.equal(res.headers.get("Content-Disposition"), 'attachment; filename="OceanLive-Android.apk"', String(name));
  }
});

test("R2 errors and an oversized latest.json give 503, never the static copy", async () => {
  const env = downloadsEnv(new Map(), { "/downloads/OceanLive-Android.apk": "old" });
  env.DOWNLOADS.get = async () => { throw new Error("R2 down"); };
  for (const path of ["/downloads/OceanLive-Android.apk", "/downloads/latest.json"]) {
    const res = await worker.fetch(get(path), env);
    assert.equal(res.status, 503, path);
  }
  assert.deepEqual(env.assets, []);
  const objects = new Map();
  putChannel(objects, "stable");
  objects.set("stable/latest.json", Buffer.alloc(70 * 1024, 32));
  assert.equal((await worker.fetch(get("/downloads/latest.json"), downloadsEnv(objects))).status, 503);
});

test("builds published by tools/downloads-lib.mjs are served with the SHA-256 their latest.json gives", async () => {
  const objects = new Map();
  const r2 = {
    get: async (key) => (objects.has(key) ? Buffer.from(objects.get(key)) : null),
    put: async (key, data) => { objects.set(key, Buffer.from(data)); },
    delete: async (key) => { objects.delete(key); },
  };
  const quiet = () => {};
  const builds = [];
  for (const [build, tag] of [[101, "one"], [102, "two"], [103, "three"]]) {
    const apks = {
      android: Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.from(`phone ${tag}`)]),
      wear: Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.from(`watch ${tag}`)]),
    };
    await publish({ r2, channel: "preview", apks, version: "1.5.0", build: String(build), commit: "abcdef0123456789abcdef0123456789abcdef01", log: quiet, warn: quiet });
    builds.push(apks);
    const latest = JSON.parse(await (await worker.fetch(get("/downloads/preview/latest.json"), downloadsEnv(objects))).text());
    assert.equal(latest.build, build);
    for (const [key, file] of Object.entries(FILE_OF)) {
      const res = await worker.fetch(get("/downloads/preview/" + file), downloadsEnv(objects));
      assert.equal(res.status, 200, `${build} ${file}`);
      const body = Buffer.from(await res.arrayBuffer());
      assert.deepEqual(body, apks[key]);
      assert.equal(hex(body), latest.files[key].sha256);
      assert.equal(body.length, latest.files[key].size);
      assert.equal(res.headers.get("Content-Disposition"), `attachment; filename="OceanLive-1.5-${key === "android" ? "Android" : "Wear"}.apk"`);
    }
  }
  // Current and previous build kept, the one before deleted; the stable channel never touched.
  assert.deepEqual([...objects.keys()].filter((k) => k.endsWith(".apk")).sort(), [
    "preview/b102-abcdef01/OceanLive-Android.apk",
    "preview/b102-abcdef01/OceanLive-Wear.apk",
    "preview/b103-abcdef01/OceanLive-Android.apk",
    "preview/b103-abcdef01/OceanLive-Wear.apk",
  ]);
  assert.equal((await worker.fetch(get("/downloads/latest.json"), downloadsEnv(objects, {}))).status, 404);
});
