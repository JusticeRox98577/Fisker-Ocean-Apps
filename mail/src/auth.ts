/**
 * Sign-in: a mailbox address plus the shared PIN (secret MAIL_PIN).
 * Sessions are random tokens in an HttpOnly, SameSite=Strict cookie; only their SHA-256 is stored.
 * Every request that changes something must also carry the session's CSRF token and come from this origin.
 */
import { type Env, type Session, num } from "./env";
import { bump, clear, current } from "./limits";
import { canonicalAddress, fail, getCookie, json, randomToken, sha256, sha256hex } from "./util";

export const COOKIE = "__Host-olmail";
const SESSION_MS = 30 * 24 * 3600 * 1000;
const IP_WINDOW_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 3600 * 1000;

export async function pinMatches(env: Env, pin: unknown): Promise<boolean> {
  const expected = env.MAIL_PIN;
  if (!expected || typeof pin !== "string" || pin.length === 0 || pin.length > 128) return false;
  const [a, b] = await Promise.all([sha256(pin), sha256(expected)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

/** The request comes from this site (or from no browser page at all, like curl). */
export function sameOrigin(req: Request): boolean {
  const url = new URL(req.url);
  const origin = req.headers.get("Origin");
  if (origin && origin !== url.origin) return false;
  const site = req.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin" && site !== "none") return false;
  return true;
}

export async function getSession(req: Request, env: Env, now = Date.now()): Promise<Session | null> {
  const token = getCookie(req, COOKIE);
  if (!token || token.length > 100) return null;
  const tokenHash = await sha256hex(token);
  const row = await env.DB.prepare(
    "SELECT s.mailbox, s.csrf FROM sessions s JOIN mailboxes m ON m.address = s.mailbox WHERE s.token_hash = ?1 AND s.expires_at > ?2",
  )
    .bind(tokenHash, now)
    .first<{ mailbox: string; csrf: string }>();
  return row ? { mailbox: row.mailbox, csrf: row.csrf, tokenHash } : null;
}

/** For POST/PATCH/DELETE: same origin and the session's CSRF token in X-CSRF-Token. */
export function csrfOk(req: Request, session: Session): boolean {
  if (req.method === "GET" || req.method === "HEAD") return true;
  if (!sameOrigin(req)) return false;
  const sent = req.headers.get("X-CSRF-Token") ?? "";
  if (sent.length !== session.csrf.length) return false;
  let diff = 0;
  for (let i = 0; i < sent.length; i++) diff |= sent.charCodeAt(i) ^ session.csrf.charCodeAt(i);
  return diff === 0;
}

function cookie(value: string, maxAgeSec: number): string {
  return `${COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}`;
}

export async function login(req: Request, env: Env, now = Date.now()): Promise<Response> {
  if (!sameOrigin(req)) return fail(403, "Sign in from mail.oceanlive.org.");
  if (!env.MAIL_PIN) return fail(503, "Sign-in isn't set up yet: the MAIL_PIN secret is missing.");
  let body: { address?: unknown; pin?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Send the address and PIN.");
  }
  const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
  const ipKey = `loginfail:ip:${ip}`;
  const dayKey = "loginfail:all";
  const perIp = num(env.LOGIN_FAILS_PER_IP, 5);
  const perDay = num(env.LOGIN_FAILS_PER_DAY, 50);
  if ((await current(env.DB, ipKey, now)) >= perIp) {
    return fail(429, "Too many wrong tries from this network. Wait 15 minutes and try again.");
  }
  if ((await current(env.DB, dayKey, now)) >= perDay) {
    return fail(429, "Sign-in is paused for today after too many wrong tries. Try again tomorrow (UTC).");
  }

  const address = canonicalAddress(String(body.address ?? ""));
  const box = address
    ? await env.DB.prepare("SELECT address, display_name FROM mailboxes WHERE address = ?1")
        .bind(address)
        .first<{ address: string; display_name: string }>()
    : null;
  const pinOk = await pinMatches(env, body.pin);
  if (!box || !pinOk) {
    await bump(env.DB, ipKey, IP_WINDOW_MS, now);
    await bump(env.DB, dayKey, DAY_MS, now);
    return fail(401, "That address and PIN don't match. Check both and try again.");
  }
  await clear(env.DB, ipKey);

  const token = randomToken(32);
  const csrf = randomToken(24);
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, mailbox, csrf, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)",
  )
    .bind(await sha256hex(token), box.address, csrf, now, now + SESSION_MS)
    .run();
  return json(
    { mailbox: box.address, name: box.display_name, csrf },
    { headers: { "Set-Cookie": cookie(token, SESSION_MS / 1000) } },
  );
}

export async function logout(env: Env, session: Session | null): Promise<Response> {
  if (session) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(session.tokenHash).run();
  return json({ ok: true }, { headers: { "Set-Cookie": cookie("", 0) } });
}
