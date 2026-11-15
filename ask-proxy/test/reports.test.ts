import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";
import { parseReport } from "../src/reports";

const API = "https://api.oceanlive.org";
const WEB = "https://account.oceanlive.org";
const db = () => env.LOG_DB!;

let n = 0;
const uniq = () => `${Date.now().toString(36)}${++n}`;
const ip = () => `192.0.2.${(++n % 250) + 1}-${uniq()}`;

async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Sends requests to the Worker, with a fake Resend that remembers the codes it was asked to email. */
function server(vars: Partial<Env> = {}) {
  const codes = new Map<string, string>();
  const resend = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { to: string[]; subject: string };
    codes.set(body.to[0], /^(\d{6}) /.exec(body.subject)![1]);
    return Response.json({ id: "re_1" });
  });
  const e: Env = { ...env, RESEND_API_KEY: "test", RESEND_FETCH: resend as unknown as typeof fetch, ...vars };
  async function call(url: string, init: RequestInit = {}) {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request(url, init), e, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  }
  return { call, codes, resend, env: e };
}

const post = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});

/** An account with an app session. */
async function account(opts: { email?: string; cents?: number } = {}) {
  const id = crypto.randomUUID();
  const token = `tok_${crypto.randomUUID().replace(/-/g, "")}`;
  const now = new Date().toISOString();
  await db().batch([
    db().prepare("INSERT INTO accounts (id, email, name, created, last_seen) VALUES (?, ?, NULL, ?, ?)").bind(id, opts.email ?? `${id}@example.com`, now, now),
    db().prepare("INSERT INTO sessions (token_hash, account_id, created, last_used, expires) VALUES (?, ?, ?, ?, ?)")
      .bind(await sha256Hex(token), id, now, now, new Date(Date.now() + 86_400_000).toISOString()),
  ]);
  if (opts.cents) await db().prepare("INSERT INTO balances (account_id, cents, updated) VALUES (?, ?, ?)").bind(id, opts.cents, now).run();
  return { id, token, auth: { Authorization: `Bearer ${token}` } };
}

/** A logged question, as /ask writes it. Returns its row ID. */
async function question(opts: { device?: string; accountId?: string | null; ts?: string } = {}) {
  const r = await db()
    .prepare("INSERT INTO questions (ts, device, lang, question, history, car, answer, cost_micros, model, account_id) VALUES (?, ?, 'en', 'Q?', '[]', NULL, 'A.', 1, 'm', ?)")
    .bind(opts.ts ?? new Date().toISOString(), opts.device ?? `dev-${uniq()}`, opts.accountId ?? null)
    .run();
  return r.meta.last_row_id as number;
}

const count = async (sql: string, ...args: unknown[]) => (await db().prepare(`SELECT COUNT(*) AS n FROM ${sql}`).bind(...args).first<{ n: number }>())!.n;

/** A fake Anthropic API that always answers. */
const claude = () =>
  vi.fn(async () =>
    Response.json({
      id: `msg_${uniq()}`,
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content: [{ type: "text", text: "Check the 12 V battery." }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1000, output_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    }),
  ) as unknown as typeof fetch;

const ASK = { ANTHROPIC_API_KEY: "test", DEVICE_DAILY_LIMIT: "100", IP_DAILY_LIMIT: "1000" } as const;
const ask = (device: string, headers: Record<string, string> = {}) =>
  post({ device, messages: [{ role: "user", text: "Why is my car slow?" }] }, { "CF-Connecting-IP": ip(), ...headers });

describe("migration 0004", () => {
  it("creates reports (one per question and reporter, known reasons only) and reward_claims", async () => {
    const names = (await db().prepare("SELECT name FROM sqlite_master").all<{ name: string }>()).results.map((r) => r.name);
    for (const t of ["reports", "reports_once", "reward_claims"]) expect(names).toContain(t);
    expect(names).not.toContain("claimed_rewards");
    const q = await question();
    const ins = (reason: string, acc: string | null, dev: string | null) =>
      db().prepare("INSERT INTO reports (question_id, account_id, device, reason, note, created) VALUES (?, ?, ?, ?, NULL, 'x')").bind(q, acc, dev, reason).run();
    await expect(ins("rude", "a", null)).rejects.toThrow();
    await ins("wrong", "a", null);
    await expect(ins("other", "a", null)).rejects.toThrow();
    await ins("wrong", null, "dev-12345678");
    await expect(ins("wrong", null, "dev-12345678")).rejects.toThrow();
  });

  it("backfills reward_claims from the ledger's store references and the earlier table", async () => {
    const play = `play:${uniq()}`;
    const apple = `apple:${uniq()}`;
    const old = `play:old-${uniq()}`;
    const q = `question:${uniq()}`;
    const a = crypto.randomUUID();
    await db().batch([
      db().prepare("CREATE TABLE IF NOT EXISTS claimed_rewards (ref TEXT PRIMARY KEY, created TEXT NOT NULL)"),
      db().prepare("INSERT INTO claimed_rewards (ref, created) VALUES (?, '2026-01-01')").bind(old),
      db().prepare("INSERT INTO ledger (account_id, delta_cents, kind, ref, note, created) VALUES (?, 500, 'reward', ?, NULL, '2026-01-02')").bind(a, play),
      db().prepare("INSERT INTO ledger (account_id, delta_cents, kind, ref, note, created) VALUES (?, 0, 'adjust', ?, NULL, '2026-01-03')").bind(a, apple),
      db().prepare("INSERT INTO ledger (account_id, delta_cents, kind, ref, note, created) VALUES (?, -1, 'question', ?, NULL, '2026-01-04')").bind(a, q),
    ]);
    const m = env.TEST_MIGRATIONS.find((x) => x.name.startsWith("0004"))!;
    for (const sql of m.queries) await db().prepare(sql).run();
    const rows = await db().prepare("SELECT ref, claimed FROM reward_claims WHERE ref IN (?, ?, ?, ?) ORDER BY claimed").bind(play, apple, old, q).all();
    expect(rows.results).toEqual([
      { ref: old, claimed: "2026-01-01" },
      { ref: play, claimed: "2026-01-02" },
      { ref: apple, claimed: "2026-01-03" },
    ]);
    const names = (await db().prepare("SELECT name FROM sqlite_master WHERE name = 'claimed_rewards'").all()).results;
    expect(names).toEqual([]);
  });
});

describe("/ask questionId", () => {
  it("comes with every answer as a string, for the row that was logged", async () => {
    const s = server({ ...ASK, ANTHROPIC_FETCH: claude() });
    const device = `dev-${uniq()}`;
    const res = await s.call(`${API}/ask`, ask(device));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { questionId: string; answer: string };
    expect(body.questionId).toMatch(/^\d+$/);
    const row = await db().prepare("SELECT device, answer FROM questions WHERE id = ?").bind(Number(body.questionId)).first();
    expect(row).toEqual({ device, answer: "Check the 12 V battery." });
    // ...and can be reported right away by the same install.
    expect((await s.call(`${API}/ask/report`, post({ questionId: body.questionId, reason: "wrong", device }))).status).toBe(200);
  });

  it("comes with paid answers too", async () => {
    const a = await account({ cents: 500 });
    const s = server({ ...ASK, DEVICE_DAILY_LIMIT: "0", ANTHROPIC_FETCH: claude() });
    const body = (await (await s.call(`${API}/ask`, ask(`dev-${uniq()}`, a.auth))).json()) as { paid: boolean; questionId: string };
    expect(body.paid).toBe(true);
    expect(await count("questions WHERE id = ? AND account_id = ?", Number(body.questionId), a.id)).toBe(1);
    expect(await count("ledger WHERE ref = ?", `question:${body.questionId}`)).toBe(1);
  });
});

describe("POST /ask/report", () => {
  it("records a signed-in owner's report on their own question", async () => {
    const a = await account();
    const q = await question({ accountId: a.id });
    const res = await server().call(`${API}/ask/report`, post({ questionId: String(q), reason: "offensive", note: "  Rude\u0000 tone " }, a.auth));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const row = await db().prepare("SELECT account_id, device, reason, note FROM reports WHERE question_id = ?").bind(q).first();
    expect(row).toEqual({ account_id: a.id, device: null, reason: "offensive", note: "Rude  tone" });
  });

  it("accepts a numeric questionId and no note", async () => {
    const a = await account();
    const q = await question({ accountId: a.id });
    expect((await server().call(`${API}/ask/report`, post({ questionId: q, reason: "other" }, a.auth))).status).toBe(200);
    expect((await db().prepare("SELECT note FROM reports WHERE question_id = ?").bind(q).first())).toEqual({ note: null });
  });

  it("is not_found for someone else's question or one that doesn't exist", async () => {
    const a = await account();
    const b = await account();
    const q = await question({ accountId: b.id });
    const s = server();
    for (const id of [q, 999_999_999]) {
      const res = await s.call(`${API}/ask/report`, post({ questionId: String(id), reason: "wrong" }, a.auth));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
    expect(await count("reports WHERE question_id = ?", q)).toBe(0);
  });

  it("lets an install without an account report its own questions only", async () => {
    const device = `dev-${uniq()}`;
    const mine = await question({ device });
    const other = await question();
    const a = await account();
    const linked = await question({ device, accountId: a.id });
    const s = server({ ALLOW_ANONYMOUS: "true" });
    expect((await s.call(`${API}/ask/report`, post({ questionId: String(mine), reason: "harmful", device }))).status).toBe(200);
    expect((await s.call(`${API}/ask/report`, post({ questionId: String(other), reason: "harmful", device }))).status).toBe(404);
    // A question linked to an account is reported by signing in.
    expect((await s.call(`${API}/ask/report`, post({ questionId: String(linked), reason: "harmful", device }))).status).toBe(404);
    expect((await s.call(`${API}/ask/report`, post({ questionId: String(linked), reason: "harmful" }, a.auth))).status).toBe(200);
    expect(await db().prepare("SELECT account_id, device FROM reports WHERE question_id = ?").bind(mine).first()).toEqual({ account_id: null, device });
  });

  it("needs a sign-in once apps without accounts are turned off", async () => {
    const device = `dev-${uniq()}`;
    const q = await question({ device });
    const res = await server({ ALLOW_ANONYMOUS: "false" }).call(`${API}/ask/report`, post({ questionId: String(q), reason: "wrong", device }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "signin_required" });
  });

  it("refuses bad bodies", async () => {
    const a = await account();
    const q = String(await question({ accountId: a.id }));
    const s = server();
    const bad = [
      {},
      { questionId: q },
      { questionId: q, reason: "spam" },
      { questionId: q, reason: "wrong", note: "x".repeat(501) },
      { questionId: q, reason: "wrong", note: 5 },
      { questionId: "1; DROP TABLE reports", reason: "wrong" },
      { questionId: -1, reason: "wrong" },
      { questionId: 1.5, reason: "wrong" },
    ];
    for (const b of bad) {
      const res = await s.call(`${API}/ask/report`, post(b, a.auth));
      expect(res.status, JSON.stringify(b)).toBe(400);
      expect(await res.json()).toEqual({ error: "bad_request" });
    }
    expect((await s.call(`${API}/ask/report`, { method: "POST", headers: a.auth, body: "{" })).status).toBe(400);
    expect((await s.call(`${API}/ask/report`, { headers: a.auth })).status).toBe(405);
    // Without a sign-in or an install ID there is no reporter.
    expect((await s.call(`${API}/ask/report`, post({ questionId: q, reason: "wrong" }))).status).toBe(400);
    expect((await s.call(`${API}/ask/report`, post({ questionId: q, reason: "wrong", note: "x".repeat(500) }, a.auth))).status).toBe(200);
  });

  it("is idempotent: the same report again answers ok and keeps the first", async () => {
    const a = await account();
    const q = await question({ accountId: a.id });
    const s = server();
    for (const reason of ["wrong", "offensive", "wrong"]) {
      expect((await s.call(`${API}/ask/report`, post({ questionId: String(q), reason }, a.auth))).status).toBe(200);
    }
    expect(await count("reports WHERE question_id = ?", q)).toBe(1);
    expect(await db().prepare("SELECT reason FROM reports WHERE question_id = ?").bind(q).first()).toEqual({ reason: "wrong" });
    // Repeats don't count toward the daily limit.
    expect(await env.ASK_KV.get(`rep:a:${a.id}:${new Date().toISOString().slice(0, 10)}`)).toBe("1");
  });

  it("allows REPORT_DAILY_LIMIT new reports a day per reporter", async () => {
    const a = await account();
    const s = server({ REPORT_DAILY_LIMIT: "2" });
    const qs = [await question({ accountId: a.id }), await question({ accountId: a.id }), await question({ accountId: a.id })];
    expect((await s.call(`${API}/ask/report`, post({ questionId: String(qs[0]), reason: "wrong" }, a.auth))).status).toBe(200);
    expect((await s.call(`${API}/ask/report`, post({ questionId: String(qs[1]), reason: "wrong" }, a.auth))).status).toBe(200);
    const res = await s.call(`${API}/ask/report`, post({ questionId: String(qs[2]), reason: "wrong" }, a.auth));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
    // A report already made still answers ok.
    expect((await s.call(`${API}/ask/report`, post({ questionId: String(qs[0]), reason: "wrong" }, a.auth))).status).toBe(200);
    // Another reporter has its own limit.
    const b = await account();
    expect((await s.call(`${API}/ask/report`, post({ questionId: String(await question({ accountId: b.id })), reason: "wrong" }, b.auth))).status).toBe(200);
  });

  it("is not on the account host", async () => {
    const a = await account();
    const q = await question({ accountId: a.id });
    const res = await server().call(`${WEB}/ask/report`, post({ questionId: String(q), reason: "wrong" }, { ...a.auth, Origin: WEB }));
    expect(res.status).not.toBe(200);
    expect(await count("reports WHERE question_id = ?", q)).toBe(0);
  });
});

describe("parseReport", () => {
  it("keeps only what's valid", () => {
    expect(parseReport({ questionId: "12", reason: "wrong", note: "", device: "bad id!" })).toEqual({ questionId: 12, reason: "wrong", note: null, device: null });
    expect(parseReport({ questionId: 12, reason: "harmful", device: "dev-12345678" })).toEqual({ questionId: 12, reason: "harmful", note: null, device: "dev-12345678" });
    expect(parseReport(null)).toBeNull();
    expect(parseReport([])).toBeNull();
    expect(parseReport({ questionId: "0", reason: "wrong" })).toBeNull();
    expect(parseReport({ questionId: "1234567890123456", reason: "wrong" })).toBeNull();
  });
});

describe("reports are deleted with their question", () => {
  it("by the daily log cleanup", async () => {
    const a = await account();
    const old = await question({ accountId: a.id, ts: new Date(Date.now() - 91 * 86_400_000).toISOString() });
    const recent = await question({ accountId: a.id });
    const s = server();
    for (const q of [old, recent]) expect((await s.call(`${API}/ask/report`, post({ questionId: String(q), reason: "wrong" }, a.auth))).status).toBe(200);
    // A report whose question went some other way.
    await db().prepare("INSERT INTO reports (question_id, account_id, device, reason, note, created) VALUES (?, NULL, 'dev-orphan01', 'other', NULL, ?)")
      .bind(2_000_000_000, new Date().toISOString()).run();
    await worker.scheduled!(createScheduledController(), s.env);
    expect(await count("questions WHERE id = ?", old)).toBe(0);
    expect(await count("reports WHERE question_id = ?", old)).toBe(0);
    expect(await count("reports WHERE question_id = ?", 2_000_000_000)).toBe(0);
    expect(await count("reports WHERE question_id = ?", recent)).toBe(1);
  });

  it("and with the account", async () => {
    const a = await account();
    const q = await question({ accountId: a.id });
    const s = server();
    expect((await s.call(`${API}/ask/report`, post({ questionId: String(q), reason: "wrong" }, a.auth))).status).toBe(200);
    expect((await s.call(`${API}/account`, { method: "DELETE", headers: a.auth })).status).toBe(200);
    expect(await count("reports WHERE question_id = ? OR account_id = ?", q, a.id)).toBe(0);
  });
});

// ── Store review sign-in ──────────────────────────────────────

const CODE = "246810";
const reviewAddress = () => `review-${uniq()}@example.org`;

describe("review sign-in", () => {
  it("signs in with REVIEW_CODE, sending no email, only when both are set", async () => {
    const email = reviewAddress();
    const s = server({ REVIEW_EMAIL: email.toUpperCase(), REVIEW_CODE: CODE });
    const start = await s.call(`${API}/auth/email/start`, post({ email: ` ${email} ` }, { "CF-Connecting-IP": ip() }));
    expect(start.status).toBe(200);
    expect(await start.json()).toEqual({ ok: true });
    expect(s.resend).not.toHaveBeenCalled();
    const res = await s.call(`${API}/auth/email/verify`, post({ email, code: CODE, device: "test-device-0001" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; account: { email: string } };
    expect(body.token).toBeTruthy();
    expect(body.account.email).toBe(email);
    // Only the hash is stored, like any code.
    await s.call(`${API}/auth/email/start`, post({ email }, { "CF-Connecting-IP": ip() }));
    const row = await db().prepare("SELECT code_hash FROM email_codes WHERE email = ?").bind(email).first<{ code_hash: string }>();
    expect(row!.code_hash).not.toContain(CODE);
  });

  it("is off when either is unset: the address gets an emailed code like any other", async () => {
    const cases = [
      (email: string) => ({ REVIEW_EMAIL: email, REVIEW_CODE: "" }),
      (_email: string) => ({ REVIEW_EMAIL: "", REVIEW_CODE: CODE }),
      (email: string) => ({ REVIEW_EMAIL: email, REVIEW_CODE: "12345" }),
    ];
    for (const vars of cases) {
      const email = reviewAddress();
      const s = server(vars(email));
      expect((await s.call(`${API}/auth/email/start`, post({ email }, { "CF-Connecting-IP": ip() }))).status).toBe(200);
      expect(s.resend).toHaveBeenCalledTimes(1);
      const sent = s.codes.get(email)!;
      if (sent !== CODE) expect((await s.call(`${API}/auth/email/verify`, post({ email, code: CODE }))).status).toBe(401);
      expect((await s.call(`${API}/auth/email/verify`, post({ email, code: sent }))).status).toBe(200);
    }
  });

  it("leaves other addresses alone", async () => {
    const s = server({ REVIEW_EMAIL: reviewAddress(), REVIEW_CODE: CODE });
    const other = `owner-${uniq()}@example.org`;
    expect((await s.call(`${API}/auth/email/start`, post({ email: other }, { "CF-Connecting-IP": ip() }))).status).toBe(200);
    expect(s.resend).toHaveBeenCalledTimes(1);
    if (s.codes.get(other) !== CODE) expect((await s.call(`${API}/auth/email/verify`, post({ email: other, code: CODE }))).status).toBe(401);
  });

  it("refuses a wrong code and stops after 5 tries", async () => {
    const email = reviewAddress();
    const s = server({ REVIEW_EMAIL: email, REVIEW_CODE: CODE });
    await s.call(`${API}/auth/email/start`, post({ email }, { "CF-Connecting-IP": ip() }));
    for (let i = 0; i < 5; i++) {
      const res = await s.call(`${API}/auth/email/verify`, post({ email, code: "135790" }));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "wrong_code" });
    }
    const res = await s.call(`${API}/auth/email/verify`, post({ email, code: CODE }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "code_expired" });
    // A new start gives new tries.
    await s.call(`${API}/auth/email/start`, post({ email }, { "CF-Connecting-IP": ip() }));
    expect((await s.call(`${API}/auth/email/verify`, post({ email, code: CODE }))).status).toBe(200);
  });

  it("stops taking the review code after 20 wrong guesses over all requests, until REVIEW_CODE changes", async () => {
    const email = reviewAddress();
    const s = server({ REVIEW_EMAIL: email, REVIEW_CODE: CODE });
    for (let start = 0; start < 4; start++) {
      expect((await s.call(`${API}/auth/email/start`, post({ email }, { "CF-Connecting-IP": ip() }))).status).toBe(200);
      for (let i = 0; i < 5; i++) expect((await s.call(`${API}/auth/email/verify`, post({ email, code: "135790" }))).status).toBe(401);
    }
    // A fresh request resets the per-code tries, but the review code no longer works.
    expect((await s.call(`${API}/auth/email/start`, post({ email }, { "CF-Connecting-IP": ip() }))).status).toBe(200);
    const res = await s.call(`${API}/auth/email/verify`, post({ email, code: CODE }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "code_expired" });
    // A new REVIEW_CODE works again (the hourly request limit is cleared here to get past it).
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email)))]
      .map((b) => b.toString(16).padStart(2, "0")).join("");
    await env.ASK_KV.delete(`ec:${hash}`);
    const s2 = server({ REVIEW_EMAIL: email, REVIEW_CODE: "975310" });
    expect((await s2.call(`${API}/auth/email/start`, post({ email }, { "CF-Connecting-IP": ip() }))).status).toBe(200);
    expect((await s2.call(`${API}/auth/email/verify`, post({ email, code: "975310" }))).status).toBe(200);
  });

  it("doesn't count wrong guesses for other addresses toward the review lock", async () => {
    const email = reviewAddress();
    const s = server({ REVIEW_EMAIL: email, REVIEW_CODE: CODE });
    const other = `owner-${uniq()}@example.org`;
    for (let start = 0; start < 5; start++) {
      await s.call(`${API}/auth/email/start`, post({ email: other }, { "CF-Connecting-IP": ip() }));
      for (let i = 0; i < 5; i++) await s.call(`${API}/auth/email/verify`, post({ email: other, code: "000000" }));
    }
    await s.call(`${API}/auth/email/start`, post({ email }, { "CF-Connecting-IP": ip() }));
    expect((await s.call(`${API}/auth/email/verify`, post({ email, code: CODE }))).status).toBe(200);
  });

  it("keeps the code request limits", async () => {
    const email = reviewAddress();
    const s = server({ REVIEW_EMAIL: email, REVIEW_CODE: CODE });
    for (let i = 0; i < 5; i++) expect((await s.call(`${API}/auth/email/start`, post({ email }, { "CF-Connecting-IP": ip() }))).status).toBe(200);
    const res = await s.call(`${API}/auth/email/start`, post({ email }, { "CF-Connecting-IP": ip() }));
    expect(res.status).toBe(429);
  });

  it("the review account can't claim rewards or pay from a balance", async () => {
    const email = reviewAddress();
    const vars = { REVIEW_EMAIL: email, REVIEW_CODE: CODE };
    const a = await account({ email, cents: 500 });
    const s = server({ ...vars, ...ASK, DEVICE_DAILY_LIMIT: "0", ANTHROPIC_FETCH: claude() });
    for (const path of ["/rewards/play", "/rewards/apple"]) {
      const res = await s.call(`${API}${path}`, post({ productId: "prereg_credit_5", purchaseToken: `t.${"x".repeat(40)}`, appTransaction: "a.b.c" }, a.auth));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "review_account" });
    }
    const res = await s.call(`${API}/ask`, ask(`dev-${uniq()}`, a.auth));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited", reason: "free_used", balanceCents: 0 });
    expect(await count("ledger WHERE account_id = ?", a.id)).toBe(0);
    // An email sign-in to the review address on an account with another email counts too.
    const b = await account();
    await db().prepare("INSERT INTO identities (provider, subject, account_id, created) VALUES ('email', ?, ?, 'x')").bind(email, b.id).run();
    expect((await s.call(`${API}/rewards/play`, post({}, b.auth))).status).toBe(403);
    // Other accounts are unaffected.
    const c = await account();
    expect((await s.call(`${API}/rewards/play`, post({}, c.auth))).status).toBe(400);
  });
});
