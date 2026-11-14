export interface Env {
  DB: D1Database;
  STORE: R2Bucket;
  ASSETS: Fetcher;
  MAIL_DOMAIN: string;
  LOGIN_FAILS_PER_IP: string;
  LOGIN_FAILS_PER_DAY: string;
  SEND_PER_HOUR: string;
  SEND_PER_DAY: string;
  MAX_RECIPIENTS: string;
  TRASH_DAYS: string;
  /** Secret: the PIN for every mailbox. */
  MAIL_PIN?: string;
  /** Secret: Resend API key. */
  RESEND_API_KEY?: string;
  /** Tests only: replaces the Resend API call. */
  RESEND_FETCH?: typeof fetch;
}

export interface Session {
  mailbox: string;
  csrf: string;
  tokenHash: string;
}

export function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
