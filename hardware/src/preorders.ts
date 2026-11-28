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
 *   POST /api/admin/preorders/request      { product, link, kind }  emails the payment link: kind "deposit" to
 *                                          everyone confirmed once the product has its goal, "balance" (the
 *                                          rest of the price, right before the parts are ordered) to everyone
 *                                          whose deposit is paid
 *   POST /api/admin/preorders/mark         { id, status: confirmed | deposit_paid | paid | cancelled }
 *   GET  /api/admin/preorders/signature    ?id=  the signed disclosure's drawn signature (PNG)
 *   POST /api/admin/preorders/step         { product, batch, step, done }  tick a build step on or off
 *   GET  /api/preorder/build               each product's latest batch and its build steps (public)
 *   POST /api/preorder/lookup              { email } emails links to that address's reservations
 *
 * Nobody is charged here. Reserving needs the first-generation disclosure signed (typed name and a drawn
 * signature, kept with the reservation). A reservation only counts once its email is confirmed. When a
 * product reaches its goal (10), the admin gets an email, and from /admin sends everyone a link to pay
 * the refundable $100 deposit (a payment link made in the payment provider). The rest of the price is
 * asked for the same way right before the parts are ordered. Each person keeps the price they reserved at.
 */
import type { Env } from "./env";
import { EMAIL, line, text } from "./form";
import { sendEmail } from "./mail";
import { json, plainHeaders, randomToken, sha256 } from "./util";

export interface Product {
  name: string;
  /** Volume pricing, US cents: [reservations in the batch, price from then on], first step at 1. Everyone
   * in a batch pays its lowest reached price, never more than the price when they reserved. */
  tiers: [number, number][];
  /** The first step's price (set from tiers below). */
  price: number;
  deposit: number;
  /** Confirmed reservations before anyone is asked for a deposit. */
  goal: number;
  /** One line for the emails. */
  blurb: string;
  /** Works only with a Nova Light: reserving it also reserves a Light at LIGHT_BUNDLE_OFF less, unless the
   * person says they already have one. */
  needsLight?: boolean;
}

// EDIT: how much less the Light costs when it's reserved together with a Flare or Quasar (US cents).
export const LIGHT_BUNDLE_OFF = 5000;

// EDIT: what can be pre-ordered, the volume prices (US cents) and the goals. Lowering a step lowers it
// for everyone in an open batch; raising one only affects new reservations. With the bundle Light
// ($50 off): Flare $599 and Quasar $629 in all at the first step.
export const PRODUCTS: Record<string, Product> = {
  light: {
    name: "Nova Light",
    tiers: [[1, 17900], [25, 16900], [50, 15900], [100, 14900]],
    price: 0,
    deposit: 10000,
    goal: 10,
    blurb: "the cellular CAN reader: charge, 12V, location and alerts in the app, from anywhere",
  },
  supernova: {
    name: "SuperNova",
    tiers: [[1, 59900], [25, 57900], [50, 54900], [100, 49900]],
    price: 0,
    deposit: 10000,
    goal: 10,
    blurb: "everything in one box: Android on the center screen, live data, its own LTE, and remote lock and climate",
  },
  flare: {
    name: "Nova Flare",
    tiers: [[1, 47000], [25, 45500], [50, 43500], [100, 39900]],
    price: 0,
    deposit: 10000,
    goal: 10,
    blurb: "Android on the center screen, working with your Nova Light",
    needsLight: true,
  },
  quasar: {
    name: "Nova Quasar",
    tiers: [[1, 50000], [25, 48500], [50, 46500], [100, 42900]],
    price: 0,
    deposit: 10000,
    goal: 10,
    blurb: "Android on the center screen with its own LTE for streaming, working with your Nova Light",
    needsLight: true,
  },
};

// EDIT: bump when the first-generation disclosure (public/preorder.html, #disclosure) changes, so each
// signature records which text was signed.
export const DISCLOSURE_VERSION = "2026-11-28.4";

for (const p of Object.values(PRODUCTS)) p.price = p.tiers[0][1];

// EDIT: the build tracker's steps, ticked off in /admin for each batch. Keep a step's id once it's in use.
const BUILD_COMMON_START: [string, string][] = [["paid", "Batch paid in full"]];
const BUILD_COMMON_END: [string, string][] = [
  ["assembled", "Units assembled"],
  ["flashed", "Firmware loaded"],
  ["tested", "Each unit tested"],
  ["packed", "Packed with the harness and guide"],
  ["shipped", "Shipped"],
];
export const BUILD_STEPS: Record<string, [string, string][]> = {
  light: [...BUILD_COMMON_START,
    ["pcb", "Circuit boards ordered (assembled at the factory)"], ["sim", "SIM cards ordered"],
    ["harness", "Harness parts ordered"], ["pcb-in", "Circuit boards arrived"], ["case", "Enclosures printed"],
    ["harness-made", "Harnesses made"], ...BUILD_COMMON_END],
  supernova: [...BUILD_COMMON_START,
    ["pcb", "Main boards and video cards ordered (assembled at the factory)"], ["module", "Compute modules ordered"],
    ["lte", "LTE cards and antennas ordered"], ["video-plugs", "Video plugs ordered"], ["sim", "SIM cards ordered"],
    ["pcb-in", "Boards arrived"], ["module-in", "Compute modules arrived"], ["case", "Enclosures printed"],
    ["harness-made", "Harnesses made"], ["android", "Android set up on each module"], ...BUILD_COMMON_END],
  flare: [...BUILD_COMMON_START,
    ["pcb", "Main boards and video cards ordered (assembled at the factory)"], ["module", "Compute modules ordered"],
    ["video-plugs", "Video plugs ordered"], ["pcb-in", "Boards arrived"], ["module-in", "Compute modules arrived"],
    ["case", "Enclosures printed"], ["harness-made", "Harnesses made"], ["android", "Android set up on each module"],
    ...BUILD_COMMON_END],
  quasar: [...BUILD_COMMON_START,
    ["pcb", "Main boards and video cards ordered (assembled at the factory)"], ["module", "Compute modules ordered"],
    ["lte", "LTE cards and antennas ordered"], ["video-plugs", "Video plugs ordered"], ["pcb-in", "Boards arrived"],
    ["module-in", "Compute modules arrived"], ["case", "Enclosures printed"], ["harness-made", "Harnesses made"],
    ["android", "Android set up on each module"], ...BUILD_COMMON_END],
};

async function stepsFor(db: D1Database, product: string, batch: number | null): Promise<{ id: string; label: string; doneAt: number | null }[]> {
  const done = new Map<string, number>();
  if (batch) {
    const { results } = await db.prepare("SELECT step, done_at FROM build_steps WHERE product = ?1 AND batch = ?2")
      .bind(product, batch).all<{ step: string; done_at: number }>();
    for (const r of results) done.set(r.step, r.done_at);
  }
  return (BUILD_STEPS[product] ?? []).map(([id, label]) => ({ id, label, doneAt: done.get(id) ?? null }));
}

/** GET /api/preorder/build: each product's latest batch and its steps (no personal data). */
export async function builds(env: Env): Promise<Response> {
  const out = [];
  for (const id of Object.keys(PRODUCTS)) {
    const b = await env.DB.prepare("SELECT MAX(batch) AS b FROM preorders WHERE product = ?1").bind(id).first<{ b: number | null }>();
    const batch = b?.b ?? null;
    const units = batch
      ? (await env.DB.prepare("SELECT COUNT(*) AS n FROM preorders WHERE product = ?1 AND batch = ?2 AND status != 'cancelled'")
        .bind(id, batch).first<{ n: number }>())?.n ?? 0
      : 0;
    out.push({ id, batch, units, steps: await stepsFor(env.DB, id, batch) });
  }
  return json({ products: out });
}

/** POST /api/admin/preorders/step { product, batch, step, done } */
export async function setStep(env: Env, body: Record<string, unknown>, now: number): Promise<Response> {
  const product = String(body.product ?? "");
  const batch = Number(body.batch);
  const step = String(body.step ?? "");
  if (!BUILD_STEPS[product]?.some(([id]) => id === step) || !Number.isInteger(batch) || batch < 1) return json({ error: "Bad request." }, 400);
  if (body.done === true) {
    await env.DB.prepare("INSERT OR REPLACE INTO build_steps (product, batch, step, done_at) VALUES (?1, ?2, ?3, ?4)").bind(product, batch, step, now).run();
  } else {
    await env.DB.prepare("DELETE FROM build_steps WHERE product = ?1 AND batch = ?2 AND step = ?3").bind(product, batch, step).run();
  }
  return json({ ok: true });
}

// EDIT: the email with the status links.
/** POST /api/preorder/lookup { email }: emails fresh links to every reservation for that address. Same
 * answer whether or not there are any, so it can't be used to find out who reserved. */
export async function lookup(env: Env, body: Record<string, unknown>): Promise<Response> {
  if (String(body.website ?? "").trim()) return json({ ok: true });
  const email = line(body.email, 254).toLowerCase();
  if (!EMAIL.test(email)) return json({ error: "Enter a valid email address." }, 400);
  const { results } = await env.DB.prepare("SELECT id, product, bundle, status FROM preorders WHERE email = ?1 AND status != 'unconfirmed' ORDER BY id")
    .bind(email).all<{ id: number; product: string; bundle: string; status: string }>();
  if (!results.length) return json({ ok: true });
  const lines: string[] = [];
  const updates = [];
  for (const r of results) {
    const token = randomToken();
    updates.push(env.DB.prepare("UPDATE preorders SET token_hash = ?2 WHERE id = ?1").bind(r.id, await sha256(token)));
    lines.push(`${PRODUCTS[r.product]?.name ?? r.product}${r.status === "cancelled" ? " (cancelled)" : ""}:\n${link(env, token)}`);
  }
  const sent = await sendEmail(env, { label: "Nova pre-order",
    to: email,
    subject: "Your Nova order status",
    text: `Hi,\n\nHere's the status of your Nova ${results.length === 1 ? "reservation" : "reservations"} (these links replace any older ones):\n\n${lines.join("\n\n")}\n\nJustice\nOcean Live LLC`,
  });
  if (!sent.ok) return json({ error: "Couldn't send the email. Please try again in a few minutes." }, 502);
  await env.DB.batch(updates);
  return json({ ok: true });
}

/** The price for a batch of n reservations. */
export function tierPrice(p: Product, n: number): number {
  let price = p.tiers[0][1];
  for (const [from, cents] of p.tiers) if (n >= from) price = cents;
  return price;
}

/** What one reservation costs now: its batch's price (Light in a bundle: $50 less), never more than
 * the price when it was made. Closed batches (balance asked for) keep the price they closed at. */
function current(r: { product: string; bundle: string; price_cents: number; status: string }, n: Record<string, number>): number {
  const p = PRODUCTS[r.product];
  if (!p || r.status === "balance_requested" || r.status === "paid") return r.price_cents;
  const now = tierPrice(p, Math.max(1, n[r.product] ?? 0)) - (r.product === "light" && isBundled(r.bundle) ? LIGHT_BUNDLE_OFF : 0);
  return Math.min(r.price_cents, now);
}
const isBundled = (b: string) => b !== "" && b !== "light" && b !== "has-light";

/** Statuses in a product's open batch: they count towards its goal and its volume price. A batch closes
 * when the rest of the price is asked for; later reservations start the next batch. */
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
  /** Flare/Quasar: 'light' (a Light was reserved with it) or 'has-light'. Light: the product it came with. */
  bundle: string;
  sig_name: string;
  sig_at: number | null;
  sig_version: string;
  balance_requested_at: number | null;
  balance_paid_at: number | null;
  batch: number | null;
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
      id, name: p.name, price: tierPrice(p, Math.max(1, n[id] ?? 0)), tiers: p.tiers, deposit: p.deposit, goal: p.goal,
      reserved: n[id] ?? 0, needsLight: !!p.needsLight,
    })),
    lightBundleOff: LIGHT_BUNDLE_OFF,
  });
}

function link(env: Env, token: string): string {
  return `${env.PREORDER_URL || env.SITE_URL}/reservation#${token}`;
}

// EDIT: the emails.
function confirmEmail(p: Product, price: number, lightPrice: number, name: string, url: string, bundle: string, signed: string, site: string): { subject: string; text: string } {
  const light = PRODUCTS.light;
  const extra = bundle === "light"
    ? `It works together with a Nova Light, so a Nova Light is reserved with it at the bundle price of ${dollars(lightPrice)} ` +
      `(${dollars(price + lightPrice)} for both right now). The Light is built in its own batch, with its own ${dollars(light.deposit)} deposit when that batch reaches ${light.goal}. ` +
      `Confirming confirms both, and cancelling the ${p.name} cancels the Light that came with it.\n\n`
    : bundle === "has-light"
      ? `You said you already have a Nova Light, which the ${p.name} needs, so no Light was added.\n\n`
      : "";
  return {
    subject: `Confirm your ${p.name} reservation`,
    text:
      `${name ? `Hi ${name},` : "Hi,"}\n\n` +
      `Thanks for reserving a ${p.name}, ${p.blurb}. Please confirm it here:\n\n${url}\n\n` + extra +
      `Your price right now is ${dollars(price)}. The more people reserve, the cheaper it gets for everyone: if your batch's price drops after you reserve, you pay the lower price, and you never pay more than ${dollars(price)}.\n\n` +
      `Nothing is charged now. Once ${p.goal} people have confirmed a ${p.name} reservation, I'll email you a link to pay a refundable ${dollars(p.deposit)} deposit. ` +
      `The rest of the price is due right before I order the parts and start building your batch, and I'll email you for it then. ` +
      `You can cancel and get your deposit back at any time until you've paid in full.\n\n` +
      `You signed the first-generation disclosure as "${signed}" (version ${DISCLOSURE_VERSION}). You can read it again at ${site}/#disclosure.\n\n` +
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

/** The drawn signature: a PNG data URL from the page's canvas, at most 200 kB. */
export function signature(v: unknown): Uint8Array | null {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]{100,280000})$/.exec(String(v ?? ""));
  if (!m) return null;
  try {
    const bin = atob(m[1]);
    const out = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    // the PNG signature bytes
    return out.length > 8 && out[0] === 0x89 && out[1] === 0x50 && out[2] === 0x4e && out[3] === 0x47 ? out : null;
  } catch {
    return null;
  }
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
  const signed = line(body.signedName, 100);
  if (signed.length < 3) return json({ error: "Type your full name to sign the disclosure." }, 400);
  const png = signature(body.signature);
  if (!png) return json({ error: "Draw your signature in the box to sign the disclosure." }, 400);
  const name = line(body.name, 100);
  const region = line(body.region, 100);
  const car = line(body.car, 100);
  const notes = text(body.notes, 1000);
  const bundle = p.needsLight ? (body.hasLight === true ? "has-light" : "light") : "";

  const token = randomToken();
  const hash = await sha256(token);
  const old = await env.DB.prepare("SELECT status FROM preorders WHERE email = ?1 AND product = ?2")
    .bind(email, id).first<{ status: string }>();
  const active = !!old && old.status !== "unconfirmed" && old.status !== "cancelled";

  if (active) {
    // Already reserved: send a fresh link, change nothing else.
    const sent = await sendEmail(env, { label: "Nova pre-order", to: email, ...alreadyEmail(p, name, link(env, token)) });
    if (!sent.ok) return json({ error: "Couldn't send the email. Please try again in a few minutes." }, 502);
    await env.DB.prepare("UPDATE preorders SET token_hash = ?3 WHERE email = ?1 AND product = ?2").bind(email, id, hash).run();
    return json({ ok: true });
  }
  const site = env.PREORDER_URL || env.SITE_URL;
  const n = await counts(env.DB);
  const price = tierPrice(p, Math.max(1, n[id] ?? 0));
  const lightPrice = tierPrice(PRODUCTS.light, Math.max(1, n.light ?? 0)) - LIGHT_BUNDLE_OFF;
  const sent = await sendEmail(env, { label: "Nova pre-order", to: email, ...confirmEmail(p, price, lightPrice, name, link(env, token), bundle, signed, site) });
  if (!sent.ok) return json({ error: "Couldn't send the email. Please try again in a few minutes." }, 502);
  const upsert = `INSERT INTO preorders (product, email, name, region, car, notes, status, token_hash, price_cents, deposit_cents, created_at, bundle,
       sig_name, sig_png, sig_at, sig_version)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'unconfirmed', ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?10, ?14)
     ON CONFLICT(email, product) DO UPDATE SET
       name = excluded.name, region = excluded.region, car = excluded.car, notes = excluded.notes,
       status = 'unconfirmed', token_hash = excluded.token_hash, price_cents = excluded.price_cents,
       deposit_cents = excluded.deposit_cents, created_at = excluded.created_at, bundle = excluded.bundle,
       sig_name = excluded.sig_name, sig_png = excluded.sig_png, sig_at = excluded.sig_at, sig_version = excluded.sig_version,
       confirmed_at = NULL, deposit_requested_at = NULL, paid_at = NULL, cancelled_at = NULL,
       balance_requested_at = NULL, balance_paid_at = NULL`;
  const sig = [signed, png, DISCLOSURE_VERSION] as const;
  const writes = [env.DB.prepare(upsert).bind(id, email, name, region, car, notes, hash, price, p.deposit, now, bundle, ...sig)];
  if (bundle === "light") {
    const light = PRODUCTS.light;
    const own = await env.DB.prepare("SELECT status FROM preorders WHERE email = ?1 AND product = 'light'").bind(email).first<{ status: string }>();
    if (own && own.status !== "unconfirmed" && own.status !== "cancelled") {
      // They already reserved a Light on its own: it becomes the bundle's Light, at the bundle price if not paid yet.
      writes.push(env.DB.prepare(
        "UPDATE preorders SET bundle = ?2, price_cents = MIN(price_cents, ?3) WHERE email = ?1 AND product = 'light' AND status != 'deposit_paid'",
      ).bind(email, id, lightPrice));
    } else {
      // A Light that rides on this reservation: confirmed and cancelled with it, no link of its own until its batch.
      writes.push(env.DB.prepare(upsert).bind("light", email, name, region, car, "", null, lightPrice, light.deposit, now, id, ...sig));
    }
  }
  await env.DB.batch(writes);
  return json({ ok: true });
}

/** The Light reserved together with a Flare or Quasar follows it: confirmed or cancelled with it. */
async function followLight(db: D1Database, r: Row, status: "confirmed" | "cancelled", now: number): Promise<void> {
  if (r.bundle !== "light") return;
  if (status === "confirmed") {
    await db.prepare(
      "UPDATE preorders SET status = 'confirmed', confirmed_at = ?3, cancelled_at = NULL WHERE email = ?1 AND product = 'light' AND bundle = ?2 AND status IN ('unconfirmed', 'cancelled')",
    ).bind(r.email, r.product, now).run();
  } else {
    await db.prepare(
      "UPDATE preorders SET status = 'cancelled', cancelled_at = ?3 WHERE email = ?1 AND product = 'light' AND bundle = ?2 AND status IN ('unconfirmed', 'confirmed', 'deposit_requested')",
    ).bind(r.email, r.product, now).run();
  }
}

async function byToken(db: D1Database, token: string): Promise<Row | null> {
  if (!token) return null;
  return db.prepare("SELECT * FROM preorders WHERE token_hash = ?1").bind(await sha256(token)).first<Row>();
}

const badLink = () => json({ error: "This link isn't valid any more. Use the newest email about your reservation, or reserve again." }, 404);

async function view(db: D1Database, r: Row): Promise<Record<string, unknown>> {
  const p = PRODUCTS[r.product];
  const all = await counts(db);
  const n = all[r.product] ?? 0;
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
    reserved: n, goal: p?.goal ?? 10, price: current(r, all), reservedAt: r.price_cents, deposit: r.deposit_cents,
    tiers: p?.tiers ?? [], bundleOff: r.product === "light" && isBundled(r.bundle) ? LIGHT_BUNDLE_OFF : 0,
    // Flare/Quasar: a Light reserved with it ('light') or already owned ('has-light'); Light: what it came with
    bundle: r.bundle,
    batch: r.batch, build: await stepsFor(db, r.product, r.batch),
  };
}

/** Emails the admin when a confirmation brings a product to exactly its goal. */
async function goalNotice(env: Env, ctx: ExecutionContext, before: Record<string, number>): Promise<void> {
  const after = await counts(env.DB);
  for (const [id, p] of Object.entries(PRODUCTS)) {
    if ((before[id] ?? 0) < p.goal && (after[id] ?? 0) >= p.goal) {
      // EDIT: the email to the admin when a product reaches its goal.
      ctx.waitUntil(
        sendEmail(env, { label: "Nova pre-order",
          to: env.ADMIN_EMAIL,
          subject: `${p.name}: ${p.goal} confirmed reservations`,
          text:
            `${p.name} has reached ${p.goal} confirmed reservations. When you're ready to build them, make a ${dollars(p.deposit)} deposit payment link ` +
            `and send it to everyone from the Pre-orders section of ${env.SITE_URL}/admin.`,
        }).then((x) => { if (!x.ok) console.error("goal notice not sent", x.error); }),
      );
    }
  }
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
    const before = await counts(env.DB);
    await env.DB.prepare("UPDATE preorders SET status = 'confirmed', confirmed_at = ?2, cancelled_at = NULL WHERE id = ?1").bind(r.id, now).run();
    await followLight(env.DB, r, "confirmed", now);
    r.status = "confirmed";
    r.confirmed_at = now;
    await goalNotice(env, ctx, before);
  }
  return json(await view(env.DB, r));
}

/** POST /api/reservation/cancel { token }. A paid deposit is refunded by hand (the admin gets an email). */
export async function cancel(env: Env, ctx: ExecutionContext, token: string, now: number): Promise<Response> {
  const r = await byToken(env.DB, token);
  if (!r) return badLink();
  if (r.status !== "cancelled") {
    await env.DB.prepare("UPDATE preorders SET status = 'cancelled', cancelled_at = ?2 WHERE id = ?1").bind(r.id, now).run();
    await followLight(env.DB, r, "cancelled", now);
    const p = PRODUCTS[r.product];
    const who = r.name ? `${r.name} (${r.email})` : r.email;
    ctx.waitUntil(
      sendEmail(env, { label: "Nova pre-order",
        to: env.ADMIN_EMAIL,
        subject: `${p?.name ?? r.product}: ${who} cancelled${["deposit_paid", "balance_requested", "paid"].includes(r.status) ? " (refund due)" : ""}`,
        text: r.status === "paid"
          ? `${who} cancelled their ${p?.name ?? r.product} after paying in full. Refund ${dollars(r.price_cents)}, less the cost of any parts already bought for their unit, in the payment provider.`
          : ["deposit_paid", "balance_requested"].includes(r.status)
          ? `${who} cancelled their ${p?.name ?? r.product} reservation after paying the deposit. Refund ${dollars(r.deposit_cents)} in the payment provider.`
          : `${who} cancelled their ${p?.name ?? r.product} reservation${r.bundle === "light" ? " (and the Nova Light reserved with it)" : ""}. Nothing to refund.`,
      }).then((x) => { if (!x.ok) console.error("cancel notice not sent", x.error); }),
    );
    r.status = "cancelled";
  }
  return json(await view(env.DB, r));
}

/** GET /api/admin/preorders */
export async function list(env: Env, url: URL, now: number): Promise<Response> {
  const { results } = await env.DB.prepare("SELECT * FROM preorders ORDER BY product, COALESCE(confirmed_at, created_at)").all<Row & { sig_png?: unknown }>();
  for (const r of results) delete r.sig_png;
  const n = await counts(env.DB);
  if (url.searchParams.get("format") === "csv") {
    const cols = ["id", "product", "status", "email", "name", "region", "car", "notes", "price_cents", "deposit_cents",
      "created_at", "confirmed_at", "deposit_requested_at", "paid_at", "balance_requested_at", "balance_paid_at", "cancelled_at", "bundle",
      "sig_name", "sig_at", "sig_version"] as const;
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
    products: Object.entries(PRODUCTS).map(([id, p]) => ({ id, name: p.name, price: tierPrice(p, Math.max(1, n[id] ?? 0)), deposit: p.deposit, goal: p.goal, reserved: n[id] ?? 0 })),
    preorders: results.map((r) => ({
      id: r.id, product: r.product, status: r.status, email: r.email, name: r.name, region: r.region, car: r.car, notes: r.notes,
      price: current(r, n), deposit: r.deposit_cents, createdAt: r.created_at, confirmedAt: r.confirmed_at,
      depositRequestedAt: r.deposit_requested_at, paidAt: r.paid_at, cancelledAt: r.cancelled_at, bundle: r.bundle,
      signedName: r.sig_name, signedAt: r.sig_at, signedVersion: r.sig_version,
      balanceRequestedAt: r.balance_requested_at, balancePaidAt: r.balance_paid_at, batch: r.batch,
    })),
  });
}

// EDIT: the payment request emails. `pay` is the payment link made in the payment provider.
function payEmail(kind: "deposit" | "balance", p: Product, r: Row, pay: string, manage: string): { subject: string; text: string } {
  const hi = r.name ? `Hi ${r.name},` : "Hi,";
  const sign = `Justice\nOcean Live LLC`;
  if (kind === "deposit") {
    return {
      subject: `Your ${p.name}: time for the deposit`,
      text:
        `${hi}\n\n` +
        `${p.name} has reached ${p.goal} reservations. To keep your place, please pay the refundable ${dollars(r.deposit_cents)} deposit here:\n\n${pay}\n\n` +
        `Use the same email address (${r.email}) when you pay, so I can match it to your reservation. ` +
        `Your price is ${dollars(r.price_cents)} right now, and it still drops if more people reserve before I order the parts; you'll pay the batch's lowest price. ` +
        `The rest is due right before I order the parts and start building your batch; I'll email you for it then. ` +
        `Until you've paid in full you can cancel and get the deposit back:\n\n${manage}\n\n${sign}`,
    };
  }
  return {
    subject: `Your ${p.name}: the rest of the price, before I order the parts`,
    text:
      `${hi}\n\n` +
      `I'm ready to order the parts and build the ${p.name} batch. Your batch's final price is ${dollars(r.price_cents)}. ` +
      `Please pay the rest, ${dollars(r.price_cents - r.deposit_cents)}, here:\n\n${pay}\n\n` +
      `Use the same email address (${r.email}) when you pay. Once everyone has paid, I order the parts, and I'll email you when your unit is built and again when it ships.\n\n` +
      `As in the first-generation disclosure you signed: once you've paid in full and the parts are ordered, a cancellation is refunded less the cost of the parts already bought for your unit.\n\n` +
      `Your reservation: ${manage}\n\n${sign}`,
  };
}

/** POST /api/admin/preorders/request { product, link, kind: "deposit" | "balance" }: emails the payment link
 * to everyone at the right step (deposit: confirmed, once the product has its goal; balance: deposit paid). */
export async function requestPayments(env: Env, body: Record<string, unknown>, now: number): Promise<Response> {
  const id = String(body.product ?? "");
  const p = PRODUCTS[id];
  if (!p) return json({ error: "Unknown product." }, 400);
  const kind = body.kind === "balance" ? "balance" : "deposit";
  const pay = String(body.link ?? "").trim();
  let ok = false;
  try {
    ok = new URL(pay).protocol === "https:" && pay.length <= 500;
  } catch { /* not a URL */ }
  if (!ok) return json({ error: "Paste the payment link (https://…)." }, 400);
  if (kind === "deposit" && ((await counts(env.DB))[id] ?? 0) < p.goal) {
    return json({ error: `${p.name} hasn't reached ${p.goal} confirmed reservations yet.` }, 409);
  }
  const from = kind === "deposit" ? "confirmed" : "deposit_paid";
  const to = kind === "deposit" ? "deposit_requested" : "balance_requested";
  const at = kind === "deposit" ? "deposit_requested_at" : "balance_requested_at";
  const { results } = await env.DB.prepare("SELECT * FROM preorders WHERE product = ?1 AND status = ?2 ORDER BY confirmed_at")
    .bind(id, from).all<Row>();
  const n = await counts(env.DB);
  // Everyone pays their batch's current price; asking for the rest closes the batch at it, with a number.
  for (const r of results) r.price_cents = current(r, n);
  const batch = kind === "balance"
    ? ((await env.DB.prepare("SELECT MAX(batch) AS b FROM preorders WHERE product = ?1").bind(id).first<{ b: number | null }>())?.b ?? 0) + 1
    : null;
  let sent = 0;
  const failed: string[] = [];
  for (const r of results) {
    // a fresh manage link for each email (the person's old link stops working)
    const token = randomToken();
    const mail = await sendEmail(env, { label: "Nova pre-order", to: r.email, ...payEmail(kind, p, r, pay, link(env, token)) });
    if (!mail.ok) {
      failed.push(r.email);
      continue;
    }
    await env.DB.prepare(`UPDATE preorders SET status = ?4, ${at} = ?2, token_hash = ?3${kind === "balance" ? ", price_cents = ?5, batch = ?6" : ""} WHERE id = ?1`)
      .bind(...[r.id, now, await sha256(token), to, ...(kind === "balance" ? [r.price_cents, batch] : [])]).run();
    sent++;
  }
  return json({ ok: true, sent, failed, batch });
}

const MARKS: Record<string, string> = {
  deposit_paid: "status = 'deposit_paid', paid_at = ?2",
  paid: "status = 'paid', balance_paid_at = ?2",
  cancelled: "status = 'cancelled', cancelled_at = ?2",
  confirmed: "status = 'confirmed', confirmed_at = COALESCE(confirmed_at, ?2), paid_at = NULL, balance_paid_at = NULL, cancelled_at = NULL",
};

/** POST /api/admin/preorders/mark { id, status }: record a payment, a cancellation, or undo one. */
export async function mark(env: Env, body: Record<string, unknown>, now: number): Promise<Response> {
  const id = Number(body.id);
  const set = MARKS[String(body.status ?? "")];
  if (!Number.isInteger(id) || !set) return json({ error: "Bad request." }, 400);
  const r = await env.DB.prepare("SELECT id FROM preorders WHERE id = ?1").bind(id).first();
  if (!r) return json({ error: "No such reservation." }, 404);
  await env.DB.prepare(`UPDATE preorders SET ${set} WHERE id = ?1`).bind(id, now).run();
  return json({ ok: true });
}

/** GET /api/admin/preorders/signature?id=: the drawn signature, as a PNG. */
export async function signatureImage(env: Env, url: URL): Promise<Response> {
  const r = await env.DB.prepare("SELECT sig_png FROM preorders WHERE id = ?1").bind(Number(url.searchParams.get("id")))
    .first<{ sig_png: ArrayBuffer | number[] | null }>();
  if (!r?.sig_png) return json({ error: "No signature." }, 404);
  // D1 hands BLOBs back as an array of numbers
  return new Response(new Uint8Array(r.sig_png as ArrayLike<number>), { headers: plainHeaders({ "Content-Type": "image/png", "Content-Security-Policy": "default-src 'none'" }) });
}

/** Daily: unconfirmed reservations older than a week are deleted. */
export async function cleanup(env: Env, now: number): Promise<void> {
  await env.DB.prepare("DELETE FROM preorders WHERE status = 'unconfirmed' AND created_at < ?1").bind(now - UNCONFIRMED_DAYS * DAY).run();
}
