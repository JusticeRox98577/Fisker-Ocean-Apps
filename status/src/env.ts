export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** The addresses checked. */
  SITE_URL: string;
  API_URL: string;
  MAIL_URL: string;
  /** Optional message shown at the top of the page. */
  NOTICE?: string;
  /** Seconds a /api/status answer is reused (0: never). */
  CACHE_SECONDS?: string;
}

export function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
