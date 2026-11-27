/**
 * Ocean Live Hardware (hardware.oceanlive.org): the Nova beta tester sign-up.
 *
 * Public:
 *   GET  /api/info            { open }                   whether the form takes sign-ups
 *   GET  /api/stats           { responses, interest, boards, spokenFor }   counts only
 *   POST /api/signup          { email, consent, features, ... } -> { ok: true }
 *   POST /api/invite          { token }                  the yes/no page for a picked tester
 *   POST /api/invite/answer   { token, answer }
 *
 * Admin (only ADMIN_EMAIL, see auth.ts):
 *   POST /api/admin/login     emails a one-time sign-in link to ADMIN_EMAIL
 *   POST /api/admin/session   { token } -> session cookie
 *   POST /api/admin/logout
 *   GET  /api/admin/responses ?format=csv|json|summary
 *   POST /api/admin/pick      { email }   invite (or re-send the invitation)
 *   POST /api/admin/unpick    { email }   free their board
 *   POST /api/admin/delete    { email }   remove their answer
 *
 * Everything else is the static pages in public/. No cookies for visitors; the only thing kept about
 * someone who doesn't sign up is a hashed network address in a counter that expires after an hour.
 */
import { endSession, isSignedIn, requestLink, startSession } from "./auth";
import { type Env, boards, isClosed, num } from "./env";
import { checkSignUp } from "./form";
import { allRows, deleteSignUp, publicStats, saveSignUp, tally, toCsv } from "./store";
import { inviteAnswer, inviteInfo, pick, unpick } from "./testers";
import { bump, cleanup, json, plainHeaders, readJson, sameOrigin, sha256, tokenFrom } from "./util";

const HOUR = 60 * 60 * 1000;

const notFound = () => json({ error: "Not found." }, 404);
const wrongMethod = (allow: string) => json({ error: `Use ${allow.split(", ")[0]}.` }, 405, { Allow: allow });
const badBody = () => json({ error: "Something went wrong. Reload the page and try again." }, 400);

async function signUp(req: Request, env: Env, ctx: ExecutionContext, now: number): Promise<Response> {
  if (isClosed(env)) return json({ error: "Sign-ups for the beta are closed for now." }, 403);
  if (!sameOrigin(req)) return json({ error: "Not allowed." }, 403);
  if (!(req.headers.get("Content-Type") ?? "").toLowerCase().startsWith("application/json")) {
    return json({ error: "Send JSON." }, 415);
  }
  const body = await readJson(req);
  if (body === "too-big") return json({ error: "That's too long. Shorten the notes and try again." }, 413);
  if (!body) return badBody();

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
  ctx.waitUntil(cleanup(env.DB, now).catch(() => {}));
  return json({ ok: true });
}

async function stats(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const seconds = num(env.STATS_CACHE_SECONDS, 60);
  // The same for everyone, so it's shared for a minute to keep database reads low.
  const cache = seconds > 0 ? caches.default : null;
  const key = new Request(new URL("/api/stats", req.url).toString());
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }
  const res = json(await publicStats(env.DB, boards(env)), 200, { "Cache-Control": `public, max-age=${seconds}` });
  if (cache) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

async function invite(req: Request, env: Env, ctx: ExecutionContext, now: number, answer: boolean): Promise<Response> {
  if (!sameOrigin(req)) return json({ error: "Not allowed." }, 403);
  const body = await readJson(req);
  if (!body || body === "too-big") return badBody();
  const ip = req.headers.get("CF-Connecting-IP");
  if (ip && (await bump(env.DB, `invite:${await sha256(`hardware:${ip}`)}`, HOUR, now)) > 30) {
    return json({ error: "Too many tries. Please wait an hour." }, 429);
  }
  const token = tokenFrom(body.token);
  return answer ? inviteAnswer(env, ctx, token, body.answer, now) : inviteInfo(env, token);
}

async function admin(req: Request, env: Env, ctx: ExecutionContext, path: string, now: number): Promise<Response> {
  if (path === "/api/admin/login") return req.method === "POST" ? requestLink(req, env, now) : wrongMethod("POST");
  if (path === "/api/admin/session") return req.method === "POST" ? startSession(req, env, now) : wrongMethod("POST");
  if (path === "/api/admin/logout") return req.method === "POST" ? endSession(req, env) : wrongMethod("POST");

  if (!(await isSignedIn(req, env, now))) return json({ error: "Sign in first." }, 401);

  if (path === "/api/admin/responses") {
    if (req.method !== "GET") return wrongMethod("GET");
    const rows = await allRows(env.DB);
    const format = new URL(req.url).searchParams.get("format") ?? "csv";
    if (format === "json") return json({ responses: rows, boards: boards(env) });
    if (format === "summary") return json(tally(rows));
    const day = new Date(now).toISOString().slice(0, 10);
    return new Response(toCsv(rows), {
      headers: plainHeaders({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="nova-beta-${day}.csv"`,
      }),
    });
  }

  const actions: Record<string, (email: string) => Promise<Response>> = {
    "/api/admin/pick": (email) => pick(env, email, now),
    "/api/admin/unpick": (email) => unpick(env, email),
    "/api/admin/delete": async (email) => json({ ok: true, deleted: await deleteSignUp(env.DB, email) }),
  };
  const action = actions[path];
  if (!action) return notFound();
  if (req.method !== "POST") return wrongMethod("POST");
  // Changes only from the admin page itself (the cookie is SameSite=Strict as well).
  if (!sameOrigin(req)) return json({ error: "Not allowed." }, 403);
  const body = await readJson(req);
  if (!body || body === "too-big" || typeof body.email !== "string" || !body.email) return badBody();
  const res = await action(body.email);
  ctx.waitUntil(caches.default.delete(new Request(new URL("/api/stats", req.url).toString())).catch(() => false));
  return res;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    const now = Date.now();
    try {
      if (url.pathname.startsWith("/api/admin/")) return await admin(req, env, ctx, url.pathname, now);
      switch (url.pathname) {
        case "/api/info":
          if (req.method !== "GET" && req.method !== "HEAD") return wrongMethod("GET, HEAD");
          return json({ open: !isClosed(env) });
        case "/api/stats":
          if (req.method !== "GET" && req.method !== "HEAD") return wrongMethod("GET, HEAD");
          return await stats(req, env, ctx);
        case "/api/signup":
          if (req.method !== "POST") return wrongMethod("POST");
          return await signUp(req, env, ctx, now);
        case "/api/invite":
        case "/api/invite/answer":
          if (req.method !== "POST") return wrongMethod("POST");
          return await invite(req, env, ctx, now, url.pathname.endsWith("/answer"));
        default:
          return notFound();
      }
    } catch (e) {
      console.error("hardware error", e instanceof Error ? e.stack : e);
      return json({ error: "Something went wrong on my side. Please try again in a minute." }, 500);
    }
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await cleanup(env.DB, Date.now());
  },
};
