import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";
import { ranges, resolveReport, STUCK_HOLD_MS } from "../src/usage";

const ADMIN = "https://admin.oceanlive.org";
const API = "https://api.oceanlive.org";
const WEB = "https://account.oceanlive.org";
const DEV = "https://ocean-live-ask.example.workers.dev";
const CLIENT_ID = "test-web-client.apps.googleusercontent.com";
const db = () => env.LOG_DB!;

let n = 0;
const uniq = () => `${Date.now().toString(36)}${++n}`;
const ip = () => `198.51.100.${(++n % 250) + 1}`;
const addr = (who: string) => `${who}-${uniq()}@example.com`;

async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── A fake Google (our own RSA key as Google's JWKS), as in admin.test.ts ──

let keys: CryptoKeyPair;
let jwk: JsonWebKey;
const KID = "usage-kid";

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  jwk = { ...((await crypto.subtle.exportKey("jwk", keys.publicKey)) as JsonWebKey), kid: KID, alg: "RS256", use: "sig" } as JsonWebKey;
});

const b64url = (bytes: Uint8Array | string) => {
  const b = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function idToken(email: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", kid: KID, typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: "https://accounts.google.com", aud: CLIENT_ID, sub: `g-${email}`, email, email_verified: true, iat: now, exp: now + 3600 }));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(`${header}.${body}`));
  return `${header}.${body}.${b64url(new Uint8Array(sig))}`;
}

function server(vars: Partial<Env> = {}) {
  const jwks = vi.fn(async () => Response.json({ keys: [jwk] }));
  const e: Env = { ...env, JWKS_FETCH: jwks as unknown as typeof fetch, GOOGLE_WEB_CLIENT_ID: CLIENT_ID, ...vars };
  async function call(url: string, init: RequestInit = {}) {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request(url, init), e, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  }
  return { call, env: e };
}
type Server = ReturnType<typeof server>;

const post = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: ADMIN, ...headers },
  body: JSON.stringify(body),
});

async function signIn(s: Server, email: string) {
  const res = await s.call(`${ADMIN}/auth/google`, post({ idToken: await idToken(email) }, { "CF-Connecting-IP": ip() }));
  expect(res.status).toBe(200);
  return res.headers.get("Set-Cookie")!.split(";")[0];
}

async function ownerSession(vars: Partial<Env> = {}) {
  const owner = addr("owner");
  const s = server({ ADMIN_EMAILS: owner, ...vars });
  return { s, owner, cookie: await signIn(s, owner) };
}

const get = async <T = Record<string, unknown>>(s: Server, path: string, cookie: string) => {
  const res = await s.call(`${ADMIN}${path}`, { headers: { Cookie: cookie } });
  return { status: res.status, body: (await res.json()) as T };
};

// ── Seeding ──

async function account(email = addr("user")) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db().prepare("INSERT INTO accounts (id, email, name, created, last_seen) VALUES (?, ?, 'Name', ?, ?)").bind(id, email, now, now).run();
  return { id, email };
}

interface Q {
  ts?: string;
  device?: string;
  lang?: string | null;
  question?: string;
  answer?: string | null;
  car?: string | null;
  micros?: number;
  accountId?: string | null;
}

async function question(q: Q = {}): Promise<number> {
  const r = await db()
    .prepare("INSERT INTO questions (ts, device, lang, question, history, car, answer, cost_micros, model, account_id) VALUES (?, ?, ?, ?, '[]', ?, ?, ?, 'm', ?)")
    .bind(
      q.ts ?? new Date().toISOString(),
      q.device ?? `dev-${uniq()}`,
      q.lang === undefined ? "en" : q.lang,
      q.question ?? "What does B208896 mean?",
      q.car ?? null,
      q.answer === undefined ? "It means something." : q.answer,
      q.micros ?? 1000,
      q.accountId ?? null,
    )
    .run();
  return r.meta.last_row_id!;
}

async function report(questionId: number, opts: { reason?: string; note?: string | null; accountId?: string | null; device?: string | null } = {}) {
  const r = await db()
    .prepare("INSERT INTO reports (question_id, account_id, device, reason, note, created) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(questionId, opts.accountId ?? null, opts.device ?? `dev-${uniq()}`, opts.reason ?? "wrong", opts.note ?? null, new Date().toISOString())
    .run();
  return r.meta.last_row_id!;
}

interface Summary {
  day: string;
  month: string;
  questions: { today: number; month: number };
  costMicros: { today: number; month: number };
  spend: { monthMicros: number; capMicros: number };
  accounts: { total: number; newLast7Days: number };
  paid: { today: { questions: number; cents: number; unsettled: number }; month: { questions: number; cents: number; unsettled: number } };
  balances: { totalCents: number; accounts: number };
  rewards: { play: number; apple: number };
  openReports: number;
  days: { day: string; questions: number; costMicros: number }[];
  languages: { lang: string; questions: number }[];
  signedIn: { signedIn: number; anonymous: number };
}

const langCount = (s: Summary, lang: string) => s.languages.find((l) => l.lang === lang)?.questions ?? 0;

describe("usage endpoints: who can see them", () => {
  it("are the admin page's first tab after Home", async () => {
    const s = server();
    const page = await (await s.call(`${ADMIN}/`)).text();
    const tabs = [...page.matchAll(/role="tab"[^>]*aria-controls="panel-(\w+)"/g)].map((m) => m[1]);
    expect(tabs.slice(0, 2)).toEqual(["home", "usage"]);
    expect(page).toMatch(/id="tab-home"[^>]*aria-selected="true"/);
    expect(page).toMatch(/id="panel-home"(?![^>]*hidden)[^>]*>/);
    expect(page).toMatch(/id="panel-usage"[^>]*hidden/);
    const js = await (await s.call(`${ADMIN}/admin.js`)).text();
    for (const path of ["/admin/usage", "/admin/usage/questions", "/admin/reports", "/admin/reports/resolve"]) expect(js).toContain(path);
  });

  it("page details: readable chart labels, exact cost axis, accessible report count, data cleared on sign-out", async () => {
    const s = server();
    const [page, js, css] = await Promise.all(["/", "/admin.js", "/admin.css"].map(async (p) => (await s.call(`${ADMIN}${p}`)).text()));
    // Pull named top-level functions and constants out of the page script to run them here.
    const fnSource = (name: string) => {
      const start = js.indexOf(`function ${name}(`);
      expect(start).toBeGreaterThanOrEqual(0);
      let depth = 0;
      for (let i = js.indexOf("{", start); i < js.length; i++) {
        if (js[i] === "{") depth++;
        else if (js[i] === "}" && --depth === 0) return js.slice(start, i + 1);
      }
      throw new Error(name);
    };
    const constSource = (name: string) => js.match(new RegExp(`^const ${name} = .*;$`, "m"))![0];
    const lib = new Function(
      [constSource("COST_MIN_MAX"), fnSource("niceMax"), fnSource("usd"), fnSource("num"), fnSource("dollars"), fnSource("costAxis"), fnSource("paidSub"),
        "return { costAxis, paidSub };"].join(";\n"),
    )() as { costAxis: (m: number) => (v: number) => string; paidSub: (p: { cents: number; unsettled: number }) => string };
    // The middle gridline of a 5-cent day is $0.025, not "$0.03"; a month with no cost still has exact labels.
    expect(lib.costAxis(50_000)(25_000)).toBe("$0.0250");
    expect(lib.costAxis(0)(5_000)).toBe("$0.0050");
    expect(lib.costAxis(3_000_000)(2_500_000)).toBe("$2.50");
    expect(lib.paidSub({ cents: 7, unsettled: 0 })).toBe("$0.07 charged");
    expect(lib.paidSub({ cents: 7, unsettled: 1 })).toContain("1 never settled");
    // Charts are drawn at the container's width (1 SVG unit = 1 CSS px), not scaled down from 600.
    expect(fnSource("barChart")).toContain("container.clientWidth");
    // Language shares are of all questions, not of the 20 listed languages.
    expect(fnSource("renderSplit")).toMatch(/const total = u\.signedIn\.signedIn \+ u\.signedIn\.anonymous/);
    // The tab's count is read as "3 open" (a visually hidden word, not aria-label on a span).
    expect(page).toMatch(/id="reports-badge"[^>]*>.*<span class="sr-only"> open<\/span><\/span><\/button>/);
    expect(js).not.toMatch(/badge\.setAttribute\("aria-label"/);
    // The count's colours are a token pair (white on #ff8a7a failed contrast in dark mode).
    expect(css).toMatch(/\.count \{ background: var\(--count-bg\); color: var\(--count-ink\);/);
    expect(css).toMatch(/--count-ink: #04223a;/);
    // An ended session clears the questions, answers and readings from the page, like Sign out.
    expect(fnSource("signedOut")).toContain("clearData();");
    for (const id of ["recent", "reports", "cards", "ledger"]) expect(fnSource("clearData")).toContain(`"${id}"`);
    // Stale page loads are dropped, and focus isn't lost when a focused button goes away.
    expect(fnSource("loadRecent")).toContain("gen !== recentGen");
    expect(fnSource("loadReports")).toContain("gen !== reportsGen");
    const resolveSrc = fnSource("resolve");
    expect(resolveSrc.indexOf("statusEl.focus();")).toBeGreaterThan(0);
    expect(resolveSrc.indexOf("statusEl.focus();")).toBeLessThan(resolveSrc.indexOf("button.parentElement.remove();"));
    expect(js).toContain("function focusAfterMore(");
  });

  it("are 404 without an admin session, on every other host and for app sessions", async () => {
    const { s, cookie } = await ownerSession();
    const paths = ["/admin/usage", "/admin/usage/questions", "/admin/reports", "/admin/reports?status=all"];
    for (const path of paths) {
      expect((await s.call(`${ADMIN}${path}`)).status, path).toBe(404);
      expect((await s.call(`${ADMIN}${path}`, { headers: { Cookie: "__Host-oladmin=AAAAAAAAAAAAAAAAAAAAAAAAAAAA" } })).status, path).toBe(404);
      for (const host of [API, WEB, DEV]) {
        // Even with a valid admin cookie: the admin endpoints only exist on admin.oceanlive.org.
        expect((await s.call(`${host}${path}`, { headers: { Cookie: cookie } })).status, `${host}${path}`).toBe(404);
      }
    }
    for (const host of [API, WEB, DEV]) {
      const res = await s.call(`${host}/admin/reports/resolve`, post({ id: 1 }, { Origin: host, Cookie: cookie }));
      expect(res.status, host).toBe(404);
    }
    expect((await s.call(`${ADMIN}/admin/reports/resolve`, post({ id: 1 }))).status).toBe(404);

    // An app account's session token counts for nothing here.
    const a = await account();
    const token = `tok_${crypto.randomUUID().replace(/-/g, "")}`;
    const now = new Date().toISOString();
    await db().prepare("INSERT INTO sessions (token_hash, account_id, created, last_used, expires) VALUES (?, ?, ?, ?, ?)")
      .bind(await sha256Hex(token), a.id, now, now, new Date(Date.now() + 86_400_000).toISOString()).run();
    const tries: Record<string, string>[] = [{ Authorization: `Bearer ${token}` }, { Cookie: `__Host-olaccount=${token}` }, { Cookie: `__Host-oladmin=${token}` }];
    for (const headers of tries) {
      expect((await s.call(`${ADMIN}/admin/usage`, { headers })).status).toBe(404);
    }
  });

  it("are open to owners and to admins an owner added", async () => {
    const { s, cookie } = await ownerSession();
    const helper = addr("helper");
    expect((await s.call(`${ADMIN}/admin/admins/add`, post({ email: helper }, { Cookie: cookie }))).status).toBe(200);
    const hc = await signIn(s, helper);
    for (const c of [cookie, hc]) {
      for (const path of ["/admin/usage", "/admin/usage/questions", "/admin/reports"]) {
        expect((await get(s, path, c)).status, path).toBe(200);
      }
    }
  });

  it("only take GET, and resolving needs the admin Origin", async () => {
    const { s, cookie } = await ownerSession();
    const res = await s.call(`${ADMIN}/admin/usage`, post({}, { Cookie: cookie }));
    expect(res.status).toBe(405);
    const q = await question();
    const r = await report(q);
    const bad = await s.call(`${ADMIN}/admin/reports/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, Origin: WEB },
      body: JSON.stringify({ id: r }),
    });
    expect(bad.status).toBe(403);
    expect((await db().prepare("SELECT resolved_at FROM reports WHERE id = ?").bind(r).first<{ resolved_at: string | null }>())!.resolved_at).toBeNull();
  });
});

describe("usage summary", () => {
  it("counts questions, cost, accounts, paid questions, balances, rewards and open reports correctly", async () => {
    const { s, cookie } = await ownerSession({ MONTHLY_CAP_USD: "25" });
    const r = ranges(new Date());
    await env.ASK_KV.put(`spend:${r.month}`, "4321000");
    const before = (await get<Summary>(s, "/admin/usage", cookie)).body;

    const a = await account();
    const now = Date.now();
    const today = new Date().toISOString();
    const threeDaysAgo = new Date(now - 3 * 86_400_000).toISOString();
    const longAgo = new Date(now - 40 * 86_400_000).toISOString();
    const stuckTs = new Date(now - STUCK_HOLD_MS - 60_000).toISOString();
    const q1 = await question({ ts: today, lang: "de-DE,de;q=0.9", micros: 1500, accountId: a.id });
    await question({ ts: today, lang: "en-GB", micros: 2500 });
    await question({ ts: threeDaysAgo, lang: "en", micros: 7000 });
    await question({ ts: longAgo, lang: "fr", micros: 9000 });
    await question({ ts: today, lang: null, micros: 0 });

    const ins = (accountId: string, delta: number, kind: string, ref: string, note: string | null, created = today) =>
      db().prepare("INSERT INTO ledger (account_id, delta_cents, kind, ref, note, created) VALUES (?, ?, ?, ?, ?, ?)").bind(accountId, delta, kind, ref, note, created);
    const playRef = `play:${uniq()}`;
    const appleRef = `apple:${uniq()}`;
    await db().batch([
      ins(a.id, -3, "question", `question:${q1}`, null),
      // A question still being answered isn't counted yet.
      ins(a.id, -3, "question", `hold:${uniq()}`, "hold"),
      // A hold that never settled is a charge (its cents stay taken).
      ins(a.id, -4, "question", `hold:${uniq()}`, "hold", stuckTs),
      ins(a.id, 500, "reward", playRef, "Play reward"),
      db().prepare("INSERT INTO balances (account_id, cents, updated) VALUES (?, 494, ?)").bind(a.id, today),
      db().prepare("INSERT INTO reward_claims (ref, claimed) VALUES (?, ?)").bind(playRef, today),
      db().prepare("INSERT INTO reward_claims (ref, claimed) VALUES (?, ?)").bind(appleRef, today),
    ]);
    const open = await report(q1, { accountId: a.id, device: null });
    const done = await report(q1);
    await db().prepare("UPDATE reports SET resolved_at = ?, resolved_by = 'x@example.com' WHERE id = ?").bind(today, done).run();

    const res = await get<Summary>(s, "/admin/usage", cookie);
    expect(res.status).toBe(200);
    const after = res.body;
    const inMonth = threeDaysAgo >= r.monthStart;

    expect(after.day).toBe(r.day);
    expect(after.questions.today - before.questions.today).toBe(3);
    expect(after.questions.month - before.questions.month).toBe(inMonth ? 4 : 3);
    expect(after.costMicros.today - before.costMicros.today).toBe(4000);
    expect(after.costMicros.month - before.costMicros.month).toBe(inMonth ? 11000 : 4000);
    expect(after.spend).toEqual({ monthMicros: 4321000, capMicros: 25_000_000 });
    expect(after.accounts.total - before.accounts.total).toBe(1);
    expect(after.accounts.newLast7Days - before.accounts.newLast7Days).toBe(1);
    const stuckToday = stuckTs >= r.dayStart ? 1 : 0;
    const stuckMonth = stuckTs >= r.monthStart ? 1 : 0;
    expect(after.paid.today.questions - before.paid.today.questions).toBe(1 + stuckToday);
    expect(after.paid.today.cents - before.paid.today.cents).toBe(3 + 4 * stuckToday);
    expect(after.paid.today.unsettled - before.paid.today.unsettled).toBe(stuckToday);
    expect(after.paid.month.questions - before.paid.month.questions).toBe(1 + stuckMonth);
    expect(after.paid.month.cents - before.paid.month.cents).toBe(3 + 4 * stuckMonth);
    expect(after.paid.month.unsettled - before.paid.month.unsettled).toBe(stuckMonth);
    expect(after.balances.totalCents - before.balances.totalCents).toBe(494);
    expect(after.balances.accounts - before.balances.accounts).toBe(1);
    expect(after.rewards.play - before.rewards.play).toBe(1);
    expect(after.rewards.apple - before.rewards.apple).toBe(1);
    expect(after.openReports - before.openReports).toBe(1);
    expect(open).toBeGreaterThan(0);

    // 30 days, oldest first, ending today; the question from 40 days ago is outside.
    expect(after.days).toHaveLength(30);
    expect(after.days[29].day).toBe(r.day);
    expect(after.days[0].day).toBe(r.days[0]);
    expect(after.days[29].questions - before.days[29].questions).toBe(3);
    expect(after.days[29].costMicros - before.days[29].costMicros).toBe(4000);
    const d3 = after.days.findIndex((d) => d.day === threeDaysAgo.slice(0, 10));
    expect(after.days[d3].questions - before.days[d3].questions).toBe(1);
    const sum = (x: Summary) => x.days.reduce((t, d) => t + d.questions, 0);
    expect(sum(after) - sum(before)).toBe(4);

    expect(langCount(after, "de") - langCount(before, "de")).toBe(1);
    expect(langCount(after, "en") - langCount(before, "en")).toBe(2);
    expect(langCount(after, "fr") - langCount(before, "fr")).toBe(0);
    expect(langCount(after, "") - langCount(before, "")).toBe(1);
    expect(after.signedIn.signedIn - before.signedIn.signedIn).toBe(1);
    expect(after.signedIn.anonymous - before.signedIn.anonymous).toBe(3);
  });
});

describe("recent questions", () => {
  it("lists the newest 50 with a cursor for older ones, and never who asked", async () => {
    const { s, cookie } = await ownerSession();
    const a = await account(addr("asker"));
    const device = `secret-device-${uniq()}`;
    const ids: number[] = [];
    for (let i = 0; i < 55; i++) ids.push(await question({ question: `Question ${i}`, device, accountId: i % 2 ? a.id : null, micros: 100 + i }));
    const paidId = await question({ question: "Paid one", answer: "Paid answer", car: "SoC 80%", device, accountId: a.id, micros: 25_000 });
    await db().prepare("INSERT INTO ledger (account_id, delta_cents, kind, ref, note, created) VALUES (?, -3, 'question', ?, NULL, ?)")
      .bind(a.id, `question:${paidId}`, new Date().toISOString()).run();
    const declined = await question({ question: "Declined one", answer: null, device });

    const first = await get<{ questions: Record<string, unknown>[]; next: number | null }>(s, "/admin/usage/questions", cookie);
    expect(first.status).toBe(200);
    expect(first.body.questions).toHaveLength(50);
    const got = first.body.questions.map((q) => q.id as number);
    expect(got).toEqual([...got].sort((x, y) => y - x));
    expect(got[0]).toBe(declined);
    expect(first.body.next).toBe(got[49]);

    // Only these fields: nothing that identifies the asker.
    for (const q of first.body.questions) {
      expect(Object.keys(q).sort()).toEqual(["answer", "car", "chargedCents", "costMicros", "id", "lang", "paid", "question", "ts"]);
    }
    const text = JSON.stringify(first.body);
    expect(text).not.toContain(device);
    expect(text).not.toContain(a.id);
    expect(text).not.toContain(a.email);

    const paid = first.body.questions.find((q) => q.id === paidId)!;
    expect(paid).toMatchObject({ question: "Paid one", answer: "Paid answer", car: "SoC 80%", costMicros: 25_000, paid: true, chargedCents: 3 });
    expect(first.body.questions.find((q) => q.id === declined)).toMatchObject({ answer: null, paid: false, chargedCents: null });

    const second = await get<{ questions: { id: number }[]; next: number | null }>(s, `/admin/usage/questions?before=${first.body.next}`, cookie);
    expect(second.body.questions[0].id).toBeLessThan(first.body.next!);
    expect(second.body.questions.length).toBeGreaterThan(0);
    expect(second.body.questions.length).toBeLessThanOrEqual(50);
    // A bad cursor is the newest page.
    expect((await get<{ questions: { id: number }[] }>(s, "/admin/usage/questions?before=abc", cookie)).body.questions[0].id).toBe(declined);
  });
});

describe("reports", () => {
  it("lists open reports newest first with the question and answer, never the reporter", async () => {
    const { s, cookie } = await ownerSession();
    const a = await account(addr("reporter"));
    const device = `reporter-device-${uniq()}`;
    const q = await question({ question: "Is it safe to drive?", answer: "Bad answer", accountId: a.id });
    const r1 = await report(q, { reason: "harmful", note: "This is dangerous", accountId: a.id, device: null });
    const q2 = await question({ question: "Other", device });
    const r2 = await report(q2, { reason: "offensive", device });

    const res = await get<{ reports: Record<string, unknown>[]; next: number | null }>(s, "/admin/reports", cookie);
    expect(res.status).toBe(200);
    const ids = res.body.reports.map((x) => x.id as number);
    expect(ids.indexOf(r2)).toBeLessThan(ids.indexOf(r1));
    expect(res.body.reports.find((x) => x.id === r1)).toMatchObject({
      reason: "harmful",
      note: "This is dangerous",
      questionId: q,
      question: "Is it safe to drive?",
      answer: "Bad answer",
      resolvedAt: null,
      resolvedBy: null,
    });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(a.id);
    expect(text).not.toContain(a.email);
    expect(text).not.toContain(device);
    for (const r of res.body.reports) for (const key of ["account_id", "accountId", "device", "email"]) expect(r).not.toHaveProperty(key);
  });

  it("resolves a report once, logs it in admin_log, and moves it out of the open list", async () => {
    const { s, owner, cookie } = await ownerSession();
    const q = await question();
    const r = await report(q, { reason: "wrong" });

    const res = await s.call(`${ADMIN}/admin/reports/resolve`, post({ id: r }, { Cookie: cookie }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; resolvedAt: string; resolvedBy: string };
    expect(body).toMatchObject({ ok: true, resolvedBy: owner });
    const row = await db().prepare("SELECT resolved_at, resolved_by FROM reports WHERE id = ?").bind(r).first<{ resolved_at: string; resolved_by: string }>();
    expect(row).toEqual({ resolved_at: body.resolvedAt, resolved_by: owner });

    const log = await db().prepare("SELECT email, action, detail, account_id FROM admin_log WHERE action = 'report_resolve' AND email = ?").bind(owner)
      .all<{ email: string; action: string; detail: string; account_id: string | null }>();
    expect(log.results).toHaveLength(1);
    expect(JSON.parse(log.results[0].detail)).toEqual({ reportId: r, questionId: q });
    expect(log.results[0].account_id).toBeNull();

    // Again: nothing changes and nothing more is logged.
    const again = await s.call(`${ADMIN}/admin/reports/resolve`, post({ id: String(r) }, { Cookie: cookie }));
    expect(await again.json()).toEqual({ ok: true, alreadyResolved: true, resolvedAt: body.resolvedAt, resolvedBy: owner });
    expect((await db().prepare("SELECT COUNT(*) AS n FROM admin_log WHERE action = 'report_resolve' AND email = ?").bind(owner).first<{ n: number }>())!.n).toBe(1);

    const open = (await get<{ reports: { id: number }[] }>(s, "/admin/reports", cookie)).body.reports.map((x) => x.id);
    expect(open).not.toContain(r);
    const all = (await get<{ reports: { id: number; resolvedBy: string }[] }>(s, "/admin/reports?status=all", cookie)).body.reports;
    expect(all.find((x) => x.id === r)).toMatchObject({ resolvedBy: owner });

    // The owner's log shows it.
    const ownerLog = (await get<{ log: { action: string }[] }>(s, "/admin/log", cookie)).body.log.map((l) => l.action);
    expect(ownerLog).toContain("report_resolve");
  });

  it("logs a resolve once even when a second resolve has the same email and timestamp", async () => {
    const r = await report(await question());
    const email = addr("same-ms");
    const fixed = new Date().toISOString();
    const spy = vi.spyOn(Date.prototype, "toISOString").mockReturnValue(fixed);
    try {
      const first = (await (await resolveReport(db(), email, { id: r })).json()) as Record<string, unknown>;
      const second = (await (await resolveReport(db(), email, { id: r })).json()) as Record<string, unknown>;
      expect(first).toEqual({ ok: true, resolvedAt: fixed, resolvedBy: email });
      expect(second).toEqual({ ok: true, alreadyResolved: true, resolvedAt: fixed, resolvedBy: email });
    } finally {
      spy.mockRestore();
    }
    const n = await db().prepare("SELECT COUNT(*) AS n FROM admin_log WHERE action = 'report_resolve' AND email = ?").bind(email).first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  it("refuses unknown or invalid reports and counts resolving as an admin write", async () => {
    const { s, cookie } = await ownerSession({ ADMIN_WRITE_LIMIT: "3" });
    expect((await s.call(`${ADMIN}/admin/reports/resolve`, post({ id: 999_999_999 }, { Cookie: cookie }))).status).toBe(404);
    expect((await s.call(`${ADMIN}/admin/reports/resolve`, post({ id: "x" }, { Cookie: cookie }))).status).toBe(400);
    const r = await report(await question());
    expect((await s.call(`${ADMIN}/admin/reports/resolve`, post({ id: r }, { Cookie: cookie }))).status).toBe(200);
    expect((await s.call(`${ADMIN}/admin/reports/resolve`, post({ id: r }, { Cookie: cookie }))).status).toBe(429);
  });

  it("lets an added admin resolve reports too", async () => {
    const { s, cookie } = await ownerSession();
    const helper = addr("helper");
    await s.call(`${ADMIN}/admin/admins/add`, post({ email: helper }, { Cookie: cookie }));
    const hc = await signIn(s, helper);
    const r = await report(await question());
    const res = await s.call(`${ADMIN}/admin/reports/resolve`, post({ id: r }, { Cookie: hc }));
    expect(await res.json()).toMatchObject({ ok: true, resolvedBy: helper });
  });
});
