import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";

const WEB = "https://account.oceanlive.org";
const API = "https://api.oceanlive.org";
const DEV = "https://ocean-live-ask.example.workers.dev";

/** Sends a request to the Worker with a fake Resend that remembers the codes it was asked to email. */
function server(vars: Partial<Env> = {}) {
  const codes = new Map<string, string>();
  const resend = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { to: string[]; subject: string };
    codes.set(body.to[0], /^(\d{6}) /.exec(body.subject)![1]);
    return Response.json({ id: "re_1" });
  });
  const e: Env = { ...env, RESEND_API_KEY: "test", RESEND_FETCH: resend as unknown as typeof fetch, ...vars };
  async function call(url: string, init: RequestInit = {}) {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request(url, init), e, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  }
  return { call, codes, resend };
}

const post = (body: unknown, headers: Record<string, string> = {}, method = "POST") => ({
  method,
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});

let ipCounter = 0;
/** Each sign-in from its own network, so the per-network code limit never gets in the way. */
const ip = () => `198.51.100.${++ipCounter}`;

/** An account made in the app with this email (the web page never creates accounts). */
async function appAccount(email: string) {
  const now = new Date().toISOString();
  await env.LOG_DB!.prepare("INSERT INTO accounts (id, email, name, created, last_seen) SELECT ?, ?, NULL, ?, ? WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE email = ?)")
    .bind(crypto.randomUUID(), email, now, now, email).run();
}

/** Signs in on the web page with an email code. Returns the cookie pair ("name=value"). */
async function webSignIn(s: ReturnType<typeof server>, email: string) {
  await appAccount(email);
  const start = await s.call(`${WEB}/auth/email/start`, post({ email }, { Origin: WEB, "CF-Connecting-IP": ip() }));
  expect(start.status).toBe(200);
  const res = await s.call(`${WEB}/auth/email/verify`, post({ email, code: s.codes.get(email) }, { Origin: WEB }));
  expect(res.status).toBe(200);
  const set = res.headers.get("Set-Cookie")!;
  return { set, cookie: set.split(";")[0], body: (await res.json()) as { account: { id: string; email: string }; token?: string } };
}

/** Signs in like the apps do: no Origin, bearer token in the body. */
async function appSignIn(s: ReturnType<typeof server>, email: string, host = API) {
  await s.call(`${host}/auth/email/start`, post({ email }, { "CF-Connecting-IP": ip() }));
  const res = await s.call(`${host}/auth/email/verify`, post({ email, code: s.codes.get(email), device: "test-device-0001" }));
  expect(res.status).toBe(200);
  return { res, body: (await res.json()) as { token: string; account: { id: string } } };
}

describe("/health", () => {
  it("answers on every host without auth or caching", async () => {
    const s = server();
    for (const host of [API, WEB, DEV]) {
      const res = await s.call(`${host}/health`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      const body = (await res.json()) as { ok: boolean; service: string; time: string };
      expect(body.ok).toBe(true);
      expect(body.service).toBe("api");
      expect(Number.isNaN(Date.parse(body.time))).toBe(false);
    }
    expect(s.resend).not.toHaveBeenCalled();
  });
});

describe("account page files", () => {
  it("are served on account.oceanlive.org with a strict CSP", async () => {
    const s = server();
    const page = await s.call(`${WEB}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Your account");
    const csp = page.headers.get("Content-Security-Policy")!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("google");
    expect(page.headers.get("X-Frame-Options")).toBe("DENY");
    const js = await s.call(`${WEB}/account.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get("Content-Type")).toContain("javascript");
  });

  it("let Google's sign-in in only when a web client ID is set", async () => {
    const csp = (await server({ GOOGLE_WEB_CLIENT_ID: "123.apps.googleusercontent.com" }).call(`${WEB}/`)).headers.get("Content-Security-Policy")!;
    expect(csp).toContain("script-src 'self' https://accounts.google.com/gsi/client");
    expect(csp).toContain("frame-src https://accounts.google.com/gsi/");
  });

  it("are 404 on api.oceanlive.org and workers.dev", async () => {
    const s = server();
    for (const host of [API, DEV]) {
      for (const path of ["/", "/index.html", "/account.js", "/account.css", "/fonts/inter-latin.woff2"]) {
        const res = await s.call(`${host}${path}`);
        expect(res.status, `${host}${path}`).toBe(404);
        expect(res.headers.get("Content-Type")).toContain("application/json");
      }
    }
  });

  it("only GET on the account host outside the account endpoints", async () => {
    const res = await server().call(`${WEB}/ask`, post({}, { Origin: WEB }));
    expect(res.status).toBe(405);
  });
});

describe("web sign-in with an email code", () => {
  it("sets a locked-down cookie and never returns the token", async () => {
    const s = server();
    const { set, body } = await webSignIn(s, "web1@example.com");
    expect(set).toMatch(/^__Host-olaccount=[\w-]{40,};/);
    for (const flag of ["Path=/", "Secure", "HttpOnly", "SameSite=Strict", "Max-Age=2592000"]) expect(set).toContain(flag);
    expect(set).not.toContain("Domain");
    expect(body.token).toBeUndefined();
    expect(body.account.email).toBe("web1@example.com");
    // The web session is 30 days, not the apps' year.
    const row = await env.LOG_DB!.prepare("SELECT s.created, s.expires FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE a.email = ?")
      .bind("web1@example.com").first<{ created: string; expires: string }>();
    expect(Math.round((Date.parse(row!.expires) - Date.parse(row!.created)) / 86_400_000)).toBe(30);
  });

  it("shows the account with the cookie", async () => {
    const s = server();
    const { cookie } = await webSignIn(s, "web2@example.com");
    const res = await s.call(`${WEB}/account`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const a = (await res.json()) as { email: string; providers: string[]; created: string };
    expect(a.email).toBe("web2@example.com");
    expect(a.providers).toEqual(["email"]);
    expect((await s.call(`${WEB}/account`)).status).toBe(401);
    const forged = await s.call(`${WEB}/account`, { headers: { Cookie: "__Host-olaccount=forgedforgedforgedforgedforged" } });
    expect(forged.status).toBe(401);
    expect(forged.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });

  it("refuses a wrong code", async () => {
    const s = server();
    await s.call(`${WEB}/auth/email/start`, post({ email: "web3@example.com" }, { Origin: WEB, "CF-Connecting-IP": ip() }));
    const wrong = s.codes.get("web3@example.com") === "000000" ? "111111" : "000000";
    const res = await s.call(`${WEB}/auth/email/verify`, post({ email: "web3@example.com", code: wrong }, { Origin: WEB }));
    expect(res.status).toBe(401);
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("never creates an account: an unknown email gets no_account and no cookie", async () => {
    const s = server();
    const email = "nobody-web@example.com";
    await s.call(`${WEB}/auth/email/start`, post({ email }, { Origin: WEB, "CF-Connecting-IP": ip() }));
    const res = await s.call(`${WEB}/auth/email/verify`, post({ email, code: s.codes.get(email) }, { Origin: WEB }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no_account" });
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect((await env.LOG_DB!.prepare("SELECT COUNT(*) AS n FROM accounts WHERE email = ?").bind(email).first<{ n: number }>())!.n).toBe(0);
    expect((await env.LOG_DB!.prepare("SELECT COUNT(*) AS n FROM identities WHERE subject = ?").bind(email).first<{ n: number }>())!.n).toBe(0);
  });

  it("sends the cookie again on each use, so it lasts 30 days from last use", async () => {
    const s = server();
    const { cookie } = await webSignIn(s, "rolling@example.com");
    const res = await s.call(`${WEB}/account`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const set = res.headers.get("Set-Cookie")!;
    expect(set.split(";")[0]).toBe(cookie);
    for (const flag of ["Path=/", "Secure", "HttpOnly", "SameSite=Strict", "Max-Age=2592000"]) expect(set).toContain(flag);
    const renamed = await s.call(`${WEB}/account`, post({ name: "Ro" }, { Origin: WEB, Cookie: cookie }, "PATCH"));
    expect(renamed.headers.get("Set-Cookie")).toContain("Max-Age=2592000");
    // The apps get no cookie.
    const app = await appSignIn(s, "rolling-app@example.com");
    const appRes = await s.call(`${API}/account`, { headers: { Authorization: `Bearer ${app.body.token}` } });
    expect(appRes.headers.get("Set-Cookie")).toBeNull();
  });

  it("renames", async () => {
    const s = server();
    const { cookie } = await webSignIn(s, "web4@example.com");
    const res = await s.call(`${WEB}/account`, post({ name: "  Ada   Ocean " }, { Origin: WEB, Cookie: cookie }, "PATCH"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { name: string }).name).toBe("Ada Ocean");
    const again = (await (await s.call(`${WEB}/account`, { headers: { Cookie: cookie } })).json()) as { name: string };
    expect(again.name).toBe("Ada Ocean");
  });

  it("signs out: the session is gone and the cookie cleared", async () => {
    const s = server();
    const { cookie } = await webSignIn(s, "web5@example.com");
    const res = await s.call(`${WEB}/auth/signout`, post({}, { Origin: WEB, Cookie: cookie }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toMatch(/^__Host-olaccount=; .*Max-Age=0/);
    expect((await s.call(`${WEB}/account`, { headers: { Cookie: cookie } })).status).toBe(401);
  });

  it("deletes the account, its sessions on every device and its questions", async () => {
    const s = server();
    const email = "web6@example.com";
    const app = await appSignIn(s, email);
    const { cookie, body } = await webSignIn(s, email);
    expect(body.account.id).toBe(app.body.account.id);
    await env.LOG_DB!.prepare("INSERT INTO questions (ts, device, question, history, cost_micros, model, account_id) VALUES (?, 'd', 'q', '[]', 0, 'm', ?)")
      .bind(new Date().toISOString(), body.account.id).run();

    const res = await s.call(`${WEB}/account`, { method: "DELETE", headers: { Origin: WEB, Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0");
    const db = env.LOG_DB!;
    for (const table of ["accounts WHERE id", "sessions WHERE account_id", "identities WHERE account_id", "questions WHERE account_id"]) {
      const n = await db.prepare(`SELECT COUNT(*) AS n FROM ${table} = ?`).bind(body.account.id).first<{ n: number }>();
      expect(n!.n, table).toBe(0);
    }
    // The phone's bearer session went with it.
    expect((await s.call(`${API}/account`, { headers: { Authorization: `Bearer ${app.body.token}` } })).status).toBe(401);
  });

  it("does not offer Apple and only accepts the web Google client", async () => {
    const s = server({ GOOGLE_WEB_CLIENT_ID: "web-id", GOOGLE_IOS_CLIENT_ID: "ios-id" });
    const config = (await (await s.call(`${WEB}/auth/config`)).json()) as Record<string, unknown>;
    expect(config).toEqual({ apple: false, google: true, email: true, googleWebClientId: "web-id" });
    const apple = await s.call(`${WEB}/auth/apple`, post({ identityToken: "x" }, { Origin: WEB }));
    expect(apple.status).toBe(503);
  });
});

describe("Origin check on the account host", () => {
  it("refuses changes without the page's Origin, even with a valid cookie", async () => {
    const s = server();
    const { cookie } = await webSignIn(s, "origin@example.com");
    const cases: [string, RequestInit][] = [
      ["/account", post({ name: "Evil" }, { Cookie: cookie }, "PATCH")],
      ["/account", post({ name: "Evil" }, { Cookie: cookie, Origin: "https://evil.example" }, "PATCH")],
      ["/account", post({ name: "Evil" }, { Cookie: cookie, Origin: API }, "PATCH")],
      ["/account", { method: "DELETE", headers: { Cookie: cookie, Origin: "null" } }],
      ["/auth/signout", post({}, { Cookie: cookie, Origin: "https://evil.example" })],
      ["/auth/email/start", post({ email: "x@example.com" }, { Origin: "https://evil.example" })],
      ["/auth/email/verify", post({ email: "x@example.com", code: "123456" })],
    ];
    for (const [path, init] of cases) {
      const res = await s.call(`${WEB}${path}`, init);
      expect(res.status, `${init.method} ${path}`).toBe(403);
    }
    const a = (await (await s.call(`${WEB}/account`, { headers: { Cookie: cookie } })).json()) as { name: string | null };
    expect(a.name).toBeNull();
  });

  it("ignores a bearer token on the account host", async () => {
    const s = server();
    const { body } = await appSignIn(s, "bearer-web@example.com");
    expect((await s.call(`${WEB}/account`, { headers: { Authorization: `Bearer ${body.token}` } })).status).toBe(401);
  });
});

describe("app bearer flow", () => {
  it("is unchanged on api.oceanlive.org and workers.dev", async () => {
    for (const host of [API, DEV]) {
      const s = server();
      const email = `app-${host.length}@example.com`;
      const { res, body } = await appSignIn(s, email, host);
      expect(res.headers.get("Set-Cookie")).toBeNull();
      expect(body.token).toMatch(/^[\w-]{40,}$/);
      const auth = { Authorization: `Bearer ${body.token}` };
      const me = await s.call(`${host}/account`, { headers: auth });
      expect(me.status).toBe(200);
      // No Origin needed for the apps.
      const renamed = await s.call(`${host}/account`, post({ name: "Phone" }, { ...auth, "X-HTTP-Method-Override": "PATCH" }));
      expect(((await renamed.json()) as { name: string }).name).toBe("Phone");
      expect((await s.call(`${host}/auth/signout`, post({}, auth))).status).toBe(200);
      expect((await s.call(`${host}/account`, { headers: auth })).status).toBe(401);
    }
  });

  it("ignores the web cookie on the API host", async () => {
    const s = server();
    const { cookie } = await webSignIn(s, "cookie-api@example.com");
    expect((await s.call(`${API}/account`, { headers: { Cookie: cookie } })).status).toBe(401);
  });

  it("app sessions still last a year and link the install's questions", async () => {
    const s = server();
    await env.LOG_DB!.prepare("INSERT INTO questions (ts, device, question, history, cost_micros, model) VALUES (?, 'test-device-0001', 'q', '[]', 0, 'm')")
      .bind(new Date().toISOString()).run();
    const { body } = await appSignIn(s, "year@example.com");
    const row = await env.LOG_DB!.prepare("SELECT created, expires FROM sessions WHERE account_id = ?").bind(body.account.id).first<{ created: string; expires: string }>();
    expect(Math.round((Date.parse(row!.expires) - Date.parse(row!.created)) / 86_400_000)).toBe(365);
    const n = await env.LOG_DB!.prepare("SELECT COUNT(*) AS n FROM questions WHERE account_id = ?").bind(body.account.id).first<{ n: number }>();
    expect(n!.n).toBeGreaterThan(0);
  });

  it("/ask still needs POST", async () => {
    expect((await server().call(`${API}/ask`)).status).toBe(405);
  });
});
