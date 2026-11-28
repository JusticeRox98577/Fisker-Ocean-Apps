/**
 * Sending for other Ocean Live Workers, over a service binding (never reachable from the internet).
 * The hardware beta (hardware/) uses it for its sign-in links and tester invitations, so it needs no
 * Resend key of its own.
 *
 *   env.MAIL.send({ from: "justice@oceanlive.org", to: "someone@example.com", subject, text, label? })
 *
 * The text is sent as is, plus the branded HTML version every oceanlive.org email gets (src/letter.ts).
 *
 * It goes through the same path as webmail: `from` must be a mailbox here, the same sending limits
 * apply, and a copy is kept in that mailbox's Sent folder. One recipient per email.
 */
import { WorkerEntrypoint } from "cloudflare:workers";
import type { Env } from "./env";
import { sendMail } from "./send";
import { canonicalAddress, isValidAddress } from "./util";

export interface Notice {
  from: string;
  to: string;
  subject: string;
  text: string;
  /** The small tag at the top right of the branded email, e.g. "Nova beta" (optional). */
  label?: string;
}

export type NoticeResult = { ok: true } | { ok: false; error: string };

export async function sendNotice(env: Env, notice: Notice, now = Date.now()): Promise<NoticeResult> {
  const from = canonicalAddress(String(notice?.from ?? ""));
  const box = from ? await env.DB.prepare("SELECT 1 AS ok FROM mailboxes WHERE address = ?1").bind(from).first() : null;
  if (!box) return { ok: false, error: `${String(notice?.from ?? "")} isn't a mailbox on mail.oceanlive.org.` };
  const to = String(notice.to ?? "").trim();
  if (!isValidAddress(to)) return { ok: false, error: "Send to one valid address." };
  const subject = String(notice.subject ?? "").trim();
  const text = String(notice.text ?? "");
  if (!subject || !text.trim()) return { ok: false, error: "A notice needs a subject and text." };

  const form = new FormData();
  form.set("to", to);
  form.set("subject", subject.slice(0, 300));
  form.set("text", text.slice(0, 50_000));
  if (notice.label) form.set("label", String(notice.label).slice(0, 40));
  const res = await sendMail(
    new Request("https://mail.oceanlive.org/api/send", { method: "POST", body: form }),
    env,
    { mailbox: from, csrf: "", tokenHash: "" },
    now,
  );
  if (res.ok) return { ok: true };
  const out = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, error: out.error || `Sending failed (${res.status}).` };
}

export class Notify extends WorkerEntrypoint<Env> {
  async send(notice: Notice): Promise<NoticeResult> {
    return sendNotice(this.env, notice);
  }
}
