import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env, MailService } from "../src/env";
import worker from "../src/index";

const ORIGIN = "https://preorder.oceanlive.org";
const ADMIN = "https://hardware.oceanlive.org";
const SIG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAKCAIAAABJ+IsHAAAAGElEQVR4nGP4P0CAYdTiUYtHLR61mFwAAIZRq437tEJBAAAAAElFTkSuQmCC";

let sent: { to: string; subject: string; text: string }[] = [];
const mail: MailService = { send: async (n) => { sent.push(n); return { ok: true }; } };
const testEnv = (): Env => ({ ...env, MAIL: mail, PREORDER_URL: ORIGIN, PER_IP_PER_HOUR: "1000" });

async function call(path: string, body?: unknown, cookie?: string, origin = ORIGIN) {
  const headers = new Headers();
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
    headers.set("Origin", origin);
  }
  if (cookie) headers.set("Cookie", cookie);
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`${origin}${path}`, body === undefined ? { headers } : { method: "POST", headers, body: JSON.stringify(body) }),
    testEnv(), ctx,
  );
  await waitOnExecutionContext(ctx);
  const type = res.headers.get("Content-Type") ?? "";
  return {
    status: res.status, type,
    body: type.includes("json") ? ((await res.json()) as any) : type.includes("png") ? await res.arrayBuffer() : await res.text(),
  };
}

const tokenIn = (text: string) => text.match(/\/reservation#([A-Za-z0-9_-]+)/)![1];
const signed = { consent: true, signedName: "Sam Jones", signature: SIG };

async function reserve(email: string, product = "supernova", extra: Record<string, unknown> = {}): Promise<string> {
  sent = [];
  const r = await call("/api/preorder", { product, email, name: "Sam", ...signed, ...extra });
  expect(r.body).toEqual({ ok: true });
  return tokenIn(sent[0].text);
}

async function signIn(): Promise<string> {
  sent = [];
  await call("/api/admin/login", {}, undefined, ADMIN);
  const token = sent[0].text.match(/#login=([A-Za-z0-9_-]+)/)![1];
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`${ADMIN}/api/admin/session`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: ADMIN }, body: JSON.stringify({ token }),
  }), testEnv(), ctx);
  await waitOnExecutionContext(ctx);
  return res.headers.get("Set-Cookie")!.split(";")[0];
}

/** n confirmed reservations for a product, from p0@… up. */
async function fill(product: string, n: number, from = 0) {
  for (let i = from; i < from + n; i++) await call("/api/reservation/confirm", { token: await reserve(`p${i}@example.com`, product) });
}

beforeEach(async () => {
  sent = [];
  await env.DB.batch(["preorders", "build_steps", "counters", "login_links", "sessions"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
});

describe("pre-orders", () => {
  it("lists four products with volume prices and $100 deposits", async () => {
    const r = await call("/api/preorder/info");
    expect(r.body.open).toBe(true);
    expect(r.body.products.map((p: any) => [p.id, p.price, p.deposit, p.goal, p.needsLight])).toEqual([
      ["light", 17900, 10000, 10, false],
      ["supernova", 59900, 10000, 10, false],
      ["flare", 47000, 10000, 10, true],
      ["quasar", 50000, 10000, 10, true],
    ]);
    expect(r.body.lightBundleOff).toBe(5000);
    expect((await call("/api/preorder", { product: "pulse", email: "a@b.co", ...signed })).status).toBe(400);
  });

  it("needs the disclosure signed: a typed name and a drawn signature", async () => {
    const base = { product: "light", email: "a@b.co", consent: true };
    expect((await call("/api/preorder", { ...base, signature: SIG })).status).toBe(400);
    expect((await call("/api/preorder", { ...base, signedName: "Sam Jones" })).status).toBe(400);
    expect((await call("/api/preorder", { ...base, signedName: "Sam Jones", signature: "data:image/png;base64,AAAA" })).status).toBe(400);
    expect(sent).toHaveLength(0);
    await reserve("sam@example.com", "light");
    expect(sent[0].text).toContain('signed the first-generation disclosure as "Sam Jones"');
  });

  it("counts a reservation only once it is confirmed, and charges nothing", async () => {
    const token = await reserve("Sam@Example.com");
    expect(sent[0].to).toBe("sam@example.com");
    expect(sent[0].text).toContain("Nothing is charged now");
    expect(sent[0].text).toContain(`${ORIGIN}/reservation#`);
    expect((await call("/api/preorder/info")).body.products[1].reserved).toBe(0);
    expect((await call("/api/reservation", { token })).body).toMatchObject({ status: "unconfirmed", position: 0 });
    const ok = await call("/api/reservation/confirm", { token });
    expect(ok.body).toMatchObject({ status: "confirmed", position: 1, reserved: 1, goal: 10, price: 59900, deposit: 10000, batch: null });
    expect(ok.body.build[0]).toMatchObject({ id: "paid", doneAt: null });
  });

  it("reserves a Light at $50 off with a Flare or Quasar, unless they have one", async () => {
    const token = await reserve("sam@example.com", "flare");
    expect(sent[0].text).toContain("a Nova Light is reserved with it at the bundle price of $129");
    expect(sent[0].text).toContain("$599 for both");
    await call("/api/reservation/confirm", { token });
    const info = (await call("/api/preorder/info")).body.products;
    expect(info.find((p: any) => p.id === "light").reserved).toBe(1);
    // cancelling the Flare cancels its Light
    await call("/api/reservation/cancel", { token });
    expect((await call("/api/preorder/info")).body.products.find((p: any) => p.id === "light").reserved).toBe(0);

    await reserve("ann@example.com", "quasar", { hasLight: true });
    expect(sent[0].text).toContain("you already have a Nova Light");
    const { results } = await env.DB.prepare("SELECT product FROM preorders WHERE email = 'ann@example.com'").all();
    expect(results).toHaveLength(1);
  });

  it("drops the price for everyone in the batch as it grows, never above what they reserved at", async () => {
    const first = await reserve("first@example.com", "light");
    await call("/api/reservation/confirm", { token: first });
    expect((await call("/api/reservation", { token: first })).body.price).toBe(17900);
    await fill("light", 24); // 25 in the batch
    expect((await call("/api/preorder/info")).body.products[0].price).toBe(16900);
    const view = (await call("/api/reservation", { token: first })).body;
    expect(view).toMatchObject({ price: 16900, reservedAt: 17900 });
  });

  it("answers the same for an address that already reserved, and sends a fresh link", async () => {
    const first = await reserve("sam@example.com");
    await call("/api/reservation/confirm", { token: first });
    const second = await reserve("sam@example.com");
    expect(sent[0].subject).toBe("Your SuperNova reservation");
    expect((await call("/api/reservation", { token: first })).status).toBe(404);
    expect((await call("/api/reservation", { token: second })).body.status).toBe("confirmed");
  });

  it("cancels, tells the admin, and can reserve again", async () => {
    const token = await reserve("sam@example.com", "light");
    await call("/api/reservation/confirm", { token });
    sent = [];
    expect((await call("/api/reservation/cancel", { token })).body).toMatchObject({ status: "cancelled", reserved: 0 });
    expect(sent.some((m) => m.to === env.ADMIN_EMAIL && m.subject.includes("cancelled"))).toBe(true);
    expect((await call("/api/reservation/confirm", { token })).body.status).toBe("confirmed");
  });

  it("refuses bad input and bad links", async () => {
    expect((await call("/api/preorder", { product: "light", email: "nope", ...signed })).status).toBe(400);
    expect((await call("/api/preorder", { product: "light", email: "a@b.co", signedName: "Sam Jones", signature: SIG })).status).toBe(400);
    expect((await call("/api/reservation", { token: "x".repeat(43) })).status).toBe(404);
    expect((await call("/api/preorder", { product: "light", email: "a@b.co", ...signed, website: "x" })).body).toEqual({ ok: true });
    expect(sent).toHaveLength(0);
  });

  it("emails status links on lookup, the same answer for unknown addresses", async () => {
    const token = await reserve("sam@example.com", "light");
    await call("/api/reservation/confirm", { token });
    sent = [];
    expect((await call("/api/preorder/lookup", { email: "nobody@example.com" })).body).toEqual({ ok: true });
    expect(sent).toHaveLength(0);
    expect((await call("/api/preorder/lookup", { email: "SAM@example.com" })).body).toEqual({ ok: true });
    expect(sent[0].subject).toBe("Your Nova order status");
    const fresh = tokenIn(sent[0].text);
    expect((await call("/api/reservation", { token: fresh })).body.status).toBe("confirmed");
    expect((await call("/api/reservation", { token })).status).toBe(404);
  });

  it("runs a batch: goal email, deposit, the rest at the batch price, then the build tracker", async () => {
    await fill("supernova", 10);
    expect(sent.some((m) => m.to === env.ADMIN_EMAIL && m.subject.includes("10 confirmed"))).toBe(true);

    const cookie = await signIn();
    const ask = (product: string, kind: string, link = "https://pay.example/x") =>
      call("/api/admin/preorders/request", { product, link, kind }, cookie, ADMIN);
    expect((await ask("supernova", "deposit", "http://pay")).status).toBe(400);
    expect((await ask("light", "deposit")).status).toBe(409);
    sent = [];
    expect((await ask("supernova", "deposit")).body).toMatchObject({ ok: true, sent: 10, failed: [] });
    expect(sent[0].text).toContain("$100 deposit");

    const list = (await call("/api/admin/preorders", undefined, cookie, ADMIN)).body;
    expect(list.preorders.every((p: any) => p.status === "deposit_requested" && p.signedName === "Sam Jones")).toBe(true);
    for (const p of list.preorders) await call("/api/admin/preorders/mark", { id: p.id, status: "deposit_paid" }, cookie, ADMIN);
    const sig = await call(`/api/admin/preorders/signature?id=${list.preorders[0].id}`, undefined, cookie, ADMIN);
    expect(sig.type).toBe("image/png");

    sent = [];
    const rest = await ask("supernova", "balance");
    expect(rest.body).toMatchObject({ ok: true, sent: 10, batch: 1 });
    expect(sent[0].text).toContain("final price is $599");
    expect(sent[0].text).toContain("$499");
    // the batch is closed: new reservations start the next one
    expect((await call("/api/preorder/info")).body.products[1].reserved).toBe(0);

    let build = (await call("/api/preorder/build")).body.products.find((b: any) => b.id === "supernova");
    expect(build).toMatchObject({ batch: 1, units: 10 });
    expect((await call("/api/admin/preorders/step", { product: "supernova", batch: 1, step: "pcb", done: true }, cookie, ADMIN)).body.ok).toBe(true);
    expect((await call("/api/admin/preorders/step", { product: "supernova", batch: 1, step: "nope", done: true }, cookie, ADMIN)).status).toBe(400);
    build = (await call("/api/preorder/build")).body.products.find((b: any) => b.id === "supernova");
    expect(build.steps.find((s: any) => s.id === "pcb").doneAt).toBeGreaterThan(0);

    const csv = await call("/api/admin/preorders?format=csv", undefined, cookie, ADMIN);
    expect(String(csv.body).split("\n")[0]).toContain("product,status,email");
  });

  it("keeps the admin endpoints behind sign-in", async () => {
    expect((await call("/api/admin/preorders")).status).toBe(401);
    expect((await call("/api/admin/preorders/step", { product: "light", batch: 1, step: "pcb", done: true })).status).toBe(401);
  });

  it("serves the pre-order page as the home page of preorder.oceanlive.org", async () => {
    let asked = "";
    const ctx = createExecutionContext();
    await worker.fetch(new Request(`${ORIGIN}/`), {
      ...testEnv(), ASSETS: { fetch: async (r: Request) => { asked = new URL(r.url).pathname; return new Response("ok"); } } as any,
    }, ctx);
    expect(asked).toBe("/preorder");
  });
});
