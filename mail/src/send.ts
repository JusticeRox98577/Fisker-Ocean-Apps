/** Sending through Resend, always from the signed-in mailbox. Sent mail is stored in Sent. */
import { addressParser } from "postal-mime";
import { type Env, type Session, num } from "./env";
import { bump } from "./limits";
import { type AttachmentRow, ownMessage } from "./messages";
import { escapeHtml, fail, isValidAddress, json, newId, oneLine, snippetOf, toBase64 } from "./util";
import type { Person } from "./receive";

/** Resend takes 40 MB per email after base64; keep the raw total under 25 MB. */
export const MAX_SEND_BYTES = 25 * 1024 * 1024;
const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function parseRecipients(input: unknown): { ok: Person[]; bad: string[] } {
  const s = String(input ?? "").trim();
  if (!s) return { ok: [], bad: [] };
  const parsed = addressParser(s, { flatten: true }) as { name?: string; address?: string }[];
  const ok: Person[] = [];
  const bad: string[] = [];
  for (const p of parsed) {
    const address = (p.address ?? "").trim();
    if (address && isValidAddress(address)) ok.push({ name: oneLine(p.name ?? "", 200), address: address.toLowerCase() });
    else bad.push(address || p.name || "?");
  }
  return { ok, bad };
}

export function formatPerson(p: Person): string {
  const name = p.name.replace(/["\\]/g, "").trim();
  return name ? `"${name}" <${p.address}>` : p.address;
}

/** Plain text to simple HTML: escaped, line breaks kept, links clickable, "> " quotes as blockquotes. */
export function textToHtml(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let out = "";
  let depth = 0;
  for (const line of lines) {
    const m = /^((?:>\s?)*)(.*)$/.exec(line)!;
    const d = (m[1].match(/>/g) ?? []).length;
    while (depth < d) {
      out += '<blockquote style="margin:0 0 0 .8ex;border-left:2px solid #9bb;padding-left:1ex;color:#455">';
      depth++;
    }
    while (depth > d) {
      out += "</blockquote>";
      depth--;
    }
    const linked = escapeHtml(m[2]).replace(/\bhttps?:\/\/[^\s<>"']+/g, (u) => `<a href="${u}">${u}</a>`);
    out += `${linked}<br>`;
  }
  while (depth-- > 0) out += "</blockquote>";
  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.5">${out}</div>`;
}

export async function sendMail(req: Request, env: Env, session: Session, now = Date.now()): Promise<Response> {
  if (!env.RESEND_API_KEY && !env.RESEND_FETCH) return fail(503, "Sending isn't set up yet: the RESEND_API_KEY secret is missing.");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "The message didn't arrive in one piece. Try again.");
  }

  const to = parseRecipients(form.get("to"));
  const cc = parseRecipients(form.get("cc"));
  const bcc = parseRecipients(form.get("bcc"));
  const bad = [...to.bad, ...cc.bad, ...bcc.bad];
  if (bad.length) return fail(400, `Check these addresses: ${bad.slice(0, 5).join(", ")}`, { field: "to" });
  if (!to.ok.length) return fail(400, "Add at least one address in To.", { field: "to" });
  const total = to.ok.length + cc.ok.length + bcc.ok.length;
  if (total > num(env.MAX_RECIPIENTS, 50)) return fail(400, `Too many recipients (most ${env.MAX_RECIPIENTS}).`, { field: "to" });

  const subject = oneLine(form.get("subject"), 500);
  const text = String(form.get("text") ?? "").slice(0, 500_000);

  // Reply or forward: the original must be in this mailbox.
  const headers: Record<string, string> = {};
  const replyToId = String(form.get("replyTo") ?? "");
  if (replyToId) {
    const orig = await ownMessage(env, session, replyToId);
    if (!orig) return fail(404, "The message you're replying to isn't here any more.");
    if (orig.message_id) {
      const mid = orig.message_id.startsWith("<") ? orig.message_id : `<${orig.message_id}>`;
      headers["In-Reply-To"] = mid;
      headers["References"] = oneLine(`${orig.refs ?? ""} ${mid}`, 4000);
    }
  }

  type Out = { filename: string; contentType: string; bytes: Uint8Array };
  const files: Out[] = [];
  const forwardOf = String(form.get("forwardOf") ?? "");
  if (forwardOf) {
    const orig = await ownMessage(env, session, forwardOf);
    if (!orig) return fail(404, "The message you're forwarding isn't here any more.");
    const wanted = new Set(form.getAll("forwardAttachment").map(String));
    const { results } = await env.DB.prepare("SELECT * FROM attachments WHERE message = ?1 AND inline = 0 ORDER BY idx")
      .bind(forwardOf)
      .all<AttachmentRow>();
    for (const a of results) {
      if (!wanted.has(a.id)) continue;
      const obj = await env.STORE.get(a.r2_key);
      if (obj) files.push({ filename: a.filename, contentType: a.content_type, bytes: new Uint8Array(await obj.arrayBuffer()) });
    }
  }
  for (const f of form.getAll("attachments")) {
    if (typeof f === "string" || !f.size) continue;
    files.push({
      filename: oneLine(f.name, 255) || "attachment",
      contentType: oneLine(f.type, 200) || "application/octet-stream",
      bytes: new Uint8Array(await f.arrayBuffer()),
    });
  }
  const bytes = files.reduce((n, f) => n + f.bytes.byteLength, 0);
  if (bytes > MAX_SEND_BYTES) return fail(413, "Attachments are over 25 MB together. Remove some and try again.", { field: "attachments" });
  if (!subject && !text.trim() && !files.length) return fail(400, "The message is empty.", { field: "text" });

  // Limits: per mailbox per hour, all mailboxes per day.
  const hourCount = await bump(env.DB, `send:${session.mailbox}:hour`, HOUR_MS, now);
  const dayCount = await bump(env.DB, "send:all:day", DAY_MS, now);
  if (hourCount > num(env.SEND_PER_HOUR, 30) || dayCount > num(env.SEND_PER_DAY, 150)) {
    return fail(429, "Sending limit reached. Wait a while and try again.");
  }

  const box = await env.DB.prepare("SELECT display_name FROM mailboxes WHERE address = ?1")
    .bind(session.mailbox)
    .first<{ display_name: string }>();
  const fromPerson: Person = { name: box?.display_name ?? "", address: session.mailbox };
  const id = newId(now);
  const payload = {
    from: formatPerson(fromPerson),
    to: to.ok.map(formatPerson),
    cc: cc.ok.length ? cc.ok.map(formatPerson) : undefined,
    bcc: bcc.ok.length ? bcc.ok.map(formatPerson) : undefined,
    subject: subject || "(no subject)",
    text,
    html: textToHtml(text),
    headers: Object.keys(headers).length ? headers : undefined,
    attachments: files.length
      ? files.map((f) => ({ filename: f.filename, content: toBase64(f.bytes), content_type: f.contentType }))
      : undefined,
  };

  const doFetch = env.RESEND_FETCH ?? fetch;
  let providerId = "";
  try {
    const res = await doFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": id,
      },
      body: JSON.stringify(payload),
    });
    const out = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return fail(502, `Resend didn't send it: ${oneLine(out.message ?? res.statusText, 300)}`);
    providerId = out.id ?? "";
  } catch {
    return fail(502, "Couldn't reach Resend. Nothing was sent; try again.");
  }

  // Keep a copy in Sent.
  const prefix = `m/${id}`;
  if (text) await env.STORE.put(`${prefix}/body.txt`, text, { httpMetadata: { contentType: "text/plain; charset=utf-8" } });
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO messages (id, mailbox, folder, in_reply_to, refs, provider_id, from_addr, from_name, to_json, cc_json,
         subject, snippet, date, created_at, seen, has_text, has_attachments, size)
       VALUES (?1, ?2, 'sent', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12, 1, ?13, ?14, ?15)`,
    ).bind(
      id,
      session.mailbox,
      headers["In-Reply-To"] ?? null,
      headers["References"] ?? null,
      providerId,
      session.mailbox,
      fromPerson.name,
      JSON.stringify(to.ok),
      JSON.stringify([...cc.ok, ...bcc.ok.map((p) => ({ ...p, bcc: true }))]),
      payload.subject,
      snippetOf(text, ""),
      now,
      text ? 1 : 0,
      files.length ? 1 : 0,
      text.length + bytes,
    ),
  ];
  for (const [i, f] of files.entries()) {
    const key = `${prefix}/a/${i}`;
    await env.STORE.put(key, f.bytes, { httpMetadata: { contentType: f.contentType } });
    stmts.push(
      env.DB.prepare(
        `INSERT INTO attachments (id, message, idx, filename, content_type, size, content_id, inline, r2_key)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, '', 0, ?7)`,
      ).bind(`${id}-${i}`, id, i, f.filename, f.contentType, f.bytes.byteLength, key),
    );
  }
  await env.DB.batch(stmts);
  return json({ id, providerId });
}
