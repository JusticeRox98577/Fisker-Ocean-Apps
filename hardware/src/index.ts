/**
 * Ocean Live Hardware (hardware.oceanlive.org): the Nova beta tester sign-up.
 *
 *   GET    /api/info        { open }                      whether the form takes sign-ups
 *   POST   /api/signup      { email, consent, features, ... } -> { ok: true }
 *   GET    /api/responses   admin (Authorization: Bearer ADMIN_TOKEN): every answer as CSV;
 *                           ?format=json for JSON, ?format=summary for the feature ranking
 *   DELETE /api/responses?email=...   admin: removes one person's answer
 *
 * Everything else is the static page in public/. No cookies; the only thing kept about a visitor who
 * doesn't sign up is a hashed network address in a counter that expires after an hour.
 */
import { type Env, isClosed, num } from "./env";
import { checkSignUp } from "./form";
import { allRows, bump, cleanupCounters, deleteSignUp, saveSignUp, tally, toCsv } from "./store";

const HOUR = 60 * 60 * 1000;
const MAX_BODY = 16 * 1024;

const API_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...API_HEADERS, "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}

const notFound = () => json({ error: "Not found." }, 404);
const wrongMethod = (allow: string) => json({ error: `Use ${allow.split(", ")[0]}.` }, 405, { Allow: allow });

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time comparison of the admin token. */
async function isAdmin(req: Request, env: Env): Promise<boolean> {
  const token = env.ADMIN_TOKEN ?? "";
  if (token.length < 16) return false;
  const given = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const [a, b] = await Promise.all([sha256(given), sha256(token)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function signUp(req: Request, env: Env, ctx: ExecutionContext, now: number): Promise<Response> {
  if (isClosed(env)) return json({ error: "Sign-ups for the beta are closed for now." }, 403);
  if (!(req.headers.get("Content-Type") ?? "").toLowerCase().startsWith("application/json")) {
    return json({ error: "Send JSON." }, 415);
  }
  // Only this page may post here.
  const origin = req.headers.get("Origin");
  if (origin && origin !== new URL(req.url).origin) return json({ error: "Not allowed." }, 403);

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: "That's too long. Shorten the notes and try again." }, 413);
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed;
  } catch {
    return json({ error: "Something went wrong. Reload the page and try again." }, 400);
  }

  // Honeypot: people never see this field, so anything in it is a bot. Answer as if it worked.
  if (String(body.website ?? "").trim()) return json({ ok: true });

  const checked = checkSignUp(body);
  if (!checked.ok) return json({ error: checked.error }, 400);

  const ip = req.headers.get("CF-Connecting-IP");
  if (ip) {
    const count = await bump(env.DB, `ip:${await sha256(`hardware:${ip}`)}`, HOUR, now);
    if (count > num(env.PER_IP_PER_HOUR, 5)) {
      return json({ error: "Too many sign-ups from this network. Please try again in an hour." }, 429);
    }
  }

  await saveSignUp(env.DB, checked.value, now);
  ctx.waitUntil(cleanupCounters(env.DB, now).catch(() => {}));
  return json({ ok: true });
}

async function responses(req: Request, env: Env): Promise<Response> {
  // Without a token set, the admin endpoints don't exist.
  if (!(env.ADMIN_TOKEN && env.ADMIN_TOKEN.length >= 16)) return notFound();
  if (!(await isAdmin(req, env))) {
    return json({ error: "Wrong or missing token." }, 401, { "WWW-Authenticate": 'Bearer realm="hardware"' });
  }
  const url = new URL(req.url);
  if (req.method === "DELETE") {
    const email = url.searchParams.get("email") ?? "";
    if (!email) return json({ error: "Add ?email=" }, 400);
    return json({ ok: true, deleted: await deleteSignUp(env.DB, email) });
  }
  const rows = await allRows(env.DB);
  const format = url.searchParams.get("format") ?? "csv";
  if (format === "json") return json({ responses: rows });
  if (format === "summary") return json(tally(rows));
  const day = new Date().toISOString().slice(0, 10);
  return new Response(toCsv(rows), {
    headers: {
      ...API_HEADERS,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="nova-beta-${day}.csv"`,
    },
  });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    try {
      switch (url.pathname) {
        case "/api/info":
          if (req.method !== "GET" && req.method !== "HEAD") return wrongMethod("GET, HEAD");
          return json({ open: !isClosed(env) });
        case "/api/signup":
          if (req.method !== "POST") return wrongMethod("POST");
          return await signUp(req, env, ctx, Date.now());
        case "/api/responses":
          if (req.method !== "GET" && req.method !== "DELETE") return wrongMethod("GET, DELETE");
          return await responses(req, env);
        default:
          return notFound();
      }
    } catch (e) {
      console.error("hardware error", e instanceof Error ? e.stack : e);
      return json({ error: "Something went wrong on our side. Please try again in a minute." }, 500);
    }
  },
};
