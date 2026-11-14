/** Incoming mail from Cloudflare Email Routing: parse, store in R2 + D1, or reject unknown addresses. */
import PostalMime, { type Address, type Email } from "postal-mime";
import type { Env } from "./env";
import { canonicalAddress, newId, oneLine, snippetOf } from "./util";

/** Cloudflare Email Routing accepts up to 25 MiB; refuse anything bigger outright. */
export const MAX_INBOUND = 25 * 1024 * 1024;

export interface Person {
  name: string;
  address: string;
}

export function flattenAddresses(list: Address[] | Address | undefined): Person[] {
  const arr = !list ? [] : Array.isArray(list) ? list : [list];
  const out: Person[] = [];
  for (const a of arr) {
    if ("group" in a && Array.isArray(a.group)) {
      for (const m of a.group) out.push({ name: oneLine(m.name, 200), address: oneLine(m.address, 254) });
    } else if ("address" in a) {
      out.push({ name: oneLine(a.name, 200), address: oneLine(a.address, 254) });
    }
  }
  return out.filter((p) => p.address || p.name);
}

/** The mailbox a message is for, or "" when it is not on our domain. */
export function mailboxFor(rcpt: string, domain: string): string {
  const a = canonicalAddress(rcpt);
  return a && a.endsWith(`@${domain.toLowerCase()}`) ? a : "";
}

/** A short warning when the receiving server says the sender failed authentication. */
export function authWarning(email: Pick<Email, "headers">): string {
  const results = email.headers
    .filter((h) => h.key === "authentication-results" || h.key === "arc-authentication-results")
    .map((h) => h.value.toLowerCase())
    .join(" ");
  if (!results) return "";
  if (/\bdmarc=fail\b/.test(results)) return "The sender's domain says it did not send this (DMARC failed). It may be fake.";
  if (/\bspf=fail\b/.test(results) && !/\bdkim=pass\b/.test(results)) {
    return "This message could not be verified as coming from the sender's domain (SPF failed, no valid DKIM).";
  }
  return "";
}

function stripBrackets(id: string | undefined): string {
  return oneLine(id ?? "", 500);
}

export async function handleEmail(message: ForwardableEmailMessage, env: Env): Promise<void> {
  const mailbox = mailboxFor(message.to, env.MAIL_DOMAIN);
  const known = mailbox
    ? await env.DB.prepare("SELECT 1 FROM mailboxes WHERE address = ?1").bind(mailbox).first()
    : null;
  if (!known) {
    message.setReject("550 5.1.1 There is no mailbox with that address at this domain.");
    return;
  }
  if (message.rawSize > MAX_INBOUND) {
    message.setReject("552 5.3.4 Message too big for this mailbox (25 MB limit).");
    return;
  }
  const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
  await storeInbound(env, mailbox, raw);
}

/** Parse and store one message. Returns the new id, or the existing id when it is a duplicate. */
export async function storeInbound(env: Env, mailbox: string, raw: Uint8Array, now = Date.now()): Promise<string> {
  let email: Email | null = null;
  try {
    email = await PostalMime.parse(raw, { maxNestingDepth: 50 });
  } catch {
    email = null;
  }

  const messageId = stripBrackets(email?.messageId);
  if (messageId) {
    const dup = await env.DB.prepare(
      "SELECT id FROM messages WHERE mailbox = ?1 AND message_id = ?2 AND folder != 'sent' LIMIT 1",
    )
      .bind(mailbox, messageId)
      .first<{ id: string }>();
    if (dup) return dup.id;
  }

  const id = newId(now);
  const prefix = `m/${id}`;
  await env.STORE.put(`${prefix}/raw.eml`, raw, { httpMetadata: { contentType: "message/rfc822" } });

  if (!email) {
    await env.DB.prepare(
      `INSERT INTO messages (id, mailbox, folder, subject, snippet, date, created_at, size, has_text)
       VALUES (?1, ?2, 'inbox', ?3, ?4, ?5, ?5, ?6, 0)`,
    )
      .bind(id, mailbox, "(This message couldn't be read)", "Download the original to open it in another app.", now, raw.byteLength)
      .run();
    return id;
  }

  const text = email.text ?? "";
  const html = email.html ?? "";
  if (text) await env.STORE.put(`${prefix}/body.txt`, text, { httpMetadata: { contentType: "text/plain; charset=utf-8" } });
  if (html) await env.STORE.put(`${prefix}/body.html`, html, { httpMetadata: { contentType: "text/html; charset=utf-8" } });

  const stmts: D1PreparedStatement[] = [];
  let visibleAttachments = 0;
  for (const [i, att] of email.attachments.entries()) {
    const key = `${prefix}/a/${i}`;
    const content = att.content as ArrayBuffer | Uint8Array | string;
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
    const size = bytes.byteLength;
    const contentType = oneLine(att.mimeType || "application/octet-stream", 200);
    await env.STORE.put(key, bytes, { httpMetadata: { contentType } });
    const cid = oneLine(att.contentId ?? "", 500).replace(/^<|>$/g, "").toLowerCase();
    const inline = att.disposition === "inline" && cid ? 1 : att.related && cid ? 1 : 0;
    if (!inline) visibleAttachments++;
    stmts.push(
      env.DB.prepare(
        `INSERT INTO attachments (id, message, idx, filename, content_type, size, content_id, inline, r2_key)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      ).bind(`${id}-${i}`, id, i, oneLine(att.filename ?? "", 255) || `attachment-${i + 1}`, contentType, size, cid, inline, key),
    );
  }

  const from = flattenAddresses(email.from)[0] ?? { name: "", address: "" };
  const replyTo = flattenAddresses(email.replyTo)[0]?.address ?? "";
  const date = Date.parse(email.date ?? "") || now;
  stmts.unshift(
    env.DB.prepare(
      `INSERT INTO messages (id, mailbox, folder, message_id, in_reply_to, refs, from_addr, from_name, reply_to,
         to_json, cc_json, subject, snippet, date, created_at, has_html, has_text, has_attachments, size, auth_warning)
       VALUES (?1, ?2, 'inbox', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)`,
    ).bind(
      id,
      mailbox,
      messageId,
      stripBrackets(email.inReplyTo),
      oneLine(email.references ?? "", 4000),
      from.address,
      from.name,
      replyTo,
      JSON.stringify(flattenAddresses(email.to)),
      JSON.stringify(flattenAddresses(email.cc)),
      oneLine(email.subject ?? "", 500),
      snippetOf(text, html),
      date,
      now,
      html ? 1 : 0,
      text ? 1 : 0,
      visibleAttachments ? 1 : 0,
      raw.byteLength,
      authWarning(email),
    ),
  );
  await env.DB.batch(stmts);
  return id;
}
