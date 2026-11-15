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
  /** Mailing list: the public site (links in emails), sender, reply address, postal address for the footer. */
  LIST_SITE: string;
  LIST_FROM: string;
  LIST_REPLY_TO: string;
  /** Secret, optional: postal address for the news email footer. */
  LIST_POSTAL_ADDRESS?: string;
  /** Optional host for the RFC 8058 one-click unsubscribe URL (default: LIST_SITE). */
  LIST_UNSUB_BASE?: string;
  /** Mailing list limits. */
  LIST_SEND_PER_DAY: string;
  LIST_BATCH: string;
  LIST_SIGNUPS_PER_IP_HOUR: string;
  LIST_CONFIRMS_PER_DAY: string;
  /** Secret: the PIN for every mailbox. */
  MAIL_PIN?: string;
  /** Optional secret: salt for the hashed per-network sign-up counter (falls back to RESEND_API_KEY). */
  LIST_IP_SALT?: string;
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
