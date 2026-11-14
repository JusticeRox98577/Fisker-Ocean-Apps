/** Reading, listing and moving messages. Everything is scoped to the signed-in mailbox. */
import type { Env, Session } from "./env";
import { bodyCsp, bodyDocument, sanitizeHtml } from "./sanitize";
import { fail, json, toBase64 } from "./util";

const FOLDERS = new Set(["inbox", "sent", "trash"]);
const PAGE = 50;
/** Inline images bigger than this (in total) are left out of the body document. */
const MAX_INLINE_BYTES = 10 * 1024 * 1024;

export interface MessageRow {
  id: string;
  mailbox: string;
  folder: string;
  prev_folder: string | null;
  message_id: string | null;
  in_reply_to: string | null;
  refs: string | null;
  from_addr: string;
  from_name: string;
  reply_to: string;
  to_json: string;
  cc_json: string;
  subject: string;
  snippet: string;
  date: number;
  created_at: number;
  seen: number;
  has_html: number;
  has_text: number;
  has_attachments: number;
  size: number;
  auth_warning: string;
}

export interface AttachmentRow {
  id: string;
  message: string;
  idx: number;
  filename: string;
  content_type: string;
  size: number;
  content_id: string;
  inline: number;
  r2_key: string;
}

export async function ownMessage(env: Env, session: Session, id: string): Promise<MessageRow | null> {
  return env.DB.prepare("SELECT * FROM messages WHERE id = ?1 AND mailbox = ?2")
    .bind(id, session.mailbox)
    .first<MessageRow>();
}

function listItem(r: MessageRow) {
  return {
    id: r.id,
    folder: r.folder,
    from: { name: r.from_name, address: r.from_addr },
    to: JSON.parse(r.to_json || "[]"),
    subject: r.subject,
    snippet: r.snippet,
    date: r.date,
    receivedAt: r.created_at,
    seen: !!r.seen,
    hasAttachments: !!r.has_attachments,
  };
}

export async function listMessages(url: URL, env: Env, session: Session): Promise<Response> {
  const folder = url.searchParams.get("folder") ?? "inbox";
  if (!FOLDERS.has(folder)) return fail(400, "Unknown folder.");
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 200);
  const unread = url.searchParams.get("unread") === "1";
  const before = Number(url.searchParams.get("before")) || 0;

  const where = ["mailbox = ?1", "folder = ?2"];
  const args: unknown[] = [session.mailbox, folder];
  if (unread) where.push("seen = 0");
  if (before) {
    args.push(before);
    where.push(`created_at < ?${args.length}`);
  }
  if (q) {
    args.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const p = `?${args.length}`;
    where.push(
      `(subject LIKE ${p} ESCAPE '\\' OR from_addr LIKE ${p} ESCAPE '\\' OR from_name LIKE ${p} ESCAPE '\\' OR snippet LIKE ${p} ESCAPE '\\' OR to_json LIKE ${p} ESCAPE '\\')`,
    );
  }
  const { results } = await env.DB.prepare(
    `SELECT * FROM messages WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ${PAGE + 1}`,
  )
    .bind(...args)
    .all<MessageRow>();
  const more = results.length > PAGE;
  const page = results.slice(0, PAGE);
  return json({
    messages: page.map(listItem),
    next: more ? page[page.length - 1].created_at : null,
  });
}

export async function counts(env: Env, session: Session): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT folder, COUNT(*) AS total, SUM(seen = 0) AS unread FROM messages WHERE mailbox = ?1 GROUP BY folder",
  )
    .bind(session.mailbox)
    .all<{ folder: string; total: number; unread: number }>();
  const out: Record<string, { total: number; unread: number }> = {
    inbox: { total: 0, unread: 0 },
    sent: { total: 0, unread: 0 },
    trash: { total: 0, unread: 0 },
  };
  for (const r of results) out[r.folder] = { total: r.total, unread: r.unread ?? 0 };
  return json(out);
}

export async function readMessage(env: Env, session: Session, id: string): Promise<Response> {
  const m = await ownMessage(env, session, id);
  if (!m) return fail(404, "That message isn't here any more.");
  if (!m.seen) await env.DB.prepare("UPDATE messages SET seen = 1 WHERE id = ?1").bind(id).run();
  const { results: atts } = await env.DB.prepare(
    "SELECT * FROM attachments WHERE message = ?1 ORDER BY idx",
  )
    .bind(id)
    .all<AttachmentRow>();
  let text = "";
  if (m.has_text) text = (await (await env.STORE.get(`m/${id}/body.txt`))?.text()) ?? "";
  let remote = 0;
  if (m.has_html) {
    const html = (await (await env.STORE.get(`m/${id}/body.html`))?.text()) ?? "";
    remote = (await sanitizeHtml(html, { allowRemote: false })).remote;
  }
  return json({
    ...listItem(m),
    seen: true,
    prevFolder: m.prev_folder,
    messageId: m.message_id,
    replyTo: m.reply_to,
    cc: JSON.parse(m.cc_json || "[]"),
    text,
    hasHtml: !!m.has_html,
    remoteImages: remote,
    authWarning: m.auth_warning,
    size: m.size,
    attachments: atts
      .filter((a) => !a.inline)
      .map((a) => ({ id: a.id, filename: a.filename, contentType: a.content_type, size: a.size })),
  });
}

/** The sanitized HTML body as its own document, for the sandboxed iframe. */
export async function messageBody(url: URL, env: Env, session: Session, id: string): Promise<Response> {
  const m = await ownMessage(env, session, id);
  if (!m || !m.has_html) return new Response("Not found", { status: 404 });
  const allowRemote = url.searchParams.get("images") === "1";
  const html = (await (await env.STORE.get(`m/${id}/body.html`))?.text()) ?? "";

  const cid = new Map<string, string>();
  const { results: inline } = await env.DB.prepare(
    "SELECT * FROM attachments WHERE message = ?1 AND content_id != '' AND content_type LIKE 'image/%' ORDER BY idx",
  )
    .bind(id)
    .all<AttachmentRow>();
  let budget = MAX_INLINE_BYTES;
  for (const a of inline) {
    if (a.size > budget || !/^image\/(png|gif|jpe?g|webp|bmp|avif)$/i.test(a.content_type)) continue;
    const obj = await env.STORE.get(a.r2_key);
    if (!obj) continue;
    budget -= a.size;
    cid.set(a.content_id, `data:${a.content_type};base64,${toBase64(new Uint8Array(await obj.arrayBuffer()))}`);
  }

  const { html: clean } = await sanitizeHtml(html, { allowRemote, cid });
  return new Response(bodyDocument(clean), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": bodyCsp(allowRemote),
      "X-Frame-Options": "SAMEORIGIN",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "private, no-store",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function attachment(env: Env, session: Session, id: string, attId: string): Promise<Response> {
  const m = await ownMessage(env, session, id);
  if (!m) return new Response("Not found", { status: 404 });
  const a = await env.DB.prepare("SELECT * FROM attachments WHERE id = ?1 AND message = ?2")
    .bind(attId, id)
    .first<AttachmentRow>();
  const obj = a ? await env.STORE.get(a.r2_key) : null;
  if (!a || !obj) return new Response("Not found", { status: 404 });
  return new Response(obj.body, {
    headers: {
      // Always a download, never rendered on this origin.
      "Content-Type": "application/octet-stream",
      "Content-Disposition": contentDisposition(a.filename),
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

export async function rawMessage(env: Env, session: Session, id: string): Promise<Response> {
  const m = await ownMessage(env, session, id);
  const obj = m ? await env.STORE.get(`m/${id}/raw.eml`) : null;
  if (!m || !obj) return new Response("Not found", { status: 404 });
  const name = (m.subject || "message").replace(/[^\w.-]+/g, "_").slice(0, 60) || "message";
  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": contentDisposition(`${name}.eml`),
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

/** PATCH: { seen?: boolean, folder?: "inbox" | "sent" | "trash" } */
export async function updateMessage(req: Request, env: Env, session: Session, id: string): Promise<Response> {
  const m = await ownMessage(env, session, id);
  if (!m) return fail(404, "That message isn't here any more.");
  let body: { seen?: unknown; folder?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Nothing to change.");
  }
  if (typeof body.seen === "boolean") {
    await env.DB.prepare("UPDATE messages SET seen = ?2 WHERE id = ?1").bind(id, body.seen ? 1 : 0).run();
  }
  if (typeof body.folder === "string") {
    if (!FOLDERS.has(body.folder)) return fail(400, "Unknown folder.");
    if (body.folder === "trash" && m.folder !== "trash") {
      await env.DB.prepare("UPDATE messages SET folder = 'trash', prev_folder = ?2, trashed_at = ?3 WHERE id = ?1")
        .bind(id, m.folder, Date.now())
        .run();
    } else if (body.folder !== "trash" && m.folder === "trash") {
      // Restore: back to where it came from (sent mail to Sent, received mail to Inbox).
      const target = m.prev_folder === "sent" ? "sent" : "inbox";
      await env.DB.prepare("UPDATE messages SET folder = ?2, prev_folder = NULL, trashed_at = NULL WHERE id = ?1")
        .bind(id, target)
        .run();
    }
  }
  return json({ ok: true });
}

export async function purge(env: Env, id: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const list = await env.STORE.list({ prefix: `m/${id}/`, cursor });
    if (list.objects.length) await env.STORE.delete(list.objects.map((o) => o.key));
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM attachments WHERE message = ?1").bind(id),
    env.DB.prepare("DELETE FROM messages WHERE id = ?1").bind(id),
  ]);
}

/** DELETE: only from Trash, and then for good. */
export async function deleteMessage(env: Env, session: Session, id: string): Promise<Response> {
  const m = await ownMessage(env, session, id);
  if (!m) return fail(404, "That message isn't here any more.");
  if (m.folder !== "trash") return fail(409, "Move it to Trash first.");
  await purge(env, id);
  return json({ ok: true });
}
