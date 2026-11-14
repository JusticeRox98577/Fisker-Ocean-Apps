/**
 * Ocean Live accounts: sign in with Apple, Google or a 6-digit email code.
 *
 * The Worker checks the sign-in itself (Apple and Google identity tokens are verified against
 * their published keys; email codes are sent through Resend) and then issues its own random
 * session token. Only a SHA-256 hash of each token is stored. No passwords exist anywhere.
 *
 * Tables: see migrations/0002_accounts.sql.
 */

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
}

export interface Account {
  id: string;
  email: string | null;
  name: string | null;
  created: string;
}

const SESSION_DAYS = 365;
const CODE_MINUTES = 10;
const CODE_ATTEMPTS = 5;
const MAX_NAME = 60;

/** Handles /auth/* and /account. Returns null for other paths. */
export async function handleAuth(request: Request, env: AuthEnv, path: string): Promise<Response | null> {
  if (path !== "/account" && !path.startsWith("/auth/")) return null;
  if (!env.LOG_DB) return json({ error: "accounts_unavailable" }, 503);
  const db = env.LOG_DB;
  // Android's HttpURLConnection can't send PATCH, so it sends POST with this header.
  const method = request.method === "POST" && request.headers.get("X-HTTP-Method-Override") === "PATCH" ? "PATCH" : request.method;
  try {
    if (path === "/auth/config" && method === "GET") return json(config(env));
    if (path === "/account") {
      const account = await sessionAccount(request, env);
      if (!account) return json({ error: "signin_required" }, 401);
      if (method === "GET") return json(await accountInfo(db, account));
      if (method === "PATCH") {
        const body = (await request.json()) as { name?: unknown };
        const name = cleanName(body.name);
        await db.prepare("UPDATE accounts SET name = ? WHERE id = ?").bind(name, account.id).run();
        return json(await accountInfo(db, { ...account, name }));
      }
      if (method === "DELETE") {
        await deleteAccount(env, account.id);
        return json({ ok: true });
      }
      return json({ error: "method" }, 405);
    }
    if (method !== "POST") return json({ error: "method" }, 405);
    const body = (await request.json()) as Record<string, unknown>;
    const device = typeof body.device === "string" && /^[A-Za-z0-9-]{8,64}$/.test(body.device) ? body.device : null;
    switch (path) {
      case "/auth/apple": {
        const aud = list(env.APPLE_AUDIENCES);
        if (aud.length === 0) return json({ error: "method_unavailable" }, 503);
        const claims = await verifyJwt(String(body.identityToken ?? ""), APPLE_KEYS, ["https://appleid.apple.com"], aud);
        if (!claims) return json({ error: "invalid_token" }, 401);
        const verified = claims.email_verified === true || claims.email_verified === "true";
        return json(await signIn(env, "apple", String(claims.sub), verified ? str(claims.email) : null, cleanName(body.name), device));
      }
      case "/auth/google": {
        const aud = googleAudiences(env);
        if (aud.length === 0) return json({ error: "method_unavailable" }, 503);
        const claims = await verifyJwt(String(body.idToken ?? ""), GOOGLE_KEYS, ["https://accounts.google.com", "accounts.google.com"], aud);
        if (!claims) return json({ error: "invalid_token" }, 401);
        const verified = claims.email_verified === true || claims.email_verified === "true";
        return json(await signIn(env, "google", String(claims.sub), verified ? str(claims.email) : null, cleanName(claims.name), device));
      }
      case "/auth/email/start":
        return await emailStart(request, env, body.email);
      case "/auth/email/verify":
        return await emailVerify(env, body.email, body.code, device);
      case "/auth/signout": {
        const token = bearer(request);
        if (token) await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
        return json({ ok: true });
      }
    }
    return json({ error: "not_found" }, 404);
  } catch {
    return json({ error: "bad_request" }, 400);
  }
}

/** Which sign-in methods this server has been set up for, so the apps only show those. */
function config(env: AuthEnv) {
  return {
    apple: list(env.APPLE_AUDIENCES).length > 0,
    google: googleAudiences(env).length > 0,
    email: !!env.RESEND_API_KEY && !!env.EMAIL_FROM,
    googleWebClientId: env.GOOGLE_WEB_CLIENT_ID?.trim() || null,
    googleIosClientId: env.GOOGLE_IOS_CLIENT_ID?.trim() || null,
  };
}

/** The signed-in account for a request's "Authorization: Bearer <token>", or null. */
export async function sessionAccount(request: Request, env: AuthEnv): Promise<Account | null> {
  const token = bearer(request);
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
  // Rolling expiry, written at most once a day.
  if (now - Date.parse(row.last_used) > 86_400_000) {
    const iso = new Date(now).toISOString();
    await env.LOG_DB.batch([
      env.LOG_DB.prepare("UPDATE sessions SET last_used = ?, expires = ? WHERE token_hash = ?").bind(iso, new Date(now + SESSION_DAYS * 86_400_000).toISOString(), hash),
      env.LOG_DB.prepare("UPDATE accounts SET last_seen = ? WHERE id = ?").bind(iso, row.id),
    ]);
  }
  return { id: row.id, email: row.email, name: row.name, created: row.created };
}

/** Finds or creates the account for a verified identity, links this install's past questions and starts a session. */
async function signIn(env: AuthEnv, provider: string, subject: string, email: string | null, name: string | null, device: string | null) {
  const db = env.LOG_DB!;
  const now = new Date().toISOString();
  const mail = email?.trim().toLowerCase() || null;
  let accountId = (await db.prepare("SELECT account_id FROM identities WHERE provider = ? AND subject = ?").bind(provider, subject).first<{ account_id: string }>())?.account_id;
  if (!accountId && mail) {
    // Same verified email from another sign-in method: same account.
    accountId = (await db.prepare("SELECT id FROM accounts WHERE email = ?").bind(mail).first<{ id: string }>())?.id;
  }
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
    .bind(await sha256Hex(token), accountId, now, now, new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString()).run();
  const account = (await db.prepare("SELECT id, email, name, created FROM accounts WHERE id = ?").bind(accountId).first<Account>())!;
  return { token, account: await accountInfo(db, account) };
}

async function accountInfo(db: D1Database, a: Account) {
  const ids = await db.prepare("SELECT provider FROM identities WHERE account_id = ? ORDER BY created").bind(a.id).all<{ provider: string }>();
  return { id: a.id, email: a.email, name: a.name, created: a.created, providers: ids.results.map((r) => r.provider) };
}

/** Removes the account, its sign-ins, sessions, logged questions and any hand-set question limit. */
async function deleteAccount(env: AuthEnv, id: string) {
  const db = env.LOG_DB!;
  await db.batch([
    db.prepare("DELETE FROM questions WHERE account_id = ?").bind(id),
    db.prepare("DELETE FROM sessions WHERE account_id = ?").bind(id),
    db.prepare("DELETE FROM identities WHERE account_id = ?").bind(id),
    db.prepare("DELETE FROM accounts WHERE id = ?").bind(id),
  ]);
  await env.ASK_KV.delete(`limit:${id}`);
}

// ── Email codes ─────────────────────────────────────────────────

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

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

  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  const code = String(n).padStart(6, "0");
  const expires = new Date(Date.now() + CODE_MINUTES * 60_000).toISOString();
  await env.LOG_DB!.prepare("INSERT OR REPLACE INTO email_codes (email, code_hash, expires, attempts) VALUES (?, ?, ?, 0)")
    .bind(email, await codeHash(env, email, code), expires).run();

  const text = emailText(request.headers.get("Accept-Language") ?? "", code);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [email], subject: text.subject, text: text.body }),
  });
  if (!res.ok) return json({ error: "email_failed" }, 502);
  return json({ ok: true });
}

async function emailVerify(env: AuthEnv, rawEmail: unknown, rawCode: unknown, device: string | null): Promise<Response> {
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  const code = typeof rawCode === "string" ? rawCode.replace(/\D/g, "") : "";
  const db = env.LOG_DB!;
  const row = await db.prepare("SELECT code_hash, expires, attempts FROM email_codes WHERE email = ?").bind(email)
    .first<{ code_hash: string; expires: string; attempts: number }>();
  if (!row || Date.parse(row.expires) < Date.now() || row.attempts >= CODE_ATTEMPTS) return json({ error: "code_expired" }, 401);
  if (code.length !== 6 || (await codeHash(env, email, code)) !== row.code_hash) {
    await db.prepare("UPDATE email_codes SET attempts = attempts + 1 WHERE email = ?").bind(email).run();
    return json({ error: "wrong_code" }, 401);
  }
  await db.prepare("DELETE FROM email_codes WHERE email = ?").bind(email).run();
  return json(await signIn(env, "email", email, email, null, device));
}

function codeHash(env: AuthEnv, email: string, code: string) {
  return sha256Hex(`${env.IP_SALT ?? ""}|${email}|${code}`);
}

function emailText(acceptLanguage: string, code: string): { subject: string; body: string } {
  const lang = acceptLanguage.slice(0, 2).toLowerCase();
  const t: Record<string, [string, string]> = {
    en: ["Your Ocean Live code", `Your Ocean Live sign-in code is ${code}.\n\nIt works for ${CODE_MINUTES} minutes. If you didn't ask for it, you can ignore this email.`],
    de: ["Dein Ocean-Live-Code", `Dein Anmeldecode für Ocean Live ist ${code}.\n\nEr gilt ${CODE_MINUTES} Minuten. Wenn du ihn nicht angefordert hast, kannst du diese E-Mail ignorieren.`],
    nl: ["Je Ocean Live-code", `Je inlogcode voor Ocean Live is ${code}.\n\nHij werkt ${CODE_MINUTES} minuten. Heb je hem niet aangevraagd, dan kun je deze e-mail negeren.`],
    fr: ["Votre code Ocean Live", `Votre code de connexion Ocean Live est ${code}.\n\nIl est valable ${CODE_MINUTES} minutes. Si vous ne l'avez pas demandé, ignorez cet e-mail.`],
    es: ["Tu código de Ocean Live", `Tu código para entrar en Ocean Live es ${code}.\n\nSirve durante ${CODE_MINUTES} minutos. Si no lo has pedido, puedes ignorar este correo.`],
  };
  const [subject, body] = t[lang] ?? t.en;
  return { subject, body };
}

// ── Identity token verification (RS256 JWTs) ────────────────────

const APPLE_KEYS = "https://appleid.apple.com/auth/keys";
const GOOGLE_KEYS = "https://www.googleapis.com/oauth2/v3/certs";
const keyCache = new Map<string, { at: number; keys: JsonWebKey[] }>();

async function jwks(url: string, refresh = false): Promise<JsonWebKey[]> {
  const hit = keyCache.get(url);
  if (hit && !refresh && Date.now() - hit.at < 3_600_000) return hit.keys;
  const res = await fetch(url);
  if (!res.ok) throw new Error("jwks");
  const keys = ((await res.json()) as { keys: JsonWebKey[] }).keys;
  keyCache.set(url, { at: Date.now(), keys });
  return keys;
}

/** Verifies signature, issuer, audience and expiry. Returns the claims, or null. */
export async function verifyJwt(token: string, keysUrl: string, issuers: string[], audiences: string[]): Promise<Record<string, unknown> | null> {
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
  let jwk = (await jwks(keysUrl)).find((k) => (k as { kid?: string }).kid === header.kid);
  if (!jwk) jwk = (await jwks(keysUrl, true)).find((k) => (k as { kid?: string }).kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, unbase64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) return null;
  const now = Date.now() / 1000;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!issuers.includes(String(claims.iss))) return null;
  if (!aud.some((a) => audiences.includes(String(a)))) return null;
  if (typeof claims.exp !== "number" || claims.exp < now - 60) return null;
  if (typeof claims.sub !== "string" || !claims.sub) return null;
  return claims;
}

// ── Helpers ─────────────────────────────────────────────────────

function bearer(request: Request): string | null {
  const h = request.headers.get("Authorization") ?? "";
  const m = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(h);
  return m ? m[1] : null;
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
