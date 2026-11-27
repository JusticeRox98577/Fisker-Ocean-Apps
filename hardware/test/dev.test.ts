import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { twistedEdwards } from "@noble/curves/abstract/edwards";
import { ed25519 } from "@noble/curves/ed25519";
import { blake2b } from "@noble/hashes/blake2b";
import { beforeEach, describe, expect, it } from "vitest";
import { hex, parseHello, unhex } from "../src/dev";
import type { Env, MailService } from "../src/env";
import worker from "../src/index";

const ORIGIN = "https://hardware.oceanlive.org";
const eddsa = twistedEdwards({ ...ed25519.CURVE, hash: (m: Uint8Array | string) => blake2b(m, { dkLen: 64 }) });
const ownerSeed = new Uint8Array(32).fill(1);
const leaseSeed = new Uint8Array(32).fill(2);
const devSeed = new Uint8Array(32).fill(3);
const UID = "0102030405060708090a0b0c";

let sent: { to: string; text: string }[] = [];
const mail: MailService = { send: async (n) => { sent.push(n); return { ok: true }; } };
const testEnv = (): Env => ({
  ...env, MAIL: mail,
  OWNER_PUB: hex(eddsa.getPublicKey(ownerSeed)),
  LEASE_KEY: hex(leaseSeed) + hex(eddsa.getPublicKey(leaseSeed)),
});

async function call(path: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  if (init.cookie) headers.set("Cookie", init.cookie);
  if (init.method === "POST") headers.set("Origin", ORIGIN);
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), testEnv(), ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function signIn(): Promise<string> {
  sent = [];
  await call("/api/admin/login", { method: "POST", body: "{}" });
  const token = sent[0].text.match(/#login=([A-Za-z0-9_-]+)/)![1];
  const res = await call("/api/admin/session", { method: "POST", body: JSON.stringify({ token }) });
  return res.headers.get("Set-Cookie")!.split(";")[0];
}

/** A certificate as novaboot.py cert makes it. */
function cert(serial: number, lease: number, signer = ownerSeed, uid = UID): string {
  const b = new Uint8Array(96);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, 0x4344564e, true);
  b[4] = 1; b[5] = 0b110; dv.setUint16(6, lease, true); dv.setUint32(8, serial, true);
  b.set(unhex(uid)!, 12);
  b.set(eddsa.getPublicKey(devSeed), 24);
  b.set(new TextEncoder().encode("Alex"), 56);
  return hex(b) + hex(eddsa.sign(b, signer));
}

/** The bootloader's HELLO. */
function hello(o: { serial: number; starts: number; until: number; lease: number; signer?: number }): string {
  const b = new Uint8Array(35);
  const dv = new DataView(b.buffer);
  b[0] = 1; b[1] = 1; b.set(unhex(UID)!, 2); b[14] = 1;
  dv.setUint32(15, o.serial, true); dv.setUint32(19, 0x00020001, true); b[23] = o.signer ?? 1;
  dv.setUint32(24, o.starts, true); dv.setUint32(28, o.until, true); dv.setUint16(32, o.lease, true);
  return hex(b);
}

const checkin = async (h: string) =>
  (await (await call("/api/dev/checkin", { method: "POST", body: JSON.stringify({ hello: h, app: "0.1.0", uptimeS: 60 }) })).json()) as { tokens: string[] };

/** Token checks as the bootloader does them (nb_token_check). */
function readToken(t: string) {
  const b = unhex(t)!;
  const dv = new DataView(b.buffer);
  return {
    ok: eddsa.verify(b.slice(32), b.slice(0, 32), eddsa.getPublicKey(leaseSeed)),
    kind: b[5], serial: dv.getUint32(8, true), uid: hex(b.slice(12, 24)), until: dv.getUint32(24, true),
  };
}

beforeEach(async () => {
  await env.DB.batch(["dev_certs", "dev_checkins", "counters", "sessions", "login_links"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
});

describe("developer access", () => {
  it("registers only owner-signed certificates, once", async () => {
    const cookie = await signIn();
    const reg = (c: string) => call("/api/admin/dev/register", { method: "POST", body: JSON.stringify({ cert: c }), cookie });
    expect((await reg(cert(7, 20, devSeed))).status).toBe(400); // signed by the developer themselves
    const ok = await reg(cert(7, 20));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as any).cert).toMatchObject({ serial: 7, uid: UID, holder: "Alex", lease: 20, targets: 6 });
    expect((await reg(cert(7, 20))).status).toBe(409);
    expect((await call("/api/admin/dev/register", { method: "POST", body: JSON.stringify({ cert: cert(8, 1) }) })).status).toBe(401);
  });

  it("renews half-used leases and records usage", async () => {
    const cookie = await signIn();
    await call("/api/admin/dev/register", { method: "POST", body: JSON.stringify({ cert: cert(7, 20) }), cookie });

    // fresh box: no renewal yet, so the bootloader won't start developer firmware -> renew
    let r = await checkin(hello({ serial: 7, starts: 0, until: 0, lease: 20 }));
    expect(r.tokens).toHaveLength(1);
    expect(readToken(r.tokens[0])).toEqual({ ok: true, kind: 1, serial: 7, uid: UID, until: 20 });
    // plenty left: nothing
    r = await checkin(hello({ serial: 7, starts: 5, until: 20, lease: 20 }));
    expect(r.tokens).toHaveLength(0);
    // half used: renew from where it is
    r = await checkin(hello({ serial: 7, starts: 10, until: 20, lease: 20 }));
    expect(readToken(r.tokens[0]).until).toBe(30);

    const list = (await (await call("/api/admin/dev", { cookie })).json()) as any;
    expect(list.certs[0]).toMatchObject({ serial: 7, status: "active", checkins: 3, dev_starts: 10, signer: 1, app_version: "0.1.0" });
    expect(list.leaseKeySet).toBe(true);
    const log = (await (await call("/api/admin/dev/checkins?serial=7", { cookie })).json()) as any;
    expect(log.checkins.map((c: any) => c.token)).toEqual(["renew", "", "renew"]);
  });

  it("sends a revocation once revoked, and never renews again", async () => {
    const cookie = await signIn();
    await call("/api/admin/dev/register", { method: "POST", body: JSON.stringify({ cert: cert(7, 20) }), cookie });
    expect((await call("/api/admin/dev/revoke", { method: "POST", body: JSON.stringify({ serial: 7, reason: "test" }), cookie })).status).toBe(200);
    const r = await checkin(hello({ serial: 7, starts: 19, until: 20, lease: 20 }));
    expect(r.tokens.map((t) => readToken(t).kind)).toEqual([2]);
    expect(readToken(r.tokens[0])).toMatchObject({ ok: true, serial: 7, uid: UID });
    // still sent after the certificate is gone from the box (the bootloader keeps it on its revoked list)
    const after = await checkin(hello({ serial: 0, starts: 19, until: 0, lease: 0, signer: 0 }));
    expect(after.tokens.map((t) => readToken(t).kind)).toEqual([2]);
    expect((await call("/api/admin/dev/revoke", { method: "POST", body: JSON.stringify({ serial: 7 }), cookie })).status).toBe(404);
  });

  it("rejects junk", async () => {
    expect((await call("/api/dev/checkin", { method: "POST", body: JSON.stringify({ hello: "zz" }) })).status).toBe(400);
    expect(parseHello(new Uint8Array(10))).toBeNull();
    expect((await call("/api/admin/dev")).status).toBe(401);
  });
});
