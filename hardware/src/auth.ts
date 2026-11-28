/**
 * Admin sign-in for /admin. There is no password: the page asks for a one-time link, which is
 * emailed to ADMIN_EMAIL and nowhere else, so only whoever reads that mailbox can get in.
 *
 * The link carries its token in the #fragment (it never reaches server logs). The page swaps it for
 * a session: a random token in an HttpOnly, Secure, SameSite=Strict cookie. Only hashes of link and
 * session tokens are stored. Every admin change must also come from a page on this site.
 */
import type { Env } from "./env";
import { sendEmail } from "./mail";
import { bump, getCookie, json, randomToken, readJson, sameOrigin, sha256, tokenFrom } from "./util";

export const COOKIE = "__Host-olhw";
const LINK_MS = 15 * 60 * 1000;
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
/** Sign-in emails per hour from one network, and in total. The per-network cap stops one visitor from
 * using up the total and locking the admin out for the hour. */
const LINKS_PER_IP_PER_HOUR = 3;
const LINKS_PER_HOUR = 10;

function cookie(value: string, maxAgeSec: number): string {
  return `${COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}`;
}

export async function isSignedIn(req: Request, env: Env, now: number): Promise<boolean> {
  const token = tokenFrom(getCookie(req, COOKIE));
  if (!token) return false;
  const row = await env.DB.prepare("SELECT 1 AS ok FROM sessions WHERE token_hash = ?1 AND expires_at > ?2")
    .bind(await sha256(token), now)
    .first();
  return row !== null;
}

/** POST /api/admin/login: emails a sign-in link to ADMIN_EMAIL. The answer is the same whoever asks. */
export async function requestLink(req: Request, env: Env, now: number): Promise<Response> {
  if (!sameOrigin(req)) return json({ error: "Not allowed." }, 403);
  const sent = { ok: true, to: maskEmail(env.ADMIN_EMAIL) };
  const ip = req.headers.get("CF-Connecting-IP");
  if (ip && (await bump(env.DB, `admin-links:${await sha256(`hardware:${ip}`)}`, HOUR, now)) > LINKS_PER_IP_PER_HOUR) {
    return json({ error: "Too many sign-in emails this hour. Use the last one, or try again later." }, 429);
  }
  if ((await bump(env.DB, "admin-links", HOUR, now)) > LINKS_PER_HOUR) {
    return json({ error: "Too many sign-in emails this hour. Use the last one, or try again later." }, 429);
  }
  const token = randomToken();
  await env.DB.prepare("INSERT INTO login_links (token_hash, expires_at) VALUES (?1, ?2)")
    .bind(await sha256(token), now + LINK_MS)
    .run();
  const link = `${env.SITE_URL}/admin#login=${token}`;
  const r = await sendEmail(env, { label: "Admin sign-in",
    to: env.ADMIN_EMAIL,
    subject: "Sign in to the Nova beta admin",
    text:
      `Here's your link to sign in to the Nova beta admin page:\n\n${link}\n\n` +
      `It works once, for 15 minutes. If you didn't ask for it, ignore this email: nobody can sign in without it.`,
  });
  if (!r.ok) return json({ error: r.error }, 502);
  return json(sent);
}

/** POST /api/admin/session { token }: swaps a sign-in link for a session cookie. */
export async function startSession(req: Request, env: Env, now: number): Promise<Response> {
  if (!sameOrigin(req)) return json({ error: "Not allowed." }, 403);
  const body = await readJson(req);
  const token = body && body !== "too-big" ? tokenFrom(body.token) : "";
  if (!token) return json({ error: "That sign-in link isn't valid. Ask for a new one." }, 400);
  const used = await env.DB.prepare("DELETE FROM login_links WHERE token_hash = ?1 AND expires_at > ?2 RETURNING 1 AS ok")
    .bind(await sha256(token), now)
    .first();
  if (!used) return json({ error: "That sign-in link has expired or was already used. Ask for a new one." }, 401);
  const session = randomToken();
  await env.DB.prepare("INSERT INTO sessions (token_hash, expires_at) VALUES (?1, ?2)")
    .bind(await sha256(session), now + SESSION_MS)
    .run();
  return json({ ok: true }, 200, { "Set-Cookie": cookie(session, SESSION_MS / 1000) });
}

/** POST /api/admin/logout */
export async function endSession(req: Request, env: Env): Promise<Response> {
  const token = tokenFrom(getCookie(req, COOKIE));
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(await sha256(token)).run();
  return json({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
}

/** j•••••@oceanlive.org: enough to recognise, not enough to copy. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "the admin address";
  return `${user.slice(0, 1)}${"•".repeat(Math.max(3, user.length - 1))}@${domain}`;
}
