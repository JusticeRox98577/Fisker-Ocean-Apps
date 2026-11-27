/**
 * Emails go out through the mail Worker (mail/, ocean-live-mail) over a service binding, so this
 * Worker needs no Resend key. They're sent from MAIL_FROM, a mailbox there, and a copy of each is
 * kept in that mailbox's Sent folder in webmail.
 */
import type { Env } from "./env";

export interface Email {
  to: string;
  subject: string;
  /** Plain text, paragraphs separated by blank lines. Links are written out in full. */
  text: string;
}

export async function sendEmail(env: Env, email: Email): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!env.MAIL) return { ok: false, error: "Email isn't set up: the MAIL service binding is missing." };
  try {
    const r = await env.MAIL.send({ from: env.MAIL_FROM, ...email });
    return r.ok ? { ok: true } : { ok: false, error: r.error || "The mail service didn't send it." };
  } catch (e) {
    console.error("mail service error", e instanceof Error ? e.message : e);
    return { ok: false, error: "Couldn't reach the mail service. Nothing was sent; try again." };
  }
}
