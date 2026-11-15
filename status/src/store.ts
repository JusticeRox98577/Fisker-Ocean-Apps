/** Saving check results, tidying old ones, and reading them back for the page. */
import type { CheckResult, ServiceId } from "./checks";

export const HOUR = 3600_000;
export const DAY = 24 * HOUR;
/** Single checks and hourly totals are kept this long. */
export const RAW_KEEP_MS = 48 * HOUR;
/** Daily totals are kept this many days. */
export const DAILY_KEEP_DAYS = 90;

export function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function hourStart(ms: number): number {
  return Math.floor(ms / HOUR) * HOUR;
}

/** One batch per run: the raw row plus the hourly and daily totals for each service. */
export async function saveResults(db: D1Database, at: number, results: CheckResult[]): Promise<void> {
  const hour = hourStart(at);
  const day = dayKey(at);
  const statements: D1PreparedStatement[] = [];
  for (const r of results) {
    const up = r.ok ? 1 : 0;
    statements.push(
      db
        .prepare(
          "INSERT OR REPLACE INTO checks (at, service, ok, status, latency_ms, error) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .bind(at, r.service, up, r.status, r.latencyMs, r.error),
      db
        .prepare(
          "INSERT INTO hourly (hour, service, total, up) VALUES (?1, ?2, 1, ?3) " +
            "ON CONFLICT (hour, service) DO UPDATE SET total = total + 1, up = up + excluded.up",
        )
        .bind(hour, r.service, up),
      db
        .prepare(
          "INSERT INTO daily (day, service, total, up, latency_sum) VALUES (?1, ?2, 1, ?3, ?4) " +
            "ON CONFLICT (day, service) DO UPDATE SET total = total + 1, up = up + excluded.up, " +
            "latency_sum = latency_sum + excluded.latency_sum",
        )
        .bind(day, r.service, up, r.ok ? r.latencyMs : 0),
    );
  }
  await db.batch(statements);
}

/** Deletes single checks and hourly totals older than 48 hours, and daily totals older than 90 days. */
export async function cleanup(db: D1Database, now: number): Promise<void> {
  const rawCutoff = now - RAW_KEEP_MS;
  const dayCutoff = dayKey(now - (DAILY_KEEP_DAYS - 1) * DAY);
  await db.batch([
    db.prepare("DELETE FROM checks WHERE at < ?1").bind(rawCutoff),
    db.prepare("DELETE FROM hourly WHERE hour < ?1").bind(hourStart(rawCutoff)),
    db.prepare("DELETE FROM daily WHERE day < ?1").bind(dayCutoff),
  ]);
}

export interface LatestRow {
  at: number;
  service: ServiceId;
  ok: number;
  status: number | null;
  latency_ms: number;
  error: string | null;
}

export interface TotalRow {
  service: ServiceId;
  total: number;
  up: number;
}

/** The newest run's results. */
export async function latest(db: D1Database): Promise<LatestRow[]> {
  const { results } = await db
    .prepare(
      "SELECT at, service, ok, status, latency_ms, error FROM checks WHERE at = (SELECT MAX(at) FROM checks)",
    )
    .all<LatestRow>();
  return results;
}

export async function hours(db: D1Database, from: number): Promise<(TotalRow & { hour: number })[]> {
  const { results } = await db
    .prepare("SELECT hour, service, total, up FROM hourly WHERE hour >= ?1")
    .bind(from)
    .all<TotalRow & { hour: number }>();
  return results;
}

export async function days(db: D1Database, from: string): Promise<(TotalRow & { day: string; latency_sum: number })[]> {
  const { results } = await db
    .prepare("SELECT day, service, total, up, latency_sum FROM daily WHERE day >= ?1")
    .bind(from)
    .all<TotalRow & { day: string; latency_sum: number }>();
  return results;
}
