// Tests for src/worker.js (the /api/list/* proxy), with fake MAIL and ASSETS bindings.
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
