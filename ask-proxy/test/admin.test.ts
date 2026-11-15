import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";

const ADMIN = "https://admin.oceanlive.org";
const API = "https://api.oceanlive.org";
const WEB = "https://account.oceanlive.org";
const DEV = "https://ocean-live-ask.example.workers.dev";
const CLIENT_ID = "test-web-client.apps.googleusercontent.com";
const db = () => env.LOG_DB!;

let n = 0;
const uniq = () => `${Date.now().toString(36)}${++n}`;
const ip = () => `203.0.113.${(++n % 250) + 1}`;
const addr = (who: string) => `${who}-${uniq()}@example.com`;

async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── A fake Google: our own RSA key, served as Google's JWKS through JWKS_FETCH ──

let keys: CryptoKeyPair;
let jwk: JsonWebKey;
const KID = "test-kid";

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  jwk = { ...((await crypto.subtle.exportKey("jwk", keys.publicKey)) as JsonWebKey), kid: KID, alg: "RS256", use: "sig" } as JsonWebKey;
});

const b64url = (bytes: Uint8Array | string) => {
  const b = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** A Google ID token for `email`, signed with the test key. */
async function idToken(email: string, claims: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", kid: KID, typ: "JWT" }));
  const body = b64url(
    JSON.stringify({ iss: "https://accounts.google.com", aud: CLIENT_ID, sub: `g-${email}`, email, email_verified: true, iat: now, exp: now + 3600, ...claims }),
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(`${header}.${body}`));
  return `${header}.${body}.${b64url(new Uint8Array(sig))}`;
}

function server(vars: Partial<Env> = {}) {
  const resend = vi.fn(async () => Response.json({ id: "re_1" }));
  const jwks = vi.fn(async () => Response.json({ keys: [jwk] }));
  const e: Env = {
    ...env,
    RESEND_API_KEY: "test",
    RESEND_FETCH: resend as unknown as typeof fetch,
    JWKS_FETCH: jwks as unknown as typeof fetch,
    GOOGLE_WEB_CLIENT_ID: CLIENT_ID,
    APPLE_AUDIENCES: "com.justice.OceanABRP",
    ...vars,
  };
  async function call(url: string, init: RequestInit = {}) {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request(url, init), e, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  }
  return { call, resend, jwks, env: e };
}
type Server = ReturnType<typeof server>;

const post = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: ADMIN, ...headers },
  body: JSON.stringify(body),
});

/** Signs in on the admin page with Google. Returns the response and the cookie pair. */
async function signIn(s: Server, email: string, claims: Record<string, unknown> = {}) {
  const res = await s.call(`${ADMIN}/auth/google`, post({ idToken: await idToken(email, claims) }, { "CF-Connecting-IP": ip() }));
  const set = res.headers.get("Set-Cookie");
  return { res, set, cookie: set ? set.split(";")[0] : "" };
}

const get = (s: Server, path: string, cookie: string) => s.call(`${ADMIN}${path}`, { headers: { Cookie: cookie } });
const write = (s: Server, path: string, cookie: string, body: unknown) => s.call(`${ADMIN}${path}`, post(body, { Cookie: cookie }));

async function appAccount(opts: { email?: string; cents?: number } = {}) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const email = opts.email ?? addr("user");
  await db().prepare("INSERT INTO accounts (id, email, name, created, last_seen) VALUES (?, ?, NULL, ?, ?)").bind(id, email, now, now).run();
  if (opts.cents) await db().prepare("INSERT INTO balances (account_id, cents, updated) VALUES (?, ?, ?)").bind(id, opts.cents, now).run();
  return { id, email };
}

async function adminSessions(email: string) {
  return (await db().prepare("SELECT COUNT(*) AS n FROM admin_sessions WHERE email = ?").bind(email.toLowerCase()).first<{ n: number }>())!.n;
}

describe("admin host", () => {
  it("serves the admin page only on admin.oceanlive.org, with a strict CSP and noindex", async () => {
    const s = server();
    const page = await s.call(`${ADMIN}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("Content-Type")).toContain("text/html");
    expect(await page.text()).toContain("Ocean Live admin");
    const csp = page.headers.get("Content-Security-Policy")!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("https://accounts.google.com/gsi/client");
    expect(page.headers.get("X-Robots-Tag")).toContain("noindex");
    const js = await s.call(`${ADMIN}/admin.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get("Content-Type")).toContain("javascript");
    expect(await js.text()).toContain("/admin/balance");
    expect((await s.call(`${ADMIN}/admin.css`)).headers.get("Content-Type")).toContain("text/css");

    for (const host of [API, WEB, DEV]) {
      for (const path of ["/admin.js", "/admin.css", "/admin/me", "/admin/accounts?email=a@example.com", "/admin/admins", "/admin"]) {
        const res = await s.call(`${host}${path}`);
        expect(res.status, `${host}${path}`).toBe(404);
      }
      for (const path of ["/admin/balance", "/admin/badge", "/admin/admins/add", "/auth/google"]) {
        if (path === "/auth/google") continue;
        const res = await s.call(`${host}${path}`, post({ accountId: "x", deltaCents: 1, note: "abc" }, { Origin: host }));
        expect(res.status, `${host}${path}`).toBe(404);
      }
    }
  });

  it("keeps the account page's files off the admin host", async () => {
    const s = server();
    for (const path of ["/account.js", "/account.css", "/fonts/inter-latin.woff2", "/icons/favicon-32.png", "/account"]) {
      expect((await s.call(`${ADMIN}${path}`)).status, path).toBe(404);
    }
  });

  it("is Google only: email codes, Apple and the account endpoints are refused", async () => {
    const s = server({ ADMIN_EMAILS: "owner@example.com" });
    const email = "owner@example.com";
    for (const path of ["/auth/email/start", "/auth/email/verify", "/auth/apple"]) {
      const res = await s.call(`${ADMIN}${path}`, post({ email, code: "123456", identityToken: "x" }, { "CF-Connecting-IP": ip() }));
      expect(res.status, path).toBe(404);
    }
    expect((await s.call(`${ADMIN}/account`)).status).toBe(404);
    expect(s.resend).not.toHaveBeenCalled();
    const config = (await (await s.call(`${ADMIN}/auth/config`)).json()) as Record<string, unknown>;
    expect(config).toEqual({ google: true, googleWebClientId: CLIENT_ID });
  });

  it("checks the Origin of every change", async () => {
    const owner = addr("owner");
    const s = server({ ADMIN_EMAILS: owner });
    const { cookie } = await signIn(s, owner);
    const a = await appAccount();
    for (const origin of [undefined, WEB, "https://evil.example"]) {
      const headers: Record<string, string> = { "Content-Type": "application/json", Cookie: cookie };
      if (origin) headers.Origin = origin;
      const res = await s.call(`${ADMIN}/admin/balance`, { method: "POST", headers, body: JSON.stringify({ accountId: a.id, deltaCents: 100, note: "test" }) });
      expect(res.status).toBe(403);
    }
    const google = await s.call(`${ADMIN}/auth/google`, { method: "POST", body: JSON.stringify({ idToken: await idToken(owner) }) });
    expect(google.status).toBe(403);
  });
});

describe("admin sign-in", () => {
  it("makes owners from the secret only, matching case-insensitively, with a 12-hour host-only cookie", async () => {
    const owner = addr("Owner");
    const s = server({ ADMIN_EMAILS: ` someone@example.com , ${owner.toUpperCase()} ` });
    const { res, set, cookie } = await signIn(s, owner);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: owner.toLowerCase(), owner: true });
    expect(set).toContain("__Host-oladmin=");
    expect(set).toContain("Max-Age=43200");
    expect(set).toContain("HttpOnly");
    expect(set).toContain("Secure");
    expect(set).toContain("SameSite=Strict");
    expect(set).not.toContain("Domain");
    const me = await get(s, "/admin/me", cookie);
    expect(await me.json()).toEqual({ email: owner.toLowerCase(), owner: true });
    const row = await db().prepare("SELECT created, expires FROM admin_sessions WHERE email = ?").bind(owner.toLowerCase()).first<{ created: string; expires: string }>();
    expect(Date.parse(row!.expires) - Date.parse(row!.created)).toBe(12 * 3600 * 1000);
  });

  it("refuses a Google account that isn't an admin, and creates no session", async () => {
    const stranger = addr("stranger");
    for (const vars of [{ ADMIN_EMAILS: addr("owner") }, { ADMIN_EMAILS: "" }, { ADMIN_EMAILS: undefined }]) {
      const s = server(vars);
      const { res, set } = await signIn(s, stranger);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "not_admin" });
      expect(set).toBeNull();
    }
    expect(await adminSessions(stranger)).toBe(0);
  });

  it("needs a verified email, the web client ID as audience and a valid token", async () => {
    const owner = addr("owner");
    const s = server({ ADMIN_EMAILS: owner });
    expect((await signIn(s, owner, { email_verified: false })).res.status).toBe(403);
    expect((await signIn(s, owner, { aud: "other-client" })).res.status).toBe(401);
    expect((await signIn(s, owner, { iss: "https://evil.example" })).res.status).toBe(401);
    expect((await signIn(s, owner, { exp: Math.floor(Date.now() / 1000) - 3600 })).res.status).toBe(401);
    const tampered = (await idToken(owner)).replace(/\.[^.]+$/, ".AAAA");
    expect((await s.call(`${ADMIN}/auth/google`, post({ idToken: tampered }))).status).toBe(401);
    expect(await adminSessions(owner)).toBe(0);
    // No web client ID: Google is off here.
    const off = server({ ADMIN_EMAILS: owner, GOOGLE_WEB_CLIENT_ID: "" });
    expect((await signIn(off, owner)).res.status).toBe(503);
  });

  it("never makes the review account an admin, and app sessions count for nothing", async () => {
    const review = addr("review");
    const s = server({ ADMIN_EMAILS: review, REVIEW_EMAIL: review, REVIEW_CODE: "123456" });
    expect((await signIn(s, review)).res.status).toBe(403);
    expect(await adminSessions(review)).toBe(0);

    // An app account's bearer token or account-page cookie on the admin host.
    const a = await appAccount();
    const token = `tok_${crypto.randomUUID().replace(/-/g, "")}`;
    const now = new Date().toISOString();
    await db().prepare("INSERT INTO sessions (token_hash, account_id, created, last_used, expires) VALUES (?, ?, ?, ?, ?)")
      .bind(await sha256Hex(token), a.id, now, now, new Date(Date.now() + 86_400_000).toISOString()).run();
    const tries: Record<string, string>[] = [{ Authorization: `Bearer ${token}` }, { Cookie: `__Host-olaccount=${token}` }, { Cookie: `__Host-oladmin=${token}` }];
    for (const headers of tries) {
      expect((await s.call(`${ADMIN}/admin/me`, { headers })).status).toBe(404);
    }
  });

  it("ends expired sessions and signs out", async () => {
    const owner = addr("owner");
    const s = server({ ADMIN_EMAILS: owner });
    const { cookie } = await signIn(s, owner);
    await db().prepare("UPDATE admin_sessions SET expires = ? WHERE email = ?").bind(new Date(Date.now() - 1000).toISOString(), owner).run();
    const res = await get(s, "/admin/me", cookie);
    expect(res.status).toBe(404);
    expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0");

    const again = await signIn(s, owner);
    expect((await get(s, "/admin/me", again.cookie)).status).toBe(200);
    expect((await s.call(`${ADMIN}/auth/signout`, post({}, { Cookie: again.cookie }))).status).toBe(200);
    expect((await get(s, "/admin/me", again.cookie)).status).toBe(404);
    expect(await adminSessions(owner)).toBe(0);
  });

  it("ends the sessions of an owner taken out of the secret", async () => {
    const owner = addr("owner");
    const { cookie } = await signIn(server({ ADMIN_EMAILS: owner }), owner);
    expect((await get(server({ ADMIN_EMAILS: owner }), "/admin/me", cookie)).status).toBe(200);
    expect((await get(server({ ADMIN_EMAILS: "" }), "/admin/me", cookie)).status).toBe(404);
    expect(await adminSessions(owner)).toBe(0);
  });
});

describe("admin accounts and balances", () => {
  async function ownerSession(vars: Partial<Env> = {}) {
    const owner = addr("owner");
    const s = server({ ADMIN_EMAILS: owner, ...vars });
    const { cookie } = await signIn(s, owner);
    return { s, owner, cookie };
  }

  it("finds an account by exact email or ID with balance, badges and ledger", async () => {
    const { s, cookie } = await ownerSession();
    const a = await appAccount({ cents: 250 });
    await db().prepare("INSERT INTO badges (account_id, badge, created) VALUES (?, 'early_supporter', ?)").bind(a.id, new Date().toISOString()).run();
    const byEmail = (await (await get(s, `/admin/accounts?email=${encodeURIComponent(a.email.toUpperCase())}`, cookie)).json()) as {
      accounts: { id: string; balanceCents: number; badges: string[]; ledger: unknown[]; review: boolean }[];
    };
    expect(byEmail.accounts).toHaveLength(1);
    expect(byEmail.accounts[0]).toMatchObject({ id: a.id, balanceCents: 250, badges: ["early_supporter"], ledger: [], review: false });
    const byId = (await (await get(s, `/admin/accounts?id=${a.id}`, cookie)).json()) as { accounts: { id: string }[] };
    expect(byId.accounts.map((x) => x.id)).toEqual([a.id]);
    const none = (await (await get(s, `/admin/accounts?email=${encodeURIComponent(a.email.slice(1))}`, cookie)).json()) as { accounts: unknown[] };
    expect(none.accounts).toEqual([]);
    expect((await get(s, "/admin/accounts?email=", cookie)).status).toBe(400);
  });

  it("adds and removes credit atomically, with a ledger row, the admin's email and a log entry", async () => {
    const { s, owner, cookie } = await ownerSession();
    const a = await appAccount();
    let res = await write(s, "/admin/balance", cookie, { accountId: a.id, deltaCents: 500, note: "goodwill credit" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, balanceCents: 500 });
    res = await write(s, "/admin/balance", cookie, { accountId: a.id, deltaCents: -120, note: "correction" });
    expect(await res.json()).toEqual({ ok: true, balanceCents: 380 });
    const ledger = await db().prepare("SELECT delta_cents, kind, ref, note FROM ledger WHERE account_id = ? ORDER BY id").bind(a.id)
      .all<{ delta_cents: number; kind: string; ref: string; note: string }>();
    expect(ledger.results.map((r) => [r.delta_cents, r.kind, r.note])).toEqual([
      [500, "adjust", `${owner}: goodwill credit`],
      [-120, "adjust", `${owner}: correction`],
    ]);
    for (const r of ledger.results) expect(r.ref).toMatch(/^admin:[0-9a-f-]{36}$/);
    const log = await db().prepare("SELECT email, action FROM admin_log WHERE account_id = ? ORDER BY id").bind(a.id).all<{ email: string; action: string }>();
    expect(log.results).toEqual([{ email: owner, action: "balance" }, { email: owner, action: "balance" }]);
  });

  it("never takes the balance below 0", async () => {
    const { s, cookie } = await ownerSession();
    const a = await appAccount({ cents: 100 });
    const res = await write(s, "/admin/balance", cookie, { accountId: a.id, deltaCents: -101, note: "too much" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "insufficient_balance", balanceCents: 100 });
    const empty = await appAccount();
    expect((await write(s, "/admin/balance", cookie, { accountId: empty.id, deltaCents: -1, note: "none" })).status).toBe(409);
    expect((await db().prepare("SELECT COUNT(*) AS n FROM ledger WHERE account_id IN (?, ?)").bind(a.id, empty.id).first<{ n: number }>())!.n).toBe(0);
    expect((await db().prepare("SELECT COUNT(*) AS n FROM admin_log WHERE account_id IN (?, ?)").bind(a.id, empty.id).first<{ n: number }>())!.n).toBe(0);
    expect((await write(s, "/admin/balance", cookie, { accountId: a.id, deltaCents: -100, note: "all of it" })).status).toBe(200);
  });

  it("needs a note and a sensible amount", async () => {
    const { s, cookie } = await ownerSession();
    const a = await appAccount();
    const cases: [unknown, unknown, string][] = [
      [100, undefined, "note_required"],
      [100, "ab", "note_required"],
      [100, "x".repeat(201), "note_required"],
      [100, "   \n  ", "note_required"],
      [0, "zero", "bad_amount"],
      [1.5, "fraction", "bad_amount"],
      ["100", "string", "bad_amount"],
      [100_001, "too big", "bad_amount"],
      [-100_001, "too small", "bad_amount"],
    ];
    for (const [deltaCents, note, error] of cases) {
      const res = await write(s, "/admin/balance", cookie, { accountId: a.id, deltaCents, note });
      expect(res.status, JSON.stringify([deltaCents, note])).toBe(400);
      expect(await res.json()).toEqual({ error });
    }
    expect((await write(s, "/admin/balance", cookie, { accountId: crypto.randomUUID(), deltaCents: 1, note: "nobody" })).status).toBe(404);
  });

  it("grants and removes the Early supporter badge", async () => {
    const { s, cookie } = await ownerSession();
    const a = await appAccount();
    let res = await write(s, "/admin/badge", cookie, { accountId: a.id, badge: "early_supporter", grant: true });
    expect(await res.json()).toEqual({ ok: true, badges: ["early_supporter"] });
    res = await write(s, "/admin/badge", cookie, { accountId: a.id, badge: "early_supporter", grant: true });
    expect(await res.json()).toEqual({ ok: true, badges: ["early_supporter"] });
    res = await write(s, "/admin/badge", cookie, { accountId: a.id, badge: "early_supporter", grant: false });
    expect(await res.json()).toEqual({ ok: true, badges: [] });
    expect((await write(s, "/admin/badge", cookie, { accountId: a.id, badge: "other", grant: true })).status).toBe(400);
    expect((await write(s, "/admin/badge", cookie, { accountId: a.id, badge: "early_supporter", grant: "yes" })).status).toBe(400);
    const log = await db().prepare("SELECT COUNT(*) AS n FROM admin_log WHERE account_id = ? AND action = 'badge'").bind(a.id).first<{ n: number }>();
    expect(log!.n).toBe(3);
  });

  it("never gives the review account a balance or badge", async () => {
    const review = addr("review");
    const { s, cookie } = await ownerSession({ REVIEW_EMAIL: review, REVIEW_CODE: "123456" });
    const a = await appAccount({ email: review });
    expect((await write(s, "/admin/balance", cookie, { accountId: a.id, deltaCents: 500, note: "should fail" })).status).toBe(400);
    expect((await write(s, "/admin/badge", cookie, { accountId: a.id, badge: "early_supporter", grant: true })).status).toBe(400);
    const found = (await (await get(s, `/admin/accounts?id=${a.id}`, cookie)).json()) as { accounts: { review: boolean; balanceCents: number }[] };
    expect(found.accounts[0]).toMatchObject({ review: true, balanceCents: 0 });
  });

  it("limits writes per admin per day", async () => {
    const { s, cookie } = await ownerSession({ ADMIN_WRITE_LIMIT: "2" });
    const a = await appAccount();
    expect((await write(s, "/admin/balance", cookie, { accountId: a.id, deltaCents: 1, note: "one" })).status).toBe(200);
    expect((await write(s, "/admin/badge", cookie, { accountId: a.id, badge: "early_supporter", grant: true })).status).toBe(200);
    expect((await write(s, "/admin/balance", cookie, { accountId: a.id, deltaCents: 1, note: "three" })).status).toBe(429);
  });

  it("deletes the admin log rows about an account with the account", async () => {
    const { s, cookie } = await ownerSession();
    const email = addr("deleted");
    // An app account with an app session, so it can delete itself.
    const a = await appAccount({ email });
    const token = `tok_${crypto.randomUUID().replace(/-/g, "")}`;
    const now = new Date().toISOString();
    await db().prepare("INSERT INTO sessions (token_hash, account_id, created, last_used, expires) VALUES (?, ?, ?, ?, ?)")
      .bind(await sha256Hex(token), a.id, now, now, new Date(Date.now() + 86_400_000).toISOString()).run();
    expect((await write(s, "/admin/balance", cookie, { accountId: a.id, deltaCents: 200, note: "before delete" })).status).toBe(200);
    const del = await s.call(`${API}/account`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    expect(del.status).toBe(200);
    for (const table of ["admin_log", "ledger", "balances"]) {
      const row = await db().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE account_id = ?`).bind(a.id).first<{ n: number }>();
      expect(row!.n, table).toBe(0);
    }
  });
});

describe("managing admins", () => {
  it("lets owners add an admin who can then change balances but not manage admins", async () => {
    const owner = addr("owner");
    const helper = addr("Helper");
    const s = server({ ADMIN_EMAILS: owner });
    const o = await signIn(s, owner);
    // Not yet an admin.
    expect((await signIn(s, helper)).res.status).toBe(403);

    const add = await write(s, "/admin/admins/add", o.cookie, { email: helper.toUpperCase() });
    expect(add.status).toBe(200);
    const list = (await add.json()) as { owners: string[]; admins: { email: string; addedBy: string }[] };
    expect(list.owners).toEqual([owner]);
    expect(list.admins).toEqual([expect.objectContaining({ email: helper.toLowerCase(), addedBy: owner })]);

    const h = await signIn(s, helper);
    expect(h.res.status).toBe(200);
    expect(await h.res.json()).toEqual({ email: helper.toLowerCase(), owner: false });
    const a = await appAccount();
    expect((await write(s, "/admin/balance", h.cookie, { accountId: a.id, deltaCents: 300, note: "helper credit" })).status).toBe(200);
    expect((await write(s, "/admin/badge", h.cookie, { accountId: a.id, badge: "early_supporter", grant: true })).status).toBe(200);
    const note = await db().prepare("SELECT note FROM ledger WHERE account_id = ?").bind(a.id).first<{ note: string }>();
    expect(note!.note).toBe(`${helper.toLowerCase()}: helper credit`);

    // Admins can't manage admins or read the admin log.
    expect((await get(s, "/admin/admins", h.cookie)).status).toBe(403);
    expect((await get(s, "/admin/log", h.cookie)).status).toBe(403);
    expect((await write(s, "/admin/admins/add", h.cookie, { email: addr("friend") })).status).toBe(403);
    expect((await write(s, "/admin/admins/remove", h.cookie, { email: helper })).status).toBe(403);

    const log = (await (await get(s, "/admin/log", o.cookie)).json()) as { log: { email: string; action: string }[] };
    expect(log.log.map((l) => l.action)).toEqual(expect.arrayContaining(["admin_add", "balance", "badge", "signin"]));
  });

  it("ends a removed admin's sessions straight away", async () => {
    const owner = addr("owner");
    const helper = addr("helper");
    const s = server({ ADMIN_EMAILS: owner });
    const o = await signIn(s, owner);
    await write(s, "/admin/admins/add", o.cookie, { email: helper });
    const h1 = await signIn(s, helper);
    const h2 = await signIn(s, helper);
    expect((await get(s, "/admin/me", h1.cookie)).status).toBe(200);
    expect(await adminSessions(helper)).toBe(2);

    const res = await write(s, "/admin/admins/remove", o.cookie, { email: helper });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { admins: { email: string }[] }).admins.map((x) => x.email)).not.toContain(helper);
    expect(await adminSessions(helper)).toBe(0);
    for (const c of [h1.cookie, h2.cookie]) expect((await get(s, "/admin/me", c)).status).toBe(404);
    expect((await signIn(s, helper)).res.status).toBe(403);
  });

  it("can't remove owners, add owners again or add the review address", async () => {
    const owner = addr("owner");
    const other = addr("owner2");
    const review = addr("review");
    const s = server({ ADMIN_EMAILS: `${owner},${other}`, REVIEW_EMAIL: review, REVIEW_CODE: "123456" });
    const o = await signIn(s, owner);
    let res = await write(s, "/admin/admins/remove", o.cookie, { email: other });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "owner_fixed" });
    res = await write(s, "/admin/admins/add", o.cookie, { email: other });
    expect(await res.json()).toEqual({ error: "already_owner" });
    res = await write(s, "/admin/admins/add", o.cookie, { email: review });
    expect(await res.json()).toEqual({ error: "not_allowed" });
    res = await write(s, "/admin/admins/add", o.cookie, { email: "not an email" });
    expect(await res.json()).toEqual({ error: "bad_email" });
    expect((await signIn(s, other)).res.status).toBe(200);
    // Even if the review address got into the table some other way, it is never an admin.
    await db().prepare("INSERT INTO admins (email, added_by, created) VALUES (?, 'x', ?)").bind(review, new Date().toISOString()).run();
    expect((await signIn(s, review)).res.status).toBe(403);
  });
});

describe("daily cleanup", () => {
  it("deletes expired admin sessions", async () => {
    const owner = addr("owner");
    const s = server({ ADMIN_EMAILS: owner });
    await signIn(s, owner);
    await signIn(s, owner);
    await db().prepare("UPDATE admin_sessions SET expires = ? WHERE token_hash IN (SELECT token_hash FROM admin_sessions WHERE email = ? LIMIT 1)")
      .bind(new Date(Date.now() - 1000).toISOString(), owner).run();
    await worker.scheduled!(createScheduledController(), s.env);
    expect(await adminSessions(owner)).toBe(1);
  });
});
