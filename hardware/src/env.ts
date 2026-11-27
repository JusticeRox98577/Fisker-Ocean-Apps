export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Sign-ups allowed per network per hour. */
  PER_IP_PER_HOUR?: string;
  /** "true" closes the form. */
  CLOSED?: string;
  /** Secret: unlocks GET/DELETE /api/responses. Not set: those answer 404. */
  ADMIN_TOKEN?: string;
}

export function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function isClosed(env: Env): boolean {
  return String(env.CLOSED ?? "").trim().toLowerCase() === "true";
}
