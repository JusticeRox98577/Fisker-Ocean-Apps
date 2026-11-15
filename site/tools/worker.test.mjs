// Tests for src/worker.js (the /api/list/* and /api/roadmap proxies, and the /community pages), with fake MAIL, ASK and ASSETS bindings.
// Usage: node --test site/tools/worker.test.mjs   (Node 20+, no dependencies)
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
