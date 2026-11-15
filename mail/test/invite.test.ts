import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import worker from "../src/index";
import { cleanupList, confirm, invite } from "../src/list";
import { INVITE } from "../src/list-email";
import { newId, sha256hex } from "../src/util";

const ORIGIN = "https://mail.oceanlive.org";
const PIN = "24681357"; // the test PIN from vitest.config.ts
const DAY = 24 * 3600 * 1000;

type Call = { url: string; body: any; headers: Record<string, string> };

/** A fake Resend batch endpoint: records every call; `reply` can override the answer per call. */
function fakeResend(reply?: (call: Call, n: number) => Response | undefined) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(url), body: JSON.parse(String(init!.body)), headers: init!.headers as Record<string, string> };
    calls.push(call);
    const custom = reply?.(call, calls.length);
    if (custom) return custom;
    return Response.json({ data: call.body.map((_: unknown, i: number) => ({ id: `re_${calls.length}_${i}` })) });
  });
  return { calls, fn };
}

function envWith(fn: unknown, vars: Partial<Env> = {}): Env {
  return { ...env, RESEND_API_KEY: "test", RESEND_FETCH: fn as typeof fetch, ...vars };
}

function call(e: Env, path: string, init: RequestInit = {}) {
  return worker.fetch(new Request(`${ORIGIN}${path}`, init), e);
}

let ipSeq = 0;
const freshIp = () => `198.19.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;

async function signedIn(e: Env) {
  const res = await call(e, "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, "CF-Connecting-IP": freshIp() },
    body: JSON.stringify({ address: "justice@oceanlive.org", pin: PIN }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers.get("Set-Cookie")!.split(";")[0];
  const { csrf } = (await res.json()) as { csrf: string };
  return { Cookie: cookie, "X-CSRF-Token": csrf, Origin: ORIGIN, "Content-Type": "application/json" };
}

function postInvite(e: Env, emails: unknown, headers: Record<string, string>) {
  return call(e, "/api/list/invite", { method: "POST", headers, body: JSON.stringify({ emails }) });
}

/** Calls invite() directly, so a test can pick the day. */
function inviteAt(e: Env, emails: unknown, now: number) {
  return invite(new Request(`${ORIGIN}/api/list/invite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emails }) }), e, now);
}

type InviteResult = { invited: number; skipped: number; deferred: string[]; failed: { email: string; error: string }[] };

const count = async (sql: string, ...args: unknown[]) =>
  (await env.DB.prepare(sql).bind(...args).first<{ n: number }>())!.n;

async function seedSubscriber(email: string, status: "pending" | "confirmed") {
  const id = newId();
  await env.DB.prepare(
    `INSERT INTO list_subscribers (id, email, lang, status, consent, confirm_expires, unsub_token, created_at, confirmed_at)
     VALUES (?1, ?2, 'en', ?3, 'site-v1', ?4, ?5, ?6, ?7)`,
  )
    .bind(id, email, status, Date.now() + 7 * DAY, `unsub-${id}-xxxxxxxxxxxx`, Date.now(), status === "confirmed" ? Date.now() : null)
    .run();
}

/** All recipients of all batch calls, in order. */
const recipients = (calls: Call[]) => calls.flatMap((c) => c.body.map((m: { to: string[] }) => m.to[0]));

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM list_deliveries"),
    env.DB.prepare("DELETE FROM list_campaigns"),
    env.DB.prepare("DELETE FROM list_subscribers"),
    env.DB.prepare("DELETE FROM list_invites"),
    env.DB.prepare("DELETE FROM counters WHERE key LIKE 'list:%'"),
  ]);
});

describe("health", () => {
  it("answers without a session, cache or database", async () => {
    const res = await call(env, "/api/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, service: "mail" });
    expect((await call(env, "/api/health", { method: "POST" })).status).toBe(401);
  });
});

describe("tester invitations", () => {
  it("is for the owner only: 401 without a session, 403 without CSRF", async () => {
    const r = fakeResend();
    const e = envWith(r.fn);
    expect((await postInvite(e, ["a@example.com"], { "Content-Type": "application/json", Origin: ORIGIN })).status).toBe(401);
    const h = await signedIn(e);
    const noCsrf = { ...h } as Record<string, string>;
    delete noCsrf["X-CSRF-Token"];
    expect((await postInvite(e, ["a@example.com"], noCsrf)).status).toBe(403);
    expect((await postInvite(e, ["a@example.com"], { ...h, Origin: "https://evil.example" })).status).toBe(403);
    expect(r.fn).not.toHaveBeenCalled();
    expect(await count("SELECT COUNT(*) AS n FROM list_subscribers")).toBe(0);
  });

  it("creates pending invite rows and sends the honest invitation with the fragment confirm link", async () => {
    const r = fakeResend();
    const e = envWith(r.fn);
    const h = await signedIn(e);
    const res = await postInvite(e, [" Ada@Example.com", "ada@example.com", "Bo Tester <bo@example.com>"], h);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ invited: 2, skipped: 0, deferred: [], failed: [] });

    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].url).toBe("https://api.resend.com/emails/batch");
    expect(recipients(r.calls)).toEqual(["ada@example.com", "bo@example.com"]);
    const msg = r.calls[0].body[0];
    expect(msg.from).toBe("Ocean Live <news@oceanlive.org>");
    expect(msg.subject).toBe(INVITE.subject);
    expect(msg.text).toContain("You're getting this because you test Ocean Live (the Fisker Ocean app).");
    expect(msg.html).toContain("because you test Ocean Live (the Fisker Ocean app).");
    expect(msg.html).toContain("you won&#39;t hear from this list again.");
    expect(msg.text).toContain(
      "Justice is starting a mailing list for Ocean Live news: new releases and important fixes, a few emails a year, no ads.",
    );
    expect(msg.text).toContain("If you'd like those emails, confirm here:");
    expect(msg.text).toContain("If you don't confirm, you won't be added and you won't hear from this list again.");
    const link = /https:\/\/oceanlive\.org\/list\/confirm#t=([\w-]+)/.exec(msg.text);
    expect(link).not.toBeNull();
    expect(msg.html).toContain(`href="https://oceanlive.org/list/confirm#t=${link![1]}"`);
    expect(msg.html).not.toMatch(/<script/i);

    const rows = await env.DB.prepare("SELECT email, status, source, consent, lang, confirm_sends, confirm_expires, confirm_hash FROM list_subscribers ORDER BY email").all<any>();
    expect(rows.results.map((x) => [x.email, x.status, x.source, x.consent, x.lang, x.confirm_sends])).toEqual([
      ["ada@example.com", "pending", "invite", "invite-v1", "en", 1],
      ["bo@example.com", "pending", "invite", "invite-v1", "en", 1],
    ]);
    // Only the hash of the token is stored, and the link works for 7 days.
    expect(rows.results[0].confirm_hash).toBe(await sha256hex(link![1]));
    expect(rows.results[0].confirm_expires).toBeGreaterThan(Date.now() + 6.9 * DAY);
    // The invitation counts against the day's list budget, like a confirmation email.
    expect(await count("SELECT count AS n FROM counters WHERE key LIKE 'list:sent:%'")).toBe(2);
    expect(await count("SELECT count AS n FROM counters WHERE key LIKE 'list:confirms:%'")).toBe(2);

    // The link confirms like any sign-up.
    const ok = await confirm(new Request(`${ORIGIN}/x`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: link![1] }) }), e);
    expect(ok.status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM list_subscribers WHERE email = 'ada@example.com' AND status = 'confirmed'")).toBe(1);
  });

  it("skips addresses already on the list and never emails them", async () => {
    await seedSubscriber("pending@example.com", "pending");
    await seedSubscriber("confirmed@example.com", "confirmed");
    const r = fakeResend();
    const e = envWith(r.fn);
    const res = await postInvite(e, ["pending@example.com", "CONFIRMED@example.com", "new@example.com"], await signedIn(e));
    expect(await res.json()).toEqual({ invited: 1, skipped: 2, deferred: [], failed: [] });
    expect(recipients(r.calls)).toEqual(["new@example.com"]);
    expect(await count("SELECT COUNT(*) AS n FROM list_subscribers WHERE source = 'invite'")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM list_subscribers WHERE email = 'pending@example.com' AND source = 'site'")).toBe(1);
  });

  it("never invites anyone twice, even after the unconfirmed row expired", async () => {
    const r = fakeResend();
    const e = envWith(r.fn);
    const t0 = Date.now();
    expect(((await (await inviteAt(e, ["once@example.com"], t0)).json()) as InviteResult).invited).toBe(1);
    // The daily clean-up removes the unconfirmed row after 7 days...
    await env.DB.prepare("DELETE FROM list_subscribers").run();
    // ...but the same list sent again later still skips it.
    const again = (await (await inviteAt(e, ["once@example.com"], t0 + 10 * DAY)).json()) as InviteResult;
    expect(again).toEqual({ invited: 0, skipped: 1, deferred: [], failed: [] });
    expect(r.calls).toHaveLength(1);
    // Only a hash is remembered, not the address.
    const kept = await env.DB.prepare("SELECT email_hash FROM list_invites").all<{ email_hash: string }>();
    expect(kept.results).toEqual([{ email_hash: await sha256hex("invite:once@example.com") }]);
  });

  it("never invites people who unsubscribed, were removed, or let a site sign-up lapse", async () => {
    await seedSubscriber("left@example.com", "confirmed");
    await seedSubscriber("removed@example.com", "confirmed");
    const r = fakeResend();
    const e = envWith(r.fn);
    const h = await signedIn(e);
    // Unsubscribes with the link from a news email.
    const leftId = (await env.DB.prepare("SELECT id FROM list_subscribers WHERE email = 'left@example.com'").first<{ id: string }>())!.id;
    expect((await call(e, "/api/list/unsubscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: `unsub-${leftId}-xxxxxxxxxxxx` }) })).status).toBe(200);
    // Removed by the owner from the webmail.
    const removedId = (await env.DB.prepare("SELECT id FROM list_subscribers WHERE email = 'removed@example.com'").first<{ id: string }>())!.id;
    expect((await call(e, `/api/list/subscribers/${removedId}`, { method: "DELETE", headers: h })).status).toBe(200);
    // Signed up on the site, never confirmed, deleted by the daily clean-up.
    await seedSubscriber("lapsed@example.com", "pending");
    await env.DB.prepare("UPDATE list_subscribers SET confirm_expires = 1, created_at = 1 WHERE email = 'lapsed@example.com'").run();
    await cleanupList(e);
    expect(await count("SELECT COUNT(*) AS n FROM list_subscribers")).toBe(0);

    const out = (await (await postInvite(e, ["left@example.com", "removed@example.com", "lapsed@example.com", "new@example.com"], h)).json()) as InviteResult;
    expect(out).toEqual({ invited: 1, skipped: 3, deferred: [], failed: [] });
    expect(recipients(r.calls)).toEqual(["new@example.com"]);
  });

  it("defers what the daily budget can't take, without rows, and the same list continues the next day", async () => {
    const r = fakeResend();
    const e = envWith(r.fn, { LIST_CONFIRMS_PER_DAY: "2" });
    const t0 = Date.UTC(2026, 10, 15, 12);
    const list = ["a@example.com", "b@example.com", "c@example.com", "d@example.com"];

    const first = (await (await inviteAt(e, list, t0)).json()) as InviteResult;
    expect(first).toEqual({ invited: 2, skipped: 0, deferred: ["c@example.com", "d@example.com"], failed: [] });
    expect(await count("SELECT COUNT(*) AS n FROM list_subscribers")).toBe(2);
    expect(await count("SELECT COUNT(*) AS n FROM list_subscribers WHERE email IN ('c@example.com', 'd@example.com')")).toBe(0);

    // Same day: nothing left in the budget, nothing sent, nothing created.
    const sameDay = (await (await inviteAt(e, list, t0 + 1000)).json()) as InviteResult;
    expect(sameDay).toEqual({ invited: 0, skipped: 2, deferred: ["c@example.com", "d@example.com"], failed: [] });
    expect(r.calls).toHaveLength(1);

    // Next UTC day: the same list picks up where it stopped.
    const next = (await (await inviteAt(e, list, t0 + DAY)).json()) as InviteResult;
    expect(next).toEqual({ invited: 2, skipped: 2, deferred: [], failed: [] });
    expect(recipients(r.calls)).toEqual(list);
  });

  it("shares the budget with news: when today's list emails are used up, everything is deferred", async () => {
    const r = fakeResend();
    const e = envWith(r.fn, { LIST_SEND_PER_DAY: "3" });
    const t0 = Date.UTC(2026, 10, 15, 12);
    await env.DB.prepare("INSERT INTO counters (key, count, reset_at) VALUES (?1, 3, ?2)").bind("list:sent:2026-11-15", t0 + 3600_000).run();
    const out = (await (await inviteAt(e, ["a@example.com"], t0)).json()) as InviteResult;
    expect(out).toEqual({ invited: 0, skipped: 0, deferred: ["a@example.com"], failed: [] });
    expect(r.fn).not.toHaveBeenCalled();
    expect(await count("SELECT COUNT(*) AS n FROM list_subscribers")).toBe(0);
  });

  it("rejects invalid input and sends nothing", async () => {
    const r = fakeResend();
    const e = envWith(r.fn);
    const h = await signedIn(e);
    const bad = await postInvite(e, ["ok@example.com", "not-an-address", "x@"], h);
    expect(bad.status).toBe(400);
    const body = (await bad.json()) as { error: string; invalid: string[] };
    expect(body.invalid).toEqual(["not-an-address", "x@"]);
    expect(body.error).toContain("not-an-address");
    expect((await postInvite(e, [], h)).status).toBe(400);
    expect((await postInvite(e, "a@example.com", h)).status).toBe(400);
    expect((await postInvite(e, [42], h)).status).toBe(400);
    expect((await postInvite(e, [`${"a".repeat(250)}@example.com`], h)).status).toBe(400);
    const tooMany = Array.from({ length: 201 }, (_, i) => `t${i}@example.com`);
    expect((await postInvite(e, tooMany, h)).status).toBe(400);
    expect(r.fn).not.toHaveBeenCalled();
    expect(await count("SELECT COUNT(*) AS n FROM list_subscribers")).toBe(0);
  });

  it("reports addresses Resend refuses as failed and keeps no row or invite record for them", async () => {
    const r = fakeResend(() =>
      Response.json({ data: [{ id: "re_ok" }], errors: [{ index: 1, message: "Invalid `to` field." }] }),
    );
    const e = envWith(r.fn);
    const out = (await (await inviteAt(e, ["good@example.com", "bad@example.com"], Date.now())).json()) as InviteResult;
    expect(out.invited).toBe(1);
    expect(out.failed).toEqual([{ email: "bad@example.com", error: "Resend refused it: Invalid `to` field." }]);
    expect(await count("SELECT COUNT(*) AS n FROM list_subscribers WHERE email = 'bad@example.com'")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM list_invites")).toBe(1);
    expect(await count("SELECT count AS n FROM counters WHERE key LIKE 'list:sent:%'")).toBe(1);
  });

  it("keeps nothing when Resend fails, and defers when Resend's own quota is used up", async () => {
    const down = fakeResend(() => Response.json({ name: "application_error", message: "Down" }, { status: 500 }));
    const out = (await (await inviteAt(envWith(down.fn), ["a@example.com"], Date.now())).json()) as InviteResult;
    expect(out).toEqual({ invited: 0, skipped: 0, deferred: [], failed: [{ email: "a@example.com", error: "Resend didn't send it: Down" }] });
    const quota = fakeResend(() => Response.json({ name: "daily_quota_exceeded", message: "Quota" }, { status: 429 }));
    const out2 = (await (await inviteAt(envWith(quota.fn), ["a@example.com", "b@example.com"], Date.now())).json()) as InviteResult;
    expect(out2).toEqual({ invited: 0, skipped: 0, deferred: ["a@example.com", "b@example.com"], failed: [] });
    expect(await count("SELECT COUNT(*) AS n FROM list_subscribers")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM list_invites")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM counters WHERE key LIKE 'list:sent:%'")).toBe(0);
  });

  it("answers 503 when sending isn't set up", async () => {
    const res = await inviteAt({ ...env, RESEND_API_KEY: undefined, RESEND_FETCH: undefined }, ["a@example.com"], Date.now());
    expect(res.status).toBe(503);
  });
});
