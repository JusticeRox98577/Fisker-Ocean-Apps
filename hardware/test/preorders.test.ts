import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env, MailService } from "../src/env";
import worker from "../src/index";

const ORIGIN = "https://preorder.oceanlive.org";
const ADMIN = "https://hardware.oceanlive.org";

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
  return { status: res.status, body: type.includes("json") ? ((await res.json()) as any) : await res.text() };
}

const tokenIn = (text: string) => text.match(/\/reservation#([A-Za-z0-9_-]+)/)![1];

async function reserve(email: string, product = "supernova"): Promise<string> {
  sent = [];
  const r = await call("/api/preorder", { product, email, name: "Sam", consent: true });
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

beforeEach(async () => {
  sent = [];
  await env.DB.batch(["preorders", "counters", "login_links", "sessions"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
});

describe("pre-orders", () => {
  it("lists only the Light and the SuperNova, with prices and counts", async () => {
    const r = await call("/api/preorder/info");
    expect(r.body.open).toBe(true);
    expect(r.body.products.map((p: any) => [p.id, p.price, p.deposit, p.goal, p.reserved])).toEqual([
      ["light", 17900, 5000, 10, 0],
      ["supernova", 59900, 10000, 10, 0],
    ]);
    expect((await call("/api/preorder", { product: "flare", email: "a@b.co", consent: true })).status).toBe(400);
  });

  it("counts a reservation only once it is confirmed, and charges nothing", async () => {
    const token = await reserve("Sam@Example.com");
    expect(sent[0].to).toBe("sam@example.com");
    expect(sent[0].text).toContain("Nothing is charged now");
    expect(sent[0].text).toContain(`${ORIGIN}/reservation#`);
    expect((await call("/api/preorder/info")).body.products[1].reserved).toBe(0);

    const view = await call("/api/reservation", { token });
    expect(view.body).toMatchObject({ product: "supernova", status: "unconfirmed", position: 0 });
    const ok = await call("/api/reservation/confirm", { token });
    expect(ok.body).toMatchObject({ status: "confirmed", position: 1, reserved: 1, goal: 10, price: 59900, deposit: 10000 });
    expect((await call("/api/preorder/info")).body.products[1].reserved).toBe(1);
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
    const c = await call("/api/reservation/cancel", { token });
    expect(c.body).toMatchObject({ status: "cancelled", reserved: 0 });
    expect(sent.some((m) => m.to === env.ADMIN_EMAIL && m.subject.includes("cancelled"))).toBe(true);
    expect((await call("/api/reservation/confirm", { token })).body.status).toBe("confirmed");
  });

  it("refuses bad input and bad links", async () => {
    expect((await call("/api/preorder", { product: "light", email: "nope", consent: true })).status).toBe(400);
    expect((await call("/api/preorder", { product: "light", email: "a@b.co" })).status).toBe(400);
    expect((await call("/api/reservation", { token: "x".repeat(43) })).status).toBe(404);
    // honeypot: looks fine, saves nothing
    expect((await call("/api/preorder", { product: "light", email: "a@b.co", consent: true, website: "x" })).body).toEqual({ ok: true });
    expect(sent).toHaveLength(0);
  });

  it("emails the admin at 10, then sends the deposit link only when asked", async () => {
    for (let i = 0; i < 10; i++) {
      const token = await reserve(`p${i}@example.com`);
      sent = [];
      await call("/api/reservation/confirm", { token });
    }
    expect(sent.some((m) => m.to === env.ADMIN_EMAIL && m.subject.includes("10 confirmed"))).toBe(true);

    const cookie = await signIn();
    expect((await call("/api/admin/preorders/request", { product: "supernova", link: "http://pay" }, cookie, ADMIN)).status).toBe(400);
    expect((await call("/api/admin/preorders/request", { product: "light", link: "https://pay.example/x" }, cookie, ADMIN)).status).toBe(409);
    sent = [];
    const r = await call("/api/admin/preorders/request", { product: "supernova", link: "https://pay.example/dep" }, cookie, ADMIN);
    expect(r.body).toMatchObject({ ok: true, sent: 10, failed: [] });
    expect(sent[0].text).toContain("https://pay.example/dep");
    expect(sent[0].text).toContain("$100");

    const list = (await call("/api/admin/preorders", undefined, cookie, ADMIN)).body;
    expect(list.preorders.every((p: any) => p.status === "deposit_requested")).toBe(true);
    const id = list.preorders[0].id;
    expect((await call("/api/admin/preorders/mark", { id, status: "deposit_paid" }, cookie, ADMIN)).body.ok).toBe(true);
    expect((await call("/api/preorder/info")).body.products[1].reserved).toBe(10);
    const csv = await call("/api/admin/preorders?format=csv", undefined, cookie, ADMIN);
    expect(String(csv.body).split("\n")[0]).toContain("product,status,email");
  });

  it("keeps the admin list behind sign-in", async () => {
    expect((await call("/api/admin/preorders")).status).toBe(401);
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
