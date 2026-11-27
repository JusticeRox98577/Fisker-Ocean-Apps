import { SELF, createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env, MailService } from "../src/env";
import { checkSignUp } from "../src/form";
import worker from "../src/index";
import { allRows, tally, toCsv, type Row } from "../src/store";

const ORIGIN = "https://hardware.oceanlive.org";

type Sent = { from: string; to: string; subject: string; text: string };

/** A fake mail Worker that keeps what it was asked to send. */
function fakeMail() {
  const sent: Sent[] = [];
  const service: MailService = {
    send: async (n) => {
      sent.push(n);
      return { ok: true };
    },
  };
  return { service, sent };
}

/** Calls the Worker with the mail service faked; returns the response and what was emailed. */
async function call(path: string, init: RequestInit & { cookie?: string } = {}, mail: { service: MailService; sent: Sent[] } = fakeMail()) {
  const e: Env = { ...env, MAIL: mail.service };
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  if (init.cookie) headers.set("Cookie", init.cookie);
  if (init.method === "POST") headers.set("Origin", ORIGIN);
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), e, ctx);
  await waitOnExecutionContext(ctx);
  return { res, sent: mail.sent };
}

/** Signs in the way the admin does: ask for a link, take it from the email, swap it for a cookie. */
async function signIn(): Promise<string> {
  const { res, sent } = await call("/api/admin/login", { method: "POST", body: "{}" });
  expect(res.status).toBe(200);
  expect(sent[0]).toMatchObject({ from: "justice@oceanlive.org", to: "justice@oceanlive.org" });
  const token = sent[0].text.match(/#login=([A-Za-z0-9_-]+)/)![1];
  const s = await call("/api/admin/session", { method: "POST", body: JSON.stringify({ token }) });
  expect(s.res.status).toBe(200);
  const cookie = s.res.headers.get("Set-Cookie")!;
  expect(cookie).toMatch(/HttpOnly/);
  expect(cookie).toMatch(/SameSite=Strict/);
  return cookie.split(";")[0];
}

const good = {
  email: "Owner@Example.com",
  name: "Sam",
  region: "Oregon, USA",
  car: "extreme",
  phone: "iphone",
  products: ["flare", "supernova"],
  features: ["carplay", "remote-status", "low-drain", "fail-safe", "price"],
  otherFeature: "",
  install: "help",
  notes: "Line one\nLine two",
  consent: true,
  website: "",
};

function post(body: unknown, headers: Record<string, string> = {}) {
  return SELF.fetch(`${ORIGIN}/api/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}


beforeEach(async () => {
  await env.DB.batch(["responses", "counters", "sessions", "login_links"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
});

describe("checking a sign-up", () => {
  it("accepts a full answer and tidies it", () => {
    const r = checkSignUp({ ...good, name: "  Sam\u0000  Smith ", features: ["CarPlay", "carplay", "abrp"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.email).toBe("owner@example.com");
    expect(r.value.name).toBe("Sam Smith");
    expect(r.value.features).toEqual(["carplay", "abrp"]);
    expect(r.value.notes).toBe("Line one\nLine two");
  });

  it("needs an email, consent and at least one feature", () => {
    expect(checkSignUp({ ...good, email: "nope" })).toMatchObject({ ok: false });
    expect(checkSignUp({ ...good, consent: false })).toMatchObject({ ok: false });
    expect(checkSignUp({ ...good, features: [] })).toMatchObject({ ok: false });
    expect(checkSignUp({ ...good, features: [], otherFeature: "Heated wipers" })).toMatchObject({ ok: true });
  });

  it("refuses more than five features and odd ids", () => {
    expect(checkSignUp({ ...good, features: ["a", "b", "c", "d", "e", "f"] })).toMatchObject({ ok: false });
    expect(checkSignUp({ ...good, features: ["<script>"] })).toMatchObject({ ok: false });
    expect(checkSignUp({ ...good, features: "carplay" })).toMatchObject({ ok: false });
  });

  it("drops a choice that isn't an id", () => {
    const r = checkSignUp({ ...good, phone: "a phone!" });
    expect(r.ok && r.value.phone).toBe("");
  });
});

describe("POST /api/signup", () => {
  it("saves an answer", async () => {
    const res = await post(good);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const rows = await allRows(env.DB);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: "owner@example.com", features: good.features, products: good.products, install: "help" });
  });

  it("replaces the earlier answer for the same address", async () => {
    await post(good);
    await post({ ...good, email: "owner@example.com", features: ["abrp"] });
    const rows = await allRows(env.DB);
    expect(rows).toHaveLength(1);
    expect(rows[0].features).toEqual(["abrp"]);
  });

  it("says why an answer is refused", async () => {
    const res = await post({ ...good, consent: false });
    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toMatch(/Tick the box/);
  });

  it("pretends to accept bots that fill the hidden field, and saves nothing", async () => {
    const res = await post({ ...good, website: "http://spam.example" });
    expect(res.status).toBe(200);
    expect(await allRows(env.DB)).toHaveLength(0);
  });

  it("refuses other sites, non-JSON and broken JSON", async () => {
    expect((await post(good, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await post(good, { "Content-Type": "text/plain" })).status).toBe(415);
    expect((await post("{not json")).status).toBe(400);
    expect((await post([1, 2])).status).toBe(400);
  });

  it("limits sign-ups per network", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await post({ ...good, email: `p${i}@example.com` }, { "CF-Connecting-IP": "203.0.113.9" })).status).toBe(200);
    }
    expect((await post({ ...good, email: "p6@example.com" }, { "CF-Connecting-IP": "203.0.113.9" })).status).toBe(429);
    expect((await post({ ...good, email: "p7@example.com" }, { "CF-Connecting-IP": "203.0.113.10" })).status).toBe(200);
  });

  it("only takes POST", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/signup`);
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });
});

describe("admin sign-in", () => {
  it("keeps the answers private without a session", async () => {
    await post(good);
    for (const path of ["/api/admin/responses", "/api/admin/responses?format=json", "/api/admin/responses?format=summary"]) {
      expect((await SELF.fetch(`${ORIGIN}${path}`)).status).toBe(401);
    }
    expect((await call("/api/admin/pick", { method: "POST", body: JSON.stringify({ email: good.email }) })).res.status).toBe(401);
    expect((await call("/api/admin/responses", { cookie: "__Host-olhw=made-up-session-token-123456" })).res.status).toBe(401);
  });

  it("only ever emails the admin address, and doesn't print it in full", async () => {
    const { res, sent } = await call("/api/admin/login", { method: "POST", body: JSON.stringify({ email: "attacker@example.com" }) });
    expect(sent.map((m) => m.to)).toEqual(["justice@oceanlive.org"]);
    expect(await res.json()).toEqual({ ok: true, to: "j••••••@oceanlive.org" });
  });

  it("uses each link once", async () => {
    const { sent } = await call("/api/admin/login", { method: "POST", body: "{}" });
    const token = sent[0].text.match(/#login=([A-Za-z0-9_-]+)/)![1];
    expect((await call("/api/admin/session", { method: "POST", body: JSON.stringify({ token }) })).res.status).toBe(200);
    expect((await call("/api/admin/session", { method: "POST", body: JSON.stringify({ token }) })).res.status).toBe(401);
  });

  it("limits sign-in emails", async () => {
    for (let i = 0; i < 5; i++) expect((await call("/api/admin/login", { method: "POST", body: "{}" })).res.status).toBe(200);
    expect((await call("/api/admin/login", { method: "POST", body: "{}" })).res.status).toBe(429);
  });

  it("signs out", async () => {
    const cookie = await signIn();
    expect((await call("/api/admin/responses", { cookie })).res.status).toBe(200);
    await call("/api/admin/logout", { method: "POST", body: "{}", cookie });
    expect((await call("/api/admin/responses", { cookie })).res.status).toBe(401);
  });
});

describe("the admin page's data", () => {
  it("downloads the answers as CSV, JSON and a ranking", async () => {
    const cookie = await signIn();
    await post(good);
    await post({ ...good, email: "b@example.com", features: ["remote-status", "carplay"], notes: "=SUM(A1)" });

    const csv = (await call("/api/admin/responses", { cookie })).res;
    expect(csv.headers.get("Content-Type")).toMatch(/text\/csv/);
    const text = await csv.text();
    expect(text.split("\r\n")[0]).toContain("feature_1,feature_2");
    expect(text).toContain("'=SUM(A1)");
    expect(text).toContain('"Line one\nLine two"');

    const j = await (await call("/api/admin/responses?format=json", { cookie })).res.json<{ responses: Row[]; boards: number }>();
    expect(j.responses).toHaveLength(2);
    expect(j.boards).toBe(4);

    const s = await (await call("/api/admin/responses?format=summary", { cookie })).res.json<ReturnType<typeof tally>>();
    expect(s.responses).toBe(2);
    // carplay: 5 + 4 = 9; remote-status: 4 + 5 = 9, tie broken by firsts (1 each), then by name.
    expect(s.features.slice(0, 2).map((f) => [f.feature, f.points])).toEqual([["carplay", 9], ["remote-status", 9]]);
  });

  it("deletes one person", async () => {
    const cookie = await signIn();
    await post(good);
    const { res } = await call("/api/admin/delete", { method: "POST", body: JSON.stringify({ email: "OWNER@example.com" }), cookie });
    expect(await res.json()).toEqual({ ok: true, deleted: true });
    expect(await allRows(env.DB)).toHaveLength(0);
  });

  it("refuses changes from other sites", async () => {
    const cookie = await signIn();
    await post(good);
    const e: Env = { ...env, MAIL: fakeMail().service };
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request(`${ORIGIN}/api/admin/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie, Origin: "https://evil.example" },
        body: JSON.stringify({ email: good.email }),
      }),
      e,
      ctx,
    );
    expect(res.status).toBe(403);
    expect(await allRows(env.DB)).toHaveLength(1);
  });
});

describe("picking testers", () => {
  async function invitationToken(cookie: string, email: string) {
    const { res, sent } = await call("/api/admin/pick", { method: "POST", body: JSON.stringify({ email }), cookie });
    expect(res.status).toBe(200);
    expect(sent[0].to).toBe(email.toLowerCase());
    expect(sent[0].subject).toMatch(/picked/);
    return sent[0].text.match(/\/invite#([A-Za-z0-9_-]+)/)![1];
  }

  it("emails the person a link to say yes, and tells the admin", async () => {
    const cookie = await signIn();
    await post(good);
    const token = await invitationToken(cookie, "owner@example.com");
    expect((await allRows(env.DB))[0].pick).toBe("invited");

    const info = await call("/api/invite", { method: "POST", body: JSON.stringify({ token }) });
    expect(await info.res.json()).toEqual({ name: "Sam", status: "invited", boards: 4 });

    const yes = await call("/api/invite/answer", { method: "POST", body: JSON.stringify({ token, answer: "yes" }) });
    expect(await yes.res.json()).toEqual({ ok: true, status: "accepted" });
    expect(yes.sent[0].to).toBe("justice@oceanlive.org");
    expect(yes.sent[0].subject).toMatch(/said yes/);
    expect(yes.sent[0].text).toContain("owner@example.com");
    expect((await allRows(env.DB))[0].pick).toBe("accepted");
  });

  it("never invites more people than there are boards; a no frees one", async () => {
    const cookie = await signIn();
    for (let i = 0; i < 5; i++) await post({ ...good, email: `p${i}@example.com` });
    const tokens: string[] = [];
    for (let i = 0; i < 4; i++) tokens.push(await invitationToken(cookie, `p${i}@example.com`));
    const fifth = await call("/api/admin/pick", { method: "POST", body: JSON.stringify({ email: "p4@example.com" }), cookie });
    expect(fifth.res.status).toBe(409);
    expect(fifth.sent).toHaveLength(0);

    await call("/api/invite/answer", { method: "POST", body: JSON.stringify({ token: tokens[0], answer: "no" }) });
    await invitationToken(cookie, "p4@example.com");

    // The one who said no can't take the board back once it's gone.
    const late = await call("/api/invite/answer", { method: "POST", body: JSON.stringify({ token: tokens[0], answer: "yes" }) });
    expect(late.res.status).toBe(409);
  });

  it("someone who said no can change their mind while a board is free", async () => {
    const cookie = await signIn();
    await post(good);
    const token = await invitationToken(cookie, good.email);
    await call("/api/invite/answer", { method: "POST", body: JSON.stringify({ token, answer: "no" }) });
    const again = await call("/api/invite/answer", { method: "POST", body: JSON.stringify({ token, answer: "yes" }) });
    expect(await again.res.json()).toEqual({ ok: true, status: "accepted" });
    expect(again.sent[0].subject).toMatch(/said yes/);
    expect((await allRows(env.DB))[0].pick).toBe("accepted");
  });

  it("re-sending replaces the link; un-picking stops it working", async () => {
    const cookie = await signIn();
    await post(good);
    const first = await invitationToken(cookie, good.email);
    const second = await invitationToken(cookie, good.email);
    expect((await call("/api/invite", { method: "POST", body: JSON.stringify({ token: first }) })).res.status).toBe(404);
    expect((await call("/api/invite", { method: "POST", body: JSON.stringify({ token: second }) })).res.status).toBe(200);
    await call("/api/admin/unpick", { method: "POST", body: JSON.stringify({ email: good.email }), cookie });
    expect((await call("/api/invite", { method: "POST", body: JSON.stringify({ token: second }) })).res.status).toBe(404);
    expect((await allRows(env.DB))[0].pick).toBe("");
  });

  it("doesn't take a board when the email fails", async () => {
    const cookie = await signIn();
    await post(good);
    const broken = { service: { send: async () => ({ ok: false as const, error: "nope" }) }, sent: [] };
    const { res } = await call("/api/admin/pick", { method: "POST", body: JSON.stringify({ email: good.email }), cookie }, broken);
    expect(res.status).toBe(502);
    expect((await allRows(env.DB))[0].pick).toBe("");
  });

  it("keeps the pick when the person signs up again", async () => {
    const cookie = await signIn();
    await post(good);
    await invitationToken(cookie, good.email);
    await post({ ...good, features: ["abrp"] });
    expect((await allRows(env.DB))[0]).toMatchObject({ pick: "invited", features: ["abrp"] });
  });
});

describe("public counters", () => {
  it("show counts only", async () => {
    const cookie = await signIn();
    await post(good);
    await post({ ...good, email: "b@example.com", products: ["flare"] });
    await post({ ...good, email: "c@example.com", products: [] });
    await call("/api/admin/pick", { method: "POST", body: JSON.stringify({ email: "b@example.com" }), cookie });
    const res = await SELF.fetch(`${ORIGIN}/api/stats`);
    const body = await res.json();
    expect(body).toEqual({ responses: 3, interest: { flare: 2, supernova: 1 }, boards: 4, spokenFor: 1 });
    expect(JSON.stringify(body)).not.toContain("@");
  });
});

describe("the page", () => {
  it("is served, and /api/info says the form is open", async () => {
    const page = await SELF.fetch(`${ORIGIN}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('id="beta-form"');
    expect(await (await SELF.fetch(`${ORIGIN}/api/info`)).json()).toEqual({ open: true });
    expect((await SELF.fetch(`${ORIGIN}/api/nope`)).status).toBe(404);
  });

  it("has feature ids the API accepts", async () => {
    const html = await (await SELF.fetch(`${ORIGIN}/`)).text();
    const ids = [...html.matchAll(/name="features" value="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(MIN_FEATURES);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(checkSignUp({ ...good, features: [id] }).ok).toBe(true);
  });
});

const MIN_FEATURES = 5;

describe("CSV", () => {
  it("has a header even with no answers", () => {
    expect(toCsv([]).split("\r\n")[0].startsWith("email,name")).toBe(true);
  });
});
