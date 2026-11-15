/**
 * "Report this answer": owners flag an "Any questions?" answer that was offensive, harmful or wrong.
 *
 * POST /ask/report { questionId, reason, note?, device? }
 *   questionId  the `questionId` the /ask answer carried (a string; a number is accepted too)
 *   reason      "offensive" | "harmful" | "wrong" | "other"
 *   note        optional, at most 500 characters
 *   device      the install ID, only for apps without an account (like /ask)
 *
 * Same sign-in as /ask: the account's bearer token, or for installs without an account (while
 * ALLOW_ANONYMOUS is "true") the install ID. Only the question's own asker can report it: a question
 * that doesn't exist or belongs to someone else is not_found either way. One report per question and
 * reporter (sending it again answers ok and changes nothing), and at most REPORT_DAILY_LIMIT (20) new
 * reports per reporter per day (UTC).
 *
 * Answers { ok: true } or { error: "bad_request" | "not_found" | "rate_limited" | "signin_required" }.
 * Reports are kept with their question and deleted with it (the daily log cleanup and account deletion).
 * Table: migrations/0004_reports_claims.sql.
 */

import { sessionAccount, type AuthEnv } from "./auth";

export interface ReportsEnv extends AuthEnv {
  ALLOW_ANONYMOUS?: string;
  /** New reports per account (or install) per day. Default 20. */
  REPORT_DAILY_LIMIT?: string;
}

export const REPORT_REASONS = ["offensive", "harmful", "wrong", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
const MAX_NOTE = 500;

export interface ReportBody {
  questionId: number;
  reason: ReportReason;
  note: string | null;
  device: string | null;
}

/** Checks a report body. Returns null when it isn't valid. */
export function parseReport(v: unknown): ReportBody | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const raw = o.questionId;
  let id = NaN;
  if (typeof raw === "number") id = raw;
  else if (typeof raw === "string" && /^\d{1,15}$/.test(raw.trim())) id = Number(raw.trim());
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  if (typeof o.reason !== "string" || !(REPORT_REASONS as readonly string[]).includes(o.reason)) return null;
  let note: string | null = null;
  if (o.note !== undefined && o.note !== null) {
    if (typeof o.note !== "string") return null;
    const clean = o.note.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim();
    if (clean.length > MAX_NOTE) return null;
    note = clean || null;
  }
  const device = typeof o.device === "string" && /^[A-Za-z0-9-]{8,64}$/.test(o.device) ? o.device : null;
  return { questionId: id, reason: o.reason as ReportReason, note, device };
}

export async function handleReport(request: Request, env: ReportsEnv): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method" }, 405);
  let body: ReportBody | null;
  try {
    body = parseReport(await request.json());
  } catch {
    body = null;
  }
  if (!body) return json({ error: "bad_request" }, 400);
  if (!env.LOG_DB) return json({ error: "not_found" }, 404);
  const db = env.LOG_DB;

  const account = await sessionAccount(request, env);
  if (!account && (env.ALLOW_ANONYMOUS !== "true" || !body.device)) {
    return env.ALLOW_ANONYMOUS === "true" ? json({ error: "bad_request" }, 400) : json({ error: "signin_required" }, 401);
  }
  const accountId = account?.id ?? null;
  const device = account ? null : body.device;

  // The reporter must have asked the question: the same account, or (without an account) the same install
  // for a question not linked to any account.
  const own = account
    ? await db.prepare("SELECT id FROM questions WHERE id = ? AND account_id = ?").bind(body.questionId, accountId).first()
    : await db.prepare("SELECT id FROM questions WHERE id = ? AND device = ? AND account_id IS NULL").bind(body.questionId, device).first();
  if (!own) return json({ error: "not_found" }, 404);

  const same = "question_id = ? AND IFNULL(account_id, '') = ? AND IFNULL(device, '') = ?";
  const already = await db.prepare(`SELECT 1 AS x FROM reports WHERE ${same}`).bind(body.questionId, accountId ?? "", device ?? "").first();
  if (already) return json({ ok: true });

  const day = new Date().toISOString().slice(0, 10);
  const key = account ? `rep:a:${accountId}:${day}` : `rep:d:${device}:${day}`;
  const limit = intVar(env.REPORT_DAILY_LIMIT, 20);
  const used = parseInt((await env.ASK_KV.get(key)) ?? "0", 10) || 0;
  if (used >= limit) return json({ error: "rate_limited" }, 429);

  // A parallel duplicate hits the unique index (reports_once) and is ignored.
  const r = await db
    .prepare("INSERT INTO reports (question_id, account_id, device, reason, note, created) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING")
    .bind(body.questionId, accountId, device, body.reason, body.note, new Date().toISOString())
    .run();
  if (r.meta.changes > 0) await env.ASK_KV.put(key, String(used + 1), { expirationTtl: 60 * 60 * 26 });
  return json({ ok: true });
}

function intVar(v: string | undefined, fallback: number): number {
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
