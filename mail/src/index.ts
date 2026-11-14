/**
 * Ocean Live Mail (mail.oceanlive.org).
 * - email(): Cloudflare Email Routing hands over mail for @oceanlive.org; known mailboxes are stored, others rejected.
 * - fetch(): the JSON API under /api/ (the web app in public/ is served as static files).
 * - scheduled(): daily clean-up.
 */
import { csrfOk, getSession, login, logout } from "./auth";
import { type Env, num } from "./env";
import { createMailbox, listMailboxes, renameMailbox } from "./mailboxes";
import {
  attachment,
  counts,
  deleteMessage,
  listMessages,
  messageBody,
  purge,
  rawMessage,
  readMessage,
  updateMessage,
} from "./messages";
import { handleEmail } from "./receive";
import { sendMail } from "./send";
import { fail, json, withApiHeaders } from "./util";

const ID = "([0-9a-z]{19})";
const ATT = "([0-9a-z]{19}-[0-9]{1,4})";

async function api(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  if (path === "/api/login" && method === "POST") return login(req, env);

  const session = await getSession(req, env);
  if (path === "/api/session" && method === "GET") {
    if (!session) return fail(401, "Signed out.");
    const box = await env.DB.prepare("SELECT display_name FROM mailboxes WHERE address = ?1")
      .bind(session.mailbox)
      .first<{ display_name: string }>();
    return json({ mailbox: session.mailbox, name: box?.display_name ?? "", csrf: session.csrf, domain: env.MAIL_DOMAIN });
  }
  if (!session) return fail(401, "Signed out.");
  if (!csrfOk(req, session)) return fail(403, "This request didn't come from the mail app. Reload the page and try again.");

  if (path === "/api/logout" && method === "POST") return logout(env, session);
  if (path === "/api/messages" && method === "GET") return listMessages(url, env, session);
  if (path === "/api/counts" && method === "GET") return counts(env, session);
  if (path === "/api/send" && method === "POST") return sendMail(req, env, session);
  if (path === "/api/mailboxes" && method === "GET") return listMailboxes(env);
  if (path === "/api/mailboxes" && method === "POST") return createMailbox(req, env);
  if (path === "/api/mailbox" && method === "PATCH") return renameMailbox(req, env, session);

  let m = new RegExp(`^/api/messages/${ID}$`).exec(path);
  if (m) {
    if (method === "GET") return readMessage(env, session, m[1]);
    if (method === "PATCH") return updateMessage(req, env, session, m[1]);
    if (method === "DELETE") return deleteMessage(env, session, m[1]);
  }
  m = new RegExp(`^/api/messages/${ID}/body$`).exec(path);
  if (m && method === "GET") return messageBody(url, env, session, m[1]);
  m = new RegExp(`^/api/messages/${ID}/raw$`).exec(path);
  if (m && method === "GET") return rawMessage(env, session, m[1]);
  m = new RegExp(`^/api/messages/${ID}/attachments/${ATT}$`).exec(path);
  if (m && method === "GET") return attachment(env, session, m[1], m[2]);

  return fail(404, "Not found.");
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return withApiHeaders(await api(req, env));
      } catch (e) {
        console.error("api error", e instanceof Error ? e.stack : e);
        return fail(500, "Something went wrong on the server. Try again.");
      }
    }
    return env.ASSETS.fetch(req);
  },

  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    await handleEmail(message, env);
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?1").bind(now),
      env.DB.prepare("DELETE FROM counters WHERE reset_at <= ?1").bind(now),
    ]);
    const cutoff = now - num(env.TRASH_DAYS, 30) * 24 * 3600 * 1000;
    const { results } = await env.DB.prepare(
      "SELECT id FROM messages WHERE folder = 'trash' AND trashed_at < ?1 LIMIT 500",
    )
      .bind(cutoff)
      .all<{ id: string }>();
    for (const r of results) await purge(env, r.id);
  },
} satisfies ExportedHandler<Env>;
