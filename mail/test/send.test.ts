import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import type { Env, Session } from "../src/env";
import { storeInbound } from "../src/receive";
import { parseRecipients, sendMail, textToHtml } from "../src/send";
import { enc, multipartMessage } from "./fixtures";

const session: Session = { mailbox: "justice@oceanlive.org", csrf: "x", tokenHash: "x" };

function mockResend(status = 200, body: unknown = { id: "re_123" }) {
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json(body, { status }));
}

function sendRequest(fields: Record<string, string | File | (string | File)[]>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const item of Array.isArray(v) ? v : [v]) form.append(k, item);
  return new Request("https://mail.oceanlive.org/api/send", { method: "POST", body: form });
}

describe("parseRecipients", () => {
  it("reads names and addresses and flags bad ones", () => {
    expect(parseRecipients('Ada <ada@example.com>, bob@example.org')).toEqual({
      ok: [
        { name: "Ada", address: "ada@example.com" },
        { name: "", address: "bob@example.org" },
      ],
      bad: [],
    });
    expect(parseRecipients("nope, x@y").bad).toHaveLength(2);
  });
});

describe("textToHtml", () => {
  it("escapes, links and quotes", () => {
    const html = textToHtml("<b>hi</b> see https://oceanlive.org\n> quoted\n>> deeper");
    expect(html).toContain("&lt;b&gt;hi&lt;/b&gt;");
    expect(html).toContain('<a href="https://oceanlive.org">');
    expect(html.match(/<blockquote/g)).toHaveLength(2);
  });
});

describe("sendMail", () => {
  it("sends from the signed-in mailbox only, with reply headers and attachments, and keeps a copy in Sent", async () => {
    const orig = await storeInbound(env, "justice@oceanlive.org", enc(multipartMessage({ messageId: "<orig@example.com>" })));
    const resend = mockResend();
    const e: Env = { ...env, RESEND_API_KEY: "test", RESEND_FETCH: resend as unknown as typeof fetch };
    const res = await sendMail(
      sendRequest({
        to: "Ada <ada@example.com>",
        subject: "Re: Range question",
        text: "About 300 km.\n> How far?",
        replyTo: orig,
        from: "ceo@bank.com", // ignored: the sender is always the mailbox
        attachments: new File(["hello"], "notes.txt", { type: "text/plain" }),
      }),
      e,
      session,
    );
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };

    const [url, init] = resend.mock.calls[0];
    expect(String(url)).toBe("https://api.resend.com/emails");
    const payload = JSON.parse(String(init!.body));
    expect(payload.from).toBe('"Justice" <justice@oceanlive.org>');
    expect(payload.to).toEqual(['"Ada" <ada@example.com>']);
    expect(payload.headers).toEqual({
      "In-Reply-To": "<orig@example.com>",
      References: "<first@example.com> <orig@example.com>",
    });
    expect(payload.attachments).toEqual([{ filename: "notes.txt", content: btoa("hello"), content_type: "text/plain" }]);
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer test");

    const row = await env.DB.prepare("SELECT folder, provider_id, subject, has_attachments FROM messages WHERE id = ?1").bind(id).first();
    expect(row).toEqual({ folder: "sent", provider_id: "re_123", subject: "Re: Range question", has_attachments: 1 });
  });

  it("forwards chosen attachments of the original", async () => {
    const orig = await storeInbound(env, "justice@oceanlive.org", enc(multipartMessage({ messageId: "<fwd@example.com>" })));
    const resend = mockResend();
    const e: Env = { ...env, RESEND_API_KEY: "test", RESEND_FETCH: resend as unknown as typeof fetch };
    const res = await sendMail(
      sendRequest({ to: "bob@example.org", subject: "Fwd", text: "fyi", forwardOf: orig, forwardAttachment: `${orig}-1` }),
      e,
      session,
    );
    expect(res.status).toBe(200);
    const payload = JSON.parse(String(resend.mock.calls[0][1]!.body));
    expect(payload.attachments.map((a: { filename: string }) => a.filename)).toEqual(["trip.pdf"]);
  });

  it("won't reply to or forward another mailbox's message", async () => {
    const other = await storeInbound(env, "support@oceanlive.org", enc(multipartMessage({ messageId: "<other@example.com>" })));
    const e: Env = { ...env, RESEND_API_KEY: "test", RESEND_FETCH: mockResend() as unknown as typeof fetch };
    expect((await sendMail(sendRequest({ to: "a@b.co", text: "x", forwardOf: other }), e, session)).status).toBe(404);
  });

  it("refuses bad addresses and empty To", async () => {
    const resend = mockResend();
    const e: Env = { ...env, RESEND_API_KEY: "test", RESEND_FETCH: resend as unknown as typeof fetch };
    expect((await sendMail(sendRequest({ to: "not-an-address", text: "x" }), e, session)).status).toBe(400);
    expect((await sendMail(sendRequest({ to: "", cc: "a@b.co", text: "x" }), e, session)).status).toBe(400);
    expect(resend).not.toHaveBeenCalled();
  });

  it("stops at the hourly limit", async () => {
    const resend = mockResend();
    const e: Env = { ...env, SEND_PER_HOUR: "2", RESEND_API_KEY: "test", RESEND_FETCH: resend as unknown as typeof fetch };
    const s: Session = { ...session, mailbox: "support@oceanlive.org" };
    const go = () => sendMail(sendRequest({ to: "a@b.co", text: "x" }), e, s);
    expect((await go()).status).toBe(200);
    expect((await go()).status).toBe(200);
    expect((await go()).status).toBe(429);
    expect(resend).toHaveBeenCalledTimes(2);
  });

  it("reports a Resend error and stores nothing", async () => {
    const e: Env = { ...env, RESEND_API_KEY: "test", RESEND_FETCH: mockResend(422, { message: "Invalid from" }) as unknown as typeof fetch };
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM messages WHERE folder = 'sent'").first<{ n: number }>();
    const res = await sendMail(sendRequest({ to: "a@b.co", text: "x" }), e, session);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toContain("Invalid from");
    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM messages WHERE folder = 'sent'").first<{ n: number }>();
    expect(after!.n).toBe(before!.n);
  });
});
