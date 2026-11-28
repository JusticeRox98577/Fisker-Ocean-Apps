/**
 * Pre-orders: reserve a Nova Light or a SuperNova without paying anything.
 *
 *   GET  /api/preorder/info          { open, products: [{ id, name, price, deposit, goal, reserved }] }
 *   POST /api/preorder               { product, email, name, region, car, notes, consent, website }
 *                                    -> { ok: true }; emails a link to confirm (same answer for every address)
 *   POST /api/reservation            { token } -> { product, name, status, position, reserved, goal, price, deposit }
 *   POST /api/reservation/confirm    { token }
 *   POST /api/reservation/cancel     { token }
 *
 * Admin (signed in):
 *   GET  /api/admin/preorders              ?format=json|csv
 *   POST /api/admin/preorders/request      { product, link }  emails everyone confirmed for that product
 *                                          the deposit link, once it has reached its goal
 *   POST /api/admin/preorders/mark         { id, status: confirmed | deposit_paid | cancelled }
 *
 * Nobody is charged here. A reservation only counts once its email is confirmed. When a product
 * reaches its goal (10), the admin gets an email, and from /admin sends everyone a link to pay the
 * refundable deposit (a payment link made in the payment provider). The rest is due before shipping.
 * Each person keeps the price they reserved at.
 */
import type { Env } from "./env";
import { EMAIL, line, text } from "./form";
import { sendEmail } from "./mail";
import { json, plainHeaders, randomToken, sha256 } from "./util";

export interface Product {
  name: string;
  /** US cents. */
  price: number;
  deposit: number;
  /** Confirmed reservations before anyone is asked for a deposit. */
  goal: number;
  /** One line for the emails. */
  blurb: string;
}

// EDIT: what can be pre-ordered, the prices (US cents) and the goals. Only these two for now; add the
// Flare and Quasar here when they open. Changing a price affects new reservations only.
export const PRODUCTS: Record<string, Product> = {
  light: {
    name: "Nova Light",
    price: 17900,
    deposit: 5000,
    goal: 10,
    blurb: "the cellular CAN reader: charge, 12V, location and alerts in the app, from anywhere",
  },
  supernova: {
    name: "SuperNova",
    price: 59900,
    deposit: 10000,
    goal: 10,
    blurb: "everything in one box: Android on the center screen, live data, its own LTE, and remote lock and climate",
  },
};

/** Statuses that count towards a product's goal. */
const COUNTED = ["confirmed", "deposit_requested", "deposit_paid"];
const COUNTED_SQL = COUNTED.map((s) => `'${s}'`).join(", ");
const UNCONFIRMED_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

const dollars = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
const open = (env: Env) => String(env.PREORDERS_CLOSED ?? "").trim().toLowerCase() !== "true";

interface Row {
  id: number;
  product: string;
  email: string;
  name: string;
  region: string;
  car: string;
  notes: string;
  status: string;
  price_cents: number;
  deposit_cents: number;
  created_at: number;
  confirmed_at: number | null;
  deposit_requested_at: number | null;
  paid_at: number | null;
  cancelled_at: number | null;
}

async function counts(db: D1Database): Promise<Record<string, number>> {
  const { results } = await db
    .prepare(`SELECT product, COUNT(*) AS n FROM preorders WHERE status IN (${COUNTED_SQL}) GROUP BY product`)
    .all<{ product: string; n: number }>();
  const out: Record<string, number> = {};
  for (const id of Object.keys(PRODUCTS)) out[id] = 0;
  for (const r of results) out[r.product] = r.n;
  return out;
}

/** GET /api/preorder/info: prices and counts only, never who. */
export async function info(env: Env): Promise<Response> {
  const n = await counts(env.DB);
  return json({
    open: open(env),
    products: Object.entries(PRODUCTS).map(([id, p]) => ({
      id, name: p.name, price: p.price, deposit: p.deposit, goal: p.goal, reserved: n[id] ?? 0,
    })),
  });
}

function link(env: Env, token: string): string {
  return `${env.PREORDER_URL || env.SITE_URL}/reservation#${token}`;
}

// EDIT: the emails.
function confirmEmail(p: Product, name: string, url: string): { subject: string; text: string } {
  return {
    subject: `Confirm your ${p.name} reservation`,
    text:
      `${name ? `Hi ${name},` : "Hi,"}\n\n` +
      `Thanks for reserving a ${p.name}, ${p.blurb}. Please confirm it here:\n\n${url}\n\n` +
      `Nothing is charged now. Once ${p.goal} people have confirmed a ${p.name} reservation, I'll email you a link to pay a refundable ${dollars(p.deposit)} deposit. ` +
      `The rest (${dollars(p.price - p.deposit)} of the ${dollars(p.price)} price) is due before your unit ships, and you can cancel and get your deposit back until then.\n\n` +
      `Keep this email: the same link shows your place in line and lets you cancel at any time. ` +
      `If you didn't ask for this, ignore it and the reservation is deleted in ${UNCONFIRMED_DAYS} days.\n\n` +
      `Justice\nOcean Live LLC`,
  };
}

function alreadyEmail(p: Product, name: string, url: string): { subject: string; text: string } {
  return {
    subject: `Your ${p.name} reservation`,
    text:
      `${name ? `Hi ${name},` : "Hi,"}\n\n` +
      `You already have a ${p.name} reservation, so nothing changed. Here's a fresh link to see it or cancel it (the old link no longer works):\n\n${url}\n\n` +
      `Justice\nOcean Live LLC`,
  };
}

/** POST /api/preorder. The answer is the same whether or not the address already has a reservation. */
export async function reserve(env: Env, body: Record<string, unknown>, now: number): Promise<Response> {
  if (!open(env)) return json({ error: "Pre-orders are closed for now." }, 403);
  if (String(body.website ?? "").trim()) return json({ ok: true }); // honeypot
  const id = String(body.product ?? "");
  const p = PRODUCTS[id];
  if (!p) return json({ error: "Pick a product." }, 400);
  const email = line(body.email, 254).toLowerCase();
  if (!EMAIL.test(email)) return json({ error: "Enter a valid email address." }, 400);
  if (body.consent !== true) return json({ error: "Tick the box to agree to the pre-order terms." }, 400);
  const name = line(body.name, 100);
  const region = line(body.region, 100);
  const car = line(body.car, 100);
  const notes = text(body.notes, 1000);

  const token = randomToken();
  const hash = await sha256(token);
  const old = await env.DB.prepare("SELECT status FROM preorders WHERE email = ?1 AND product = ?2")
    .bind(email, id).first<{ status: string }>();
  const active = !!old && old.status !== "unconfirmed" && old.status !== "cancelled";

  if (active) {
    // Already reserved: send a fresh link, change nothing else.
    const sent = await sendEmail(env, { to: email, ...alreadyEmail(p, name, link(env, token)) });
    if (!sent.ok) return json({ error: "Couldn't send the email. Please try again in a few minutes." }, 502);
    await env.DB.prepare("UPDATE preorders SET token_hash = ?3 WHERE email = ?1 AND product = ?2").bind(email, id, hash).run();
    return json({ ok: true });
  }
  const sent = await sendEmail(env, { to: email, ...confirmEmail(p, name, link(env, token)) });
  if (!sent.ok) return json({ error: "Couldn't send the email. Please try again in a few minutes." }, 502);
  await env.DB.prepare(
    `INSERT INTO preorders (product, email, name, region, car, notes, status, token_hash, price_cents, deposit_cents, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'unconfirmed', ?7, ?8, ?9, ?10)
     ON CONFLICT(email, product) DO UPDATE SET
       name = excluded.name, region = excluded.region, car = excluded.car, notes = excluded.notes,
       status = 'unconfirmed', token_hash = excluded.token_hash, price_cents = excluded.price_cents,
       deposit_cents = excluded.deposit_cents, created_at = excluded.created_at,
       confirmed_at = NULL, deposit_requested_at = NULL, paid_at = NULL, cancelled_at = NULL`,
  )
    .bind(id, email, name, region, car, notes, hash, p.price, p.deposit, now)
    .run();
  return json({ ok: true });
}

async function byToken(db: D1Database, token: string): Promise<Row | null> {
  if (!token) return null;
  return db.prepare("SELECT * FROM preorders WHERE token_hash = ?1").bind(await sha256(token)).first<Row>();
}

const badLink = () => json({ error: "This link isn't valid any more. Use the newest email about your reservation, or reserve again." }, 404);

async function view(db: D1Database, r: Row): Promise<Record<string, unknown>> {
  const p = PRODUCTS[r.product];
  const n = (await counts(db))[r.product] ?? 0;
  let position = 0;
  if (COUNTED.includes(r.status) && r.confirmed_at !== null) {
    const ahead = await db
      .prepare(`SELECT COUNT(*) AS n FROM preorders WHERE product = ?1 AND status IN (${COUNTED_SQL}) AND (confirmed_at < ?2 OR (confirmed_at = ?2 AND id < ?3))`)
      .bind(r.product, r.confirmed_at, r.id)
      .first<{ n: number }>();
    position = (ahead?.n ?? 0) + 1;
  }
  return {
    product: r.product, productName: p?.name ?? r.product, name: r.name, status: r.status, position,
    reserved: n, goal: p?.goal ?? 10, price: r.price_cents, deposit: r.deposit_cents,
  };
}

/** POST /api/reservation { token } */
export async function show(env: Env, token: string): Promise<Response> {
  const r = await byToken(env.DB, token);
  return r ? json(await view(env.DB, r)) : badLink();
}

/** POST /api/reservation/confirm { token } */
export async function confirm(env: Env, ctx: ExecutionContext, token: string, now: number): Promise<Response> {
  const r = await byToken(env.DB, token);
  if (!r) return badLink();
  if (r.status === "unconfirmed" || r.status === "cancelled") {
    await env.DB.prepare("UPDATE preorders SET status = 'confirmed', confirmed_at = ?2, cancelled_at = NULL WHERE id = ?1").bind(r.id, now).run();
    r.status = "confirmed";
    r.confirmed_at = now;
    const p = PRODUCTS[r.product];
    const n = (await counts(env.DB))[r.product] ?? 0;
    if (p && n === p.goal) {
      // EDIT: the email to the admin when a product reaches its goal.
      ctx.waitUntil(
        sendEmail(env, {
          to: env.ADMIN_EMAIL,
          subject: `${p.name}: ${p.goal} confirmed reservations`,
          text:
            `${p.name} has reached ${p.goal} confirmed reservations. When you're ready to build them, make a ${dollars(p.deposit)} deposit payment link ` +
            `and send it to everyone from the Pre-orders section of ${env.SITE_URL}/admin.`,
        }).then((x) => { if (!x.ok) console.error("goal notice not sent", x.error); }),
      );
    }
  }
  return json(await view(env.DB, r));
}

/** POST /api/reservation/cancel { token }. A paid deposit is refunded by hand (the admin gets an email). */
export async function cancel(env: Env, ctx: ExecutionContext, token: string, now: number): Promise<Response> {
  const r = await byToken(env.DB, token);
  if (!r) return badLink();
  if (r.status !== "cancelled") {
    await env.DB.prepare("UPDATE preorders SET status = 'cancelled', cancelled_at = ?2 WHERE id = ?1").bind(r.id, now).run();
    const p = PRODUCTS[r.product];
    const who = r.name ? `${r.name} (${r.email})` : r.email;
    ctx.waitUntil(
      sendEmail(env, {
        to: env.ADMIN_EMAIL,
        subject: `${p?.name ?? r.product}: ${who} cancelled${r.status === "deposit_paid" ? " (refund the deposit)" : ""}`,
        text: r.status === "deposit_paid"
          ? `${who} cancelled their ${p?.name ?? r.product} reservation after paying the deposit. Refund ${dollars(r.deposit_cents)} in the payment provider.`
          : `${who} cancelled their ${p?.name ?? r.product} reservation. Nothing to refund.`,
      }).then((x) => { if (!x.ok) console.error("cancel notice not sent", x.error); }),
    );
    r.status = "cancelled";
  }
  return json(await view(env.DB, r));
}

/** GET /api/admin/preorders */
export async function list(env: Env, url: URL, now: number): Promise<Response> {
  const { results } = await env.DB.prepare("SELECT * FROM preorders ORDER BY product, COALESCE(confirmed_at, created_at)").all<Row>();
  const n = await counts(env.DB);
  if (url.searchParams.get("format") === "csv") {
    const cols = ["id", "product", "status", "email", "name", "region", "car", "notes", "price_cents", "deposit_cents",
      "created_at", "confirmed_at", "deposit_requested_at", "paid_at", "cancelled_at"] as const;
    const cell = (v: unknown) => {
      let s = v === null || v === undefined ? "" : String(v);
      if (/^[=+\-@]/.test(s)) s = "'" + s; // no formulas when opened in a spreadsheet
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const iso = (v: number | null) => (v ? new Date(v).toISOString() : "");
    const lines = [cols.join(",")].concat(results.map((r) => cols.map((c) => cell(c.endsWith("_at") ? iso(r[c] as number | null) : r[c])).join(",")));
    return new Response(lines.join("\n") + "\n", {
      headers: plainHeaders({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="nova-preorders-${new Date(now).toISOString().slice(0, 10)}.csv"`,
      }),
    });
  }
  return json({
    products: Object.entries(PRODUCTS).map(([id, p]) => ({ id, name: p.name, price: p.price, deposit: p.deposit, goal: p.goal, reserved: n[id] ?? 0 })),
    preorders: results.map((r) => ({
      id: r.id, product: r.product, status: r.status, email: r.email, name: r.name, region: r.region, car: r.car, notes: r.notes,
      price: r.price_cents, deposit: r.deposit_cents, createdAt: r.created_at, confirmedAt: r.confirmed_at,
      depositRequestedAt: r.deposit_requested_at, paidAt: r.paid_at, cancelledAt: r.cancelled_at,
    })),
  });
}

// EDIT: the deposit request email. {link} is the payment link made in the payment provider.
function depositEmail(p: Product, r: Row, pay: string, manage: string): { subject: string; text: string } {
  return {
    subject: `Your ${p.name}: time for the deposit`,
    text:
      `${r.name ? `Hi ${r.name},` : "Hi,"}\n\n` +
      `${p.name} has reached ${p.goal} reservations, so I'm building them. To keep your place, please pay the refundable ${dollars(r.deposit_cents)} deposit here:\n\n${pay}\n\n` +
      `Use the same email address (${r.email}) when you pay, so I can match it to your reservation. ` +
      `The rest (${dollars(r.price_cents - r.deposit_cents)}) is due before your unit ships. Until it ships you can cancel and get the deposit back:\n\n${manage}\n\n` +
      `A reminder that this is a first-revision device: it's tested, but things can still go wrong, and I'll fix what I can with updates.\n\n` +
      `Justice\nOcean Live LLC`,
  };
}

/** POST /api/admin/preorders/request { product, link }: send the deposit link to everyone confirmed. */
export async function requestDeposits(env: Env, body: Record<string, unknown>, now: number): Promise<Response> {
  const id = String(body.product ?? "");
  const p = PRODUCTS[id];
  if (!p) return json({ error: "Unknown product." }, 400);
  const pay = String(body.link ?? "").trim();
  let ok = false;
  try {
    ok = new URL(pay).protocol === "https:" && pay.length <= 500;
  } catch { /* not a URL */ }
  if (!ok) return json({ error: "Paste the payment link (https://…)." }, 400);
  if (((await counts(env.DB))[id] ?? 0) < p.goal) return json({ error: `${p.name} hasn't reached ${p.goal} confirmed reservations yet.` }, 409);

  const { results } = await env.DB.prepare("SELECT * FROM preorders WHERE product = ?1 AND status = 'confirmed' ORDER BY confirmed_at")
    .bind(id).all<Row>();
  let sent = 0;
  const failed: string[] = [];
  for (const r of results) {
    // a fresh manage link for each email (the person's old link stops working)
    const token = randomToken();
    const mail = await sendEmail(env, { to: r.email, ...depositEmail(p, r, pay, link(env, token)) });
    if (!mail.ok) {
      failed.push(r.email);
      continue;
    }
    await env.DB.prepare("UPDATE preorders SET status = 'deposit_requested', deposit_requested_at = ?2, token_hash = ?3 WHERE id = ?1")
      .bind(r.id, now, await sha256(token)).run();
    sent++;
  }
  return json({ ok: true, sent, failed });
}

/** POST /api/admin/preorders/mark { id, status }: record a paid deposit, a cancellation, or undo one. */
export async function mark(env: Env, body: Record<string, unknown>, now: number): Promise<Response> {
  const id = Number(body.id);
  const status = String(body.status ?? "");
  if (!Number.isInteger(id) || !["confirmed", "deposit_paid", "cancelled"].includes(status)) return json({ error: "Bad request." }, 400);
  const r = await env.DB.prepare("SELECT * FROM preorders WHERE id = ?1").bind(id).first<Row>();
  if (!r) return json({ error: "No such reservation." }, 404);
  const set = status === "deposit_paid"
    ? "status = 'deposit_paid', paid_at = ?2"
    : status === "cancelled"
      ? "status = 'cancelled', cancelled_at = ?2"
      : "status = 'confirmed', confirmed_at = COALESCE(confirmed_at, ?2), paid_at = NULL, cancelled_at = NULL";
  await env.DB.prepare(`UPDATE preorders SET ${set} WHERE id = ?1`).bind(id, now).run();
  return json({ ok: true });
}

/** Daily: unconfirmed reservations older than a week are deleted. */
export async function cleanup(env: Env, now: number): Promise<void> {
  await env.DB.prepare("DELETE FROM preorders WHERE status = 'unconfirmed' AND created_at < ?1").bind(now - UNCONFIRMED_DAYS * DAY).run();
}
