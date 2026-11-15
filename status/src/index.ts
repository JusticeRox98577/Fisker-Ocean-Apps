/**
 * Ocean Live Status (status.oceanlive.org).
 * - scheduled(): every 5 minutes, checks the website, the app server and mail, and saves the results.
 * - fetch(): GET /api/status, the JSON the page reads; everything else is the static page in public/.
 * No cookies, no sign-in, nothing about visitors is stored.
 */
import { checkAll } from "./checks";
import { type Env, num } from "./env";
import { buildStatus } from "./status";
import { cleanup, saveResults } from "./store";

const API_HEADERS: Record<string, string> = {
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function json(data: unknown, status = 200, cacheSeconds = 0): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...API_HEADERS, "Cache-Control": cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : "no-store" },
  });
}

async function statusAnswer(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const seconds = num(env.CACHE_SECONDS, 30);
  // The answer is the same for everyone, so it is shared for a few seconds to keep database reads low.
  const cache = seconds > 0 ? caches.default : null;
  const key = new Request(new URL("/api/status", req.url).toString());
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }
  const res = json(await buildStatus(env, Date.now()), 200, seconds);
  if (cache) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

/** Runs the checks and saves them. Exported for tests. */
export async function run(env: Env, at: number, fetcher: typeof fetch = fetch): Promise<void> {
  const results = await checkAll(env, fetcher);
  await saveResults(env.DB, at, results);
  // Tidy up once an hour (the first run of each hour).
  if (new Date(at).getUTCMinutes() < 5) await cleanup(env.DB, at);
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      if (url.pathname !== "/api/status") return json({ error: "Not found." }, 404);
      if (req.method !== "GET" && req.method !== "HEAD") {
        const res = json({ error: "Use GET." }, 405);
        res.headers.set("Allow", "GET, HEAD");
        return res;
      }
      try {
        return await statusAnswer(req, env, ctx);
      } catch (e) {
        console.error("status error", e instanceof Error ? e.stack : e);
        return json({ error: "Could not read the status. Try again in a minute." }, 500);
      }
    }
    return env.ASSETS.fetch(req);
  },

  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    await run(env, event.scheduledTime);
  },
};
