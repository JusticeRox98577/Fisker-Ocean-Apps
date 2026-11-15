/**
 * Ocean Live accounts: sign in with Apple, Google or a 6-digit email code.
 *
 * The Worker checks the sign-in itself (Apple and Google identity tokens are verified against
 * their published keys; email codes are sent through Resend) and then issues its own random
 * session token. Only a SHA-256 hash of each token is stored. No passwords exist anywhere.
 *
 * The apps keep the token and send it as "Authorization: Bearer <token>". The web account page at
 * account.oceanlive.org never sees it: the Worker keeps it in a host-only, HttpOnly session cookie
 * (see WEB_COOKIE) and only accepts changes that come from that page's own origin.
 *
 * Tables: see migrations/0002_accounts.sql.
 */

import { badgesOf, balanceOf } from "./balance";
import { emailLang, signInEmail } from "./email";
import { deleteAccountKnowledge } from "./knowledge";
import { deleteAccountRoadmap } from "./roadmap";

export interface AuthEnv {
  LOG_DB?: D1Database;
  ASK_KV: KVNamespace;
  IP_SALT?: string;
  /** Comma-separated: the iPhone app's bundle ID(s) Apple identity tokens are issued for. */
  APPLE_AUDIENCES?: string;
  /** Google OAuth "Web application" client ID; Android signs in with it. */
  GOOGLE_WEB_CLIENT_ID?: string;
  /** Google OAuth "iOS" client ID; the iPhone app signs in with it. */
  GOOGLE_IOS_CLIENT_ID?: string;
  RESEND_API_KEY?: string;
  /** Sender for code emails, e.g. "Ocean Live <login@yourdomain.com>". */
  EMAIL_FROM?: string;
  /** Tests only: replaces fetch() for calls to Resend. */
  RESEND_FETCH?: typeof fetch;
  /**
   * Store review sign-in. With both set, a code requested for exactly REVIEW_EMAIL isn't emailed: the
   * pending code is REVIEW_CODE (a secret, 6 digits), so app reviewers can sign in. Either unset: that
   * address is like any other. The account of REVIEW_EMAIL never gets rewards or a balance.
   */
  REVIEW_EMAIL?: string;
  REVIEW_CODE?: string;
  /** Tests only: replaces fetch() for Apple's and Google's signing keys (nothing is cached then). */
  JWKS_FETCH?: typeof fetch;
  /** Free "Any questions?" questions per install per day; the web account page states it under the balance. Default 10. */
  DEVICE_DAILY_LIMIT?: string;
}

export interface Account {
  id: string;
  email: string | null;
  name: string | null;
  created: string;
}

const DAY = 86_400_000;
const SESSION_DAYS = 365;
/** Web sessions are shorter: the page is used now and then, sometimes on a shared computer. */
const WEB_SESSION_DAYS = 30;
const CODE_MINUTES = 10;
const CODE_ATTEMPTS = 5;
/** Wrong guesses at the review address, over all its code requests, before REVIEW_CODE stops working. */
export const REVIEW_FAILS = 20;
const MAX_NAME = 60;

/** The web account page. Its session cookie is only read on this host. */
export const WEB_HOST = "account.oceanlive.org";
export const WEB_ORIGIN = `https://${WEB_HOST}`;
/** "__Host-": Secure, Path=/ and no Domain, so the browser keeps it to account.oceanlive.org alone. */
export const WEB_COOKIE = "__Host-olaccount";

/**
 * Handles /auth/* and /account. Returns null for other paths.
 *
 * `web` is true for requests to account.oceanlive.org: the session comes from the cookie instead of a
 * bearer token, sign-ins set the cookie instead of returning the token, and anything other than GET
 * must carry that page's Origin (the CSRF guard; SameSite=Strict is the second one).
 */
export async function handleAuth(request: Request, env: AuthEnv, path: string, web = false): Promise<Response | null> {
  if (path !== "/account" && !path.startsWith("/auth/")) return null;
  if (web && request.method !== "GET" && request.method !== "HEAD" && request.headers.get("Origin") !== WEB_ORIGIN) {
    return json({ error: "origin" }, 403);
  }
  if (!env.LOG_DB) return json({ error: "accounts_unavailable" }, 503);
  const db = env.LOG_DB;
  // Android's HttpURLConnection can't send PATCH, so it sends POST with this header.
  const method = request.method === "POST" && request.headers.get("X-HTTP-Method-Override") === "PATCH" ? "PATCH" : request.method;
  const token = web ? cookieToken(request) : bearer(request);
  try {
    if (path === "/auth/config" && method === "GET") return json(web ? webConfig(env) : config(env));
    if (path === "/account") {
      const account = await sessionAccount(request, env, token);
      if (!account) return web && token ? clearCookie(json({ error: "signin_required" }, 401)) : json({ error: "signin_required" }, 401);
      // The web cookie is sent again on each use, so it lasts WEB_SESSION_DAYS from last use like the session row.
      const keep = (res: Response) => (web && token ? setCookie(res, token) : res);
      if (method === "GET") return keep(json(await accountInfo(db, account)));
      if (method === "PATCH") {
        const body = (await request.json()) as { name?: unknown };
        const name = cleanName(body.name);
        await db.prepare("UPDATE accounts SET name = ? WHERE id = ?").bind(name, account.id).run();
        return keep(json(await accountInfo(db, { ...account, name })));
      }
      if (method === "DELETE") {
        await deleteAccount(env, account.id);
        return web ? clearCookie(json({ ok: true })) : json({ ok: true });
      }
      return json({ error: "method" }, 405);
    }
    if (method !== "POST") return json({ error: "method" }, 405);
    const body = (await request.json()) as Record<string, unknown>;
    // The web page has no install whose questions could be linked.
    const device = !web && typeof body.device === "string" && /^[A-Za-z0-9-]{8,64}$/.test(body.device) ? body.device : null;
    // App sign-ins return the token; web sign-ins put it in the cookie and return only the account.
    // The web page never creates accounts (they are made in the apps): an unknown sign-in gets no_account,
    // so nobody signs in to a new empty account and deletes that one thinking it was theirs.
    const done = (s: { token: string; account: unknown } | null) =>
      !s ? json({ error: "no_account" }, 404) : web ? setCookie(json({ account: s.account }), s.token) : json(s);
    const days = web ? WEB_SESSION_DAYS : SESSION_DAYS;
    const create = !web;
    switch (path) {
      case "/auth/apple": {
        // Apple on the web needs a Services ID this server doesn't have.
        if (web) return json({ error: "method_unavailable" }, 503);
        const aud = list(env.APPLE_AUDIENCES);
        if (aud.length === 0) return json({ error: "method_unavailable" }, 503);
        const claims = await verifyJwt(String(body.identityToken ?? ""), APPLE_KEYS, ["https://appleid.apple.com"], aud, env.JWKS_FETCH);
        if (!claims || !(await nonceMatches(claims, body.nonce))) return json({ error: "invalid_token" }, 401);
        const verified = claims.email_verified === true || claims.email_verified === "true";
        return done(await signIn(env, "apple", String(claims.sub), verified ? str(claims.email) : null, cleanName(body.name), device, days, create));
      }
      case "/auth/google": {
        // The web page signs in with the web client ID only.
        const aud = web ? list(env.GOOGLE_WEB_CLIENT_ID) : googleAudiences(env);
        if (aud.length === 0) return json({ error: "method_unavailable" }, 503);
        const claims = await verifyJwt(String(body.idToken ?? ""), GOOGLE_KEYS, GOOGLE_ISSUERS, aud, env.JWKS_FETCH);
        if (!claims || !(await nonceMatches(claims, body.nonce))) return json({ error: "invalid_token" }, 401);
        const verified = claims.email_verified === true || claims.email_verified === "true";
        return done(await signIn(env, "google", String(claims.sub), verified ? str(claims.email) : null, cleanName(claims.name), device, days, create));
      }
      case "/auth/email/start":
        return await emailStart(request, env, body.email);
      case "/auth/email/verify": {
        const r = await emailVerify(env, body.email, body.code, device, days, create);
        return r instanceof Response ? r : done(r);
      }
      case "/auth/signout": {
        if (token) await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
        return web ? clearCookie(json({ ok: true })) : json({ ok: true });
      }
    }
    return json({ error: "not_found" }, 404);
  } catch (e) {
    // Apple's or Google's key server couldn't be reached: a retry may work, the request was fine.
    if (e instanceof Error && e.message === "jwks") return json({ error: "provider_unavailable" }, 502);
    return json({ error: "bad_request" }, 400);
  }
}

/**
 * When the app sent the nonce it asked Apple or Google to put in the token, the token must carry it:
 * either as sent (Google) or as its SHA-256 hex (Apple's usual pattern, where the app passes
 * sha256(nonce) to Apple). Without one (older app builds) there is nothing to compare.
 */
export async function nonceMatches(claims: Record<string, unknown>, sent: unknown): Promise<boolean> {
  if (sent === undefined || sent === null || sent === "") return true;
  if (typeof sent !== "string" || sent.length > 200) return false;
  const inToken = claims.nonce;
  if (typeof inToken !== "string") return false;
  return inToken === sent || inToken === (await sha256Hex(sent));
}

/** Which sign-in methods this server has been set up for, so the apps only show those. */
function config(env: AuthEnv) {
  return {
    apple: list(env.APPLE_AUDIENCES).length > 0,
    // Any Google client ID set. Each app also needs its own ID below: Android uses the web one,
    // the iPhone the iOS one, and hides Google when its ID is missing.
    google: googleAudiences(env).length > 0,
    email: !!env.RESEND_API_KEY && !!env.EMAIL_FROM,
    googleWebClientId: env.GOOGLE_WEB_CLIENT_ID?.trim() || null,
    googleIosClientId: env.GOOGLE_IOS_CLIENT_ID?.trim() || null,
  };
}

/** What the web page can offer: email codes and, with a web client ID, Google. Never Apple. */
function webConfig(env: AuthEnv) {
  const id = env.GOOGLE_WEB_CLIENT_ID?.trim() || null;
  const free = parseInt(env.DEVICE_DAILY_LIMIT ?? "", 10);
  return {
    apple: false,
    google: !!id,
    email: !!env.RESEND_API_KEY && !!env.EMAIL_FROM,
    googleWebClientId: id,
    // For the line under the balance: paid questions start after this many free ones a day.
    freeDailyQuestions: Number.isFinite(free) && free >= 0 ? free : 10,
  };
}

/** The account of the account page's session cookie (account.oceanlive.org only), or null. */
export async function webSessionAccount(request: Request, env: AuthEnv): Promise<Account | null> {
  return sessionAccount(request, env, cookieToken(request));
}

/**
 * The signed-in account for a session token, or null. Without `token`, the request's
 * "Authorization: Bearer <token>" is used (the apps).
 */
export async function sessionAccount(request: Request, env: AuthEnv, token: string | null = bearer(request)): Promise<Account | null> {
  if (!token || !env.LOG_DB) return null;
  const hash = await sha256Hex(token);
  const row = await env.LOG_DB.prepare(
    "SELECT a.id, a.email, a.name, a.created, s.expires, s.last_used FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ?",
  ).bind(hash).first<{ id: string; email: string | null; name: string | null; created: string; expires: string; last_used: string }>();
  if (!row) return null;
  const now = Date.now();
  if (Date.parse(row.expires) < now) {
    await env.LOG_DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(hash).run();
    return null;
  }
  // Rolling expiry, written at most once a day. A session keeps the length it started with
  // (expires - last_used): a year for the apps, WEB_SESSION_DAYS for the web page.
  if (now - Date.parse(row.last_used) > DAY) {
    const iso = new Date(now).toISOString();
    const life = Math.min(SESSION_DAYS * DAY, Math.max(DAY, Date.parse(row.expires) - Date.parse(row.last_used)));
    await env.LOG_DB.batch([
      env.LOG_DB.prepare("UPDATE sessions SET last_used = ?, expires = ? WHERE token_hash = ?").bind(iso, new Date(now + life).toISOString(), hash),
      env.LOG_DB.prepare("UPDATE accounts SET last_seen = ? WHERE id = ?").bind(iso, row.id),
    ]);
  }
  return { id: row.id, email: row.email, name: row.name, created: row.created };
}

/**
 * Finds or creates the account for a verified identity, links this install's past questions and starts a session.
 * With `create` false (the web page), an identity with no account gets null and nothing is written.
 */
async function signIn(
  env: AuthEnv,
  provider: string,
  subject: string,
  email: string | null,
  name: string | null,
  device: string | null,
  days = SESSION_DAYS,
  create = true,
) {
  const db = env.LOG_DB!;
  const now = new Date().toISOString();
  const mail = email?.trim().toLowerCase() || null;
  let accountId = (await db.prepare("SELECT account_id FROM identities WHERE provider = ? AND subject = ?").bind(provider, subject).first<{ account_id: string }>())?.account_id;
  if (!accountId && mail) {
    // Same verified email from another sign-in method: same account.
    accountId = (await db.prepare("SELECT id FROM accounts WHERE email = ?").bind(mail).first<{ id: string }>())?.id;
  }
  if (!accountId && !create) return null;
  if (!accountId) {
    accountId = crypto.randomUUID();
    await db.prepare("INSERT INTO accounts (id, email, name, created, last_seen) VALUES (?, ?, ?, ?, ?)").bind(accountId, mail, name, now, now).run();
  } else {
    // Fill in an email or name the account didn't have yet; never overwrite a name the owner chose.
    await db.prepare("UPDATE accounts SET email = COALESCE(email, ?), name = COALESCE(name, ?), last_seen = ? WHERE id = ?").bind(mail, name, now, accountId).run();
  }
  await db.prepare("INSERT OR IGNORE INTO identities (provider, subject, account_id, created) VALUES (?, ?, ?, ?)").bind(provider, subject, accountId, now).run();
  if (device) await db.prepare("UPDATE questions SET account_id = ? WHERE device = ? AND account_id IS NULL").bind(accountId, device).run();

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = base64url(bytes);
  await db.prepare("INSERT INTO sessions (token_hash, account_id, created, last_used, expires) VALUES (?, ?, ?, ?, ?)")
    .bind(await sha256Hex(token), accountId, now, now, new Date(Date.now() + days * DAY).toISOString()).run();
  const account = (await db.prepare("SELECT id, email, name, created FROM accounts WHERE id = ?").bind(accountId).first<Account>())!;
  return { token, account: await accountInfo(db, account) };
}

async function accountInfo(db: D1Database, a: Account) {
  const ids = await db.prepare("SELECT provider FROM identities WHERE account_id = ? ORDER BY created").bind(a.id).all<{ provider: string }>();
  const [balanceCents, badges] = await Promise.all([balanceOf(db, a.id), badgesOf(db, a.id)]);
  return { id: a.id, email: a.email, name: a.name, created: a.created, providers: ids.results.map((r) => r.provider), balanceCents, badges };
}

/**
 * Removes the account, its sign-ins, sessions, pending email codes, logged questions and their reports, balance, ledger, badges,
 * pending and rejected knowledge suggestions, app feedback, roadmap votes and any hand-set question limit. Only the hashed references of store rewards it claimed stay (reward_claims),
 * so the same store purchase can't be claimed again.
 */
async function deleteAccount(env: AuthEnv, id: string) {
  const db = env.LOG_DB!;
  await db.batch([
    // First, while the account and identity rows still exist: pending codes for every address of the account
    // (codes are keyed by the lower-cased address).
    db.prepare(
      "DELETE FROM email_codes WHERE email IN (" +
        "SELECT lower(email) FROM accounts WHERE id = ? AND email IS NOT NULL " +
        "UNION SELECT lower(subject) FROM identities WHERE account_id = ? AND provider = 'email')",
    ).bind(id, id),
    // Reports go with their question, and the account's own reports on other questions with it.
    db.prepare("DELETE FROM reports WHERE account_id = ? OR question_id IN (SELECT id FROM questions WHERE account_id = ?)").bind(id, id),
    db.prepare("DELETE FROM questions WHERE account_id = ?").bind(id),
    // Its pending and rejected knowledge suggestions and its app feedback; approved notes stay, unlinked (knowledge.ts).
    // Its roadmap votes, and the link from a roadmap item to its feedback (before the feedback goes).
    ...deleteAccountRoadmap(db, id),
    ...deleteAccountKnowledge(db, id),
    db.prepare("DELETE FROM ledger WHERE account_id = ?").bind(id),
    db.prepare("DELETE FROM balances WHERE account_id = ?").bind(id),
    db.prepare("DELETE FROM badges WHERE account_id = ?").bind(id),
    // What admins did to this account (balance and badge changes) goes with it.
    db.prepare("DELETE FROM admin_log WHERE account_id = ?").bind(id),
    db.prepare("DELETE FROM sessions WHERE account_id = ?").bind(id),
    db.prepare("DELETE FROM identities WHERE account_id = ?").bind(id),
    db.prepare("DELETE FROM accounts WHERE id = ?").bind(id),
  ]);
  await env.ASK_KV.delete(`limit:${id}`);
}

// ── Email codes ─────────────────────────────────────────────────

export const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

async function emailStart(request: Request, env: AuthEnv, raw: unknown): Promise<Response> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return json({ error: "method_unavailable" }, 503);
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!EMAIL.test(email)) return json({ error: "bad_email" }, 400);

  // At most 5 codes per address and 20 per network an hour.
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const keys = [`ec:${await sha256Hex(email)}`, `eip:${await sha256Hex(`${env.IP_SALT ?? ""}|${ip}`)}`];
  const counts = await Promise.all(keys.map((k) => env.ASK_KV.get(k).then((v) => (v ? parseInt(v, 10) : 0))));
  if (counts[0] >= 5 || counts[1] >= 20) return json({ error: "rate_limited" }, 429);
  await Promise.all(keys.map((k, i) => env.ASK_KV.put(k, String(counts[i] + 1), { expirationTtl: 3600 })));

  // The store reviewers' address: the fixed review code instead of an email (same expiry and tries,
  // plus a lock after REVIEW_FAILS wrong guesses in all, in emailVerify).
  const review = reviewCode(env, email);
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  const code = review ?? String(n).padStart(6, "0");
  const expires = new Date(Date.now() + CODE_MINUTES * 60_000).toISOString();
  await env.LOG_DB!.prepare("INSERT OR REPLACE INTO email_codes (email, code_hash, expires, attempts) VALUES (?, ?, ?, 0)")
    .bind(email, await codeHash(env, email, code), expires).run();
  if (review) return json({ ok: true });

  const mail = signInEmail(emailLang(request.headers.get("Accept-Language") ?? ""), code, CODE_MINUTES);
  const res = await (env.RESEND_FETCH ?? fetch)("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [email], subject: mail.subject, text: mail.text, html: mail.html }),
  });
  if (!res.ok) return json({ error: "email_failed" }, 502);
  return json({ ok: true });
}

async function emailVerify(env: AuthEnv, rawEmail: unknown, rawCode: unknown, device: string | null, days: number, create = true) {
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  const code = typeof rawCode === "string" ? rawCode.replace(/\D/g, "") : "";
  const db = env.LOG_DB!;
  const row = await db.prepare("SELECT code_hash, expires, attempts FROM email_codes WHERE email = ?").bind(email)
    .first<{ code_hash: string; expires: string; attempts: number }>();
  if (!row || Date.parse(row.expires) < Date.now() || row.attempts >= CODE_ATTEMPTS) return json({ error: "code_expired" }, 401);
  // The review code never changes, so wrong guesses at it add up across starts: after REVIEW_FAILS
  // the review code stops working until the owner sets a new REVIEW_CODE (the counter is per code).
  const review = reviewCode(env, email);
  const failKey = review ? `rvf:${await codeHash(env, email, review)}` : null;
  const fails = failKey ? parseInt((await env.ASK_KV.get(failKey)) ?? "0", 10) || 0 : 0;
  if (failKey && fails >= REVIEW_FAILS) return json({ error: "code_expired" }, 401);
  if (code.length !== 6 || (await codeHash(env, email, code)) !== row.code_hash) {
    await db.prepare("UPDATE email_codes SET attempts = attempts + 1 WHERE email = ?").bind(email).run();
    if (failKey) await env.ASK_KV.put(failKey, String(fails + 1), { expirationTtl: 180 * 86_400 });
    return json({ error: "wrong_code" }, 401);
  }
  await db.prepare("DELETE FROM email_codes WHERE email = ?").bind(email).run();
  return await signIn(env, "email", email, email, null, device, days, create);
}

/** The review address (lower case), or null when REVIEW_EMAIL isn't set. */
export function reviewEmail(env: AuthEnv): string | null {
  const e = env.REVIEW_EMAIL?.trim().toLowerCase();
  return e && EMAIL.test(e) ? e : null;
}

/** REVIEW_CODE when `email` is the review address and both are set (the code must be 6 digits), else null. */
function reviewCode(env: AuthEnv, email: string): string | null {
  const code = env.REVIEW_CODE?.trim() ?? "";
  return reviewEmail(env) === email && /^\d{6}$/.test(code) ? code : null;
}

/**
 * Is this the store reviewers' account (REVIEW_EMAIL is its email or one of its email sign-ins)? Such an
 * account never claims rewards, never has a balance and never gains any other rights.
 */
export async function isReviewAccount(db: D1Database, env: AuthEnv, account: Account): Promise<boolean> {
  const review = reviewEmail(env);
  if (!review) return false;
  if (account.email?.toLowerCase() === review) return true;
  const row = await db
    .prepare("SELECT 1 AS x FROM identities WHERE account_id = ? AND provider = 'email' AND lower(subject) = ?")
    .bind(account.id, review)
    .first();
  return !!row;
}

function codeHash(env: AuthEnv, email: string, code: string) {
  return sha256Hex(`${env.IP_SALT ?? ""}|${email}|${code}`);
}

// ── Identity token verification (RS256 JWTs) ────────────────────

const APPLE_KEYS = "https://appleid.apple.com/auth/keys";
export const GOOGLE_KEYS = "https://www.googleapis.com/oauth2/v3/certs";
export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const keyCache = new Map<string, { at: number; keys: JsonWebKey[] }>();

async function jwks(url: string, refresh = false, fetcher?: typeof fetch): Promise<JsonWebKey[]> {
  if (fetcher) {
    // Tests: their own keys, never cached.
    const res = await fetcher(url);
    const keys = ((await res.json()) as { keys: JsonWebKey[] }).keys;
    if (!Array.isArray(keys)) throw new Error("jwks");
    return keys;
  }
  const hit = keyCache.get(url);
  if (hit && !refresh && Date.now() - hit.at < 3_600_000) return hit.keys;
  let keys: JsonWebKey[];
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error();
    keys = ((await res.json()) as { keys: JsonWebKey[] }).keys;
    if (!Array.isArray(keys)) throw new Error();
  } catch {
    // Keep using keys we already have rather than failing every sign-in while the provider is down.
    if (hit) return hit.keys;
    throw new Error("jwks");
  }
  keyCache.set(url, { at: Date.now(), keys });
  return keys;
}

/** Verifies signature, issuer, audience and expiry. Returns the claims, or null. */
export async function verifyJwt(
  token: string,
  keysUrl: string,
  issuers: string[],
  audiences: string[],
  fetcher?: typeof fetch,
): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header: { alg?: string; kid?: string };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(unbase64url(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(unbase64url(parts[1])));
  } catch {
    return null;
  }
  if (header.alg !== "RS256" || !header.kid) return null;
  let jwk = (await jwks(keysUrl, false, fetcher)).find((k) => (k as { kid?: string }).kid === header.kid);
  if (!jwk) jwk = (await jwks(keysUrl, true, fetcher)).find((k) => (k as { kid?: string }).kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, unbase64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) return null;
  const now = Date.now() / 1000;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!issuers.includes(String(claims.iss))) return null;
  if (!aud.some((a) => audiences.includes(String(a)))) return null;
  if (typeof claims.exp !== "number" || claims.exp < now - 60) return null;
  // Issued in the future (beyond clock skew): not a token we should trust.
  if (typeof claims.iat === "number" && claims.iat > now + 300) return null;
  if (typeof claims.sub !== "string" || !claims.sub) return null;
  return claims;
}

// ── Helpers ─────────────────────────────────────────────────────

function bearer(request: Request): string | null {
  const h = request.headers.get("Authorization") ?? "";
  const m = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(h);
  return m ? m[1] : null;
}

function cookieToken(request: Request): string | null {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === WEB_COOKIE) return v && /^[A-Za-z0-9_-]{20,200}$/.test(v) ? v : null;
  }
  return null;
}

function setCookie(res: Response, token: string): Response {
  res.headers.append("Set-Cookie", `${WEB_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${WEB_SESSION_DAYS * 86_400}`);
  return res;
}

function clearCookie(res: Response): Response {
  res.headers.append("Set-Cookie", `${WEB_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`);
  return res;
}

function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
  return s || null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

function googleAudiences(env: AuthEnv): string[] {
  return [env.GOOGLE_WEB_CLIENT_ID, env.GOOGLE_IOS_CLIENT_ID].map((s) => s?.trim() ?? "").filter(Boolean);
}

function list(v: string | undefined): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unbase64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
