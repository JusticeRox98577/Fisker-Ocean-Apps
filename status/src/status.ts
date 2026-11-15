/** Builds the /api/status answer the page shows. */
import { services, type ServiceId } from "./checks";
import type { Env } from "./env";
import { DAILY_KEEP_DAYS, DAY, HOUR, dayKey, days, hourStart, hours, latest } from "./store";

/** Checks run every 5 minutes; older than this and the page says results are late. */
export const STALE_MS = 15 * 60_000;

export type State = "up" | "down" | "unknown";

export interface Bucket {
  /** Hour start (ms) for the 24-hour bar, YYYY-MM-DD for the 90-day bar. */
  start: number | string;
  total: number;
  up: number;
}

export interface ServiceStatus {
  id: ServiceId;
  name: string;
  about: string;
  state: State;
  latencyMs: number | null;
  error: string | null;
  checkedAt: number | null;
  /** Share of checks that were up, 0 to 1, or null with no checks. */
  uptime24h: number | null;
  uptime90d: number | null;
  /** Oldest first: 24 hours, then 90 days. */
  last24h: Bucket[];
  last90d: Bucket[];
}

export interface StatusAnswer {
  generatedAt: number;
  checkedAt: number | null;
  stale: boolean;
  overall: "up" | "partial" | "down" | "unknown";
  notice: string;
  services: ServiceStatus[];
}

function share(buckets: Bucket[]): number | null {
  let total = 0;
  let up = 0;
  for (const b of buckets) {
    total += b.total;
    up += b.up;
  }
  return total ? up / total : null;
}

export async function buildStatus(env: Env, now: number): Promise<StatusAnswer> {
  const firstHour = hourStart(now) - 23 * HOUR;
  const firstDay = dayKey(now - (DAILY_KEEP_DAYS - 1) * DAY);
  const [newest, hourRows, dayRows] = await Promise.all([
    latest(env.DB),
    hours(env.DB, firstHour),
    days(env.DB, firstDay),
  ]);

  const checkedAt = newest.length ? newest[0].at : null;
  const stale = checkedAt === null || now - checkedAt > STALE_MS;

  const list = services(env).map((s): ServiceStatus => {
    const row = newest.find((r) => r.service === s.id);
    const last24h: Bucket[] = [];
    for (let i = 0; i < 24; i++) {
      const start = firstHour + i * HOUR;
      const h = hourRows.find((r) => r.service === s.id && r.hour === start);
      last24h.push({ start, total: h?.total ?? 0, up: h?.up ?? 0 });
    }
    const last90d: Bucket[] = [];
    for (let i = DAILY_KEEP_DAYS - 1; i >= 0; i--) {
      const start = dayKey(now - i * DAY);
      const d = dayRows.find((r) => r.service === s.id && r.day === start);
      last90d.push({ start, total: d?.total ?? 0, up: d?.up ?? 0 });
    }
    return {
      id: s.id,
      name: s.name,
      about: s.about,
      state: !row || stale ? "unknown" : row.ok ? "up" : "down",
      latencyMs: row && row.ok ? row.latency_ms : null,
      error: row && !row.ok ? row.error : null,
      checkedAt: row ? row.at : null,
      uptime24h: share(last24h),
      uptime90d: share(last90d),
      last24h,
      last90d,
    };
  });

  const states = list.map((s) => s.state);
  const overall = states.includes("unknown")
    ? "unknown"
    : states.every((s) => s === "up")
      ? "up"
      : states.every((s) => s === "down")
        ? "down"
        : "partial";

  return {
    generatedAt: now,
    checkedAt,
    stale,
    overall,
    notice: (env.NOTICE ?? "").trim().slice(0, 500),
    services: list,
  };
}
