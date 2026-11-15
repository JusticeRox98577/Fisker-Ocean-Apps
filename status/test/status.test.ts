import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { check, checkOnce, services, type CheckResult } from "../src/checks";
import worker, { run } from "../src/index";
import type { StatusAnswer } from "../src/status";
import { DAY, HOUR, cleanup, dayKey, saveResults } from "../src/store";

const ORIGIN = "https://status.oceanlive.org";
const site = services(env)[0];
const api = services(env)[1];

/** A fake fetch that answers per URL and records what was asked. */
function fakeFetch(answers: Record<string, () => Response | Promise<Response>>) {
  const calls: string[] = [];
  const fn = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    const answer = answers[url];
    if (!answer) throw new TypeError("connection refused");
    return answer();
  }) as typeof fetch;
  return { fn, calls };
}

const healthy = () => Response.json({ ok: true, service: "x" });
const allUp = () =>
  fakeFetch({
    [env.SITE_URL]: () => new Response("<html></html>", { status: 200 }),
    [env.API_URL]: healthy,
    [env.MAIL_URL]: healthy,
  });

async function getStatus(): Promise<StatusAnswer> {
  const res = await SELF.fetch(`${ORIGIN}/api/status`);
  expect(res.status).toBe(200);
  return res.json();
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM checks"),
    env.DB.prepare("DELETE FROM hourly"),
    env.DB.prepare("DELETE FROM daily"),
  ]);
});

describe("a single check", () => {
  it("counts a 200 page as up and records latency", async () => {
    const r = await checkOnce(site, allUp().fn);
    expect(r).toMatchObject({ service: "site", ok: true, status: 200, error: null });
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("needs ok: true from a health address", async () => {
    const bad = fakeFetch({ [env.API_URL]: () => Response.json({ ok: false }) });
    expect(await checkOnce(api, bad.fn)).toMatchObject({ ok: false, status: 200, error: "Health check says not ok" });
    const notJson = fakeFetch({ [env.API_URL]: () => new Response("<html>challenge</html>") });
    expect(await checkOnce(api, notJson.fn)).toMatchObject({ ok: false, error: "Not a health answer" });
  });

  it("counts other statuses and network errors as down", async () => {
    const f = fakeFetch({ [env.SITE_URL]: () => new Response("busy", { status: 503 }) });
    expect(await checkOnce(site, f.fn)).toMatchObject({ ok: false, status: 503, error: "HTTP 503" });
    expect(await checkOnce(api, f.fn)).toMatchObject({ ok: false, status: null, error: "Could not connect" });
  });

  it("reports a timeout", async () => {
    const slow = (async () => {
      const e = new Error("timed out");
      e.name = "TimeoutError";
      throw e;
    }) as typeof fetch;
    expect(await checkOnce(site, slow)).toMatchObject({ ok: false, error: "No answer in 8 seconds" });
  });

  it("tries once more after a failure", async () => {
    let n = 0;
    const flaky = (async () => (++n === 1 ? new Response("", { status: 502 }) : new Response("ok"))) as typeof fetch;
    expect(await check(site, flaky)).toMatchObject({ ok: true });
    expect(n).toBe(2);
  });
});

describe("runs and the status answer", () => {
  it("has no data before the first run", async () => {
    const s = await getStatus();
    expect(s.overall).toBe("unknown");
    expect(s.checkedAt).toBeNull();
    expect(s.services.map((x) => x.id)).toEqual(["site", "api", "mail"]);
    for (const x of s.services) {
      expect(x.last24h).toHaveLength(24);
      expect(x.last90d).toHaveLength(90);
      expect(x.uptime24h).toBeNull();
    }
  });

  it("shows everything up after a good run", async () => {
    const f = allUp();
    await run(env, Date.now(), f.fn);
    expect(f.calls.sort()).toEqual([env.API_URL, env.MAIL_URL, env.SITE_URL].sort());
    const s = await getStatus();
    expect(s.overall).toBe("up");
    expect(s.stale).toBe(false);
    for (const x of s.services) {
      expect(x.state).toBe("up");
      expect(x.uptime24h).toBe(1);
      expect(x.uptime90d).toBe(1);
      expect(x.last24h.at(-1)).toMatchObject({ total: 1, up: 1 });
      expect(x.last90d.at(-1)).toMatchObject({ start: dayKey(Date.now()), total: 1, up: 1 });
    }
  });

  it("shows a partial outage and the reason", async () => {
    const now = Date.now();
    await run(env, now - 5 * 60_000, allUp().fn);
    const f = fakeFetch({ [env.SITE_URL]: () => new Response("x"), [env.MAIL_URL]: healthy });
    await run(env, now, f.fn);
    const s = await getStatus();
    expect(s.overall).toBe("partial");
    const a = s.services.find((x) => x.id === "api")!;
    expect(a).toMatchObject({ state: "down", error: "Could not connect", latencyMs: null, uptime24h: 0.5 });
  });

  it("says down when every service fails", async () => {
    await run(env, Date.now(), fakeFetch({}).fn);
    expect((await getStatus()).overall).toBe("down");
  });

  it("marks results as late when the last run is old", async () => {
    await run(env, Date.now() - 30 * 60_000, allUp().fn);
    const s = await getStatus();
    expect(s.stale).toBe(true);
    expect(s.overall).toBe("unknown");
    expect(s.services[0].uptime24h).toBe(1);
  });

  it("adds runs in the same hour and day together", async () => {
    const base = Math.floor(Date.now() / HOUR) * HOUR;
    const ok: CheckResult[] = [{ service: "site", ok: true, status: 200, latencyMs: 100, error: null }];
    const bad: CheckResult[] = [{ service: "site", ok: false, status: 500, latencyMs: 40, error: "HTTP 500" }];
    await saveResults(env.DB, base + 60_000, ok);
    await saveResults(env.DB, base + 120_000, ok);
    await saveResults(env.DB, base + 180_000, bad);
    const h = await env.DB.prepare("SELECT total, up FROM hourly WHERE hour = ?1 AND service = 'site'").bind(base).first();
    expect(h).toEqual({ total: 3, up: 2 });
    const d = await env.DB.prepare("SELECT total, up, latency_sum FROM daily WHERE day = ?1 AND service = 'site'")
      .bind(dayKey(base))
      .first();
    expect(d).toEqual({ total: 3, up: 2, latency_sum: 200 });
  });

  it("shows the owner's notice", async () => {
    const res = await worker.fetch(
      new Request(`${ORIGIN}/api/status`),
      { ...env, NOTICE: "  Planned work on Sunday.  " },
      { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
    );
    expect(((await res.json()) as StatusAnswer).notice).toBe("Planned work on Sunday.");
    expect((await getStatus()).notice).toBe("");
  });
});

describe("clean-up", () => {
  it("keeps single checks and hourly totals 48 hours and daily totals 90 days", async () => {
    const now = Date.UTC(2026, 10, 15, 12, 0, 0);
    const r: CheckResult[] = [{ service: "site", ok: true, status: 200, latencyMs: 10, error: null }];
    for (const at of [now - 49 * HOUR, now - 47 * HOUR, now - 89 * DAY, now - 91 * DAY]) await saveResults(env.DB, at, r);
    await cleanup(env.DB, now);
    const checks = await env.DB.prepare("SELECT at FROM checks ORDER BY at").all<{ at: number }>();
    expect(checks.results.map((x) => x.at)).toEqual([now - 47 * HOUR]);
    const hours = await env.DB.prepare("SELECT hour FROM hourly ORDER BY hour").all<{ hour: number }>();
    expect(hours.results.map((x) => x.hour)).toEqual([now - 47 * HOUR]);
    const days = await env.DB.prepare("SELECT day FROM daily ORDER BY day").all<{ day: string }>();
    expect(days.results.map((x) => x.day)).toEqual([dayKey(now - 89 * DAY), dayKey(now - 48 * HOUR)]); // 49 and 47 hours ago are the same UTC day
  });

  it("runs only in the first run of each hour", async () => {
    const top = Date.UTC(2026, 10, 15, 12, 0, 0);
    const old: CheckResult[] = [{ service: "site", ok: true, status: 200, latencyMs: 10, error: null }];
    await saveResults(env.DB, top - 72 * HOUR, old);
    await run(env, top + 20 * 60_000, allUp().fn);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM checks WHERE at < ?1").bind(top - 48 * HOUR).first("n")).toBe(1);
    await run(env, top + 60 * 60_000, allUp().fn);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM checks WHERE at < ?1").bind(top - 48 * HOUR).first("n")).toBe(0);
  });
});

describe("the web side", () => {
  it("answers unknown /api paths and other methods with JSON errors", async () => {
    const a = await SELF.fetch(`${ORIGIN}/api/nope`);
    expect(a.status).toBe(404);
    expect(await a.json()).toEqual({ error: "Not found." });
    const b = await SELF.fetch(`${ORIGIN}/api/status`, { method: "POST" });
    expect(b.status).toBe(405);
  });

  it("sends no cookies and no caching when CACHE_SECONDS is 0", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/status`);
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Type")).toContain("application/json");
    await res.body?.cancel();
  });

  it("serves the page with a strict CSP", async () => {
    const res = await SELF.fetch(`${ORIGIN}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Ocean Live Status");
    expect(html).not.toMatch(/<script>(?!<)|<style|\son\w+=/i);
    expect(html).not.toMatch(/https?:\/\/(?!oceanlive\.org)[^"]*\.(js|css|woff2)/);
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self';");
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });
});
