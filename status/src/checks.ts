/** The services on the page and how each one is checked. */
import type { Env } from "./env";

export type ServiceId = "site" | "api" | "mail";

export interface Service {
  id: ServiceId;
  name: string;
  /** What the service is, shown under its name. */
  about: string;
  url: string;
  /** "page": a 200 answer is enough. "health": a 200 JSON answer with ok: true. */
  kind: "page" | "health";
}

export interface CheckResult {
  service: ServiceId;
  ok: boolean;
  status: number | null;
  latencyMs: number;
  error: string | null;
}

export const TIMEOUT_MS = 8000;
const USER_AGENT = "OceanLiveStatus/1.0 (+https://status.oceanlive.org)";

export function services(env: Env): Service[] {
  return [
    { id: "site", name: "Website", about: "oceanlive.org", url: env.SITE_URL, kind: "page" },
    { id: "api", name: "App server", about: "Ask, sign-in and accounts in the app", url: env.API_URL, kind: "health" },
    { id: "mail", name: "Email", about: "Sign-in codes and replies from Ocean Live", url: env.MAIL_URL, kind: "health" },
  ];
}

/** One request with a time limit. Never throws: a failure is a result with ok false. */
export async function checkOnce(service: Service, fetcher: typeof fetch = fetch): Promise<CheckResult> {
  const started = Date.now();
  const done = (ok: boolean, status: number | null, error: string | null): CheckResult => ({
    service: service.id,
    ok,
    status,
    latencyMs: Math.max(0, Date.now() - started),
    error,
  });
  try {
    const res = await fetcher(service.url, {
      headers: { "User-Agent": USER_AGENT, Accept: service.kind === "health" ? "application/json" : "text/html" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status !== 200) {
      await res.body?.cancel();
      return done(false, res.status, `HTTP ${res.status}`);
    }
    if (service.kind === "page") {
      await res.body?.cancel();
      return done(true, 200, null);
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return done(false, 200, "Not a health answer");
    }
    const ok = typeof body === "object" && body !== null && (body as { ok?: unknown }).ok === true;
    return done(ok, 200, ok ? null : "Health check says not ok");
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") return done(false, null, "No answer in 8 seconds");
    return done(false, null, "Could not connect");
  }
}

/** Checks a service, trying once more after a failure so one dropped request is not shown as an outage. */
export async function check(service: Service, fetcher: typeof fetch = fetch): Promise<CheckResult> {
  const first = await checkOnce(service, fetcher);
  if (first.ok) return first;
  const second = await checkOnce(service, fetcher);
  return second.ok ? second : first;
}

export async function checkAll(env: Env, fetcher: typeof fetch = fetch): Promise<CheckResult[]> {
  return Promise.all(services(env).map((s) => check(s, fetcher)));
}
