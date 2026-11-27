import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { sendNotice } from "../src/notify";

function mockResend() {
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ id: "re_n1" }));
}

describe("sendNotice (for other Workers)", () => {
  it("sends from a mailbox here and keeps a copy in Sent", async () => {
    const resend = mockResend();
    const e: Env = { ...env, RESEND_API_KEY: "test", RESEND_FETCH: resend as unknown as typeof fetch };
    const r = await sendNotice(e, { from: "justice@oceanlive.org", to: "tester@example.com", subject: "You've been picked", text: "Hi" });
    expect(r).toEqual({ ok: true });
    const payload = JSON.parse(String(resend.mock.calls[0][1]?.body));
    expect(payload.from).toMatch(/justice@oceanlive\.org/);
    expect(payload.to).toEqual(["tester@example.com"]);
    const row = await env.DB.prepare("SELECT folder, subject FROM messages WHERE mailbox = 'justice@oceanlive.org' AND subject = ?1")
      .bind("You've been picked")
      .first();
    expect(row).toEqual({ folder: "sent", subject: "You've been picked" });
  });

  it("refuses a sender that isn't a mailbox, more than one recipient, or an empty notice", async () => {
    const resend = mockResend();
    const e: Env = { ...env, RESEND_API_KEY: "test", RESEND_FETCH: resend as unknown as typeof fetch };
    expect(await sendNotice(e, { from: "ceo@bank.com", to: "a@example.com", subject: "x", text: "y" })).toMatchObject({ ok: false });
    expect(await sendNotice(e, { from: "nobody@oceanlive.org", to: "a@example.com", subject: "x", text: "y" })).toMatchObject({ ok: false });
    expect(await sendNotice(e, { from: "justice@oceanlive.org", to: "a@example.com, b@example.com", subject: "x", text: "y" })).toMatchObject({ ok: false });
    expect(await sendNotice(e, { from: "justice@oceanlive.org", to: "a@example.com", subject: "", text: "y" })).toMatchObject({ ok: false });
    expect(resend).not.toHaveBeenCalled();
  });

  it("passes on Resend's refusal", async () => {
    const resend = vi.fn(async () => Response.json({ message: "domain not verified" }, { status: 403 }));
    const e: Env = { ...env, RESEND_API_KEY: "test", RESEND_FETCH: resend as unknown as typeof fetch };
    const r = await sendNotice(e, { from: "justice@oceanlive.org", to: "a@example.com", subject: "x", text: "y" });
    expect(r).toEqual({ ok: false, error: "Resend didn't send it: domain not verified" });
  });
});
