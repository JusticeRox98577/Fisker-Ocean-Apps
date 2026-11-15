/**
 * The admin page at admin.oceanlive.org: usage and reports, find an account, change its balance or badge, manage admins.
 *
 * Everything here answers only on ADMIN_HOST; on every other host /admin/* is a plain 404.
 *
 * Sign-in is Sign in with Google only (no email codes, no Apple). An admin is a verified Google
 * address, not an Ocean Live account:
 *   - owners: the addresses in the secret ADMIN_EMAILS (comma-separated). Unset or empty: no owners.
 *   - admins: addresses an owner added on the page (table `admins`).
 * Owners can add and remove admins; admins can change balances and badges and see usage and reports.
 * Owners can't be removed on the page (only by changing the secret). The store review address (REVIEW_EMAIL) is
 * never an admin, and app sessions (bearer tokens, the account page's cookie) count for nothing here.
 *
 * A sign-in that isn't an admin gets 403 not_admin and no session. Admin sessions last 12 hours,
 * in their own table (admin_sessions) and their own host-only cookie (ADMIN_COOKIE). Admin rights are
 * checked again on every request, so removing an admin (or an owner from the secret) ends their
 * sessions at once. Without a valid admin session every /admin/* path is 404 not_found.
 *
 * Endpoints on admin.oceanlive.org (anything but GET/HEAD must carry Origin: ADMIN_ORIGIN):
 *   GET  /auth/config               { google, googleWebClientId }
 *   POST /auth/google               { idToken, nonce? } -> { email, owner } and the session cookie
 *   POST /auth/signout
 *   GET  /admin/me                  { email, owner }
 *   GET  /admin/accounts?email= | ?id=   { accounts: [...] } with balance, badges and the last 50 ledger rows
 *   POST /admin/balance             { accountId, deltaCents, note } -> { ok, balanceCents }
 *   POST /admin/badge               { accountId, badge: "early_supporter", grant } -> { ok, badges }
 *   GET  /admin/admins              owners only: { owners, admins }
 *   POST /admin/admins/add          owners only: { email }
 *   POST /admin/admins/remove       owners only: { email }
 *   GET  /admin/log                 owners only: the last 100 admin actions
 *   GET  /admin/usage, /admin/usage/questions, /admin/reports, POST /admin/reports/resolve
 *                                   the Usage tab, owners and admins (see usage.ts)
 * Writes are limited to ADMIN_WRITE_LIMIT (100) per admin per day and each one is written to admin_log.
 * Tables: migrations/0005_admin.sql, 0006_usage.sql.
 */

import page from "../admin/index.html?raw";
import script from "../admin/admin.js?raw";
import style from "../admin/admin.css?raw";
import {
  EMAIL,
  GOOGLE_ISSUERS,
  GOOGLE_KEYS,
  isReviewAccount,
  nonceMatches,
  reviewEmail,
  sha256Hex,
  verifyJwt,
  type Account,
  type AuthEnv,
} from "./auth";
import { badgesOf, balanceOf, EARLY_SUPPORTER } from "./balance";
import { listReports, recentQuestions, resolveReport, usageSummary, type UsageEnv } from "./usage";

export interface AdminEnv extends AuthEnv, UsageEnv {
  /** Secret: the owners' Google addresses, comma-separated. */
  ADMIN_EMAILS?: string;
  /** Balance, badge, admin and report changes per admin per day. Default 100. */
  ADMIN_WRITE_LIMIT?: string;
}

export const ADMIN_HOST = "admin.oceanlive.org";
export const ADMIN_ORIGIN = `https://${ADMIN_HOST}`;
/** "__Host-": Secure, Path=/ and no Domain, so it stays on admin.oceanlive.org alone. */
export const ADMIN_COOKIE = "__Host-oladmin";

const SESSION_SECONDS = 12 * 3600;
const MAX_DELTA_CENTS = 100_000;
const SIGNIN_PER_HOUR = 30;
const BADGES = [EARLY_SUPPORTER];

type Role = "owner" | "admin";
interface Admin {
  email: string;
  role: Role;
}

const FILES: Record<string, { body: string; type: string }> = {
  "/": { body: page, type: "text/html; charset=utf-8" },
  "/index.html": { body: page, type: "text/html; charset=utf-8" },
  "/admin.js": { body: script, type: "text/javascript; charset=utf-8" },
  "/admin.css": { body: style, type: "text/css; charset=utf-8" },
};

/** Everything on admin.oceanlive.org. */
export async function adminSite(request: Request, env: AdminEnv, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = request.method;
  const read = method === "GET" || method === "HEAD";
  if (!read && request.headers.get("Origin") !== ADMIN_ORIGIN) return json({ error: "origin" }, 403);

  const file = FILES[path];
  if (file) {
    if (!read) return json({ error: "method" }, 405);
    return new Response(method === "HEAD" ? null : file.body, { headers: { "content-type": file.type, "cache-control": "no-cache" } });
  }
  if (path === "/auth/config") {
    if (!read) return json({ error: "method" }, 405);
    const id = env.GOOGLE_WEB_CLIENT_ID?.trim() || null;
    return json({ google: !!id, googleWebClientId: id });
  }
  // Google only: email codes, Apple and the account endpoints don't exist on this host.
  if (path !== "/auth/google" && path !== "/auth/signout" && path !== "/admin" && !path.startsWith("/admin/")) {
    return json({ error: "not_found" }, 404);
  }
  if (!env.LOG_DB) return json({ error: "unavailable" }, 503);
  const db = env.LOG_DB;

  try {
    if (path === "/auth/google") {
      if (method !== "POST") return json({ error: "method" }, 405);
      return await googleSignIn(request, env, db);
    }
    if (path === "/auth/signout") {
      if (method !== "POST") return json({ error: "method" }, 405);
      const token = cookieToken(request);
      if (token) await db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
      return clearCookie(json({ ok: true }));
    }

    const admin = await sessionAdmin(request, env, db);
    if (!admin) {
      const res = json({ error: "not_found" }, 404);
      return cookieToken(request) ? clearCookie(res) : res;
    }
    const owner = admin.role === "owner";
    const notFound = () => json({ error: "not_found" }, 404);
    const ownerOnly = () => json({ error: "owner_only" }, 403);

    switch (path) {
      case "/admin/me":
        return read ? json({ email: admin.email, owner }) : json({ error: "method" }, 405);
      case "/admin/accounts":
        return read ? json({ accounts: await findAccounts(env, db, url.searchParams) }) : json({ error: "method" }, 405);
      case "/admin/admins":
        if (!owner) return ownerOnly();
        return read ? json(await adminList(env, db)) : json({ error: "method" }, 405);
      case "/admin/log":
        if (!owner) return ownerOnly();
        return read ? json({ log: await recentLog(db) }) : json({ error: "method" }, 405);
      case "/admin/usage":
        return read ? json(await usageSummary(env, db)) : json({ error: "method" }, 405);
      case "/admin/usage/questions":
        return read ? json(await recentQuestions(db, url.searchParams)) : json({ error: "method" }, 405);
      case "/admin/reports":
        return read ? json(await listReports(db, url.searchParams)) : json({ error: "method" }, 405);
      case "/admin/balance":
      case "/admin/badge":
      case "/admin/admins/add":
      case "/admin/admins/remove":
      case "/admin/reports/resolve": {
        if (method !== "POST") return json({ error: "method" }, 405);
        if (path.startsWith("/admin/admins/") && !owner) return ownerOnly();
        const body = (await request.json()) as Record<string, unknown>;
        if (!body || typeof body !== "object") return json({ error: "bad_request" }, 400);
        if (!(await countWrite(env, admin.email))) return json({ error: "rate_limited" }, 429);
        if (path === "/admin/balance") return await adjustBalance(env, db, admin, body);
        if (path === "/admin/badge") return await setBadge(env, db, admin, body);
        if (path === "/admin/admins/add") return await addAdmin(env, db, admin, body);
        if (path === "/admin/reports/resolve") return await resolveReport(db, admin.email, body);
        return await removeAdmin(env, db, admin, body);
      }
    }
    return notFound();
  } catch (e) {
    if (e instanceof Error && e.message === "jwks") return json({ error: "provider_unavailable" }, 502);
    return json({ error: "bad_request" }, 400);
  }
}

// ── Who is an admin ─────────────────────────────────────────────

function owners(env: AdminEnv): string[] {
  return (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => EMAIL.test(s));
}

/** The role of a verified Google address, decided only from the secret and the admins table. */
export async function adminRole(env: AdminEnv, db: D1Database, rawEmail: string): Promise<Role | null> {
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL.test(email)) return null;
  // The store reviewers' address never gets admin rights, whatever the secret or the table say.
  if (email === reviewEmail(env)) return null;
  if (owners(env).includes(email)) return "owner";
  const row = await db.prepare("SELECT 1 AS x FROM admins WHERE email = ?").bind(email).first();
  return row ? "admin" : null;
}

async function googleSignIn(request: Request, env: AdminEnv, db: D1Database): Promise<Response> {
  const clientId = env.GOOGLE_WEB_CLIENT_ID?.trim();
  if (!clientId) return json({ error: "method_unavailable" }, 503);

  // At most SIGNIN_PER_HOUR tries per network an hour.
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const key = `asi:${await sha256Hex(`${env.IP_SALT ?? ""}|${ip}`)}`;
  const tries = parseInt((await env.ASK_KV.get(key)) ?? "0", 10) || 0;
  if (tries >= SIGNIN_PER_HOUR) return json({ error: "rate_limited" }, 429);
  await env.ASK_KV.put(key, String(tries + 1), { expirationTtl: 3600 });

  const body = (await request.json()) as Record<string, unknown>;
  const claims = await verifyJwt(String(body?.idToken ?? ""), GOOGLE_KEYS, GOOGLE_ISSUERS, [clientId], env.JWKS_FETCH);
  if (!claims || !(await nonceMatches(claims, body.nonce))) return json({ error: "invalid_token" }, 401);
  const verified = claims.email_verified === true || claims.email_verified === "true";
  const email = verified && typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  const role = email ? await adminRole(env, db, email) : null;
  if (!role) return json({ error: "not_admin" }, 403);

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = base64url(bytes);
  const now = new Date();
  await db.batch([
    // Expired sessions of this admin go first.
    db.prepare("DELETE FROM admin_sessions WHERE email = ? AND expires < ?").bind(email, now.toISOString()),
    db.prepare("INSERT INTO admin_sessions (token_hash, email, created, expires) VALUES (?, ?, ?, ?)")
      .bind(await sha256Hex(token), email, now.toISOString(), new Date(now.getTime() + SESSION_SECONDS * 1000).toISOString()),
    logStatement(db, email, "signin", null, null, now.toISOString()),
  ]);
  return setCookie(json({ email, owner: role === "owner" }), token);
}

/** The admin of this request's session cookie, or null. Checks the admin's rights again every time. */
async function sessionAdmin(request: Request, env: AdminEnv, db: D1Database): Promise<Admin | null> {
  const token = cookieToken(request);
  if (!token) return null;
  const hash = await sha256Hex(token);
  const row = await db.prepare("SELECT email, expires FROM admin_sessions WHERE token_hash = ?").bind(hash).first<{ email: string; expires: string }>();
  if (!row) return null;
  if (Date.parse(row.expires) < Date.now()) {
    await db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(hash).run();
    return null;
  }
  const role = await adminRole(env, db, row.email);
  if (!role) {
    // No longer an admin (removed, or taken out of the secret): every session of that address ends.
    await db.prepare("DELETE FROM admin_sessions WHERE email = ?").bind(row.email).run();
    return null;
  }
  return { email: row.email, role };
}

// ── Accounts ────────────────────────────────────────────────────

async function findAccounts(env: AdminEnv, db: D1Database, q: URLSearchParams) {
  const email = (q.get("email") ?? "").trim().toLowerCase();
  const id = (q.get("id") ?? "").trim();
  let rows: Account[] = [];
  if (EMAIL.test(email)) {
    // The account's address, or any of its email-code sign-ins.
    rows = (
      await db
        .prepare(
          "SELECT id, email, name, created FROM accounts WHERE email = ? " +
            "OR id IN (SELECT account_id FROM identities WHERE provider = 'email' AND lower(subject) = ?) ORDER BY created LIMIT 20",
        )
        .bind(email, email)
        .all<Account>()
    ).results;
  } else if (/^[A-Za-z0-9-]{8,64}$/.test(id)) {
    rows = (await db.prepare("SELECT id, email, name, created FROM accounts WHERE id = ?").bind(id).all<Account>()).results;
  } else {
    throw new Error("query");
  }
  return Promise.all(rows.map((a) => accountDetails(env, db, a)));
}

async function accountDetails(env: AdminEnv, db: D1Database, a: Account) {
  const [ids, balanceCents, badges, ledger, review] = await Promise.all([
    db.prepare("SELECT provider FROM identities WHERE account_id = ? ORDER BY created").bind(a.id).all<{ provider: string }>(),
    balanceOf(db, a.id),
    badgesOf(db, a.id),
    db
      .prepare("SELECT id, delta_cents AS deltaCents, kind, note, created FROM ledger WHERE account_id = ? ORDER BY id DESC LIMIT 50")
      .bind(a.id)
      .all<{ id: number; deltaCents: number; kind: string; note: string | null; created: string }>(),
    isReviewAccount(db, env, a),
  ]);
  return {
    id: a.id,
    email: a.email,
    name: a.name,
    created: a.created,
    providers: ids.results.map((r) => r.provider),
    balanceCents,
    badges,
    ledger: ledger.results,
    review,
  };
}

async function accountById(db: D1Database, id: unknown): Promise<Account | null> {
  if (typeof id !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(id)) return null;
  return await db.prepare("SELECT id, email, name, created FROM accounts WHERE id = ?").bind(id).first<Account>();
}

function cleanNote(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return s.length >= 3 && s.length <= 200 ? s : null;
}

/**
 * Adds or removes credit in one transaction: the ledger row (kind 'adjust', ref admin:<uuid>, note
 * "<admin email>: <note>"), the balance and the admin_log row. Nothing happens when the balance would
 * go below 0.
 */
async function adjustBalance(env: AdminEnv, db: D1Database, admin: Admin, body: Record<string, unknown>): Promise<Response> {
  const delta = body.deltaCents;
  const note = cleanNote(body.note);
  if (typeof delta !== "number" || !Number.isInteger(delta) || delta === 0 || Math.abs(delta) > MAX_DELTA_CENTS) {
    return json({ error: "bad_amount" }, 400);
  }
  if (!note) return json({ error: "note_required" }, 400);
  const account = await accountById(db, body.accountId);
  if (!account) return json({ error: "no_account" }, 404);
  if (await isReviewAccount(db, env, account)) return json({ error: "review_account" }, 400);

  const now = new Date().toISOString();
  const ref = `admin:${crypto.randomUUID()}`;
  const detail = JSON.stringify({ deltaCents: delta, note });
  const [ins] = await db.batch([
    db.prepare(
      "INSERT INTO ledger (account_id, delta_cents, kind, ref, note, created) " +
        "SELECT ?, ?, 'adjust', ?, ?, ? WHERE COALESCE((SELECT cents FROM balances WHERE account_id = ?), 0) + ? >= 0",
    ).bind(account.id, delta, ref, `${admin.email}: ${note}`, now, account.id, delta),
    // Only when the ledger row above was written. (Not an upsert: the CHECK on cents would see the negative delta.)
    db.prepare("INSERT OR IGNORE INTO balances (account_id, cents, updated) SELECT ?, 0, ? WHERE EXISTS (SELECT 1 FROM ledger WHERE ref = ?)")
      .bind(account.id, now, ref),
    db.prepare("UPDATE balances SET cents = cents + ?, updated = ? WHERE account_id = ? AND EXISTS (SELECT 1 FROM ledger WHERE ref = ?)")
      .bind(delta, now, account.id, ref),
    db.prepare(
      "INSERT INTO admin_log (email, action, detail, account_id, created) SELECT ?, 'balance', ?, ?, ? WHERE EXISTS (SELECT 1 FROM ledger WHERE ref = ?)",
    ).bind(admin.email, detail, account.id, now, ref),
  ]);
  const balanceCents = await balanceOf(db, account.id);
  if (!ins.meta.changes) return json({ error: "insufficient_balance", balanceCents }, 409);
  return json({ ok: true, balanceCents });
}

async function setBadge(env: AdminEnv, db: D1Database, admin: Admin, body: Record<string, unknown>): Promise<Response> {
  if (typeof body.badge !== "string" || !BADGES.includes(body.badge) || typeof body.grant !== "boolean") return json({ error: "bad_request" }, 400);
  const account = await accountById(db, body.accountId);
  if (!account) return json({ error: "no_account" }, 404);
  if (await isReviewAccount(db, env, account)) return json({ error: "review_account" }, 400);
  const now = new Date().toISOString();
  await db.batch([
    body.grant
      ? db.prepare("INSERT OR IGNORE INTO badges (account_id, badge, created) VALUES (?, ?, ?)").bind(account.id, body.badge, now)
      : db.prepare("DELETE FROM badges WHERE account_id = ? AND badge = ?").bind(account.id, body.badge),
    logStatement(db, admin.email, "badge", JSON.stringify({ badge: body.badge, grant: body.grant }), account.id, now),
  ]);
  return json({ ok: true, badges: await badgesOf(db, account.id) });
}

// ── Admins (owners only) ────────────────────────────────────────

async function adminList(env: AdminEnv, db: D1Database) {
  const rows = await db
    .prepare("SELECT email, added_by AS addedBy, created FROM admins ORDER BY created, email")
    .all<{ email: string; addedBy: string; created: string }>();
  const own = owners(env);
  return { owners: own, admins: rows.results.filter((r) => !own.includes(r.email)) };
}

function emailOf(v: unknown): string | null {
  const e = typeof v === "string" ? v.trim().toLowerCase() : "";
  return EMAIL.test(e) ? e : null;
}

async function addAdmin(env: AdminEnv, db: D1Database, admin: Admin, body: Record<string, unknown>): Promise<Response> {
  const email = emailOf(body.email);
  if (!email) return json({ error: "bad_email" }, 400);
  if (email === reviewEmail(env)) return json({ error: "not_allowed" }, 400);
  if (owners(env).includes(email)) return json({ error: "already_owner" }, 400);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO admins (email, added_by, created) VALUES (?, ?, ?)").bind(email, admin.email, now),
    logStatement(db, admin.email, "admin_add", JSON.stringify({ email }), null, now),
  ]);
  return json({ ok: true, ...(await adminList(env, db)) });
}

async function removeAdmin(env: AdminEnv, db: D1Database, admin: Admin, body: Record<string, unknown>): Promise<Response> {
  const email = emailOf(body.email);
  if (!email) return json({ error: "bad_email" }, 400);
  // Owners come from the secret; only changing the secret removes one.
  if (owners(env).includes(email)) return json({ error: "owner_fixed" }, 400);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("DELETE FROM admins WHERE email = ?").bind(email),
    // Their sessions end now, not in up to 12 hours.
    db.prepare("DELETE FROM admin_sessions WHERE email = ?").bind(email),
    logStatement(db, admin.email, "admin_remove", JSON.stringify({ email }), null, now),
  ]);
  return json({ ok: true, ...(await adminList(env, db)) });
}

async function recentLog(db: D1Database) {
  const rows = await db
    .prepare("SELECT id, email, action, detail, account_id AS accountId, created FROM admin_log ORDER BY id DESC LIMIT 100")
    .all<{ id: number; email: string; action: string; detail: string | null; accountId: string | null; created: string }>();
  return rows.results;
}

// ── Helpers ─────────────────────────────────────────────────────

function logStatement(db: D1Database, email: string, action: string, detail: string | null, accountId: string | null, now: string) {
  return db.prepare("INSERT INTO admin_log (email, action, detail, account_id, created) VALUES (?, ?, ?, ?, ?)").bind(email, action, detail, accountId, now);
}

/** Counts one write for this admin today (UTC). False once ADMIN_WRITE_LIMIT is reached. */
async function countWrite(env: AdminEnv, email: string): Promise<boolean> {
  const n = parseInt(env.ADMIN_WRITE_LIMIT ?? "", 10);
  const limit = Number.isFinite(n) && n >= 0 ? n : 100;
  const key = `adminw:${await sha256Hex(email)}:${new Date().toISOString().slice(0, 10)}`;
  const used = parseInt((await env.ASK_KV.get(key)) ?? "0", 10) || 0;
  if (used >= limit) return false;
  await env.ASK_KV.put(key, String(used + 1), { expirationTtl: 60 * 60 * 26 });
  return true;
}

function cookieToken(request: Request): string | null {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === ADMIN_COOKIE) return v && /^[A-Za-z0-9_-]{20,200}$/.test(v) ? v : null;
  }
  return null;
}

function setCookie(res: Response, token: string): Response {
  res.headers.append("Set-Cookie", `${ADMIN_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}`);
  return res;
}

function clearCookie(res: Response): Response {
  res.headers.append("Set-Cookie", `${ADMIN_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`);
  return res;
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
