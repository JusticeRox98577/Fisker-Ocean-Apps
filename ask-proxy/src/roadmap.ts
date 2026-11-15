/**
 * The public roadmap: what's planned, in progress and done, with a vote count per item.
 *
 * Admins write the items on admin.oceanlive.org (and can turn app feedback into one). Anyone can read the
 * list; only signed-in Ocean Live accounts vote, on account.oceanlive.org/roadmap, one vote per account per
 * item. Who voted is never shown anywhere: the public list carries counts only.
 *
 * Endpoints:
 *   GET  /roadmap (also /api/roadmap)    api.oceanlive.org and workers.dev, no auth. oceanlive.org reads it
 *                                        through its own Worker (service binding). Cache-friendly: public,
 *                                        max-age=60, with an ETag (If-None-Match -> 304).
 *                                        { items: [{ id, title, description, status, votes, updated }] }
 *   GET  /roadmap/items                  account.oceanlive.org: the same items plus { voted } for the signed-in
 *                                        account, and { signedIn, canVote }. Never cached.
 *   POST /roadmap/vote   { itemId }      account.oceanlive.org, cookie session, Origin https://account.oceanlive.org
 *   POST /roadmap/unvote { itemId }      -> { ok, itemId, voted, votes }
 *   GET  /admin/roadmap                  admin host (admin.ts): every item with votes, position, who made it
 *   POST /admin/roadmap/save     { id?, title, description, status }  create (no id) or edit
 *   POST /admin/roadmap/order    { ids: [...] }                       new order, first = top
 *   POST /admin/roadmap/delete   { id }                               the item and its votes
 *   POST /admin/roadmap/promote  { feedbackId, title, description, status }  new item from feedback; marks it done
 *
 * Votes are limited to VOTE_DAILY_LIMIT changes per account per UTC day. Items that are done can't be voted
 * on any more (their votes stay). The store review account can't vote. Tables: migrations/0008_roadmap.sql.
 */

import { isReviewAccount, sha256Hex, webSessionAccount, WEB_ORIGIN, type AuthEnv } from "./auth";

export const ROADMAP_STATUSES = ["planned", "in_progress", "done"] as const;
export type RoadmapStatus = (typeof ROADMAP_STATUSES)[number];
export const VOTE_DAILY_LIMIT = 60;
const MAX_ITEMS = 500;
const TITLE_MAX = 120;
const DESCRIPTION_MAX = 600;

interface ItemRow {
  id: number;
  title: string;
  description: string;
  status: RoadmapStatus;
  updated: string;
  votes: number;
}

const ITEMS_SQL =
  "SELECT i.id, i.title, i.description, i.status, i.updated, " +
  "(SELECT COUNT(*) FROM roadmap_votes v WHERE v.item_id = i.id) AS votes " +
  `FROM roadmap_items i ORDER BY i.position, i.id LIMIT ${MAX_ITEMS}`;

async function publicItems(db: D1Database) {
  const rows = await db.prepare(ITEMS_SQL).all<ItemRow>();
  return rows.results.map((r) => ({ id: r.id, title: r.title, description: r.description, status: r.status, votes: r.votes, updated: r.updated }));
}

/** True for the paths of the public roadmap read (api host, workers.dev). */
export function isPublicRoadmapPath(path: string): boolean {
  return path === "/roadmap" || path === "/api/roadmap";
}

/** GET /roadmap: everyone's view. Counts only, never who voted. */
export async function publicRoadmap(request: Request, env: AuthEnv): Promise<Response> {
  const method = request.method;
  if (method !== "GET" && method !== "HEAD") {
    const res = json({ error: "method" }, 405);
    res.headers.set("Allow", "GET, HEAD");
    return res;
  }
  if (!env.LOG_DB) return json({ error: "unavailable" }, 503);
  let body: string;
  try {
    body = JSON.stringify({ items: await publicItems(env.LOG_DB) });
  } catch {
    return json({ error: "unavailable" }, 503);
  }
  const etag = `"${(await sha256Hex(body)).slice(0, 32)}"`;
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=60, stale-while-revalidate=300",
    etag,
    "x-content-type-options": "nosniff",
  };
  const match = (request.headers.get("If-None-Match") ?? "").split(",").map((s) => s.trim().replace(/^W\//, ""));
  if (match.includes(etag)) return new Response(null, { status: 304, headers });
  return new Response(method === "HEAD" ? null : body, { status: 200, headers });
}

// ── account.oceanlive.org ───────────────────────────────────────

/** True for the roadmap's JSON endpoints on the account host. (/roadmap itself is the page there.) */
export function isAccountRoadmapPath(path: string): boolean {
  return path === "/roadmap/items" || path === "/roadmap/vote" || path === "/roadmap/unvote";
}

export async function accountRoadmap(request: Request, env: AuthEnv, path: string): Promise<Response> {
  const read = request.method === "GET" || request.method === "HEAD";
  if (!read && request.headers.get("Origin") !== WEB_ORIGIN) return json({ error: "origin" }, 403);
  if (!env.LOG_DB) return json({ error: "unavailable" }, 503);
  const db = env.LOG_DB;
  try {
    const account = await webSessionAccount(request, env);
    const canVote = !!account && !(await isReviewAccount(db, env, account));
    if (path === "/roadmap/items") {
      if (!read) return json({ error: "method" }, 405);
      const items = await publicItems(db);
      const mine = account
        ? new Set(
            (await db.prepare("SELECT item_id FROM roadmap_votes WHERE account_id = ?").bind(account.id).all<{ item_id: number }>()).results.map(
              (r) => r.item_id,
            ),
          )
        : new Set<number>();
      return json({ signedIn: !!account, canVote, items: items.map((i) => ({ ...i, voted: mine.has(i.id) })) });
    }
    if (request.method !== "POST") return json({ error: "method" }, 405);
    if (!account) return json({ error: "signin_required" }, 401);
    if (!canVote) return json({ error: "review_account" }, 403);
    const body = (await request.json()) as Record<string, unknown>;
    const itemId = idOf(body?.itemId);
    if (itemId === null) return json({ error: "bad_request" }, 400);
    const item = await db.prepare("SELECT id, status FROM roadmap_items WHERE id = ?").bind(itemId).first<{ id: number; status: RoadmapStatus }>();
    if (!item) return json({ error: "no_item" }, 404);
    const vote = path === "/roadmap/vote";
    if (vote && item.status === "done") return json({ error: "closed" }, 409);
    if (!(await countVote(env, account.id))) return json({ error: "rate_limited" }, 429);
    if (vote) {
      await db.prepare("INSERT OR IGNORE INTO roadmap_votes (item_id, account_id, created) VALUES (?, ?, ?)").bind(itemId, account.id, new Date().toISOString()).run();
    } else {
      await db.prepare("DELETE FROM roadmap_votes WHERE item_id = ? AND account_id = ?").bind(itemId, account.id).run();
    }
    const n = await db.prepare("SELECT COUNT(*) AS n FROM roadmap_votes WHERE item_id = ?").bind(itemId).first<{ n: number }>();
    return json({ ok: true, itemId, voted: vote, votes: n?.n ?? 0 });
  } catch {
    return json({ error: "bad_request" }, 400);
  }
}

async function countVote(env: AuthEnv, accountId: string): Promise<boolean> {
  const key = `rvote:${accountId}:${new Date().toISOString().slice(0, 10)}`;
  const used = parseInt((await env.ASK_KV.get(key)) ?? "0", 10) || 0;
  if (used >= VOTE_DAILY_LIMIT) return false;
  await env.ASK_KV.put(key, String(used + 1), { expirationTtl: 60 * 60 * 26 });
  return true;
}

/** Statements for deleteAccount (auth.ts): the account's votes, and the link to its feedback (run before the feedback is deleted). */
export function deleteAccountRoadmap(db: D1Database, accountId: string): D1PreparedStatement[] {
  return [
    db.prepare("DELETE FROM roadmap_votes WHERE account_id = ?").bind(accountId),
    db.prepare("UPDATE roadmap_items SET feedback_id = NULL WHERE feedback_id IN (SELECT id FROM feedback WHERE account_id = ?)").bind(accountId),
  ];
}

// ── admin.oceanlive.org ─────────────────────────────────────────

const ADMIN_WRITES = new Set(["/admin/roadmap/save", "/admin/roadmap/order", "/admin/roadmap/delete", "/admin/roadmap/promote"]);

export function isRoadmapAdminPath(path: string): boolean {
  return path === "/admin/roadmap" || ADMIN_WRITES.has(path);
}

/** The Roadmap tab, owners and admins. `countWrite` counts one write against the admin's daily limit. */
export async function roadmapAdmin(request: Request, db: D1Database, email: string, path: string, countWrite: () => Promise<boolean>): Promise<Response> {
  const read = request.method === "GET" || request.method === "HEAD";
  if (path === "/admin/roadmap") return read ? json({ items: await adminItems(db) }) : json({ error: "method" }, 405);
  if (!ADMIN_WRITES.has(path)) return json({ error: "not_found" }, 404);
  if (request.method !== "POST") return json({ error: "method" }, 405);
  const body = (await request.json()) as Record<string, unknown>;
  if (!body || typeof body !== "object") return json({ error: "bad_request" }, 400);
  if (!(await countWrite())) return json({ error: "rate_limited" }, 429);
  switch (path) {
    case "/admin/roadmap/save":
      return save(db, email, body);
    case "/admin/roadmap/order":
      return order(db, email, body);
    case "/admin/roadmap/delete":
      return remove(db, email, body);
    default:
      return promote(db, email, body);
  }
}

async function adminItems(db: D1Database) {
  const rows = await db
    .prepare(
      "SELECT i.id, i.title, i.description, i.status, i.position, i.created, i.created_by AS createdBy, i.updated, i.feedback_id AS feedbackId, " +
        "(SELECT COUNT(*) FROM roadmap_votes v WHERE v.item_id = i.id) AS votes " +
        `FROM roadmap_items i ORDER BY i.position, i.id LIMIT ${MAX_ITEMS}`,
    )
    .all();
  return rows.results;
}

async function adminItem(db: D1Database, id: number) {
  return db
    .prepare(
      "SELECT i.id, i.title, i.description, i.status, i.position, i.created, i.created_by AS createdBy, i.updated, i.feedback_id AS feedbackId, " +
        "(SELECT COUNT(*) FROM roadmap_votes v WHERE v.item_id = i.id) AS votes FROM roadmap_items i WHERE i.id = ?",
    )
    .bind(id)
    .first();
}

interface Fields {
  title: string;
  description: string;
  status: RoadmapStatus;
}

/** Title, description and status from a request, or the error code. Text is stored as plain text. */
function fields(body: Record<string, unknown>): Fields | { error: string } {
  const title = typeof body.title === "string" ? body.title.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
  if (title.length < 3 || title.length > TITLE_MAX) return { error: "bad_title" };
  const raw = body.description === undefined || body.description === null ? "" : body.description;
  if (typeof raw !== "string") return { error: "bad_description" };
  const description = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (description.length > DESCRIPTION_MAX) return { error: "bad_description" };
  const status = body.status === undefined ? "planned" : body.status;
  if (typeof status !== "string" || !(ROADMAP_STATUSES as readonly string[]).includes(status)) return { error: "bad_status" };
  return { title, description, status: status as RoadmapStatus };
}

function logStatement(db: D1Database, email: string, action: string, detail: Record<string, unknown>, now: string) {
  return db.prepare("INSERT INTO admin_log (email, action, detail, account_id, created) VALUES (?, ?, ?, NULL, ?)").bind(email, action, JSON.stringify(detail), now);
}

async function insertItem(db: D1Database, email: string, f: Fields, feedbackId: number | null, now: string, extra: D1PreparedStatement[]) {
  const count = await db.prepare("SELECT COUNT(*) AS n FROM roadmap_items").first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_ITEMS) return null;
  const [ins] = await db.batch([
    db
      .prepare(
        "INSERT INTO roadmap_items (title, description, status, position, created, created_by, updated, feedback_id) " +
          "VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM roadmap_items), ?, ?, ?, ?)",
      )
      .bind(f.title, f.description, f.status, now, email, now, feedbackId),
    ...extra,
  ]);
  return ins.meta.last_row_id as number;
}

async function save(db: D1Database, email: string, body: Record<string, unknown>): Promise<Response> {
  const f = fields(body);
  if ("error" in f) return json(f, 400);
  const now = new Date().toISOString();
  if (body.id === undefined || body.id === null) {
    const id = await insertItem(db, email, f, null, now, []);
    if (id === null) return json({ error: "too_many" }, 409);
    await logStatement(db, email, "roadmap_create", { itemId: id, title: f.title, status: f.status }, now).run();
    return json({ ok: true, item: await adminItem(db, id) });
  }
  const id = idOf(body.id);
  if (id === null) return json({ error: "bad_request" }, 400);
  const [upd] = await db.batch([
    db.prepare("UPDATE roadmap_items SET title = ?, description = ?, status = ?, updated = ? WHERE id = ?").bind(f.title, f.description, f.status, now, id),
    db
      .prepare("INSERT INTO admin_log (email, action, detail, account_id, created) SELECT ?, 'roadmap_edit', ?, NULL, ? WHERE changes() > 0")
      .bind(email, JSON.stringify({ itemId: id, title: f.title, status: f.status }), now),
  ]);
  if (!upd.meta.changes) return json({ error: "no_item" }, 404);
  return json({ ok: true, item: await adminItem(db, id) });
}

async function order(db: D1Database, email: string, body: Record<string, unknown>): Promise<Response> {
  if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > MAX_ITEMS) return json({ error: "bad_request" }, 400);
  const ids = body.ids.map(idOf);
  if (ids.some((i) => i === null) || new Set(ids).size !== ids.length) return json({ error: "bad_request" }, 400);
  const now = new Date().toISOString();
  await db.batch([
    ...ids.map((id, i) => db.prepare("UPDATE roadmap_items SET position = ? WHERE id = ?").bind(i, id)),
    logStatement(db, email, "roadmap_order", { ids }, now),
  ]);
  return json({ ok: true, items: await adminItems(db) });
}

async function remove(db: D1Database, email: string, body: Record<string, unknown>): Promise<Response> {
  const id = idOf(body.id);
  if (id === null) return json({ error: "bad_request" }, 400);
  const item = await db.prepare("SELECT title FROM roadmap_items WHERE id = ?").bind(id).first<{ title: string }>();
  if (!item) return json({ error: "no_item" }, 404);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("DELETE FROM roadmap_votes WHERE item_id = ?").bind(id),
    db.prepare("DELETE FROM roadmap_items WHERE id = ?").bind(id),
    logStatement(db, email, "roadmap_delete", { itemId: id, title: item.title }, now),
  ]);
  return json({ ok: true });
}

/** A new roadmap item from app feedback. The admin writes the public title and text; the feedback is marked done. */
async function promote(db: D1Database, email: string, body: Record<string, unknown>): Promise<Response> {
  const feedbackId = idOf(body.feedbackId);
  if (feedbackId === null) return json({ error: "bad_request" }, 400);
  const f = fields(body);
  if ("error" in f) return json(f, 400);
  const fb = await db.prepare("SELECT id FROM feedback WHERE id = ?").bind(feedbackId).first();
  if (!fb) return json({ error: "no_feedback" }, 404);
  const now = new Date().toISOString();
  const id = await insertItem(db, email, f, feedbackId, now, [
    db.prepare("UPDATE feedback SET status = 'done', handled_by = ?, handled_at = ? WHERE id = ? AND status = 'open'").bind(email, now, feedbackId),
  ]);
  if (id === null) return json({ error: "too_many" }, 409);
  await logStatement(db, email, "roadmap_promote", { itemId: id, feedbackId, title: f.title }, now).run();
  return json({ ok: true, item: await adminItem(db, id) });
}

function idOf(raw: unknown): number | null {
  const id = typeof raw === "number" ? raw : typeof raw === "string" && /^\d{1,15}$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
