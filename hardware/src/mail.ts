/** Sending email through Resend (the same account the mail Worker uses). */
import type { Env } from "./env";
import { escapeHtml } from "./util";

export interface Email {
  to: string;
  subject: string;
  /** Plain text, paragraphs separated by blank lines. Links are written out in full. */
  text: string;
  replyTo?: string;
  /** Same key, same email: Resend sends it once. */
  idempotencyKey?: string;
}

export function canSend(env: Env): boolean {
  return Boolean(env.RESEND_API_KEY || env.RESEND_FETCH);
}

/** A simple HTML version of the text, in the oceanlive.org colours, with links made clickable. */
export function toHtml(text: string): string {
  const paras = text.split(/\n{2,}/).map((p) => {
    const html = escapeHtml(p)
      .replace(/https:\/\/[^\s<]+/g, (u) => `<a href="${u}" style="color:#0b7d83">${u}</a>`)
      .replace(/\n/g, "<br>");
    return `<p style="margin:0 0 16px">${html}</p>`;
  });
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f8fc;font:16px/1.55 -apple-system,Segoe UI,Inter,sans-serif;color:#0b2545"><div style="max-width:560px;margin:0 auto;background:#fff;border-top:4px solid #5ce1e6;padding:28px 24px">${paras.join("")}</div></body></html>`;
}

export async function sendEmail(env: Env, email: Email): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!canSend(env)) return { ok: false, error: "Email isn't set up yet: the RESEND_API_KEY secret is missing." };
  const doFetch = env.RESEND_FETCH ?? fetch;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.RESEND_API_KEY ?? ""}`,
    "Content-Type": "application/json",
  };
  if (email.idempotencyKey) headers["Idempotency-Key"] = email.idempotencyKey;
  try {
    const res = await doFetch("https://api.resend.com/emails", {
      method: "POST",
      headers,
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [email.to],
        reply_to: email.replyTo ?? env.ADMIN_EMAIL,
        subject: email.subject,
        text: email.text,
        html: toHtml(email.text),
      }),
    });
    if (res.ok) return { ok: true };
    const out = (await res.json().catch(() => ({}))) as { message?: string };
    return { ok: false, error: `Resend didn't send it: ${String(out.message ?? res.statusText).slice(0, 200)}` };
  } catch {
    return { ok: false, error: "Couldn't reach Resend. Nothing was sent; try again." };
  }
}
