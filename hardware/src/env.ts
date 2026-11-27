/** The mail Worker's Notify entry point (mail/src/notify.ts). */
export interface MailService {
  send(notice: { from: string; to: string; subject: string; text: string }): Promise<{ ok: true } | { ok: false; error: string }>;
}

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** The only address that can sign in to /admin. */
  ADMIN_EMAIL: string;
  /** Sends the emails: a service binding to the mail Worker. */
  MAIL?: MailService;
  /** Sender of the sign-in and invitation emails: a mailbox in the mail Worker. */
  MAIL_FROM: string;
  /** This site, for links in emails. */
  SITE_URL: string;
  /** How many test boards there are: open invitations plus acceptances can't go above this. */
  BOARDS?: string;
  /** Sign-ups allowed per network per hour. */
  PER_IP_PER_HOUR?: string;
  /** "true" closes the form. */
  CLOSED?: string;
  /** Seconds the public counters are reused (0: never). */
  STATS_CACHE_SECONDS?: string;
}

export function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function isClosed(env: Env): boolean {
  return String(env.CLOSED ?? "").trim().toLowerCase() === "true";
}

export const boards = (env: Env) => Math.floor(num(env.BOARDS, 4));
