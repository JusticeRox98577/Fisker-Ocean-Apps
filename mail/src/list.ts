/**
 * Ocean Live news: a double opt-in mailing list.
 *
 * Public (no session; reached through oceanlive.org/api/list/*, which the site Worker forwards here):
 *   POST /api/list/subscribe    { email, lang?, website? }  -> always { ok: true } for valid input (no enumeration)
 *   POST /api/list/confirm      { token }
 *   POST /api/list/unsubscribe  { token }  or  ?t=<token> with List-Unsubscribe=One-Click (RFC 8058)
 *   GET  /api/list/unsubscribe?t=<token>   -> redirect to the unsubscribe page (never unsubscribes on GET)
 *
 * Owner (webmail session + CSRF): overview, subscribers, test email, campaigns sent in chunks under a daily cap.
 */
import { type Env, type Session, num } from "./env";
import { bump, current } from "./limits";
import { type Email, campaignEmail, confirmEmail, listLang } from "./list-email";
import { fail, isValidAddress, json, newId, oneLine, randomToken, sha256hex } from "./util";

export const CONSENT_VERSION = "site-v1";
const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
const CONFIRM_MS = 7 * DAY_MS;
const RESEND_EVERY_MS = 10 * 60 * 1000;
const MAX_CONFIRM_SENDS = 5;
/** Resend's batch endpoint takes at most 100 emails per call. */
const RESEND_BATCH_MAX = 100;
const MAX_SUBJECT = 200;
/** Kept small: every chunk carries one full copy of the email per recipient in a single request. */
const MAX_TEXT = 20_000;
/** Rough ceiling for one Resend batch request body; long emails go out in smaller chunks. */
const MAX_BATCH_BYTES = 2_000_000;
/** After a failed confirmation send, sign-ups answer the same error for every address for this long. */
const RESEND_DOWN_MS = 10 * 60 * 1000;
const RESEND_DOWN_KEY = "list:resend-down";
/** Defaults: the list's share of Resend's daily quota (100 on the free plan, shared with webmail and sign-in codes). */
const DEFAULT_PER_DAY = 60;
const DEFAULT_CONFIRMS_PER_DAY = 20;
const UA = "ocean-live-mail";

const OK = () => json({ ok: true });
const CONFIRM_FAILED = "We couldn't send the confirmation email. Try again in a few minutes.";
const EXPIRED = "This link has expired or was already used. Sign up again at oceanlive.org/news.";

function site(env: Env): string {
  return (env.LIST_SITE || "https://oceanlive.org").replace(/\/+$/, "");
}
function sendingReady(env: Env): boolean {
  return Boolean(env.RESEND_API_KEY || env.RESEND_FETCH);
}
/** Today's key and the ms until the next UTC midnight, when Resend's daily quota resets too. */
function utcDay(now: number): { day: string; untilMidnight: number } {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return { day: d.toISOString().slice(0, 10), untilMidnight: next - now };
}
/** Every list email sent today (news, tests and confirmations): one budget against LIST_SEND_PER_DAY. */
const sentKey = (now: number) => `list:sent:${utcDay(now).day}`;
const confirmsKey = (now: number) => `list:confirms:${utcDay(now).day}`;

/**
 * The network a sign-up comes from: an IPv4 address as is, an IPv6 address cut to its /64 (one host
 * usually holds a whole /64 and can pick a new address per request). Unparseable input is kept as is.
 */
export function ipNetwork(ip: string): string {
  const s = ip.trim().toLowerCase().split("%")[0];
  if (!s.includes(":")) return s;
  let addr = s;
  const v4 = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(addr);
  if (v4) {
    const [a, b, c, d] = v4.slice(2).map(Number);
    if (/^(0{0,4}:){0,5}:?ffff:$/.test(v4[1]) || v4[1] === "::ffff:") return `${a}.${b}.${c}.${d}`;
    addr = `${v4[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const parts = addr.split("::");
  if (parts.length > 2) return s;
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  const groups = parts.length === 2 ? [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill("0"), ...tail] : head;
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return s;
  return `${groups
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(":")}::/64`;
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  if (!/^application\/json\b/i.test(req.headers.get("Content-Type") ?? "")) return null;
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ---------- Resend ----------

type ResendResult = { ok: true; data: unknown } | { ok: false; status: number; name: string; message: string };

async function resend(env: Env, path: string, body: unknown, headers: Record<string, string> = {}): Promise<ResendResult> {
  const doFetch = env.RESEND_FETCH ?? fetch;
  try {
    const res = await doFetch(`https://api.resend.com${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "User-Agent": UA,
        ...headers,
      },
      body: JSON.stringify(body),
    });
    const out = (await res.json().catch(() => ({}))) as { name?: string; message?: string };
    if (!res.ok) return { ok: false, status: res.status, name: String(out.name ?? ""), message: oneLine(out.message ?? res.statusText, 300) };
    return { ok: true, data: out };
  } catch {
    return { ok: false, status: 0, name: "network", message: "Couldn't reach Resend." };
  }
}

function message(env: Env, to: string, email: Email, headers?: Record<string, string>, tags?: { name: string; value: string }[]) {
  return {
    from: env.LIST_FROM || "Ocean Live <news@oceanlive.org>",
    to: [to],
    reply_to: env.LIST_REPLY_TO || "justice@oceanlive.org",
    subject: email.subject,
    text: email.text,
    html: email.html,
    headers,
    tags,
  };
}

// ---------- Public ----------

/** POST /api/list/subscribe */
export async function subscribe(req: Request, env: Env, now = Date.now()): Promise<Response> {
  const body = await readJson(req);
  if (!body) return fail(400, "Enter your email address.");
  // Honeypot: people never see this field; bots fill it in. Pretend it worked.
  if (String(body.website ?? "").trim()) return OK();

  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email || email.length > 254 || !isValidAddress(email)) return fail(400, "That doesn't look like an email address. Check it and try again.");
  const lang = listLang(body.lang);

  // Limits that apply the same to every valid address, so they reveal nothing about who is on the list.
  if (!sendingReady(env)) return fail(503, "Sign-up isn't working right now. Try again later.");
  const ip = req.headers.get("CF-Connecting-IP");
  if (ip) {
    // Counted per network (IPv6: per /64) and stored only as a salted hash.
    const salt = env.LIST_IP_SALT || env.RESEND_API_KEY || "";
    const ipKey = (await sha256hex(`list-ip:${salt}:${ipNetwork(ip)}`)).slice(0, 32);
    if ((await bump(env.DB, `list:signup:ip:${ipKey}`, HOUR_MS, now)) > num(env.LIST_SIGNUPS_PER_IP_HOUR, 5)) {
      return fail(429, "Too many sign-ups from this network. Try again in an hour.");
    }
  } else {
    // Without the header, one shared bucket would let a handful of visitors lock everyone out: rely on the
    // daily and per-address limits instead.
    console.warn("list subscribe without CF-Connecting-IP; per-network limit skipped");
  }
  // Confirmations have their own small daily cap and draw on the same daily budget as news emails, so
  // sign-ups can never use the room left in Resend's quota for webmail and the app's sign-in codes.
  const [confirmsToday, listSentToday] = await Promise.all([current(env.DB, confirmsKey(now), now), current(env.DB, sentKey(now), now)]);
  if (confirmsToday >= num(env.LIST_CONFIRMS_PER_DAY, DEFAULT_CONFIRMS_PER_DAY) || listSentToday >= num(env.LIST_SEND_PER_DAY, DEFAULT_PER_DAY)) {
    return fail(429, "We've had a lot of sign-ups today. Try again tomorrow.");
  }
  // Resend failed a moment ago: answer every address the same way until it has had time to recover.
  if (await current(env.DB, RESEND_DOWN_KEY, now)) return fail(502, CONFIRM_FAILED);

  const row = await env.DB.prepare(
    "SELECT id, status, confirm_sent_at, confirm_sends FROM list_subscribers WHERE email = ?1",
  )
    .bind(email)
    .first<{ id: string; status: string; confirm_sent_at: number | null; confirm_sends: number }>();

  // Already on the list: send nothing, answer the same.
  if (row?.status === "confirmed") return OK();
  // Pending and asked again: resend only now and then, and answer the same either way.
  if (row && ((row.confirm_sent_at ?? 0) > now - RESEND_EVERY_MS || row.confirm_sends >= MAX_CONFIRM_SENDS)) return OK();

  const token = randomToken(32);
  const hash = await sha256hex(token);
  let id: string;
  if (row) {
    id = row.id;
  } else {
    id = newId(now);
    const ins = await env.DB.prepare(
      `INSERT INTO list_subscribers (id, email, lang, status, source, consent, confirm_hash, confirm_expires, confirm_sent_at,
         confirm_sends, unsub_token, created_at)
       VALUES (?1, ?2, ?3, 'pending', 'site', ?4, NULL, NULL, NULL, 0, ?5, ?6)
       ON CONFLICT(email) DO NOTHING`,
    )
      .bind(id, email, lang, CONSENT_VERSION, randomToken(32), now)
      .run();
    // Someone else added it at the same moment: that request sends the email.
    if (!ins.meta.changes) return OK();
  }

  const link = `${site(env)}/list/confirm#t=${token}`;
  const sent = await resend(env, "/emails", message(env, email, confirmEmail(lang, link, site(env))));
  if (!sent.ok) {
    if (!row) await env.DB.prepare("DELETE FROM list_subscribers WHERE id = ?1 AND confirm_sends = 0").bind(id).run();
    console.error("list confirm send failed", sent.status, sent.name, sent.message);
    await bump(env.DB, RESEND_DOWN_KEY, RESEND_DOWN_MS, now);
    return fail(502, CONFIRM_FAILED);
  }
  await env.DB.prepare(
    `UPDATE list_subscribers SET confirm_hash = ?2, confirm_expires = ?3, confirm_sent_at = ?4,
       confirm_sends = confirm_sends + 1, lang = ?5
     WHERE id = ?1 AND status = 'pending'`,
  )
    .bind(id, hash, now + CONFIRM_MS, now, lang)
    .run();
  const untilMidnight = utcDay(now).untilMidnight;
  await Promise.all([bump(env.DB, confirmsKey(now), untilMidnight, now), bump(env.DB, sentKey(now), untilMidnight, now)]);
  return OK();
}

/** POST /api/list/confirm */
export async function confirm(req: Request, env: Env, now = Date.now()): Promise<Response> {
  const body = await readJson(req);
  const token = String(body?.token ?? "");
  if (token.length < 20 || token.length > 100) return fail(400, EXPIRED);
  const row = await env.DB.prepare(
    `UPDATE list_subscribers SET status = 'confirmed', confirmed_at = ?2, confirm_hash = NULL, confirm_expires = NULL
     WHERE confirm_hash = ?1 AND status = 'pending' AND confirm_expires > ?2
     RETURNING id`,
  )
    .bind(await sha256hex(token), now)
    .first<{ id: string }>();
  if (!row) return fail(400, EXPIRED);
  return OK();
}

/** Deletes a subscriber and their deliveries; queued ones come off their campaign's total. */
function deleteSubscriberStatements(env: Env, where: string, value: string): D1PreparedStatement[] {
  const sub = `(SELECT id FROM list_subscribers WHERE ${where} = ?1)`;
  return [
    env.DB.prepare(
      `UPDATE list_campaigns SET total = total - 1
       WHERE id IN (SELECT campaign_id FROM list_deliveries WHERE subscriber_id = ${sub} AND status = 'queued')`,
    ).bind(value),
    env.DB.prepare(`DELETE FROM list_deliveries WHERE subscriber_id = ${sub}`).bind(value),
    env.DB.prepare(`DELETE FROM list_subscribers WHERE ${where} = ?1`).bind(value),
  ];
}

/** POST /api/list/unsubscribe: JSON { token } from the page, or RFC 8058 one-click with ?t=. Always { ok: true }. */
export async function unsubscribe(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  let token = url.searchParams.get("t") ?? "";
  if (!token) {
    const body = await readJson(req);
    token = String(body?.token ?? "");
  }
  // Mail providers POST "List-Unsubscribe=One-Click" (form-encoded or multipart); the body itself needs no checking.
  if (token.length >= 20 && token.length <= 100) await env.DB.batch(deleteSubscriberStatements(env, "unsub_token", token));
  return OK();
}

/** GET /api/list/unsubscribe?t=: someone opened the header link in a browser. Show the page; never unsubscribe on GET. */
export function unsubscribePage(req: Request, env: Env): Response {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const safe = /^[\w-]{20,100}$/.test(token) ? `#t=${token}` : "";
  return new Response(null, { status: 303, headers: { Location: `${site(env)}/list/unsubscribe${safe}`, "Cache-Control": "no-store" } });
}

// ---------- Owner ----------

interface CampaignRow {
  id: string;
  subject: string;
  created_by: string;
  created_at: number;
  status: "sending" | "done";
  total: number;
  sent: number;
  failed: number;
}

function campaignOut(c: CampaignRow) {
  return {
    id: c.id,
    subject: c.subject,
    createdBy: c.created_by,
    createdAt: c.created_at,
    status: c.status,
    total: c.total,
    sent: c.sent,
    failed: c.failed,
    queued: Math.max(0, c.total - c.sent - c.failed),
  };
}

/** GET /api/list */
export async function overview(env: Env, now = Date.now()): Promise<Response> {
  const counts = await env.DB.prepare(
    `SELECT COALESCE(SUM(status = 'pending'), 0) AS pending, COALESCE(SUM(status = 'confirmed'), 0) AS confirmed FROM list_subscribers`,
  ).first<{ pending: number; confirmed: number }>();
  const { results } = await env.DB.prepare(
    "SELECT id, subject, created_by, created_at, status, total, sent, failed FROM list_campaigns ORDER BY id DESC LIMIT 20",
  ).all<CampaignRow>();
  return json({
    pending: counts?.pending ?? 0,
    confirmed: counts?.confirmed ?? 0,
    sendingReady: sendingReady(env),
    perDay: num(env.LIST_SEND_PER_DAY, DEFAULT_PER_DAY),
    sentToday: await current(env.DB, sentKey(now), now),
    postalAddress: Boolean((env.LIST_POSTAL_ADDRESS ?? "").trim()),
    from: env.LIST_FROM || "Ocean Live <news@oceanlive.org>",
    campaigns: results.map(campaignOut),
  });
}

/** GET /api/list/subscribers?status=&q=&cursor= (50 a page, newest first) */
export async function listSubscribers(url: URL, env: Env): Promise<Response> {
  const status = url.searchParams.get("status");
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 200);
  const cursor = url.searchParams.get("cursor") ?? "";
  const where: string[] = [];
  const args: unknown[] = [];
  if (status === "pending" || status === "confirmed") {
    args.push(status);
    where.push(`status = ?${args.length}`);
  }
  if (q) {
    args.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(`email LIKE ?${args.length} ESCAPE '\\'`);
  }
  if (/^[0-9a-z]{19}$/.test(cursor)) {
    args.push(cursor);
    where.push(`id < ?${args.length}`);
  }
  const { results } = await env.DB.prepare(
    `SELECT id, email, lang, status, created_at, confirmed_at FROM list_subscribers
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT 51`,
  )
    .bind(...args)
    .all<{ id: string; email: string; lang: string; status: string; created_at: number; confirmed_at: number | null }>();
  const page = results.slice(0, 50);
  return json({
    subscribers: page.map((r) => ({
      id: r.id,
      email: r.email,
      lang: r.lang,
      status: r.status,
      createdAt: r.created_at,
      confirmedAt: r.confirmed_at,
    })),
    next: results.length > 50 ? page[page.length - 1].id : null,
  });
}

/** DELETE /api/list/subscribers/:id */
export async function deleteSubscriber(env: Env, id: string): Promise<Response> {
  const out = await env.DB.batch(deleteSubscriberStatements(env, "id", id));
  if (!out[2].meta.changes) return fail(404, "That subscriber isn't on the list any more.");
  return OK();
}

function readCampaign(body: Record<string, unknown> | null): { subject: string; text: string } | Response {
  const rawSubject = String(body?.subject ?? "");
  const subject = oneLine(rawSubject, 10_000);
  const text = String(body?.text ?? "");
  if (!subject) return fail(400, "Add a subject.", { field: "subject" });
  if (subject.length > MAX_SUBJECT) return fail(400, `Keep the subject under ${MAX_SUBJECT} characters.`, { field: "subject" });
  if (!text.trim()) return fail(400, "Write the email first.", { field: "text" });
  if (text.length > MAX_TEXT) return fail(400, "The email is too long (most 20,000 characters).", { field: "text" });
  return { subject, text };
}

function unsubscribeLinks(env: Env, token: string) {
  // Mail providers POST the one-click URL from their own servers: LIST_UNSUB_BASE can point it at a host
  // that bot protection doesn't challenge (README: "One-click unsubscribe").
  const oneClickBase = (env.LIST_UNSUB_BASE || "").replace(/\/+$/, "") || site(env);
  return {
    page: `${site(env)}/list/unsubscribe#t=${token}`,
    oneClick: `${oneClickBase}/api/list/unsubscribe?t=${token}`,
  };
}

/**
 * Renders a news email once and returns a function that addresses it to one subscriber. Only the unsubscribe
 * token differs between recipients, so it is swapped into a placeholder instead of rendering every copy.
 */
function campaignRenderer(env: Env, subject: string, text: string, campaignId?: string) {
  const slot = `OLUNSUB${randomToken(12).replace(/[^A-Za-z0-9]/g, "")}X`;
  const email = campaignEmail({
    subject,
    text,
    unsubscribePage: unsubscribeLinks(env, slot).page,
    postalAddress: env.LIST_POSTAL_ADDRESS ?? "",
    site: site(env),
  });
  const textParts = email.text.split(slot);
  const htmlParts = email.html.split(slot);
  const render = (to: string, unsubToken: string) =>
    message(
      env,
      to,
      { subject: email.subject, text: textParts.join(unsubToken), html: htmlParts.join(unsubToken) },
      { "List-Unsubscribe": `<${unsubscribeLinks(env, unsubToken).oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      campaignId ? [{ name: "campaign", value: campaignId }] : undefined,
    );
  return { render, bytes: email.text.length + email.html.length + subject.length + 1000 };
}

/** POST /api/list/test { subject, text }: the exact email, only to the signed-in mailbox. */
export async function sendTest(req: Request, env: Env, session: Session, now = Date.now()): Promise<Response> {
  if (!sendingReady(env)) return fail(503, "Sending isn't set up yet: the RESEND_API_KEY secret is missing.");
  const c = readCampaign(await readJson(req));
  if (c instanceof Response) return c;
  if ((await current(env.DB, sentKey(now), now)) >= num(env.LIST_SEND_PER_DAY, DEFAULT_PER_DAY)) {
    return fail(429, "Daily limit reached; continue tomorrow.");
  }
  // "test" is not a real token: the links in a test email unsubscribe nobody.
  const msg = campaignRenderer(env, `[Test] ${c.subject}`, c.text).render(session.mailbox, "test-email-no-real-subscriber");
  const sent = await resend(env, "/emails", msg);
  if (!sent.ok) return fail(502, `Resend didn't send it: ${sent.message}`);
  await bump(env.DB, sentKey(now), utcDay(now).untilMidnight, now);
  return json({ ok: true, to: session.mailbox });
}

/** POST /api/list/campaigns { subject, text }: queue every confirmed subscriber, then send the first chunk. */
export async function createCampaign(req: Request, env: Env, session: Session, now = Date.now()): Promise<Response> {
  if (!sendingReady(env)) return fail(503, "Sending isn't set up yet: the RESEND_API_KEY secret is missing.");
  const c = readCampaign(await readJson(req));
  if (c instanceof Response) return c;
  const id = newId(now);
  const out = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO list_campaigns (id, subject, body_text, created_by, created_at, status, total, sent, failed)
       SELECT ?1, ?2, ?3, ?4, ?5, 'sending', COUNT(*), 0, 0 FROM list_subscribers WHERE status = 'confirmed'
       HAVING COUNT(*) > 0`,
    ).bind(id, c.subject, c.text, session.mailbox, now),
    env.DB.prepare(
      `INSERT INTO list_deliveries (campaign_id, subscriber_id, status)
       SELECT ?1, s.id, 'queued' FROM list_subscribers s
       WHERE s.status = 'confirmed' AND EXISTS (SELECT 1 FROM list_campaigns WHERE id = ?1)`,
    ).bind(id),
  ]);
  if (!out[0].meta.changes) return fail(400, "Nobody has confirmed a subscription yet.");
  return sendChunk(env, id, now);
}

/** POST /api/list/campaigns/:id/continue */
export async function continueCampaign(env: Env, id: string, now = Date.now()): Promise<Response> {
  return sendChunk(env, id, now);
}

async function campaignState(env: Env, id: string, extra: Record<string, unknown> = {}): Promise<Response> {
  const c = await env.DB.prepare("SELECT id, subject, created_by, created_at, status, total, sent, failed FROM list_campaigns WHERE id = ?1")
    .bind(id)
    .first<CampaignRow>();
  if (!c) return fail(404, "That campaign isn't here.");
  return json({ campaign: campaignOut(c), limitReached: false, paused: false, ...extra });
}

/**
 * Sends the next chunk of queued deliveries in one Resend batch call. A delivery is marked sent only after
 * Resend accepts it. The Idempotency-Key is derived from the campaign and the exact recipients, so if this
 * request is retried after Resend already took the chunk (timeout, crash before the database update), Resend
 * answers from its cache instead of sending again.
 * The answer is always the campaign's state; `paused` (with a message) means stop for now and continue later.
 */
async function sendChunk(env: Env, id: string, now: number): Promise<Response> {
  const campaign = await env.DB.prepare("SELECT id, subject, body_text, status FROM list_campaigns WHERE id = ?1")
    .bind(id)
    .first<{ id: string; subject: string; body_text: string; status: string }>();
  if (!campaign) return fail(404, "That campaign isn't here.");
  if (campaign.status === "done") return campaignState(env, id);
  if (!sendingReady(env)) return fail(503, "Sending isn't set up yet: the RESEND_API_KEY secret is missing.");

  const cap = num(env.LIST_SEND_PER_DAY, DEFAULT_PER_DAY);
  // Confirmation emails and tests count against the same daily budget (sentKey).
  const room = cap - (await current(env.DB, sentKey(now), now));
  const renderer = campaignRenderer(env, campaign.subject, campaign.body_text, id);
  // Keep one batch request to a few MB however long the email is.
  const bySize = Math.max(1, Math.floor(MAX_BATCH_BYTES / renderer.bytes));
  const size = Math.min(num(env.LIST_BATCH, 50), RESEND_BATCH_MAX, bySize, room);
  if (size <= 0) return campaignState(env, id, { limitReached: true, paused: true, message: "Daily limit reached; continue tomorrow." });

  const { results: rows } = await env.DB.prepare(
    `SELECT d.subscriber_id AS id, s.email, s.unsub_token FROM list_deliveries d
     JOIN list_subscribers s ON s.id = d.subscriber_id
     WHERE d.campaign_id = ?1 AND d.status = 'queued' ORDER BY d.subscriber_id LIMIT ?2`,
  )
    .bind(id, size)
    .all<{ id: string; email: string; unsub_token: string }>();

  if (!rows.length) {
    await env.DB.prepare("UPDATE list_campaigns SET status = 'done', total = sent + failed WHERE id = ?1").bind(id).run();
    return campaignState(env, id);
  }

  const batch = rows.map((r) => renderer.render(r.email, r.unsub_token));
  const key = `list-${id}-${(await sha256hex(rows.map((r) => r.id).join(","))).slice(0, 40)}`;
  const res = await resend(env, "/emails/batch", batch, { "Idempotency-Key": key, "x-batch-validation": "permissive" });

  if (!res.ok) {
    // Nothing is recorded on any failure: continuing retries the same chunk with the same key.
    console.error("list batch failed", id, res.status, res.name, res.message);
    if (res.status === 429) {
      return campaignState(env, id, { limitReached: true, paused: true, message: `Resend's sending limit was reached (${res.message}). Continue later.` });
    }
    if (res.status === 409 && res.name === "invalid_idempotent_request") {
      // Same key, different body: a setting in the email (sender, footer, site) changed since this part was
      // first tried. Resend keeps the old request for 24 hours; sending under a new key could reach people twice.
      return campaignState(env, id, {
        paused: true,
        message:
          "The email's settings changed since this part was first tried, so Resend won't take it yet. Undo the change, or continue after 24 hours.",
      });
    }
    if (res.status === 409) {
      return campaignState(env, id, { paused: true, message: "This part is still being sent. Wait a moment and continue." });
    }
    if (res.status === 400 || res.status === 422) {
      // A whole-request refusal comes from the request or the settings (sender, reply address), not from one
      // address (with permissive validation those come back in errors[]). Keep everyone queued.
      return campaignState(env, id, { paused: true, message: `Resend refused this part: ${res.message}. Fix the setting, then continue.` });
    }
    return campaignState(env, id, { paused: true, message: `Resend didn't take this part (${res.message}). Nothing was lost; continue to try again.` });
  }

  // Permissive validation: valid emails go out, invalid ones come back in errors[] by index.
  const data = res.data as { data?: { id?: string }[]; errors?: { index?: number; message?: string }[] };
  const errors = new Map<number, string>();
  for (const e of data.errors ?? []) if (typeof e.index === "number") errors.set(e.index, oneLine(e.message ?? "Rejected", 300));
  const ids = data.data ?? [];
  const okIndexes = rows.map((_, i) => i).filter((i) => !errors.has(i));
  // `data` lists the accepted emails in request order (all of them when there were no errors).
  const idFor = new Map<number, string>();
  if (ids.length === rows.length) rows.forEach((_, i) => idFor.set(i, ids[i]?.id ?? ""));
  else okIndexes.forEach((i, n) => idFor.set(i, ids[n]?.id ?? ""));

  // The campaign's counts move only for deliveries that are still queued when this batch runs: an overlapping
  // continue (another tab) or a subscriber who left mid-chunk changes nothing. Each count update runs just
  // before its delivery update, in the same transaction.
  const stmts: D1PreparedStatement[] = [];
  rows.forEach((r, i) => {
    const err = errors.get(i);
    stmts.push(
      env.DB.prepare(
        `UPDATE list_campaigns SET ${err ? "failed = failed + 1" : "sent = sent + 1"}
         WHERE id = ?1 AND EXISTS (SELECT 1 FROM list_deliveries WHERE campaign_id = ?1 AND subscriber_id = ?2 AND status = 'queued')`,
      ).bind(id, r.id),
      env.DB.prepare(
        `UPDATE list_deliveries SET status = ?3, resend_id = ?4, error = ?5, sent_at = ?6
         WHERE campaign_id = ?1 AND subscriber_id = ?2 AND status = 'queued'`,
      ).bind(id, r.id, err ? "failed" : "sent", err ? null : idFor.get(i) || null, err ?? null, now),
    );
  });
  const out = await env.DB.batch(stmts);
  let recorded = 0;
  rows.forEach((_, i) => {
    if (!errors.has(i) && out[2 * i].meta.changes) recorded++;
  });
  // The daily budget counts what this request recorded as sent. A subscriber who left mid-chunk still got
  // the email from Resend, so count those too; a replay from Resend's idempotency cache (an overlapping
  // continue) sent nothing new and isn't counted again.
  const leftMidChunk = rows.filter((r, i) => !errors.has(i) && !out[2 * i].meta.changes).length;
  const stillHere = leftMidChunk
    ? new Set(
        (
          await env.DB.prepare(
            "SELECT subscriber_id FROM list_deliveries WHERE campaign_id = ?1 AND subscriber_id IN (SELECT value FROM json_each(?2))",
          )
            .bind(id, JSON.stringify(rows.map((r) => r.id)))
            .all<{ subscriber_id: string }>()
        ).results.map((x) => x.subscriber_id),
      )
    : new Set<string>();
  const gone = rows.filter((r, i) => !errors.has(i) && !out[2 * i].meta.changes && !stillHere.has(r.id)).length;
  const counted = recorded + gone;
  if (counted) await bump(env.DB, sentKey(now), utcDay(now).untilMidnight, now, counted);
  return finishIfDone(env, id);
}

async function finishIfDone(env: Env, id: string, extra: Record<string, unknown> = {}): Promise<Response> {
  await env.DB.prepare(
    `UPDATE list_campaigns SET status = 'done'
     WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM list_deliveries WHERE campaign_id = ?1 AND status = 'queued')`,
  )
    .bind(id)
    .run();
  return campaignState(env, id, extra);
}

/** Daily clean-up: unconfirmed sign-ups go after 7 days. */
export async function cleanupList(env: Env, now = Date.now()): Promise<void> {
  await env.DB.prepare("DELETE FROM list_subscribers WHERE status = 'pending' AND (confirm_expires IS NULL OR confirm_expires <= ?1) AND created_at <= ?2")
    .bind(now, now - 60 * 1000)
    .run();
}
