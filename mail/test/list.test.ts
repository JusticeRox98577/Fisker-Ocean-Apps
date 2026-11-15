import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import worker from "../src/index";
import { confirm, continueCampaign, ipNetwork, subscribe } from "../src/list";
import { newId, sha256hex } from "../src/util";

const ORIGIN = "https://mail.oceanlive.org";
const PIN = "24681357"; // the test PIN from vitest.config.ts
const DAY = 24 * 3600 * 1000;

type Call = { url: string; body: any; headers: Record<string, string> };

/** A fake Resend: records every call; `reply` can override the answer per call. */
function fakeResend(reply?: (call: Call, n: number) => Response | undefined) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(url), body: JSON.parse(String(init!.body)), headers: init!.headers as Record<string, string> };
    calls.push(call);
    const custom = reply?.(call, calls.length);
    if (custom) return custom;
    if (call.url.endsWith("/emails/batch")) return Response.json({ data: call.body.map((_: unknown, i: number) => ({ id: `re_b${calls.length}_${i}` })) });
    return Response.json({ id: `re_${calls.length}` });
  });
  return { calls, fn };
}

function envWith(fn: unknown, vars: Partial<Env> = {}): Env {
  return { ...env, RESEND_API_KEY: "test", RESEND_FETCH: fn as typeof fetch, ...vars };
}

function call(e: Env, path: string, init: RequestInit = {}) {
  return worker.fetch(new Request(`${ORIGIN}${path}`, init), e);
}

function postJson(e: Env, path: string, body: unknown, headers: Record<string, string> = {}) {
  return call(e, path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
}

let ipSeq = 0;
const freshIp = () => `198.18.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;

function signUp(e: Env, email: string, extra: Record<string, unknown> = {}, ip = freshIp()) {
  return postJson(e, "/api/list/subscribe", { email, ...extra }, { "CF-Connecting-IP": ip });
}

/** The confirm token from the link in a confirmation email. */
function tokenFrom(c: Call): string {
  const m = /\/list\/confirm#t=([\w-]+)/.exec(c.body.text);
  expect(m).not.toBeNull();
  return m![1];
}

async function seed(n: number, status: "pending" | "confirmed" = "confirmed", now = Date.now()) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = newId(now + i);
    ids.push(id);
    await env.DB.prepare(
      `INSERT INTO list_subscribers (id, email, lang, status, consent, confirm_expires, unsub_token, created_at, confirmed_at)
       VALUES (?1, ?2, 'en', ?3, 'site-v1', ?4, ?5, ?6, ?7)`,
    )
      .bind(id, `${status}${i}-${id}@example.com`, status, now + 7 * DAY, `unsub-${id}-xxxxxxxxxxxx`, now, status === "confirmed" ? now : null)
      .run();
  }
  return ids;
}

async function signedIn(e: Env) {
  const res = await postJson(e, "/api/login", { address: "justice@oceanlive.org", pin: PIN }, { Origin: ORIGIN, "CF-Connecting-IP": freshIp() });
  expect(res.status).toBe(200);
  const cookie = res.headers.get("Set-Cookie")!.split(";")[0];
  const { csrf } = (await res.json()) as { csrf: string };
  return { Cookie: cookie, "X-CSRF-Token": csrf, Origin: ORIGIN, "Content-Type": "application/json" };
}

const count = async (sql: string, ...args: unknown[]) =>
  (await env.DB.prepare(sql).bind(...args).first<{ n: number }>())!.n;

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM list_deliveries"),
    env.DB.prepare("DELETE FROM list_campaigns"),
    env.DB.prepare("DELETE FROM list_subscribers"),
    env.DB.prepare("DELETE FROM counters WHERE key LIKE 'list:%'"),
  ]);
});

describe("subscribe", () => {
  it("checks the address and sends nothing for bad input", async () => {
    const r = fakeResend();
    const e = envWith(r.fn);
    expect((await signUp(e, "not-an-address")).status).toBe(400);
    expect((await signUp(e, `${"a".repeat(250)}@example.com`)).status).toBe(400);
    expect((await signUp(e, "")).status).toBe(400);
    const notJson = await call(e, "/api/list/subscribe", { method: "POST", body: "email=a@example.com", headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    expect(notJson.status).toBe(400);
    expect(((await notJson.json()) as { error: string }).error).toBeTruthy();
    expect(r.fn).not.toHaveBeenCalled();
    expect(await count("SELECT COUNT(*) AS n FROM list_subscribers")).toBe(0);
  });

  it("answers success to the honeypot but does nothing", async () => {
    const r = fakeResend();
    const res = await signUp(envWith(r.fn), "bot@example.com", { website: "http://spam.example" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(r.fn).not.toHaveBeenCalled();
    expect(await count("SELECT COUNT(*) AS n FROM list_subscribers")).toBe(0);
  });

  it("gives the same answer for new, pending and confirmed addresses", async () => {
    const r = fakeResend();
    const e = envWith(r.fn);
    const fresh = await signUp(e, "Ada@Example.com ");
    const again = await signUp(e, "ada@example.com"); // pending, inside the 10-minute gap: no new email
    expect(r.calls).toHaveLength(1);
    expect((await confirm(new Request(`${ORIGIN}/x`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: tokenFrom(r.calls[0]) }) }), e)).status).toBe(200);
    const done = await signUp(e, "ada@example.com"); // confirmed: nothing sent
    expect(r.calls).toHaveLength(1);
    for (const res of [fresh, again, done]) {
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(await res.json()).toEqual({ ok: true });
    }
    const row = await env.DB.prepare("SELECT email, status, consent, source FROM list_subscribers").first();
    expect(row).toEqual({ email: "ada@example.com", status: "confirmed", consent: "site-v1", source: "site" });
  });

  it("resends to a pending address after 10 minutes, at most 5 times", async () => {
    const r = fakeResend();
    const e = envWith(r.fn);
    const t0 = Date.now();
    const req = () => new Request(`${ORIGIN}/api/list/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": freshIp() },
      body: JSON.stringify({ email: "slow@example.com" }),
    });
    for (let i = 0; i < 7; i++) expect((await subscribe(req(), e, t0 + i * 11 * 60 * 1000)).status).toBe(200);
    expect(r.calls).toHaveLength(5);
    // Only the newest link works.
    const old = tokenFrom(r.calls[0]);
    const newest = tokenFrom(r.calls[4]);
    const conf = (token: string) => confirm(new Request(`${ORIGIN}/x`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }), e, t0 + 80 * 60 * 1000);
    expect((await conf(old)).status).toBe(400);
    expect((await conf(newest)).status).toBe(200);
  });

  it("limits sign-ups per network with 429", async () => {
    const r = fakeResend();
    const e = envWith(r.fn, { LIST_SIGNUPS_PER_IP_HOUR: "2" });
    const ip = "198.51.100.200";
    expect((await signUp(e, "one@example.com", {}, ip)).status).toBe(200);
    expect((await signUp(e, "two@example.com", {}, ip)).status).toBe(200);
    const third = await signUp(e, "three@example.com", {}, ip);
    expect(third.status).toBe(429);
    expect(((await third.json()) as { error: string }).error).toMatch(/network/);
    expect((await signUp(e, "three@example.com", {}, "198.51.100.201")).status).toBe(200);
    expect(r.calls).toHaveLength(3);
  });

  it("stops at the daily total of confirmation emails", async () => {
    const r = fakeResend();
    const e = envWith(r.fn, { LIST_CONFIRMS_PER_DAY: "1" });
    expect((await signUp(e, "first@example.com")).status).toBe(200);
    expect((await signUp(e, "second@example.com")).status).toBe(429);
    expect(r.calls).toHaveLength(1);
  });

  it("sends a branded confirmation with the token only in the link's fragment", async () => {
    const r = fakeResend();
    const e = envWith(r.fn);
    expect((await signUp(e, "eva@example.de", { lang: "de-AT" })).status).toBe(200);
    expect(r.calls).toHaveLength(1);
    const c = r.calls[0];
    expect(c.url).toBe("https://api.resend.com/emails");
    expect(c.headers.Authorization).toBe("Bearer test");
    expect(c.headers["User-Agent"]).toBeTruthy();
    expect(c.body.from).toBe("Ocean Live <news@oceanlive.org>");
    expect(c.body.reply_to).toBe("justice@oceanlive.org");
    expect(c.body.to).toEqual(["eva@example.de"]);
    expect(c.body.subject).toBe("Bestätige deine Anmeldung für Ocean-Live-News");
    const token = tokenFrom(c);
    expect(token.length).toBeGreaterThanOrEqual(43);
    const link = `https://oceanlive.org/list/confirm#t=${token}`;
    expect(c.body.text).toContain(link);
    expect(c.body.html).toContain(`href="${link}"`);
    expect(c.body.html).toContain("https://oceanlive.org/email/header.png");
    expect(c.body.html).toContain('lang="de"');
    // Only the hash is stored.
    const row = await env.DB.prepare("SELECT lang, confirm_hash, confirm_expires, confirm_sends FROM list_subscribers").first<{
      lang: string;
      confirm_hash: string;
      confirm_expires: number;
      confirm_sends: number;
    }>();
    expect(row!.lang).toBe("de");
    expect(row!.confirm_hash).toBe(await sha256hex(token));
    expect(row!.confirm_sends).toBe(1);
    expect(row!.confirm_expires - Date.now()).toBeGreaterThan(6.9 * DAY);

    const en = fakeResend();
    await signUp(envWith(en.fn), "sam@example.com", { lang: "xx" });
    expect(en.calls[0].body.subject).toBe("Confirm your Ocean Live news sign-up");
    expect(en.calls[0].body.text).toContain("If you didn't ask for this, ignore this email and you won't hear from us.");
  });

  it("answers 503 without a Resend key and 502 when Resend fails, keeping nothing", async () => {
    expect((await signUp({ ...env, RESEND_API_KEY: undefined, RESEND_FETCH: undefined }, "x@example.com")).status).toBe(503);
    const r = fakeResend(() => Response.json({ name: "application_error", message: "boom" }, { status: 500 }));
    expect((await signUp(envWith(r.fn), "y@example.com")).status).toBe(502);
    expect(await count("SELECT COUNT(*) AS n FROM list_subscribers")).toBe(0);
    expect(await count("SELECT COALESCE(SUM(count), 0) AS n FROM counters WHERE key LIKE 'list:confirms:%'")).toBe(0);
  });

  it("answers the same error for confirmed and new addresses while Resend is failing", async () => {
    const good = fakeResend();
    await signUp(envWith(good.fn), "member@example.com");
    await confirm(new Request(`${ORIGIN}/x`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: tokenFrom(good.calls[0]) }) }), envWith(good.fn));
    const bad = fakeResend(() => Response.json({ name: "rate_limit_exceeded", message: "quota" }, { status: 429 }));
    const e = envWith(bad.fn);
    const fresh = await signUp(e, "new@example.com");
    const member = await signUp(e, "member@example.com");
    const other = await signUp(e, "another@example.com");
    for (const res of [fresh, member, other]) {
      expect(res.status).toBe(502);
      expect(((await res.json()) as { error: string }).error).toBe("We couldn't send the confirmation email. Try again in a few minutes.");
    }
    expect(bad.calls).toHaveLength(1); // only the first; the rest answer from the "Resend is down" flag
  });

  it("counts confirmations against the shared daily budget and stops when news used it up", async () => {
    const r = fakeResend();
    const e = envWith(r.fn, { LIST_SEND_PER_DAY: "2", LIST_CONFIRMS_PER_DAY: "10" });
    expect((await signUp(e, "a1@example.com")).status).toBe(200);
    expect((await signUp(e, "a2@example.com")).status).toBe(200);
    expect((await signUp(e, "a3@example.com")).status).toBe(429);
    expect(r.calls).toHaveLength(2);
    const sent = await count("SELECT COALESCE(SUM(count), 0) AS n FROM counters WHERE key LIKE 'list:sent:%'");
    expect(sent).toBe(2);
  });

  it("limits a whole IPv6 /64 as one network and stores no raw IP", async () => {
    const r = fakeResend();
    const e = envWith(r.fn, { LIST_SIGNUPS_PER_IP_HOUR: "2" });
    expect((await signUp(e, "v6a@example.com", {}, "2001:db8:1:2::1")).status).toBe(200);
    expect((await signUp(e, "v6b@example.com", {}, "2001:0db8:0001:0002:ffff:eeee:dddd:cccc")).status).toBe(200);
    expect((await signUp(e, "v6c@example.com", {}, "2001:db8:1:2:abcd::9")).status).toBe(429);
    expect((await signUp(e, "v6d@example.com", {}, "2001:db8:1:3::1")).status).toBe(200);
    const keys = (await env.DB.prepare("SELECT key FROM counters WHERE key LIKE 'list:signup:ip:%'").all<{ key: string }>()).results.map((k) => k.key);
    expect(keys).toHaveLength(2);
    for (const k of keys) expect(k).toMatch(/^list:signup:ip:[0-9a-f]{32}$/);
  });

  it("puts IPv4 and IPv6 addresses into networks", () => {
    expect(ipNetwork("198.51.100.7")).toBe("198.51.100.7");
    expect(ipNetwork("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(ipNetwork("2001:DB8:0:0:1:2:3:4")).toBe("2001:db8:0:0::/64");
    expect(ipNetwork("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(ipNetwork("::1")).toBe("0:0:0:0::/64");
    expect(ipNetwork("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(ipNetwork("not:an:ip::x")).toBe("not:an:ip::x");
  });

  it("skips the per-network limit when the IP header is missing instead of sharing one bucket", async () => {
    const r = fakeResend();
    const e = envWith(r.fn, { LIST_SIGNUPS_PER_IP_HOUR: "1" });
    const noIp = (email: string) => postJson(e, "/api/list/subscribe", { email });
    expect((await noIp("n1@example.com")).status).toBe(200);
    expect((await noIp("n2@example.com")).status).toBe(200);
    expect((await noIp("n3@example.com")).status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM counters WHERE key LIKE 'list:signup:ip:%'")).toBe(0);
  });
});

describe("confirm", () => {
  it("confirms once, then says the link was used", async () => {
    const r = fakeResend();
    const e = envWith(r.fn);
    await signUp(e, "once@example.com");
    const token = tokenFrom(r.calls[0]);
    const first = await postJson(e, "/api/list/confirm", { token });
    expect(first.status).toBe(200);
    const row = await env.DB.prepare("SELECT status, confirm_hash, confirmed_at FROM list_subscribers").first<{
      status: string;
      confirm_hash: string | null;
      confirmed_at: number;
    }>();
    expect(row!.status).toBe("confirmed");
    expect(row!.confirm_hash).toBeNull();
    expect(row!.confirmed_at).toBeGreaterThan(0);
    const reuse = await postJson(e, "/api/list/confirm", { token });
    expect(reuse.status).toBe(400);
    expect(((await reuse.json()) as { error: string }).error).toBe(
      "This link has expired or was already used. Sign up again at oceanlive.org/news.",
    );
    expect((await postJson(e, "/api/list/confirm", { token: "x".repeat(43) })).status).toBe(400);
    expect((await postJson(e, "/api/list/confirm", {})).status).toBe(400);
  });

  it("refuses an expired link", async () => {
    const r = fakeResend();
    const e = envWith(r.fn);
    const long = Date.now() - 8 * DAY;
    const req = new Request(`${ORIGIN}/api/list/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": freshIp() },
      body: JSON.stringify({ email: "late@example.com" }),
    });
    expect((await subscribe(req, e, long)).status).toBe(200);
    const res = await postJson(e, "/api/list/confirm", { token: tokenFrom(r.calls[0]) });
    expect(res.status).toBe(400);
    expect(await env.DB.prepare("SELECT status FROM list_subscribers").first()).toEqual({ status: "pending" });
  });
});

describe("unsubscribe", () => {
  it("deletes the address from the page (JSON) and always answers ok", async () => {
    const [id] = await seed(1);
    const res = await postJson(envWith(fakeResend().fn), "/api/list/unsubscribe", { token: `unsub-${id}-xxxxxxxxxxxx` });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await count("SELECT COUNT(*) AS n FROM list_subscribers")).toBe(0);
    const again = await postJson(envWith(fakeResend().fn), "/api/list/unsubscribe", { token: `unsub-${id}-xxxxxxxxxxxx` });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true });
  });

  it("supports RFC 8058 one-click POSTs without cookies, answering 200 and no redirect", async () => {
    const ids = await seed(2);
    const e = envWith(fakeResend().fn);
    const form = await call(e, `/api/list/unsubscribe?t=unsub-${ids[0]}-xxxxxxxxxxxx`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    });
    expect(form.status).toBe(200);
    expect(form.headers.get("Location")).toBeNull();
    const fd = new FormData();
    fd.append("List-Unsubscribe", "One-Click");
    const multipart = await call(e, `/api/list/unsubscribe?t=unsub-${ids[1]}-xxxxxxxxxxxx`, { method: "POST", body: fd });
    expect(multipart.status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM list_subscribers")).toBe(0);
  });

  it("sends a browser that opens the header link to the unsubscribe page without unsubscribing", async () => {
    const [id] = await seed(1);
    const res = await call(envWith(fakeResend().fn), `/api/list/unsubscribe?t=unsub-${id}-xxxxxxxxxxxx`, { redirect: "manual" });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(`https://oceanlive.org/list/unsubscribe#t=unsub-${id}-xxxxxxxxxxxx`);
    expect(await count("SELECT COUNT(*) AS n FROM list_subscribers")).toBe(1);
  });
});

describe("access", () => {
  it("public endpoints need no session; owner endpoints still need one, and CSRF", async () => {
    const e = envWith(fakeResend().fn);
    expect((await signUp(e, "pub@example.com", { website: "x" })).status).toBe(200);
    expect((await postJson(e, "/api/list/confirm", { token: "y".repeat(43) })).status).toBe(400);
    expect((await postJson(e, "/api/list/unsubscribe", { token: "y".repeat(43) })).status).toBe(200);

    expect((await call(e, "/api/list")).status).toBe(401);
    expect((await call(e, "/api/list/subscribers")).status).toBe(401);
    expect((await postJson(e, "/api/list/campaigns", { subject: "s", text: "t" })).status).toBe(401);
    expect((await postJson(e, "/api/list/test", { subject: "s", text: "t" })).status).toBe(401);
    expect((await call(e, "/api/list/subscribe")).status).toBe(401); // GET is not public

    const h = await signedIn(e);
    const noCsrf = { Cookie: h.Cookie, Origin: ORIGIN, "Content-Type": "application/json" };
    expect((await postJson(e, "/api/list/campaigns", { subject: "s", text: "t" }, noCsrf)).status).toBe(403);
    const [id] = await seed(1);
    expect((await call(e, `/api/list/subscribers/${id}`, { method: "DELETE", headers: noCsrf })).status).toBe(403);
    expect((await call(e, `/api/list/subscribers/${id}`, { method: "DELETE", headers: { ...h, Origin: "https://evil.example" } })).status).toBe(403);
    expect((await call(e, "/api/list", { headers: { Cookie: h.Cookie } })).status).toBe(200);
    expect((await call(e, `/api/list/subscribers/${id}`, { method: "DELETE", headers: h })).status).toBe(200);
    expect((await call(e, `/api/list/subscribers/${id}`, { method: "DELETE", headers: h })).status).toBe(404);
  });

  it("lists, filters and searches subscribers for the owner", async () => {
    const e = envWith(fakeResend().fn);
    const h = await signedIn(e);
    await seed(3, "confirmed");
    await seed(2, "pending");
    const get = async (qs: string) =>
      (await (await call(e, `/api/list/subscribers${qs}`, { headers: { Cookie: h.Cookie } })).json()) as {
        subscribers: { email: string; status: string }[];
        next: string | null;
      };
    expect((await get("")).subscribers).toHaveLength(5);
    expect((await get("?status=pending")).subscribers.every((s) => s.status === "pending")).toBe(true);
    expect((await get("?q=confirmed1")).subscribers).toHaveLength(1);
    expect((await get("?q=%25")).subscribers).toHaveLength(0); // % is literal
    const over = (await (await call(e, "/api/list", { headers: { Cookie: h.Cookie } })).json()) as Record<string, unknown>;
    expect(over).toMatchObject({ pending: 2, confirmed: 3, sendingReady: true, perDay: 60, sentToday: 0, postalAddress: false });
  });
});

describe("campaigns", () => {
  it("queues only confirmed subscribers and sends them with one-click unsubscribe headers", async () => {
    const r = fakeResend();
    const e = envWith(r.fn, { LIST_POSTAL_ADDRESS: "PO Box 1, Springfield" });
    const h = await signedIn(e);
    const confirmed = await seed(3, "confirmed");
    await seed(2, "pending");
    const res = await postJson(e, "/api/list/campaigns", { subject: "Ocean Live 3.2", text: "New: range history.\nhttps://oceanlive.org" }, h);
    expect(res.status).toBe(200);
    const out = (await res.json()) as { campaign: { id: string; status: string; total: number; sent: number; queued: number } };
    expect(out.campaign).toMatchObject({ status: "done", total: 3, sent: 3, queued: 0 });

    expect(r.calls).toHaveLength(1);
    const c = r.calls[0];
    expect(c.url).toBe("https://api.resend.com/emails/batch");
    expect(c.headers["Idempotency-Key"]).toMatch(/^list-/);
    expect(c.headers["x-batch-validation"]).toBe("permissive");
    expect(c.body).toHaveLength(3);
    const tos = c.body.map((m: { to: string[] }) => m.to[0]);
    expect(tos.every((t: string) => t.startsWith("confirmed"))).toBe(true);
    for (const [i, m] of c.body.entries()) {
      const token = `unsub-${confirmed[i]}-xxxxxxxxxxxx`;
      expect(m.to).toHaveLength(1);
      expect(m.from).toBe("Ocean Live <news@oceanlive.org>");
      expect(m.reply_to).toBe("justice@oceanlive.org");
      expect(m.subject).toBe("Ocean Live 3.2");
      expect(m.headers).toEqual({
        "List-Unsubscribe": `<https://oceanlive.org/api/list/unsubscribe?t=${token}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      });
      expect(m.text).toContain("New: range history.");
      expect(m.text).toContain("You signed up for Ocean Live news at oceanlive.org.");
      expect(m.text).toContain(`https://oceanlive.org/list/unsubscribe#t=${token}`);
      expect(m.text).toContain("PO Box 1, Springfield");
      expect(m.html).toContain(`href="https://oceanlive.org/list/unsubscribe#t=${token}"`);
      expect(m.html).toContain("PO Box 1, Springfield");
      expect(m.html).toContain("https://oceanlive.org/email/header.png");
    }
    const rows = await env.DB.prepare("SELECT status, resend_id FROM list_deliveries ORDER BY subscriber_id").all();
    expect(rows.results).toEqual([
      { status: "sent", resend_id: "re_b1_0" },
      { status: "sent", resend_id: "re_b1_1" },
      { status: "sent", resend_id: "re_b1_2" },
    ]);
  });

  it("points the one-click header at LIST_UNSUB_BASE when it is set", async () => {
    const r = fakeResend();
    const e = envWith(r.fn, { LIST_UNSUB_BASE: "https://unsub.example.net/" });
    const h = await signedIn(e);
    const [sub] = await seed(1);
    await postJson(e, "/api/list/campaigns", { subject: "News", text: "Hello" }, h);
    const m = r.calls[0].body[0];
    expect(m.headers["List-Unsubscribe"]).toBe(`<https://unsub.example.net/api/list/unsubscribe?t=unsub-${sub}-xxxxxxxxxxxx>`);
    expect(m.text).toContain(`https://oceanlive.org/list/unsubscribe#t=unsub-${sub}-xxxxxxxxxxxx`);
  });

  it("pauses on a whole-request 400/422 and keeps everyone queued", async () => {
    let refuse = true;
    const r = fakeResend((c) =>
      c.url.endsWith("/emails/batch") && refuse ? Response.json({ name: "invalid_from_address", message: "Invalid `from` field." }, { status: 422 }) : undefined,
    );
    const e = envWith(r.fn);
    const h = await signedIn(e);
    await seed(3);
    const out = (await (await postJson(e, "/api/list/campaigns", { subject: "News", text: "Hello" }, h)).json()) as any;
    expect(out).toMatchObject({ paused: true, campaign: { status: "sending", sent: 0, failed: 0, queued: 3 } });
    expect(out.message).toContain("Invalid `from` field.");
    expect(await count("SELECT COUNT(*) AS n FROM list_deliveries WHERE status = 'queued'")).toBe(3);
    refuse = false;
    const done = (await (await continueCampaign(e, out.campaign.id)).json()) as any;
    expect(done.campaign).toMatchObject({ status: "done", sent: 3, failed: 0 });
  });

  it("explains a changed body under the same idempotency key", async () => {
    const r = fakeResend((c) =>
      c.url.endsWith("/emails/batch") ? Response.json({ name: "invalid_idempotent_request", message: "Same key, different body" }, { status: 409 }) : undefined,
    );
    const e = envWith(r.fn);
    const h = await signedIn(e);
    await seed(1);
    const out = (await (await postJson(e, "/api/list/campaigns", { subject: "News", text: "Hello" }, h)).json()) as any;
    expect(out.paused).toBe(true);
    expect(out.message).toMatch(/settings changed/);
    expect(out.campaign.queued).toBe(1);
  });

  it("counts only deliveries it recorded when a subscriber leaves mid-chunk or a continue overlaps", async () => {
    let ids: string[] = [];
    let mode: "leave" | "overlap" | "" = "leave";
    const calls: any[] = [];
    const fn = async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body));
      calls.push(body);
      if (mode === "leave") {
        mode = "";
        await env.DB.batch([
          env.DB.prepare(
            `UPDATE list_campaigns SET total = total - 1 WHERE id IN (SELECT campaign_id FROM list_deliveries WHERE subscriber_id = ?1 AND status = 'queued')`,
          ).bind(ids[0]),
          env.DB.prepare("DELETE FROM list_deliveries WHERE subscriber_id = ?1").bind(ids[0]),
          env.DB.prepare("DELETE FROM list_subscribers WHERE id = ?1").bind(ids[0]),
        ]);
      } else if (mode === "overlap") {
        mode = "";
        // Another tab recorded this same chunk while Resend answered this request from its cache.
        await env.DB.prepare("UPDATE list_deliveries SET status = 'sent' WHERE status = 'queued' AND subscriber_id IN (SELECT value FROM json_each(?1))")
          .bind(JSON.stringify(ids.slice(2, 4)))
          .run();
        await env.DB.prepare("UPDATE list_campaigns SET sent = sent + 2").run();
      }
      return Response.json({ data: body.map((_: unknown, i: number) => ({ id: `re_${calls.length}_${i}` })) });
    };
    const e = envWith(fn, { LIST_BATCH: "2" });
    const h = await signedIn(e);
    ids = await seed(4);
    const first = (await (await postJson(e, "/api/list/campaigns", { subject: "News", text: "Hello" }, h)).json()) as any;
    expect(first.campaign).toMatchObject({ total: 3, sent: 1, failed: 0, queued: 2 });
    mode = "overlap";
    const second = (await (await continueCampaign(e, first.campaign.id)).json()) as any;
    expect(second.campaign).toMatchObject({ status: "done", total: 3, sent: 3, failed: 0, queued: 0 });
    // Daily budget: 2 really sent in the first chunk (one to the person who left), none new in the replay.
    expect(await count("SELECT COALESCE(SUM(count), 0) AS n FROM counters WHERE key LIKE 'list:sent:%'")).toBe(2);
  });

  it("renders a long email once per chunk with each recipient's own unsubscribe link", async () => {
    const r = fakeResend();
    const e = envWith(r.fn, { LIST_BATCH: "100" });
    const h = await signedIn(e);
    const ids = await seed(3);
    await postJson(e, "/api/list/campaigns", { subject: "Long", text: "word ".repeat(3900) }, h);
    const msgs = r.calls[0].body as { text: string; html: string }[];
    msgs.forEach((m, i) => {
      expect(m.html).toContain(`href="https://oceanlive.org/list/unsubscribe#t=unsub-${ids[i]}-xxxxxxxxxxxx"`);
      expect(m.text).toContain(`https://oceanlive.org/list/unsubscribe#t=unsub-${ids[i]}-xxxxxxxxxxxx`);
      expect(m.html).not.toMatch(/OLUNSUB/);
    });
  });

  it("refuses an empty list, a missing subject and an over-long subject", async () => {
    const r = fakeResend();
    const e = envWith(r.fn);
    const h = await signedIn(e);
    expect((await postJson(e, "/api/list/campaigns", { subject: "Hi", text: "x" }, h)).status).toBe(400);
    await seed(1);
    expect((await postJson(e, "/api/list/campaigns", { subject: "", text: "x" }, h)).status).toBe(400);
    expect((await postJson(e, "/api/list/campaigns", { subject: "s".repeat(201), text: "x" }, h)).status).toBe(400);
    expect((await postJson(e, "/api/list/campaigns", { subject: "s", text: " " }, h)).status).toBe(400);
    expect((await postJson(e, "/api/list/campaigns", { subject: "s", text: "x".repeat(20_001) }, h)).status).toBe(400);
    expect(r.fn).not.toHaveBeenCalled();
    expect(await count("SELECT COUNT(*) AS n FROM list_campaigns")).toBe(0);
  });

  it("sends in chunks, stops at the daily cap and resumes the next day", async () => {
    const r = fakeResend();
    const e = envWith(r.fn, { LIST_BATCH: "2", LIST_SEND_PER_DAY: "3" });
    const h = await signedIn(e);
    await seed(5);
    const first = (await (await postJson(e, "/api/list/campaigns", { subject: "News", text: "Hello" }, h)).json()) as any;
    expect(first.campaign).toMatchObject({ status: "sending", total: 5, sent: 2, queued: 3 });
    const id = first.campaign.id as string;

    const second = (await (await call(e, `/api/list/campaigns/${id}/continue`, { method: "POST", headers: h })).json()) as any;
    expect(second.campaign).toMatchObject({ status: "sending", sent: 3, queued: 2 });
    expect(r.calls[1].body).toHaveLength(1); // only 1 left under today's cap

    const capped = (await (await call(e, `/api/list/campaigns/${id}/continue`, { method: "POST", headers: h })).json()) as any;
    expect(capped).toMatchObject({ limitReached: true, paused: true });
    expect(capped.message).toBe("Daily limit reached; continue tomorrow.");
    expect(r.calls).toHaveLength(2);

    const tomorrow = Date.now() + DAY;
    const resumed = (await (await continueCampaign(e, id, tomorrow)).json()) as any;
    expect(resumed.campaign).toMatchObject({ status: "done", total: 5, sent: 5, failed: 0, queued: 0 });
    const everyone = r.calls.flatMap((c) => c.body.map((m: { to: string[] }) => m.to[0]));
    expect(new Set(everyone).size).toBe(5);
    expect(everyone).toHaveLength(5);

    const over = (await (await call(e, "/api/list", { headers: { Cookie: h.Cookie } })).json()) as any;
    expect(over.sentToday).toBe(3);
    expect(over.campaigns[0]).toMatchObject({ id, status: "done", sent: 5 });
  });

  it("retries a failed chunk with the same idempotency key and never sends anyone twice", async () => {
    let failNext = true;
    const r = fakeResend((c) => {
      if (c.url.endsWith("/emails/batch") && failNext) {
        failNext = false;
        return Response.json({ name: "application_error", message: "Try again." }, { status: 500 });
      }
    });
    const e = envWith(r.fn, { LIST_BATCH: "2" });
    const h = await signedIn(e);
    await seed(3);
    const created = await postJson(e, "/api/list/campaigns", { subject: "News", text: "Hello" }, h);
    expect(created.status).toBe(200);
    const createdState = (await created.json()) as any;
    expect(createdState).toMatchObject({ paused: true, campaign: { status: "sending", sent: 0, queued: 3 } });
    expect(createdState.message).toContain("Try again.");
    const id = createdState.campaign.id as string;
    // The first chunk failed: nothing marked as sent.
    expect(await count("SELECT COUNT(*) AS n FROM list_deliveries WHERE status = 'queued'")).toBe(3);

    const retry = await call(e, `/api/list/campaigns/${id}/continue`, { method: "POST", headers: h });
    expect(retry.status).toBe(200);
    expect(r.calls[1].headers["Idempotency-Key"]).toBe(r.calls[0].headers["Idempotency-Key"]);
    expect(r.calls[1].body).toEqual(r.calls[0].body);

    const last = (await (await call(e, `/api/list/campaigns/${id}/continue`, { method: "POST", headers: h })).json()) as any;
    expect(last.campaign).toMatchObject({ status: "done", sent: 3 });
    expect(r.calls[2].headers["Idempotency-Key"]).not.toBe(r.calls[1].headers["Idempotency-Key"]);
    const delivered = r.calls.slice(1).flatMap((c) => c.body.map((m: { to: string[] }) => m.to[0]));
    expect(new Set(delivered).size).toBe(delivered.length);

    // Continuing a finished campaign sends nothing.
    await call(e, `/api/list/campaigns/${id}/continue`, { method: "POST", headers: h });
    expect(r.calls).toHaveLength(3);
  });

  it("leaves a chunk queued while Resend says the same key is in flight", async () => {
    const r = fakeResend((c) =>
      c.url.endsWith("/emails/batch") ? Response.json({ name: "concurrent_idempotent_requests", message: "In flight" }, { status: 409 }) : undefined,
    );
    const e = envWith(r.fn);
    const h = await signedIn(e);
    await seed(2);
    const out = (await (await postJson(e, "/api/list/campaigns", { subject: "News", text: "Hello" }, h)).json()) as any;
    expect(out).toMatchObject({ paused: true, limitReached: false, campaign: { status: "sending", sent: 0, failed: 0, queued: 2 } });
  });

  it("records addresses Resend rejects as failed and goes on", async () => {
    const r = fakeResend((c) =>
      c.url.endsWith("/emails/batch")
        ? Response.json({ data: [{ id: "re_ok_0" }, { id: "re_ok_2" }], errors: [{ index: 1, message: "Invalid `to` field" }] })
        : undefined,
    );
    const e = envWith(r.fn);
    const h = await signedIn(e);
    const ids = await seed(3);
    const out = (await (await postJson(e, "/api/list/campaigns", { subject: "News", text: "Hello" }, h)).json()) as any;
    expect(out.campaign).toMatchObject({ status: "done", total: 3, sent: 2, failed: 1 });
    const rows = await env.DB.prepare("SELECT subscriber_id, status, resend_id, error FROM list_deliveries ORDER BY subscriber_id").all();
    expect(rows.results).toEqual([
      { subscriber_id: ids[0], status: "sent", resend_id: "re_ok_0", error: null },
      { subscriber_id: ids[1], status: "failed", resend_id: null, error: "Invalid `to` field" },
      { subscriber_id: ids[2], status: "sent", resend_id: "re_ok_2", error: null },
    ]);
  });

  it("drops a queued delivery when that subscriber leaves mid-campaign", async () => {
    const r = fakeResend();
    const e = envWith(r.fn, { LIST_BATCH: "1" });
    const h = await signedIn(e);
    const ids = await seed(3);
    const id = ((await (await postJson(e, "/api/list/campaigns", { subject: "News", text: "Hello" }, h)).json()) as any).campaign.id;
    await postJson(e, "/api/list/unsubscribe", { token: `unsub-${ids[2]}-xxxxxxxxxxxx` });
    let state: any;
    do state = await (await call(e, `/api/list/campaigns/${id}/continue`, { method: "POST", headers: h })).json();
    while (state.campaign.status === "sending");
    expect(state.campaign).toMatchObject({ total: 2, sent: 2, failed: 0 });
    expect(r.calls.flatMap((c) => c.body.map((m: { to: string[] }) => m.to[0])).some((t: string) => t.includes(ids[2]))).toBe(false);
  });

  it("sends a test only to the signed-in mailbox", async () => {
    const r = fakeResend();
    const e = envWith(r.fn);
    const h = await signedIn(e);
    await seed(2);
    const res = await postJson(e, "/api/list/test", { subject: "Draft", text: "Hello" }, h);
    expect(res.status).toBe(200);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].url).toBe("https://api.resend.com/emails");
    expect(r.calls[0].body.to).toEqual(["justice@oceanlive.org"]);
    expect(r.calls[0].body.subject).toBe("[Test] Draft");
    expect(r.calls[0].body.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(await count("SELECT COUNT(*) AS n FROM list_campaigns")).toBe(0);
  });
});

describe("daily clean-up", () => {
  it("deletes unconfirmed sign-ups whose link expired, and nothing else", async () => {
    const old = Date.now() - 8 * DAY;
    const [expired] = await seed(1, "pending", old);
    await env.DB.prepare("UPDATE list_subscribers SET confirm_expires = ?2 WHERE id = ?1").bind(expired, old + 7 * DAY).run();
    await seed(1, "pending");
    const [oldConfirmed] = await seed(1, "confirmed", old);
    await env.DB.prepare("UPDATE list_subscribers SET confirm_expires = ?2 WHERE id = ?1").bind(oldConfirmed, old).run();
    await worker.scheduled({} as ScheduledController, env);
    const { results } = await env.DB.prepare("SELECT id, status FROM list_subscribers ORDER BY id").all<{ id: string; status: string }>();
    expect(results.map((r) => r.id)).not.toContain(expired);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.status).sort()).toEqual(["confirmed", "pending"]);
  });
});
