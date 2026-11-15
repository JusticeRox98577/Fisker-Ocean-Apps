import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";
import { APPLE_ROOT_CA_G3, base64, verifyAppTransaction } from "../src/apple";
import { centsFor } from "../src/balance";
import { claimClosed, playRewardOk } from "../src/rewards";
import { parseCert, signedBy } from "../src/x509";
import { makeChain, signJws } from "./certs";

const API = "https://api.oceanlive.org";
const WEB = "https://account.oceanlive.org";
const db = () => env.LOG_DB!;

let n = 0;
const uniq = () => `${Date.now().toString(36)}${++n}`;
const ip = () => `203.0.113.${(++n % 250) + 1}-${uniq()}`;

async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** An account with an app session. Returns its ID and bearer token. */
async function account(cents = 0) {
  const id = crypto.randomUUID();
  const token = `tok_${crypto.randomUUID().replace(/-/g, "")}`;
  const now = new Date().toISOString();
  await db().batch([
    db().prepare("INSERT INTO accounts (id, email, name, created, last_seen) VALUES (?, ?, NULL, ?, ?)").bind(id, `${id}@example.com`, now, now),
    db().prepare("INSERT INTO sessions (token_hash, account_id, created, last_used, expires) VALUES (?, ?, ?, ?, ?)")
      .bind(await sha256Hex(token), id, now, now, new Date(Date.now() + 86_400_000).toISOString()),
  ]);
  if (cents) await db().prepare("INSERT INTO balances (account_id, cents, updated) VALUES (?, ?, ?)").bind(id, cents, now).run();
  return { id, token, auth: { Authorization: `Bearer ${token}` } };
}

function server(vars: Partial<Env> = {}) {
  const e: Env = { ...env, ...vars };
  return async (url: string, init: RequestInit = {}) => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request(url, init), e, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  };
}

const post = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});

const balance = async (id: string) => (await db().prepare("SELECT cents FROM balances WHERE account_id = ?").bind(id).first<{ cents: number }>())?.cents ?? 0;
const count = async (sql: string, ...args: unknown[]) => (await db().prepare(`SELECT COUNT(*) AS n FROM ${sql}`).bind(...args).first<{ n: number }>())!.n;

describe("migration 0003", () => {
  it("creates the balance tables with their rules", async () => {
    const tables = await db().prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index')").all<{ name: string }>();
    const names = tables.results.map((r) => r.name);
    for (const t of ["balances", "ledger", "badges", "claimed_rewards", "ledger_one_reward"]) expect(names).toContain(t);
    const a = crypto.randomUUID();
    await expect(db().prepare("INSERT INTO balances (account_id, cents) VALUES (?, -1)").bind(a).run()).rejects.toThrow();
    await expect(db().prepare("INSERT INTO ledger (account_id, delta_cents, kind, ref, created) VALUES (?, 1, 'gift', NULL, 'x')").bind(a).run()).rejects.toThrow();
    await db().prepare("INSERT INTO ledger (account_id, delta_cents, kind, ref, created) VALUES (?, 500, 'reward', ?, 'x')").bind(a, `t:${a}:1`).run();
    // One reward per account.
    await expect(db().prepare("INSERT INTO ledger (account_id, delta_cents, kind, ref, created) VALUES (?, 500, 'reward', ?, 'x')").bind(a, `t:${a}:2`).run()).rejects.toThrow();
    // Other kinds are not limited.
    await db().prepare("INSERT INTO ledger (account_id, delta_cents, kind, ref, created) VALUES (?, -1, 'question', ?, 'x')").bind(a, `t:${a}:3`).run();
    await expect(db().prepare("INSERT INTO ledger (account_id, delta_cents, kind, ref, created) VALUES (?, -1, 'question', ?, 'x')").bind(a, `t:${a}:3`).run()).rejects.toThrow();
  });
});

// ── Google Play ────────────────────────────────────────────────

async function playFixture() {
  const keys = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const pkcs8 = new Uint8Array((await crypto.subtle.exportKey("pkcs8", keys.privateKey)) as ArrayBuffer);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...pkcs8)).replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----\n`;
  const email = `reward-${uniq()}@test-project.iam.gserviceaccount.com`;
  const sa = JSON.stringify({ type: "service_account", client_email: email, private_key: pem, private_key_id: "kid1" });

  const purchases = new Map<string, Record<string, unknown>>();
  const acks: string[] = [];
  const tokenCalls: string[] = [];
  let down = false;
  const google = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (down) return new Response("unavailable", { status: 503 });
    if (url === "https://oauth2.googleapis.com/token") {
      const form = new URLSearchParams(String(init?.body));
      expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
      const [h, c, s] = form.get("assertion")!.split(".");
      const dec = (x: string) => Uint8Array.from(atob(x.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((x.length + 3) % 4)), (ch) => ch.charCodeAt(0));
      const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", keys.publicKey, dec(s), new TextEncoder().encode(`${h}.${c}`));
      const header = JSON.parse(new TextDecoder().decode(dec(h)));
      const claims = JSON.parse(new TextDecoder().decode(dec(c)));
      if (!ok || header.alg !== "RS256" || claims.iss !== email || claims.aud !== "https://oauth2.googleapis.com/token" ||
        claims.scope !== "https://www.googleapis.com/auth/androidpublisher" || claims.exp - claims.iat > 3600) {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      tokenCalls.push(email);
      return Response.json({ access_token: "ya29.test", token_type: "Bearer", expires_in: 3599 });
    }
    const m = /^https:\/\/androidpublisher\.googleapis\.com\/androidpublisher\/v3\/applications\/com\.justicemw\.oceanlive\/purchases\/products\/([^/]+)\/tokens\/([^/:]+)(:acknowledge)?$/.exec(url);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer ya29.test");
    if (!m) return new Response("not found", { status: 404 });
    const token = decodeURIComponent(m[2]);
    const p = purchases.get(token);
    if (!p || p.productId !== decodeURIComponent(m[1])) return Response.json({ error: { code: 404 } }, { status: 404 });
    if (m[3]) {
      expect(init?.method).toBe("POST");
      acks.push(token);
      p.acknowledgementState = 1;
      return new Response("", { status: 200 });
    }
    return Response.json({ kind: "androidpublisher#productPurchase", ...p });
  });

  const buy = (extra: Record<string, unknown> = {}) => {
    const token = `tok.${uniq()}${"x".repeat(40)}`;
    purchases.set(token, { productId: "prereg_credit_5", purchaseState: 0, consumptionState: 0, acknowledgementState: 0, purchaseType: 1, purchaseTimeMillis: "1", ...extra });
    return token;
  };
  const vars = { GOOGLE_PLAY_SERVICE_ACCOUNT: sa, GOOGLE_FETCH: google as unknown as typeof fetch };
  return { vars, buy, acks, tokenCalls, google, setDown: (v: boolean) => (down = v) };
}

const claim = (token: string, productId = "prereg_credit_5") => ({ productId, purchaseToken: token });

describe("POST /rewards/play", () => {
  it("credits $5 and the badge once, acknowledges, and shows them on the account", async () => {
    const g = await playFixture();
    const call = server(g.vars);
    const a = await account();
    const token = g.buy();
    const res = await call(`${API}/rewards/play`, post(claim(token), a.auth));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, balanceCents: 500, badges: ["early_supporter"] });
    expect(g.acks).toEqual([token]);

    // Same token again: nothing changes, nothing asked of Google.
    const calls = g.google.mock.calls.length;
    const again = await call(`${API}/rewards/play`, post(claim(token), a.auth));
    expect(await again.json()).toEqual({ ok: true, balanceCents: 500, badges: ["early_supporter"], alreadyClaimed: true });
    expect(g.google.mock.calls.length).toBe(calls);
    expect(await balance(a.id)).toBe(500);
    const ref = `play:${await sha256Hex(token)}`;
    expect(await count("ledger WHERE ref = ? AND kind = 'reward' AND delta_cents = 500", ref)).toBe(1);

    // GET /account, in the app and on the web page.
    const me = (await (await call(`${API}/account`, { headers: a.auth })).json()) as { balanceCents: number; badges: string[] };
    expect(me.balanceCents).toBe(500);
    expect(me.badges).toEqual(["early_supporter"]);
    // The access token was minted once and kept.
    expect(g.tokenCalls.length).toBe(1);
  });

  it("refuses a token another account claimed", async () => {
    const g = await playFixture();
    const call = server(g.vars);
    const [a, b] = await Promise.all([account(), account()]);
    const token = g.buy();
    expect((await call(`${API}/rewards/play`, post(claim(token), a.auth))).status).toBe(200);
    const res = await call(`${API}/rewards/play`, post(claim(token), b.auth));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already_claimed_other_account" });
    expect(await balance(b.id)).toBe(0);
  });

  it("gives one reward per account, and a second store purchase is then used up", async () => {
    const g = await playFixture();
    const call = server(g.vars);
    const [a, b] = await Promise.all([account(), account()]);
    expect((await call(`${API}/rewards/play`, post(claim(g.buy()), a.auth))).status).toBe(200);
    const second = g.buy();
    const res = await call(`${API}/rewards/play`, post(claim(second), a.auth));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, balanceCents: 500, badges: ["early_supporter"], alreadyClaimed: true });
    expect(await balance(a.id)).toBe(500);
    // Recorded against account a, so b can't use it either.
    expect((await call(`${API}/rewards/play`, post(claim(second), b.auth))).status).toBe(409);
  });

  it("refuses purchases that aren't a valid reward", async () => {
    const g = await playFixture();
    const call = server(g.vars);
    const a = await account();
    const cases: [Record<string, unknown>, string][] = [
      [{ purchaseState: 1 }, "canceled"],
      [{ purchaseState: 2 }, "pending"],
      [{ purchaseType: 2 }, "rewarded ad"],
      [{ purchaseType: 0 }, "test purchase"],
    ];
    for (const [extra, label] of cases) {
      const res = await call(`${API}/rewards/play`, post(claim(g.buy(extra)), a.auth));
      expect(res.status, label).toBe(400);
      expect(await res.json(), label).toEqual({ error: "invalid_purchase" });
    }
    // Unknown token, wrong product.
    expect(await (await call(`${API}/rewards/play`, post(claim("tok.unknown-token-123456"), a.auth))).json()).toEqual({ error: "invalid_purchase" });
    expect(await (await call(`${API}/rewards/play`, post(claim(g.buy(), "tip_small"), a.auth))).json()).toEqual({ error: "invalid_purchase" });
    expect(await balance(a.id)).toBe(0);
    // Test purchases count only when allowed; a normal purchase (no purchaseType) is credited.
    const t = await server({ ...g.vars, PLAY_ALLOW_TEST: "true" })(`${API}/rewards/play`, post(claim(g.buy({ purchaseType: 0 })), a.auth));
    expect(t.status).toBe(200);
    const b = await account();
    expect((await call(`${API}/rewards/play`, post(claim(g.buy({ purchaseType: undefined })), b.auth))).status).toBe(200);
  });

  it("doesn't acknowledge again what's already acknowledged", async () => {
    const g = await playFixture();
    const a = await account();
    expect((await server(g.vars)(`${API}/rewards/play`, post(claim(g.buy({ acknowledgementState: 1 })), a.auth))).status).toBe(200);
    expect(g.acks).toEqual([]);
  });

  it("needs a session, the service account and an open claim window", async () => {
    const g = await playFixture();
    const a = await account();
    expect((await server(g.vars)(`${API}/rewards/play`, post(claim(g.buy())))).status).toBe(401);
    const nc = await server({ GOOGLE_PLAY_SERVICE_ACCOUNT: "" })(`${API}/rewards/play`, post(claim(g.buy()), a.auth));
    expect(nc.status).toBe(503);
    expect(await nc.json()).toEqual({ error: "not_configured" });
    const closed = await server({ ...g.vars, REWARD_CLAIM_UNTIL: "2020-01-31" })(`${API}/rewards/play`, post(claim(g.buy()), a.auth));
    expect(closed.status).toBe(410);
    expect(await closed.json()).toEqual({ error: "claim_closed" });
    expect((await server({ ...g.vars, REWARD_CLAIM_UNTIL: "2999-12-31" })(`${API}/rewards/play`, post(claim(g.buy()), a.auth))).status).toBe(200);
    // Once claimed, asking again still answers after the window closed.
    const token = g.buy();
    const b = await account();
    await server(g.vars)(`${API}/rewards/play`, post(claim(token), b.auth));
    const later = await server({ ...g.vars, REWARD_CLAIM_UNTIL: "2020-01-31" })(`${API}/rewards/play`, post(claim(token), b.auth));
    expect(((await later.json()) as { alreadyClaimed: boolean }).alreadyClaimed).toBe(true);
  });

  it("credits nothing when Google can't be reached", async () => {
    const g = await playFixture();
    g.setDown(true);
    const a = await account();
    const res = await server(g.vars)(`${API}/rewards/play`, post(claim(g.buy()), a.auth));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "store_unavailable" });
    expect(await balance(a.id)).toBe(0);
  });

  it("isn't served on the account page host", async () => {
    const g = await playFixture();
    const res = await server(g.vars)(`${WEB}/rewards/play`, post(claim(g.buy()), { Origin: WEB }));
    expect(res.status).toBe(405);
  });
});

describe("reward rules", () => {
  it("playRewardOk", () => {
    expect(playRewardOk({ purchaseState: 0, purchaseType: 1 }, "p", false)).toBe(true);
    expect(playRewardOk({ purchaseState: 0 }, "p", false)).toBe(true);
    expect(playRewardOk({ purchaseState: 0, purchaseType: 0 }, "p", false)).toBe(false);
    expect(playRewardOk({ purchaseState: 0, purchaseType: 0 }, "p", true)).toBe(true);
    expect(playRewardOk({ purchaseState: 0, purchaseType: 2 }, "p", true)).toBe(false);
    expect(playRewardOk({ purchaseState: 0, productId: "q" }, "p", false)).toBe(false);
    expect(playRewardOk({}, "p", false)).toBe(false);
  });

  it("claimClosed: a date counts to the end of that day UTC", () => {
    const t = Date.parse("2027-03-01T12:00:00Z");
    expect(claimClosed("", t)).toBe(false);
    expect(claimClosed(undefined, t)).toBe(false);
    expect(claimClosed("2027-03-01", t)).toBe(false);
    expect(claimClosed("2027-02-28", t)).toBe(true);
    expect(claimClosed("2027-03-01T11:00:00Z", t)).toBe(true);
    expect(claimClosed("nonsense", t)).toBe(false);
  });

  it("centsFor rounds up to the next cent, at least 1", () => {
    expect(centsFor(0)).toBe(1);
    expect(centsFor(1)).toBe(1);
    expect(centsFor(10_000)).toBe(1);
    expect(centsFor(10_001)).toBe(2);
    expect(centsFor(24_000)).toBe(3);
  });
});

// ── App Store ──────────────────────────────────────────────────

const preorder = (extra: Record<string, unknown> = {}) => ({
  receiptType: "Production",
  bundleId: "com.justice.OceanABRP",
  appAppleId: 1234567890,
  applicationVersion: "42",
  originalApplicationVersion: "42",
  originalPurchaseDate: Date.now() - 3_600_000,
  receiptCreationDate: Date.now() - 60_000,
  preorderDate: Date.now() - 30 * 86_400_000,
  appTransactionId: `7040${uniq()}`,
  originalPlatform: "iOS",
  ...extra,
});

describe("Apple Root CA - G3", () => {
  it("is the certificate Apple publishes (SHA-256 fingerprint)", async () => {
    const der = base64(APPLE_ROOT_CA_G3);
    const fp = [...new Uint8Array(await crypto.subtle.digest("SHA-256", der))].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(fp).toBe("63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179");
    const root = parseCert(der);
    expect(root.isCA).toBe(true);
    expect(new Date(root.notAfter).toISOString()).toBe("2039-04-30T18:19:06.000Z");
    expect(await signedBy(root, root)).toBe(true);
  });

  it("verifies Apple's real WWDR G6 intermediate (P-384, SHA-384)", async () => {
    // https://www.apple.com/certificateauthority/AppleWWDRCAG6.cer
    const g6 = parseCert(base64(
      "MIIDFjCCApygAwIBAgIUIsGhRwp0c2nvU4YSycafPTjzbNcwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwSQXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcNMjEwMzE3MjAzNzEwWhcNMzYwMzE5MDAwMDAwWjB1MUQwQgYDVQQDDDtBcHBsZSBXb3JsZHdpZGUgRGV2ZWxvcGVyIFJlbGF0aW9ucyBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTELMAkGA1UECwwCRzYxEzARBgNVBAoMCkFwcGxlIEluYy4xCzAJBgNVBAYTAlVTMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAEbsQKC94PrlWmZXnXgtxzdVJL8T0SGYngDRGpngn3N6PT8JMEb7FDi4bBmPhCnZ3/sq6PF/cGcKXWsL5vOteRhyJ45x3ASP7cOB+aao90fcpxSv/EZFbniAbNgZGhIhpIo4H6MIH3MBIGA1UdEwEB/wQIMAYBAf8CAQAwHwYDVR0jBBgwFoAUu7DeoVgziJqkipnevr3rr9rLJKswRgYIKwYBBQUHAQEEOjA4MDYGCCsGAQUFBzABhipodHRwOi8vb2NzcC5hcHBsZS5jb20vb2NzcDAzLWFwcGxlcm9vdGNhZzMwNwYDVR0fBDAwLjAsoCqgKIYmaHR0cDovL2NybC5hcHBsZS5jb20vYXBwbGVyb290Y2FnMy5jcmwwHQYDVR0OBBYEFD8vlCNR01DJmig97bB85c+lkGKZMA4GA1UdDwEB/wQEAwIBBjAQBgoqhkiG92NkBgIBBAIFADAKBggqhkjOPQQDAwNoADBlAjBAXhSq5IyKogMCPtw490BaB677CaEGJXufQB/EqZGd6CSjiCtOnuMTbXVXmxxcxfkCMQDTSPxarZXvNrkxU3TkUMI33yzvFVVRT4wxWJC994OsdcZ4+RGNsYDyR5gmdr0nDGg=",
    ));
    const root = parseCert(base64(APPLE_ROOT_CA_G3));
    expect(g6.isCA).toBe(true);
    expect(g6.extensions.has("1.2.840.113635.100.6.2.1")).toBe(true);
    expect(await signedBy(g6, root)).toBe(true);
    // Tampered: fails.
    const bad = { ...g6, tbs: g6.tbs.slice() };
    bad.tbs[bad.tbs.length - 5] ^= 1;
    expect(await signedBy(bad, root)).toBe(false);
  });
});

describe("AppTransaction JWS verification", () => {
  it("accepts a good chain and refuses tampering, other roots and missing Apple markers", async () => {
    const chain = await makeChain();
    const good = await signJws(preorder(), chain);
    expect(await verifyAppTransaction(good, chain.root)).not.toBeNull();
    // Production trusts only Apple's root.
    expect(await verifyAppTransaction(good)).toBeNull();
    // Another CA.
    expect(await verifyAppTransaction(good, (await makeChain()).root)).toBeNull();
    // Payload changed after signing.
    const [h, , s] = good.split(".");
    const forged = btoa(JSON.stringify(preorder({ bundleId: "x" }))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(await verifyAppTransaction(`${h}.${forged}.${s}`, chain.root)).toBeNull();
    // Signed with a key that isn't the leaf's.
    const other = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]) as CryptoKeyPair;
    expect(await verifyAppTransaction(await signJws(preorder(), chain, other.privateKey), chain.root)).toBeNull();
    // Missing Apple's extensions.
    const noLeafOid = await makeChain({ leafOid: false });
    expect(await verifyAppTransaction(await signJws(preorder(), noLeafOid), noLeafOid.root)).toBeNull();
    const noInterOid = await makeChain({ interOid: false });
    expect(await verifyAppTransaction(await signJws(preorder(), noInterOid), noInterOid.root)).toBeNull();
    // Leaf expired before the App Store signed it.
    const expired = await makeChain({ leafNotBefore: Date.now() - 10 * 86_400_000, leafNotAfter: Date.now() - 5 * 86_400_000 });
    expect(await verifyAppTransaction(await signJws(preorder(), expired), expired.root)).toBeNull();
    // ...but valid on its signing date is fine.
    expect(await verifyAppTransaction(await signJws(preorder({ receiptCreationDate: Date.now() - 7 * 86_400_000 }), expired), expired.root)).not.toBeNull();
    // Not a JWS at all.
    expect(await verifyAppTransaction("nope", chain.root)).toBeNull();
  });
});

describe("POST /rewards/apple", () => {
  it("credits a verified pre-order once and refuses bad ones", async () => {
    const chain = await makeChain();
    const call = server({ APPLE_TEST_ROOT: chain.root });
    const [a, b] = await Promise.all([account(), account()]);
    const p = preorder();
    const jws = await signJws(p, chain);
    const res = await call(`${API}/rewards/apple`, post({ appTransaction: jws }, a.auth));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, balanceCents: 500, badges: ["early_supporter"] });
    expect(await count("ledger WHERE ref = ?", `apple:${await sha256Hex(p.appTransactionId)}`)).toBe(1);
    expect(((await (await call(`${API}/rewards/apple`, post({ appTransaction: jws }, a.auth))).json()) as { alreadyClaimed: boolean }).alreadyClaimed).toBe(true);
    // Same Apple account (appTransactionId), another Ocean Live account.
    const again = await call(`${API}/rewards/apple`, post({ appTransaction: await signJws({ ...p, receiptCreationDate: Date.now() }, chain) }, b.auth));
    expect(again.status).toBe(409);

    const refused: [Record<string, unknown>, string][] = [
      [{ bundleId: "com.example.other" }, "wrong bundle"],
      [{ preorderDate: undefined }, "no pre-order"],
      [{ receiptType: "Sandbox" }, "sandbox"],
      [{ receiptType: "Xcode" }, "xcode"],
      [{ appTransactionId: undefined }, "no appTransactionId"],
    ];
    for (const [extra, label] of refused) {
      const r = await call(`${API}/rewards/apple`, post({ appTransaction: await signJws(preorder(extra), chain) }, b.auth));
      expect(r.status, label).toBe(400);
      expect(await r.json(), label).toEqual({ error: "invalid_purchase" });
    }
    // Bad signature.
    const [h, c] = jws.split(".");
    expect((await call(`${API}/rewards/apple`, post({ appTransaction: `${h}.${c}.${"A".repeat(86)}` }, b.auth))).status).toBe(400);
    expect(await balance(b.id)).toBe(0);
    // Production server (no test root) refuses the test chain.
    expect((await server()(`${API}/rewards/apple`, post({ appTransaction: await signJws(preorder(), chain) }, b.auth))).status).toBe(400);
  });

  it("accepts Sandbox only when allowed, and checks the app ID when set", async () => {
    const chain = await makeChain();
    const a = await account();
    const sandbox = await signJws(preorder({ receiptType: "Sandbox" }), chain);
    expect((await server({ APPLE_TEST_ROOT: chain.root, APPLE_ALLOW_SANDBOX: "true" })(`${API}/rewards/apple`, post({ appTransaction: sandbox }, a.auth))).status).toBe(200);
    const b = await account();
    const wrongApp = await signJws(preorder({ appAppleId: 1 }), chain);
    expect((await server({ APPLE_TEST_ROOT: chain.root, APPLE_APP_ID: "1234567890" })(`${API}/rewards/apple`, post({ appTransaction: wrongApp }, b.auth))).status).toBe(400);
    const rightApp = await signJws(preorder(), chain);
    expect((await server({ APPLE_TEST_ROOT: chain.root, APPLE_APP_ID: "1234567890" })(`${API}/rewards/apple`, post({ appTransaction: rightApp }, b.auth))).status).toBe(200);
  });

  it("counts toward the same one reward per account as Play", async () => {
    const g = await playFixture();
    const chain = await makeChain();
    const a = await account();
    expect((await server(g.vars)(`${API}/rewards/play`, post(claim(g.buy()), a.auth))).status).toBe(200);
    const res = await server({ APPLE_TEST_ROOT: chain.root })(`${API}/rewards/apple`, post({ appTransaction: await signJws(preorder(), chain) }, a.auth));
    expect(((await res.json()) as { alreadyClaimed: boolean; balanceCents: number })).toMatchObject({ alreadyClaimed: true, balanceCents: 500 });
  });
});

// ── Paid questions ─────────────────────────────────────────────

/** A fake Anthropic API: answers with the given usage (or fails). */
function claude(usage = { input_tokens: 1000, output_tokens: 1000 }, opts: { fail?: boolean; refuse?: boolean } = {}) {
  return vi.fn(async () => {
    if (opts.fail) return Response.json({ type: "error", error: { type: "invalid_request_error", message: "nope" } }, { status: 400 });
    return Response.json({
      id: `msg_${uniq()}`,
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content: opts.refuse ? [] : [{ type: "text", text: "Check the 12 V battery." }],
      stop_reason: opts.refuse ? "refusal" : "end_turn",
      stop_sequence: null,
      usage: { cache_creation_input_tokens: 0, cache_read_input_tokens: 0, ...usage },
    });
  }) as unknown as typeof fetch;
}

const question = (headers: Record<string, string> = {}) =>
  post({ device: `dev-${uniq()}`, messages: [{ role: "user", text: "Why is my car slow?" }] }, { "CF-Connecting-IP": ip(), ...headers });

// 1000 input + 1000 output tokens at $4 / $20 per million = $0.024 → 3 cents.
const BASE = { DEVICE_DAILY_LIMIT: "1", IP_DAILY_LIMIT: "1000", ANTHROPIC_API_KEY: "test" } as const;

describe("/ask paid from the balance", () => {
  it("is free first, then charges the answer's cost rounded up to the next cent", async () => {
    const a = await account(500);
    const call = server({ ...BASE, ANTHROPIC_FETCH: claude() });
    const free = await call(`${API}/ask`, question(a.auth));
    expect(free.status).toBe(200);
    const fb = (await free.json()) as Record<string, unknown>;
    expect(fb.paid).toBeUndefined();
    expect(fb.balanceCents).toBe(500);
    expect(fb.remainingToday).toBe(0);

    const res = await call(`${API}/ask`, question(a.auth));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ answer: "Check the 12 V battery.", remainingToday: 0, paid: true, chargedCents: 3, balanceCents: 497 });
    expect(await balance(a.id)).toBe(497);
    const row = await db().prepare("SELECT delta_cents, ref FROM ledger WHERE account_id = ? AND kind = 'question'").bind(a.id).first<{ delta_cents: number; ref: string }>();
    expect(row!.delta_cents).toBe(-3);
    const qid = Number(row!.ref.replace("question:", ""));
    expect(await count("questions WHERE id = ? AND account_id = ?", qid, a.id)).toBe(1);
  });

  it("never takes more than the balance, and stops at the minimum balance", async () => {
    const a = await account(3);
    // 2000 output + 1000 input = $0.044 → 5 cents, but only 3 are there.
    const call = server({ ...BASE, ANTHROPIC_FETCH: claude({ input_tokens: 1000, output_tokens: 2000 }) });
    await call(`${API}/ask`, question(a.auth));
    const res = (await (await call(`${API}/ask`, question(a.auth))).json()) as Record<string, unknown>;
    expect(res).toMatchObject({ paid: true, chargedCents: 3, balanceCents: 0 });
    expect(await balance(a.id)).toBe(0);
    const out = await call(`${API}/ask`, question(a.auth));
    expect(out.status).toBe(429);
    expect(await out.json()).toEqual({ error: "rate_limited", reason: "free_used", balanceCents: 0 });

    const low = await account(2);
    await call(`${API}/ask`, question(low.auth));
    const r = await call(`${API}/ask`, question(low.auth));
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: "rate_limited", reason: "low_balance", balanceCents: 2 });
    expect(await balance(low.id)).toBe(2);
  });

  it("charges nothing when the question fails or is declined", async () => {
    const a = await account(100);
    await server({ ...BASE, ANTHROPIC_FETCH: claude() })(`${API}/ask`, question(a.auth));
    const failed = await server({ ...BASE, ANTHROPIC_FETCH: claude(undefined, { fail: true }) })(`${API}/ask`, question(a.auth));
    expect(failed.status).toBe(502);
    const declined = await server({ ...BASE, ANTHROPIC_FETCH: claude(undefined, { refuse: true }) })(`${API}/ask`, question(a.auth));
    expect(declined.status).toBe(422);
    expect(await balance(a.id)).toBe(100);
    expect(await count("ledger WHERE account_id = ?", a.id)).toBe(0);
  });

  it("reserves credit first, so parallel paid questions can't share one balance", async () => {
    const a = await account(7);
    const call = server({ ...BASE, ANTHROPIC_FETCH: claude() });
    await call(`${API}/ask`, question(a.auth));
    const all = await Promise.all(Array.from({ length: 8 }, () => call(`${API}/ask`, question(a.auth))));
    const ok = all.filter((r) => r.status === 200);
    // 7 cents covers two 3-cent holds; every answered question is charged in full.
    expect(ok.length).toBe(2);
    for (const r of all.filter((r) => r.status !== 200)) expect(r.status).toBe(429);
    for (const r of ok) expect(((await r.json()) as Record<string, unknown>).chargedCents).toBe(3);
    expect(await balance(a.id)).toBe(1);
    expect(await count("ledger WHERE account_id = ? AND note IS NOT NULL", a.id)).toBe(0);
    expect(await count("ledger WHERE account_id = ? AND kind = 'question' AND delta_cents = -3", a.id)).toBe(2);
  });

  it("gives the hold back when the question fails, and failed questions don't count toward the paid limit", async () => {
    const a = await account(100);
    const vars = { ...BASE, PAID_DAILY_LIMIT: "1" };
    await server({ ...vars, ANTHROPIC_FETCH: claude() })(`${API}/ask`, question(a.auth));
    expect((await server({ ...vars, ANTHROPIC_FETCH: claude(undefined, { fail: true }) })(`${API}/ask`, question(a.auth))).status).toBe(502);
    expect(await balance(a.id)).toBe(100);
    expect(await count("ledger WHERE account_id = ?", a.id)).toBe(0);
    expect((await server({ ...vars, ANTHROPIC_FETCH: claude() })(`${API}/ask`, question(a.auth))).status).toBe(200);
    expect(await balance(a.id)).toBe(97);
  });

  it("has a daily paid limit per account", async () => {
    const a = await account(500);
    const call = server({ ...BASE, PAID_DAILY_LIMIT: "1", ANTHROPIC_FETCH: claude() });
    await call(`${API}/ask`, question(a.auth));
    expect((await call(`${API}/ask`, question(a.auth))).status).toBe(200);
    const res = await call(`${API}/ask`, question(a.auth));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited", reason: "paid_limit", balanceCents: 497 });
  });

  it("is still held to the per-network limit", async () => {
    const a = await account(500);
    const call = server({ ...BASE, IP_DAILY_LIMIT: "1", ANTHROPIC_FETCH: claude() });
    const net = { "CF-Connecting-IP": ip() };
    expect((await call(`${API}/ask`, question({ ...a.auth, ...net }))).status).toBe(200);
    const res = await call(`${API}/ask`, question({ ...a.auth, ...net }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited", reason: "network", balanceCents: 500 });
    expect(await balance(a.id)).toBe(500);
  });

  it("never uses a balance without an account", async () => {
    const call = server({ ...BASE, ANTHROPIC_FETCH: claude() });
    const device = `anon-${uniq()}`;
    const ask = () => call(`${API}/ask`, post({ device, messages: [{ role: "user", text: "Hi" }] }, { "CF-Connecting-IP": ip() }));
    expect((await ask()).status).toBe(200);
    const res = await ask();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited", reason: "free_used", balanceCents: 0 });
  });

  it("respects a hand-set limit of 0", async () => {
    const a = await account(500);
    await env.ASK_KV.put(`limit:${a.id}`, "0");
    const res = await server({ ...BASE, ANTHROPIC_FETCH: claude() })(`${API}/ask`, question(a.auth));
    expect(res.status).toBe(429);
    expect(await balance(a.id)).toBe(500);
  });
});

describe("account deletion", () => {
  it("removes the balance, ledger and badges, but the store purchase stays used", async () => {
    const g = await playFixture();
    const call = server(g.vars);
    const a = await account();
    const token = g.buy();
    await call(`${API}/rewards/play`, post(claim(token), a.auth));
    expect((await call(`${API}/account`, { method: "DELETE", headers: a.auth })).status).toBe(200);
    for (const t of ["balances", "ledger", "badges"]) expect(await count(`${t} WHERE account_id = ?`, a.id), t).toBe(0);
    expect(await count("claimed_rewards WHERE ref = ?", `play:${await sha256Hex(token)}`)).toBe(1);
    const b = await account();
    const res = await call(`${API}/rewards/play`, post(claim(token), b.auth));
    expect(res.status).toBe(409);
  });

  it("GET /account shows 0 and no badges for a new account", async () => {
    const a = await account();
    const me = (await (await server()(`${API}/account`, { headers: a.auth })).json()) as Record<string, unknown>;
    expect(me.balanceCents).toBe(0);
    expect(me.badges).toEqual([]);
  });
});

describe("account page", () => {
  it("has the balance spot and serves the badge image", async () => {
    const call = server();
    const page = await (await call(`${WEB}/`)).text();
    expect(page).toContain('id="acc-balance"');
    const img = await call(`${WEB}/icons/early-supporter-badge.svg`);
    expect(img.status).toBe(200);
    expect(img.headers.get("Content-Type")).toContain("svg");
    expect(await img.text()).not.toMatch(/<script|on\w+=/i);
  });
});
