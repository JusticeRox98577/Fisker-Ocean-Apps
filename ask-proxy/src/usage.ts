/**
 * The Usage tab of the admin page (admin.oceanlive.org): how much "Any questions?" is used and what it
 * costs, the logged questions, and the reports of answers. Called from admin.ts, which has already
 * checked the admin session (owners and admins both see this; everyone else gets 404).
 *
 *   GET  /admin/usage                    summary numbers, the last 30 days per day, language and signed-in split
 *   GET  /admin/usage/questions?before=  the last 50 logged questions (older pages with before=<id>)
 *   GET  /admin/reports?status=open|all&before=   reports newest first, 50 a page, with their question
 *   POST /admin/reports/resolve { id }   marks a report resolved (written to admin_log)
 *
 * Nothing here returns who asked or reported: no account ID, email, install ID or IP (IPs are never
 * logged anyway). The per-day, per-month and list queries are bounded by a date range or a LIMIT and
 * read through an index (questions_ts, ledger_kind_created, accounts_created, reports_open; see
 * migrations/0006_usage.sql). Three totals read a whole small table on each load: all accounts, the
 * balances above zero and reward_claims. They grow with the number of accounts, not
 * with questions; if that ever matters, keep running totals instead.
 * Days and months are UTC.
 */

export interface UsageEnv {
  ASK_KV: KVNamespace;
  /** The monthly spend cap the proxy stops at (US dollars). Default 10, like /ask. */
  MONTHLY_CAP_USD?: string;
}

export const CHART_DAYS = 30;
export const PAGE_SIZE = 50;
/**
 * A hold (ledger note 'hold') is a paid question still being answered. One older than this never
 * settled (the Worker stopped, or the settle failed): its cents stay taken, so it counts as a charge.
 * /ask gives up on Claude well before this.
 */
export const STUCK_HOLD_MS = 10 * 60_000;

/** UTC boundaries as ISO strings, which compare in time order (all timestamps are written with toISOString). */
export function ranges(now: Date) {
  const day = now.toISOString().slice(0, 10);
  const dayStart = `${day}T00:00:00.000Z`;
  const monthStart = `${day.slice(0, 7)}-01T00:00:00.000Z`;
  const first = new Date(Date.parse(dayStart) - (CHART_DAYS - 1) * 86_400_000);
  return {
    day,
    month: day.slice(0, 7),
    dayStart,
    monthStart,
    chartStart: first.toISOString(),
    weekAgo: new Date(now.getTime() - 7 * 86_400_000).toISOString(),
    // The chart's days, oldest first.
    days: Array.from({ length: CHART_DAYS }, (_, i) => new Date(first.getTime() + i * 86_400_000).toISOString().slice(0, 10)),
  };
}

interface Count {
  n: number;
  micros: number;
}

export async function usageSummary(env: UsageEnv, db: D1Database, now = new Date()) {
  const r = ranges(now);
  const capUsd = numVar(env.MONTHLY_CAP_USD, 10);
  const questions = (from: string) =>
    db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(cost_micros), 0) AS micros FROM questions WHERE ts >= ?").bind(from);
  // Paid questions: settled charges, plus holds that never settled (their cents stay taken). A hold
  // younger than STUCK_HOLD_MS is a question still being answered and isn't counted yet.
  const stuckBefore = new Date(now.getTime() - STUCK_HOLD_MS).toISOString();
  const paid = (from: string) =>
    db
      .prepare(
        "SELECT COUNT(*) AS n, COALESCE(-SUM(delta_cents), 0) AS cents, COALESCE(SUM(note = 'hold'), 0) AS stuck FROM ledger " +
          "WHERE kind = 'question' AND created >= ? AND (note IS NULL OR note <> 'hold' OR created < ?)",
      )
      .bind(from, stuckBefore);

  const results = await db.batch<Record<string, unknown>>([
    questions(r.dayStart),
    questions(r.monthStart),
    db.prepare("SELECT (SELECT COUNT(*) FROM accounts) AS n, (SELECT COUNT(*) FROM accounts WHERE created >= ?) AS recent").bind(r.weekAgo),
    paid(r.dayStart),
    paid(r.monthStart),
    db.prepare("SELECT COALESCE(SUM(cents), 0) AS cents, COUNT(*) AS n FROM balances WHERE cents > 0"),
    db.prepare("SELECT COALESCE(SUM(ref LIKE 'play:%'), 0) AS play, COALESCE(SUM(ref LIKE 'apple:%'), 0) AS apple FROM reward_claims"),
    db.prepare("SELECT COUNT(*) AS n FROM reports WHERE resolved_at IS NULL"),
    db
      .prepare("SELECT substr(ts, 1, 10) AS day, COUNT(*) AS n, COALESCE(SUM(cost_micros), 0) AS micros FROM questions WHERE ts >= ? GROUP BY day")
      .bind(r.chartStart),
    // Language: the first two letters of the phone's Accept-Language ("de-DE,de;q=0.9" -> "de"); "" when not sent.
    db
      .prepare(
        "SELECT lower(substr(COALESCE(lang, ''), 1, 2)) AS lang, COUNT(*) AS n FROM questions WHERE ts >= ? GROUP BY 1 ORDER BY n DESC, lang LIMIT 20",
      )
      .bind(r.chartStart),
    db
      .prepare("SELECT COALESCE(SUM(account_id IS NOT NULL), 0) AS signedIn, COALESCE(SUM(account_id IS NULL), 0) AS anonymous FROM questions WHERE ts >= ?")
      .bind(r.chartStart),
  ]);
  const one = (i: number) => (results[i].results[0] ?? {}) as Record<string, number>;
  const today = one(0) as unknown as Count;
  const month = one(1) as unknown as Count;
  const spentMicros = parseInt((await env.ASK_KV.get(`spend:${r.month}`)) ?? "0", 10) || 0;

  const perDay = new Map((results[8].results as { day: string; n: number; micros: number }[]).map((d) => [d.day, d]));
  return {
    generated: now.toISOString(),
    day: r.day,
    month: r.month,
    questions: { today: today.n, month: month.n },
    costMicros: { today: today.micros, month: month.micros },
    // What the cap counts (KV, updated after every answer), next to the cap.
    spend: { monthMicros: spentMicros, capMicros: Math.round(capUsd * 1_000_000) },
    accounts: { total: one(2).n ?? 0, newLast7Days: one(2).recent ?? 0 },
    paid: {
      // `unsettled`: of those, holds that never settled. They can't be matched to a logged question,
      // so Recent questions shows those questions as free.
      today: { questions: one(3).n ?? 0, cents: one(3).cents ?? 0, unsettled: one(3).stuck ?? 0 },
      month: { questions: one(4).n ?? 0, cents: one(4).cents ?? 0, unsettled: one(4).stuck ?? 0 },
    },
    balances: { totalCents: one(5).cents ?? 0, accounts: one(5).n ?? 0 },
    rewards: { play: one(6).play ?? 0, apple: one(6).apple ?? 0 },
    openReports: one(7).n ?? 0,
    days: r.days.map((day) => ({ day, questions: perDay.get(day)?.n ?? 0, costMicros: perDay.get(day)?.micros ?? 0 })),
    // Breakdowns over the same 30 days as the chart.
    languages: (results[9].results as { lang: string; n: number }[]).map((l) => ({ lang: l.lang, questions: l.n })),
    signedIn: { signedIn: one(10).signedIn ?? 0, anonymous: one(10).anonymous ?? 0 },
  };
}

/** A page cursor: the smallest ID of the previous page. Missing or invalid: the newest page. */
function before(q: URLSearchParams): number {
  const v = q.get("before") ?? "";
  const n = /^\d{1,15}$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : Number.MAX_SAFE_INTEGER;
}

export interface QuestionRow {
  id: number;
  ts: string;
  lang: string | null;
  question: string;
  answer: string | null;
  car: string | null;
  costMicros: number;
  paid: boolean;
  chargedCents: number | null;
}

/** The logged questions, newest first. Only what was asked and answered: never who asked. */
export async function recentQuestions(db: D1Database, q: URLSearchParams) {
  const rows = await db
    .prepare(
      "SELECT q.id, q.ts, q.lang, q.question, q.answer, q.car, q.cost_micros AS costMicros, " +
        "(SELECT -l.delta_cents FROM ledger l WHERE l.ref = 'question:' || q.id) AS chargedCents " +
        "FROM questions q WHERE q.id < ? ORDER BY q.id DESC LIMIT ?",
    )
    .bind(before(q), PAGE_SIZE + 1)
    .all<Omit<QuestionRow, "paid">>();
  const list = rows.results.slice(0, PAGE_SIZE).map(
    (r): QuestionRow => ({
      id: r.id,
      ts: r.ts,
      lang: r.lang,
      question: r.question,
      answer: r.answer,
      car: r.car,
      costMicros: r.costMicros,
      paid: r.chargedCents !== null && r.chargedCents !== undefined,
      chargedCents: r.chargedCents ?? null,
    }),
  );
  return { questions: list, next: rows.results.length > PAGE_SIZE ? list[list.length - 1].id : null };
}

/** Reports, newest first, with the reported question and answer. Never the reporter. */
export async function listReports(db: D1Database, q: URLSearchParams) {
  const open = q.get("status") !== "all";
  const rows = await db
    .prepare(
      "SELECT r.id, r.reason, r.note, r.created, r.resolved_at AS resolvedAt, r.resolved_by AS resolvedBy, r.question_id AS questionId, " +
        "q.ts AS questionTs, q.lang, q.question, q.answer " +
        "FROM reports r LEFT JOIN questions q ON q.id = r.question_id " +
        `WHERE r.id < ?${open ? " AND r.resolved_at IS NULL" : ""} ORDER BY r.id DESC LIMIT ?`,
    )
    .bind(before(q), PAGE_SIZE + 1)
    .all<{ id: number }>();
  const list = rows.results.slice(0, PAGE_SIZE);
  return { reports: list, next: rows.results.length > PAGE_SIZE ? list[list.length - 1].id : null };
}

/**
 * Marks one report resolved by `email`, with an admin_log row, in one transaction. A report already
 * resolved stays as it was ({ ok, alreadyResolved }).
 */
export async function resolveReport(db: D1Database, email: string, body: Record<string, unknown>): Promise<Response> {
  const raw = body.id;
  const id = typeof raw === "number" ? raw : typeof raw === "string" && /^\d{1,15}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) return json({ error: "bad_request" }, 400);
  const now = new Date().toISOString();
  const [upd] = await db.batch<{ question_id: number }>([
    db.prepare("UPDATE reports SET resolved_at = ?, resolved_by = ? WHERE id = ? AND resolved_at IS NULL RETURNING question_id")
      .bind(now, email, id),
    // Only when the UPDATE above changed the report: changes() is the row count of the previous
    // statement in this transaction, so a second resolve with the same email and timestamp logs nothing.
    db.prepare(
      "INSERT INTO admin_log (email, action, detail, account_id, created) " +
        "SELECT ?, 'report_resolve', json_object('reportId', id, 'questionId', question_id), NULL, ? " +
        "FROM reports WHERE changes() > 0 AND id = ? AND resolved_at = ? AND resolved_by = ?",
    ).bind(email, now, id, now, email),
  ]);
  if (upd.results.length > 0) return json({ ok: true, resolvedAt: now, resolvedBy: email });
  const row = await db
    .prepare("SELECT resolved_at AS resolvedAt, resolved_by AS resolvedBy FROM reports WHERE id = ?")
    .bind(id)
    .first<{ resolvedAt: string | null; resolvedBy: string | null }>();
  if (!row) return json({ error: "no_report" }, 404);
  return json({ ok: true, alreadyResolved: true, resolvedAt: row.resolvedAt, resolvedBy: row.resolvedBy });
}

function numVar(v: string | undefined, fallback: number): number {
  const n = v ? parseFloat(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
