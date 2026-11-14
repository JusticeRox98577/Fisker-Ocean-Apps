/** The oceanlive.org mailboxes. Every signed-in session belongs to the owner, so any of them can add one. */
import type { Env, Session } from "./env";
import { fail, json, oneLine } from "./util";

export async function listMailboxes(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT b.address, b.display_name AS name,
       (SELECT COUNT(*) FROM messages m WHERE m.mailbox = b.address AND m.folder = 'inbox' AND m.seen = 0) AS unread
     FROM mailboxes b ORDER BY b.address`,
  ).all<{ address: string; name: string; unread: number }>();
  return json({ mailboxes: results });
}

export function validLocalPart(local: string): boolean {
  return /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(local) && !local.includes("..");
}

/** POST { local: "billing", name: "Ocean Live Billing" } */
export async function createMailbox(req: Request, env: Env): Promise<Response> {
  let body: { local?: unknown; name?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Send the new address.");
  }
  const local = String(body.local ?? "").trim().toLowerCase().replace(/@.*$/, "");
  if (!validLocalPart(local)) {
    return fail(400, "Use letters, numbers, dots, dashes or underscores, starting and ending with a letter or number.", { field: "local" });
  }
  const address = `${local}@${env.MAIL_DOMAIN.toLowerCase()}`;
  const name = oneLine(body.name, 100);
  const res = await env.DB.prepare(
    "INSERT INTO mailboxes (address, display_name, created_at) VALUES (?1, ?2, ?3) ON CONFLICT(address) DO NOTHING",
  )
    .bind(address, name, Date.now())
    .run();
  if (!res.meta.changes) return fail(409, `${address} already exists.`, { field: "local" });
  return json({ address, name }, { status: 201 });
}

/** PATCH the signed-in mailbox: { name } is the name people see next to the address. */
export async function renameMailbox(req: Request, env: Env, session: Session): Promise<Response> {
  let body: { name?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Send the new name.");
  }
  const name = oneLine(body.name, 100);
  await env.DB.prepare("UPDATE mailboxes SET display_name = ?2 WHERE address = ?1").bind(session.mailbox, name).run();
  return json({ address: session.mailbox, name });
}
