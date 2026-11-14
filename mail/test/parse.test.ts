import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { authWarning, handleEmail, mailboxFor, storeInbound } from "../src/receive";
import { canonicalAddress } from "../src/util";
import { enc, multipartMessage } from "./fixtures";

describe("addresses", () => {
  it("canonicalises recipients and drops +tags", () => {
    expect(canonicalAddress(" Justice+cars@OceanLive.org ")).toBe("justice@oceanlive.org");
    expect(canonicalAddress("not an address")).toBe("");
    expect(canonicalAddress("a@b@c.org")).toBe("");
  });
  it("only accepts our domain", () => {
    expect(mailboxFor("support@oceanlive.org", "oceanlive.org")).toBe("support@oceanlive.org");
    expect(mailboxFor("support@oceanlive.org.evil.com", "oceanlive.org")).toBe("");
    expect(mailboxFor("x@notoceanlive.org", "oceanlive.org")).toBe("");
  });
});

describe("authWarning", () => {
  it("warns on DMARC fail and on SPF fail without DKIM", () => {
    const h = (v: string) => ({ headers: [{ key: "authentication-results", originalKey: "Authentication-Results", value: v }] });
    expect(authWarning(h("mx.cloudflare.net; dmarc=fail header.from=bank.com"))).toMatch(/DMARC/);
    expect(authWarning(h("mx; spf=fail; dkim=none"))).toMatch(/SPF/);
    expect(authWarning(h("mx; spf=fail; dkim=pass"))).toBe("");
    expect(authWarning(h("mx; spf=pass; dkim=pass; dmarc=pass"))).toBe("");
  });
});

describe("storeInbound", () => {
  it("parses a multipart message into D1 and R2", async () => {
    const id = await storeInbound(env, "justice@oceanlive.org", enc(multipartMessage()));
    const row = await env.DB.prepare("SELECT * FROM messages WHERE id = ?1").bind(id).first<Record<string, unknown>>();
    expect(row).toMatchObject({
      mailbox: "justice@oceanlive.org",
      folder: "inbox",
      from_addr: "ada@example.com",
      from_name: "Ada Driver",
      subject: "Range question — winter",
      message_id: "<abc123@example.com>",
      in_reply_to: "<first@example.com>",
      has_html: 1,
      has_text: 1,
      has_attachments: 1,
      seen: 0,
    });
    expect(row!.snippet).toBe("Hi! How far does the Ocean go in winter?");
    expect(JSON.parse(String(row!.to_json))).toEqual([{ name: "Justice", address: "justice@oceanlive.org" }]);
    expect(JSON.parse(String(row!.cc_json))).toEqual([{ name: "", address: "support@oceanlive.org" }]);
    expect(row!.date).toBe(Date.parse("2026-11-13T10:00:00Z"));

    const { results: atts } = await env.DB.prepare("SELECT * FROM attachments WHERE message = ?1 ORDER BY idx").bind(id).all<Record<string, unknown>>();
    expect(atts).toHaveLength(2);
    expect(atts[0]).toMatchObject({ content_type: "image/png", content_id: "logo@ex", inline: 1 });
    expect(atts[1]).toMatchObject({ filename: "trip.pdf", content_type: "application/pdf", inline: 0 });
    expect(await (await env.STORE.get(String(atts[1].r2_key)))!.text()).toBe("%PDF-1.4 fake");
    expect(await (await env.STORE.get(`m/${id}/body.txt`))!.text()).toContain("winter");
    expect(await env.STORE.head(`m/${id}/raw.eml`)).not.toBeNull();
  });

  it("stores a duplicate delivery only once", async () => {
    const raw = enc(multipartMessage({ messageId: "<dup@example.com>" }));
    const a = await storeInbound(env, "justice@oceanlive.org", raw);
    const b = await storeInbound(env, "justice@oceanlive.org", raw);
    expect(b).toBe(a);
  });

  it("keeps a message it can't parse as a downloadable original", async () => {
    const id = await storeInbound(env, "justice@oceanlive.org", enc("not really mime\r\n\r\n"));
    const row = await env.DB.prepare("SELECT folder FROM messages WHERE id = ?1").bind(id).first();
    expect(row).toMatchObject({ folder: "inbox" });
  });
});

describe("handleEmail", () => {
  function fakeMessage(to: string, raw: string, rawSize = raw.length) {
    return {
      from: "ada@example.com",
      to,
      raw: new Response(raw).body!,
      rawSize,
      headers: new Headers(),
      setReject: vi.fn(),
      forward: vi.fn(),
      reply: vi.fn(),
    } as unknown as ForwardableEmailMessage & { setReject: ReturnType<typeof vi.fn> };
  }

  it("rejects addresses that are not mailboxes", async () => {
    const msg = fakeMessage("nobody@oceanlive.org", multipartMessage());
    await handleEmail(msg, env);
    expect(msg.setReject).toHaveBeenCalledOnce();
  });

  it("rejects oversized mail", async () => {
    const msg = fakeMessage("justice@oceanlive.org", "x", 30 * 1024 * 1024);
    await handleEmail(msg, env);
    expect(msg.setReject).toHaveBeenCalledOnce();
  });

  it("stores mail for a mailbox, +tags included", async () => {
    const msg = fakeMessage("Support+fsk@oceanlive.org", multipartMessage({ messageId: "<tag@example.com>" }));
    await handleEmail(msg, env);
    expect(msg.setReject).not.toHaveBeenCalled();
    const row = await env.DB.prepare("SELECT mailbox FROM messages WHERE message_id = '<tag@example.com>'").first();
    expect(row).toEqual({ mailbox: "support@oceanlive.org" });
  });
});
