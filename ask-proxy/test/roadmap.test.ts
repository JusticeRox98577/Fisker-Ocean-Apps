import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";
import { VOTE_DAILY_LIMIT } from "../src/roadmap";

const API = "https://api.oceanlive.org";
const DEV = "https://ocean-live-ask.example.workers.dev";
const ADMIN = "https://admin.oceanlive.org";
const WEB = "https://account.oceanlive.org";
const CLIENT_ID = "test-web-client.apps.googleusercontent.com";
const OWNER = "owner-roadmap@example.com";
const REVIEW = "review-roadmap@example.com";
const db = () => env.LOG_DB!;

let n = 0;
const uniq = () => `${Date.now().toString(36)}${++n}`;
const ip = () => `192.0.2.${(++n % 250) + 1}`;

async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── A fake Google for admin sign-in ──

let keys: CryptoKeyPair;
let jwk: JsonWebKey;
beforeAll(async () => {
  keys = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  jwk = { ...((await crypto.subtle.exportKey("jwk", keys.publicKey)) as JsonWebKey), kid: "k", alg: "RS256", use: "sig" } as JsonWebKey;
});
const b64url = (bytes: Uint8Array | string) => {
  const b = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
async function idToken(email: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", kid: "k", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: "https://accounts.google.com", aud: CLIENT_ID, sub: `g-${email}`, email, email_verified: true, iat: now, exp: now + 3600 }));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(`${header}.${body}`));
  return `${header}.${body}.${b64url(new Uint8Array(sig))}`;
}

function server(vars: Partial<Env> = {}) {
  const e: Env = {
    ...env,
    GOOGLE_WEB_CLIENT_ID: CLIENT_ID,
    JWKS_FETCH: (async () => Response.json({ keys: [jwk] })) as unknown as typeof fetch,
    ADMIN_EMAILS: OWNER,
    REVIEW_EMAIL: REVIEW,
    ...vars,
  };
  return async (url: string, init: RequestInit = {}) => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request(url, init), e, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  };
}
type Call = ReturnType<typeof server>;

const post = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});

/** An app account with a web (account page) session. */
async function account(email = `${uniq()}@example.com`) {
  const id = crypto.randomUUID();
  const token = `web_${crypto.randomUUID().replace(/-/g, "")}`;
  const now = new Date().toISOString();
  await db().batch([
    db().prepare("INSERT INTO accounts (id, email, name, created, last_seen) VALUES (?, ?, NULL, ?, ?)").bind(id, email, now, now),
    db().prepare("INSERT INTO sessions (token_hash, account_id, created, last_used, expires) VALUES (?, ?, ?, ?, ?)")
      .bind(await sha256Hex(token), id, now, now, new Date(Date.now() + 86_400_000).toISOString()),
  ]);
  return { id, email, cookie: `__Host-olaccount=${token}` };
}

const vote = (call: Call, cookie: string, itemId: unknown, how: "vote" | "unvote" = "vote", origin: string | null = WEB) =>
  call(`${WEB}/roadmap/${how}`, post({ itemId }, { Cookie: cookie, ...(origin ? { Origin: origin } : {}) }));

async function adminCookie(call: Call, email = OWNER) {
  const res = await call(`${ADMIN}/auth/google`, post({ idToken: await idToken(email) }, { Origin: ADMIN, "CF-Connecting-IP": ip() }));
  expect(res.status).toBe(200);
  return res.headers.get("Set-Cookie")!.split(";")[0];
}
const adminGet = (call: Call, path: string, cookie: string) => call(`${ADMIN}${path}`, { headers: { Cookie: cookie } });
const adminPost = (call: Call, path: string, cookie: string, body: unknown) => call(`${ADMIN}${path}`, post(body, { Origin: ADMIN, Cookie: cookie }));

type AdminItem = { id: number; title: string; description: string; status: string; position: number; votes: number; createdBy: string; feedbackId: number | null };

async function newItem(call: Call, cookie: string, fields: Record<string, unknown> = {}) {
  const res = await adminPost(call, "/admin/roadmap/save", cookie, { title: `Item ${uniq()}`, description: "Something planned.", status: "planned", ...fields });
  expect(res.status).toBe(200);
  return ((await res.json()) as { item: AdminItem }).item;
}

type PublicItem = { id: number; title: string; description: string; status: string; votes: number; updated: string };
async function publicList(call: Call, host = API) {
  const res = await call(`${host}/roadmap`);
  expect(res.status).toBe(200);
  return { res, items: ((await res.json()) as { items: PublicItem[] }).items };
}

describe("public roadmap (GET /roadmap)", () => {
  it("answers without auth on the api host and workers.dev, with counts and no voter or admin details", async () => {
    const call = server();
    const cookie = await adminCookie(call);
    const item = await newItem(call, cookie, { title: "Live Activity on iPhone", description: "Charging on the Lock Screen.", status: "in_progress" });
    const a = await account();
    const b = await account();
    expect((await vote(call, a.cookie, item.id)).status).toBe(200);
    expect((await vote(call, b.cookie, item.id)).status).toBe(200);

    for (const host of [API, DEV]) {
      for (const path of ["/roadmap", "/api/roadmap"]) {
        const res = await call(`${host}${path}`);
        expect(res.status, `${host}${path}`).toBe(200);
        expect(res.headers.get("Cache-Control")).toContain("public");
        expect(res.headers.get("Cache-Control")).toContain("max-age=60");
        expect(res.headers.get("ETag")).toMatch(/^"[0-9a-f]{32}"$/);
        expect(res.headers.get("Set-Cookie")).toBeNull();
        const raw = await res.text();
        const found = (JSON.parse(raw) as { items: PublicItem[] }).items.find((i) => i.id === item.id)!;
        expect(Object.keys(found).sort()).toEqual(["description", "id", "status", "title", "updated", "votes"]);
        expect(found).toMatchObject({ title: "Live Activity on iPhone", description: "Charging on the Lock Screen.", status: "in_progress", votes: 2 });
        // Nobody's identity: no account IDs, emails or the admin who wrote it.
        expect(raw).not.toContain(a.id);
        expect(raw).not.toContain(a.email);
        expect(raw).not.toContain(OWNER);
      }
    }
  });

  it("is cache-friendly: the same list gives the same ETag and If-None-Match gets 304", async () => {
    const call = server();
    const first = await call(`${API}/roadmap`);
    const etag = first.headers.get("ETag")!;
    const again = await call(`${API}/roadmap`, { headers: { "If-None-Match": etag } });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    const head = await call(`${API}/roadmap`, { method: "HEAD" });
    expect(head.status).toBe(200);
    // A change gives a new ETag.
    await newItem(call, await adminCookie(call));
    const changed = await call(`${API}/roadmap`, { headers: { "If-None-Match": etag } });
    expect(changed.status).toBe(200);
    expect(changed.headers.get("ETag")).not.toBe(etag);
  });

  it("is read-only and lives only on the api hosts", async () => {
    const call = server();
    const res = await call(`${API}/roadmap`, post({ itemId: 1 }));
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET, HEAD");
    // No votes through the api host.
    expect((await call(`${API}/roadmap/vote`, post({ itemId: 1 }))).status).toBe(404);
    // The admin host has no public roadmap; the account host's /roadmap is the page.
    expect((await call(`${ADMIN}/roadmap`)).status).toBe(404);
    const page = await call(`${WEB}/roadmap`);
    expect(page.status).toBe(200);
    expect(page.headers.get("Content-Type")).toContain("text/html");
    expect(await page.text()).toContain('id="roadmap"');
  });
});

describe("voting on account.oceanlive.org", () => {
  it("lets a signed-in account vote once per item and take it back", async () => {
    const call = server();
    const item = await newItem(call, await adminCookie(call));
    const a = await account();

    const before = (await (await call(`${WEB}/roadmap/items`, { headers: { Cookie: a.cookie } })).json()) as { signedIn: boolean; canVote: boolean; items: (PublicItem & { voted: boolean })[] };
    expect(before.signedIn).toBe(true);
    expect(before.canVote).toBe(true);
    expect(before.items.find((i) => i.id === item.id)).toMatchObject({ votes: 0, voted: false });

    expect(await (await vote(call, a.cookie, item.id)).json()).toEqual({ ok: true, itemId: item.id, voted: true, votes: 1 });
    // A second vote doesn't count twice.
    expect(await (await vote(call, a.cookie, item.id)).json()).toEqual({ ok: true, itemId: item.id, voted: true, votes: 1 });
    const mine = (await (await call(`${WEB}/roadmap/items`, { headers: { Cookie: a.cookie } })).json()) as { items: { id: number; voted: boolean }[] };
    expect(mine.items.find((i) => i.id === item.id)!.voted).toBe(true);

    expect(await (await vote(call, a.cookie, String(item.id), "unvote")).json()).toEqual({ ok: true, itemId: item.id, voted: false, votes: 0 });
    expect((await publicList(call)).items.find((i) => i.id === item.id)!.votes).toBe(0);
  });

  it("shows the list signed out but needs a session to vote", async () => {
    const call = server();
    const item = await newItem(call, await adminCookie(call));
    const anon = (await (await call(`${WEB}/roadmap/items`)).json()) as { signedIn: boolean; canVote: boolean; items: { id: number; voted: boolean }[] };
    expect(anon.signedIn).toBe(false);
    expect(anon.canVote).toBe(false);
    expect(anon.items.find((i) => i.id === item.id)!.voted).toBe(false);
    expect((await call(`${WEB}/roadmap/vote`, post({ itemId: item.id }, { Origin: WEB }))).status).toBe(401);
    expect((await vote(call, "__Host-olaccount=not-a-real-session-token-xyz", item.id)).status).toBe(401);
    // The app's bearer token doesn't vote on the account host either.
    expect((await call(`${WEB}/roadmap/vote`, post({ itemId: item.id }, { Origin: WEB, Authorization: "Bearer abcdefghijklmnopqrstuvwxyz" }))).status).toBe(401);
  });

  it("checks the Origin of every vote", async () => {
    const call = server();
    const item = await newItem(call, await adminCookie(call));
    const a = await account();
    for (const origin of [null, API, ADMIN, "https://evil.example"]) {
      expect((await vote(call, a.cookie, item.id, "vote", origin)).status, String(origin)).toBe(403);
    }
    const n = await db().prepare("SELECT COUNT(*) AS n FROM roadmap_votes WHERE item_id = ?").bind(item.id).first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it("refuses done items, unknown items, bad input and the store review account", async () => {
    const call = server();
    const cookie = await adminCookie(call);
    const done = await newItem(call, cookie, { status: "done" });
    const a = await account();
    expect((await vote(call, a.cookie, done.id)).status).toBe(409);
    expect((await vote(call, a.cookie, 99_999_999)).status).toBe(404);
    expect((await vote(call, a.cookie, "abc")).status).toBe(400);
    expect((await vote(call, a.cookie, -1)).status).toBe(400);

    const planned = await newItem(call, cookie);
    const review = await account(REVIEW);
    const res = await vote(call, review.cookie, planned.id);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "review_account" });
    const list = (await (await call(`${WEB}/roadmap/items`, { headers: { Cookie: review.cookie } })).json()) as { signedIn: boolean; canVote: boolean };
    expect(list).toMatchObject({ signedIn: true, canVote: false });
  });

  it("limits vote changes per account per day", async () => {
    const call = server();
    const item = await newItem(call, await adminCookie(call));
    const a = await account();
    await env.ASK_KV.put(`rvote:${a.id}:${new Date().toISOString().slice(0, 10)}`, String(VOTE_DAILY_LIMIT - 1));
    expect((await vote(call, a.cookie, item.id)).status).toBe(200);
    expect((await vote(call, a.cookie, item.id, "unvote")).status).toBe(429);
  });

  it("deletes the account's votes with the account and unlinks promoted feedback", async () => {
    const call = server();
    const cookie = await adminCookie(call);
    const item = await newItem(call, cookie);
    const a = await account();
    expect((await vote(call, a.cookie, item.id)).status).toBe(200);
    const fb = await db()
      .prepare("INSERT INTO feedback (summary, details, account_id, created, status) VALUES ('Dark mode please', NULL, ?, ?, 'open')")
      .bind(a.id, new Date().toISOString())
      .run();
    const fbId = fb.meta.last_row_id as number;
    const promoted = await adminPost(call, "/admin/roadmap/promote", cookie, { feedbackId: fbId, title: "A darker theme", description: "", status: "planned" });
    const promotedId = ((await promoted.json()) as { item: AdminItem }).item.id;

    const del = await call(`${WEB}/account`, { method: "DELETE", headers: { Cookie: a.cookie, Origin: WEB } });
    expect(del.status).toBe(200);
    const votes = await db().prepare("SELECT COUNT(*) AS n FROM roadmap_votes WHERE account_id = ?").bind(a.id).first<{ n: number }>();
    expect(votes!.n).toBe(0);
    expect((await publicList(call)).items.find((i) => i.id === item.id)!.votes).toBe(0);
    // The roadmap item stays (it's the admin's words), without the link to the deleted feedback.
    const row = await db().prepare("SELECT title, feedback_id FROM roadmap_items WHERE id = ?").bind(promotedId).first<{ title: string; feedback_id: number | null }>();
    expect(row).toEqual({ title: "A darker theme", feedback_id: null });
  });
});

describe("admin Roadmap tab", () => {
  it("is admin-only and only on the admin host", async () => {
    const call = server();
    for (const path of ["/admin/roadmap", "/admin/roadmap/save"]) {
      expect((await call(`${ADMIN}${path}`)).status).toBe(404);
      for (const host of [API, WEB, DEV]) expect((await call(`${host}${path}`)).status, `${host}${path}`).toBe(404);
    }
    // An app account's web session is not an admin session.
    const a = await account();
    expect((await call(`${ADMIN}/admin/roadmap`, { headers: { Cookie: a.cookie } })).status).toBe(404);
    expect((await call(`${ADMIN}/admin/roadmap/save`, post({ title: "Sneaky", status: "planned" }, { Origin: ADMIN, Cookie: a.cookie }))).status).toBe(404);
  });

  it("creates, edits, orders and deletes items, and logs each change", async () => {
    const helper = `helper-${uniq()}@example.com`;
    await db().prepare("INSERT INTO admins (email, added_by, created) VALUES (?, ?, ?)").bind(helper, OWNER, new Date().toISOString()).run();
    const call = server();
    // Added admins can manage the roadmap too.
    const cookie = await adminCookie(call, helper);

    const one = await newItem(call, cookie, { title: "  Tyre   pressure\ncard ", description: "Line one\r\n\r\n\r\nLine two", status: "planned" });
    expect(one.title).toBe("Tyre pressure card");
    expect(one.description).toBe("Line one\n\nLine two");
    expect(one.createdBy).toBe(helper);
    const two = await newItem(call, cookie);
    expect(two.position).toBeGreaterThan(one.position);

    for (const [body, error] of [
      [{ title: "ab", status: "planned" }, "bad_title"],
      [{ title: "x".repeat(121), status: "planned" }, "bad_title"],
      [{ title: "Fine title", description: "y".repeat(601), status: "planned" }, "bad_description"],
      [{ title: "Fine title", description: 5, status: "planned" }, "bad_description"],
      [{ title: "Fine title", status: "someday" }, "bad_status"],
    ] as const) {
      const res = await adminPost(call, "/admin/roadmap/save", cookie, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error });
    }

    const edited = await adminPost(call, "/admin/roadmap/save", cookie, { id: one.id, title: "Tyre pressure card", description: "<b>not html</b>", status: "in_progress" });
    expect(edited.status).toBe(200);
    expect(((await edited.json()) as { item: AdminItem }).item).toMatchObject({ status: "in_progress", description: "<b>not html</b>" });
    expect((await adminPost(call, "/admin/roadmap/save", cookie, { id: 99_999_999, title: "Nope nope", status: "planned" })).status).toBe(404);

    const all = ((await (await adminGet(call, "/admin/roadmap", cookie)).json()) as { items: AdminItem[] }).items;
    const ids = all.map((i) => i.id);
    const reordered = [two.id, one.id, ...ids.filter((i) => i !== one.id && i !== two.id)];
    const ord = await adminPost(call, "/admin/roadmap/order", cookie, { ids: reordered });
    expect(ord.status).toBe(200);
    expect(((await ord.json()) as { items: AdminItem[] }).items.slice(0, 2).map((i) => i.id)).toEqual([two.id, one.id]);
    expect((await publicList(call)).items.slice(0, 2).map((i) => i.id)).toEqual([two.id, one.id]);
    expect((await adminPost(call, "/admin/roadmap/order", cookie, { ids: [one.id, one.id] })).status).toBe(400);
    expect((await adminPost(call, "/admin/roadmap/order", cookie, { ids: [] })).status).toBe(400);

    const a = await account();
    expect((await vote(call, a.cookie, two.id)).status).toBe(200);
    expect((await adminPost(call, "/admin/roadmap/delete", cookie, { id: two.id })).status).toBe(200);
    expect((await publicList(call)).items.find((i) => i.id === two.id)).toBeUndefined();
    const left = await db().prepare("SELECT COUNT(*) AS n FROM roadmap_votes WHERE item_id = ?").bind(two.id).first<{ n: number }>();
    expect(left!.n).toBe(0);
    expect((await adminPost(call, "/admin/roadmap/delete", cookie, { id: two.id })).status).toBe(404);

    const log = await db().prepare("SELECT action FROM admin_log WHERE email = ? ORDER BY id").bind(helper).all<{ action: string }>();
    expect(log.results.map((r) => r.action)).toEqual(["signin", "roadmap_create", "roadmap_create", "roadmap_edit", "roadmap_order", "roadmap_delete"]);
  });

  it("promotes feedback to a roadmap item and marks the feedback done", async () => {
    const call = server();
    const cookie = await adminCookie(call);
    const fb = await db()
      .prepare("INSERT INTO feedback (summary, details, created, status) VALUES ('Please add a widget', 'Home screen', ?, 'open')")
      .bind(new Date().toISOString())
      .run();
    const fbId = fb.meta.last_row_id as number;
    expect((await adminPost(call, "/admin/roadmap/promote", cookie, { feedbackId: 99_999_999, title: "Widget", status: "planned" })).status).toBe(404);
    expect((await adminPost(call, "/admin/roadmap/promote", cookie, { feedbackId: fbId, title: "W", status: "planned" })).status).toBe(400);
    const res = await adminPost(call, "/admin/roadmap/promote", cookie, { feedbackId: fbId, title: "Home screen widget", description: "Battery at a glance.", status: "planned" });
    expect(res.status).toBe(200);
    const item = ((await res.json()) as { item: AdminItem }).item;
    expect(item).toMatchObject({ title: "Home screen widget", feedbackId: fbId, votes: 0, createdBy: OWNER });
    const f = await db().prepare("SELECT status, handled_by FROM feedback WHERE id = ?").bind(fbId).first<{ status: string; handled_by: string }>();
    expect(f).toEqual({ status: "done", handled_by: OWNER });
    // The public list shows the admin's words, never the feedback.
    const pub = (await publicList(call)).items.find((i) => i.id === item.id)!;
    expect(pub.description).toBe("Battery at a glance.");
    const action = await db().prepare("SELECT action FROM admin_log WHERE email = ? AND action = 'roadmap_promote'").bind(OWNER).first();
    expect(action).not.toBeNull();
  });

  it("counts roadmap changes against the admin's daily write limit", async () => {
    const owner = `limit-${uniq()}@example.com`;
    const limited = server({ ADMIN_WRITE_LIMIT: "1", ADMIN_EMAILS: owner });
    const cookie = await adminCookie(limited, owner);
    expect((await adminPost(limited, "/admin/roadmap/save", cookie, { title: "First item", status: "planned" })).status).toBe(200);
    expect((await adminPost(limited, "/admin/roadmap/save", cookie, { title: "Second item", status: "planned" })).status).toBe(429);
  });
});

describe("admin Home tab", () => {
  it("summarises status.oceanlive.org for admins only, fetched by the server", async () => {
    const statusFetch = vi.fn(async (req: Request) => {
      expect(new URL(req.url).toString()).toBe("https://status.oceanlive.org/api/status");
      return Response.json({
        generatedAt: Date.UTC(2026, 10, 15, 12, 0),
        checkedAt: Date.UTC(2026, 10, 15, 11, 58),
        stale: false,
        overall: "partial",
        notice: "",
        services: [
          { id: "site", name: "Website", about: "x", state: "up", latencyMs: 120.4, error: null, checkedAt: 1, uptime24h: 1, uptime90d: 1, last24h: [], last90d: [] },
          { id: "api", name: "App server", about: "x", state: "down", latencyMs: null, error: "timeout", checkedAt: 1, uptime24h: 0.5, uptime90d: 0.9, last24h: [], last90d: [] },
          { id: "x", name: "Odd", state: "<script>", latencyMs: "fast" },
        ],
      });
    });
    const call = server({ STATUS_FETCH: statusFetch as unknown as typeof fetch });
    expect((await call(`${ADMIN}/admin/status`)).status).toBe(404);
    expect(statusFetch).not.toHaveBeenCalled();
    const cookie = await adminCookie(call);
    const res = await adminGet(call, "/admin/status", cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      overall: "partial",
      stale: false,
      checkedAt: "2026-11-15T11:58:00.000Z",
      notice: "",
      services: [
        { name: "Website", state: "up", latencyMs: 120, uptime24h: 1 },
        { name: "App server", state: "down", latencyMs: null, uptime24h: 0.5 },
        { name: "Odd", state: "unknown", latencyMs: null, uptime24h: null },
      ],
    });
    for (const host of [API, WEB]) expect((await call(`${host}/admin/status`)).status).toBe(404);
  });

  it("says so when the status page can't be reached", async () => {
    for (const fetcher of [async () => new Response("no", { status: 500 }), async () => { throw new Error("down"); }, async () => new Response("not json")]) {
      const call = server({ STATUS_FETCH: fetcher as unknown as typeof fetch });
      const res = await adminGet(call, "/admin/status", await adminCookie(call));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: false, error: "status_unavailable" });
    }
  });

  it("serves the Home tab with every link and the Roadmap tab", async () => {
    const call = server();
    const html = await (await call(`${ADMIN}/`)).text();
    for (const id of ["tab-home", "panel-home", "tab-roadmap", "panel-roadmap", "live-services", "todo"]) expect(html).toContain(`id="${id}"`);
    for (const link of [
      "https://oceanlive.org/",
      "https://account.oceanlive.org/",
      "https://status.oceanlive.org/",
      "https://mail.oceanlive.org/",
      "https://api.oceanlive.org/health",
      "https://console.anthropic.com/",
      "https://resend.com/",
      "https://play.google.com/console",
      "https://appstoreconnect.apple.com/",
      "https://console.cloud.google.com/apis/credentials",
      "https://dash.cloudflare.com/",
      "/actions",
      'href="#usage"',
      'href="#roadmap"',
      'href="#accounts"',
    ]) {
      expect(html, link).toContain(link);
    }
    // Everything stays same-origin: no script or style from elsewhere but Google's sign-in.
    const js = await (await call(`${ADMIN}/admin.js`)).text();
    expect(js).toContain("/admin/status");
    expect(js).toContain("/admin/roadmap/promote");
    expect(js).not.toContain("innerHTML");
  });
});

describe("account page balance line", () => {
  it("says the balance is used automatically after the free daily questions, with the server's limit", async () => {
    const call = server({ DEVICE_DAILY_LIMIT: "12" });
    const html = await (await call(`${WEB}/`)).text();
    expect(html).toContain('Used automatically for extra "Any questions?" answers after your <span id="free-daily">10</span> free ones each day.');
    const config = (await (await call(`${WEB}/auth/config`)).json()) as { freeDailyQuestions: number };
    expect(config.freeDailyQuestions).toBe(12);
    const defaults = (await (await server({ DEVICE_DAILY_LIMIT: undefined })(`${WEB}/auth/config`)).json()) as { freeDailyQuestions: number };
    expect(defaults.freeDailyQuestions).toBe(10);
  });
});
