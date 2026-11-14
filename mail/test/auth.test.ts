import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { storeInbound } from "../src/receive";
import { enc, multipartMessage } from "./fixtures";

const ORIGIN = "https://mail.oceanlive.org";
const PIN = "24681357"; // the test PIN from vitest.config.ts

async function login(address: string, pin: string, ip = "198.51.100.1") {
  return SELF.fetch(`${ORIGIN}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, "CF-Connecting-IP": ip },
    body: JSON.stringify({ address, pin }),
  });
}

async function signedIn(address = "justice@oceanlive.org", ip = "198.51.100.9") {
  const res = await login(address, PIN, ip);
  expect(res.status).toBe(200);
  const cookie = res.headers.get("Set-Cookie")!.split(";")[0];
  const { csrf } = (await res.json()) as { csrf: string };
  return { cookie, csrf };
}

describe("sign-in", () => {
  it("rejects a wrong PIN and an unknown mailbox with the same answer", async () => {
    const a = await login("justice@oceanlive.org", "0000", "203.0.113.1");
    const b = await login("nobody@oceanlive.org", PIN, "203.0.113.1");
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(await a.json()).toEqual(await b.json());
    expect(a.headers.get("Set-Cookie")).toBeNull();
  });

  it("sets a locked-down session cookie", async () => {
    const res = await login("Justice@OceanLive.org", PIN);
    expect(res.status).toBe(200);
    const set = res.headers.get("Set-Cookie")!;
    expect(set).toMatch(/^__Host-olmail=[\w-]{40,};/);
    for (const flag of ["Path=/", "Secure", "HttpOnly", "SameSite=Strict"]) expect(set).toContain(flag);
    const body = (await res.json()) as { mailbox: string; csrf: string };
    expect(body.mailbox).toBe("justice@oceanlive.org");
    expect(body.csrf.length).toBeGreaterThan(20);
  });

  it("refuses sign-in posted from another site", async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
      body: JSON.stringify({ address: "justice@oceanlive.org", pin: PIN }),
    });
    expect(res.status).toBe(403);
  });

  it("pauses a network after 5 wrong PINs, even for the right PIN", async () => {
    const ip = "192.0.2.77";
    for (let i = 0; i < 5; i++) expect((await login("justice@oceanlive.org", `bad${i}`, ip)).status).toBe(401);
    expect((await login("justice@oceanlive.org", PIN, ip)).status).toBe(429);
    // Another network is not affected.
    expect((await login("justice@oceanlive.org", PIN, "192.0.2.78")).status).toBe(200);
  });

  it("stores only a hash of the session token", async () => {
    const { cookie } = await signedIn();
    const token = cookie.split("=")[1];
    const { results } = await env.DB.prepare("SELECT token_hash FROM sessions").all<{ token_hash: string }>();
    expect(results.some((r) => r.token_hash === token)).toBe(false);
    expect(results.every((r) => /^[0-9a-f]{64}$/.test(r.token_hash))).toBe(true);
  });
});

describe("API access", () => {
  it("needs a session", async () => {
    expect((await SELF.fetch(`${ORIGIN}/api/messages`)).status).toBe(401);
    expect((await SELF.fetch(`${ORIGIN}/api/messages`, { headers: { Cookie: "__Host-olmail=forged" } })).status).toBe(401);
  });

  it("needs the CSRF token and same origin for changes", async () => {
    const { cookie, csrf } = await signedIn();
    const send = (headers: Record<string, string>) =>
      SELF.fetch(`${ORIGIN}/api/mailbox`, {
        method: "PATCH",
        headers: { Cookie: cookie, "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ name: "Justice W" }),
      });
    expect((await send({})).status).toBe(403);
    expect((await send({ "X-CSRF-Token": "wrong" })).status).toBe(403);
    expect((await send({ "X-CSRF-Token": csrf, Origin: "https://evil.example" })).status).toBe(403);
    expect((await send({ "X-CSRF-Token": csrf, "Sec-Fetch-Site": "cross-site" })).status).toBe(403);
    expect((await send({ "X-CSRF-Token": csrf, Origin: ORIGIN })).status).toBe(200);
  });

  it("keeps each mailbox's messages to itself", async () => {
    const id = await storeInbound(env, "support@oceanlive.org", enc(multipartMessage({ messageId: "<private@x>" })));
    const justice = await signedIn("justice@oceanlive.org");
    const support = await signedIn("support@oceanlive.org");
    const asJustice = await SELF.fetch(`${ORIGIN}/api/messages/${id}`, { headers: { Cookie: justice.cookie } });
    expect(asJustice.status).toBe(404);
    const asSupport = await SELF.fetch(`${ORIGIN}/api/messages/${id}`, { headers: { Cookie: support.cookie } });
    expect(asSupport.status).toBe(200);
    const list = (await (await SELF.fetch(`${ORIGIN}/api/messages?folder=inbox`, { headers: { Cookie: justice.cookie } })).json()) as {
      messages: { id: string }[];
    };
    expect(list.messages.some((m) => m.id === id)).toBe(false);
  });

  it("serves message HTML sandboxed, with remote images off unless asked", async () => {
    const id = await storeInbound(env, "justice@oceanlive.org", enc(multipartMessage({ messageId: "<html@x>" })));
    const { cookie } = await signedIn();
    const read = (await (await SELF.fetch(`${ORIGIN}/api/messages/${id}`, { headers: { Cookie: cookie } })).json()) as {
      remoteImages: number;
      attachments: { id: string; filename: string }[];
    };
    expect(read.remoteImages).toBe(1);
    expect(read.attachments.map((a) => a.filename)).toEqual(["trip.pdf"]);

    const body = await SELF.fetch(`${ORIGIN}/api/messages/${id}/body`, { headers: { Cookie: cookie } });
    const csp = body.headers.get("Content-Security-Policy")!;
    expect(csp).toContain("sandbox");
    expect(csp).toContain("img-src data:;");
    const html = await body.text();
    expect(html).not.toMatch(/<script|onclick|tracker\.example/);
    expect(html).toContain("data:image/png;base64,");

    const withImages = await SELF.fetch(`${ORIGIN}/api/messages/${id}/body?images=1`, { headers: { Cookie: cookie } });
    expect(withImages.headers.get("Content-Security-Policy")).toContain("img-src data: https:");
    expect(await withImages.text()).toContain("tracker.example");

    const att = await SELF.fetch(`${ORIGIN}/api/messages/${id}/attachments/${read.attachments[0].id}`, { headers: { Cookie: cookie } });
    expect(att.status, await att.clone().text()).toBe(200);
    expect(att.headers.get("Content-Disposition")).toMatch(/^attachment;/);
    expect(att.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(await att.text()).toBe("%PDF-1.4 fake");
  });

  it("moves to Trash, restores, and deletes only from Trash", async () => {
    const id = await storeInbound(env, "justice@oceanlive.org", enc(multipartMessage({ messageId: "<trash@x>" })));
    const { cookie, csrf } = await signedIn();
    const h = { Cookie: cookie, "X-CSRF-Token": csrf, Origin: ORIGIN, "Content-Type": "application/json" };
    expect((await SELF.fetch(`${ORIGIN}/api/messages/${id}`, { method: "DELETE", headers: h })).status).toBe(409);
    await SELF.fetch(`${ORIGIN}/api/messages/${id}`, { method: "PATCH", headers: h, body: JSON.stringify({ folder: "trash" }) });
    await SELF.fetch(`${ORIGIN}/api/messages/${id}`, { method: "PATCH", headers: h, body: JSON.stringify({ folder: "inbox" }) });
    expect(await env.DB.prepare("SELECT folder FROM messages WHERE id = ?1").bind(id).first()).toEqual({ folder: "inbox" });
    await SELF.fetch(`${ORIGIN}/api/messages/${id}`, { method: "PATCH", headers: h, body: JSON.stringify({ folder: "trash" }) });
    expect((await SELF.fetch(`${ORIGIN}/api/messages/${id}`, { method: "DELETE", headers: h })).status).toBe(200);
    expect(await env.DB.prepare("SELECT 1 FROM messages WHERE id = ?1").bind(id).first()).toBeNull();
    expect((await env.STORE.list({ prefix: `m/${id}/` })).objects).toHaveLength(0);
  });

  it("signs out for good", async () => {
    const { cookie, csrf } = await signedIn();
    const out = await SELF.fetch(`${ORIGIN}/api/logout`, { method: "POST", headers: { Cookie: cookie, "X-CSRF-Token": csrf, Origin: ORIGIN } });
    expect(out.status).toBe(200);
    expect((await SELF.fetch(`${ORIGIN}/api/session`, { headers: { Cookie: cookie } })).status).toBe(401);
  });

  it("adds a mailbox on the domain only", async () => {
    const { cookie, csrf } = await signedIn();
    const post = (body: unknown) =>
      SELF.fetch(`${ORIGIN}/api/mailboxes`, {
        method: "POST",
        headers: { Cookie: cookie, "X-CSRF-Token": csrf, Origin: ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const ok = await post({ local: "Billing", name: "Ocean Live Billing" });
    expect(ok.status).toBe(201);
    expect(await ok.json()).toEqual({ address: "billing@oceanlive.org", name: "Ocean Live Billing" });
    expect((await post({ local: "billing" })).status).toBe(409);
    expect((await post({ local: "bad name" })).status).toBe(400);
    expect(await post({ local: "x@evil.com" }).then((r) => r.json())).toMatchObject({ address: "x@oceanlive.org" });
  });
});
