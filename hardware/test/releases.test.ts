import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { twistedEdwards } from "@noble/curves/abstract/edwards";
import { ed25519 } from "@noble/curves/ed25519";
import { blake2b } from "@noble/hashes/blake2b";
import { beforeEach, describe, expect, it } from "vitest";
import { hex } from "../src/dev";
import type { Env, MailService } from "../src/env";
import worker from "../src/index";
import { readOtaZip } from "../src/releases";

const ORIGIN = "https://hardware.oceanlive.org";
const eddsa = twistedEdwards({ ...ed25519.CURVE, hash: (m: Uint8Array | string) => blake2b(m, { dkLen: 64 }) });
const owner = new Uint8Array(32).fill(1);
let sent: { text: string }[] = [];
const mail: MailService = { send: async (n) => { sent.push(n); return { ok: true }; } };
const testEnv = (): Env => ({ ...env, MAIL: mail, OWNER_PUB: hex(eddsa.getPublicKey(owner)) });

async function call(path: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("Cookie", init.cookie);
  if (init.method === "POST") headers.set("Origin", ORIGIN);
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), testEnv(), ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function signIn() {
  sent = [];
  await call("/api/admin/login", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
  const token = sent[0].text.match(/#login=([A-Za-z0-9_-]+)/)![1];
  const res = await call("/api/admin/session", { method: "POST", body: JSON.stringify({ token }), headers: { "Content-Type": "application/json" } });
  return res.headers.get("Set-Cookie")!.split(";")[0];
}

/** A .nova image as novaboot.py sign makes it. */
function nova(target: number, version: number, signer = 0, key = owner, codeLen = 1000): Uint8Array {
  const code = Uint8Array.from({ length: codeLen }, (_, i) => (i * 7) & 255);
  const h = new Uint8Array(64);
  const dv = new DataView(h.buffer);
  dv.setUint32(0, 0x4d49564e, true); h[4] = 1; h[5] = target; h[6] = signer;
  dv.setUint32(8, version, true); dv.setUint32(12, code.length, true);
  const sig = eddsa.sign(blake2b(new Uint8Array([...h, ...code]), { dkLen: 64 }), key);
  const out = new Uint8Array(0x100 + code.length);
  out.set(h); out.set(sig, 64); out.set(code, 0x100);
  return out;
}

/** A minimal zip with stored entries, like an A/B OTA. */
function zip(files: Record<string, Uint8Array>): Uint8Array {
  const parts: number[] = [];
  const central: number[] = [];
  const le = (n: number, b: number) => Array.from({ length: b }, (_, i) => (n >>> (8 * i)) & 255);
  for (const [name, data] of Object.entries(files)) {
    const nm = [...new TextEncoder().encode(name)];
    const off = parts.length;
    parts.push(...le(0x04034b50, 4), ...le(20, 2), 0, 0, 0, 0, 0, 0, 0, 0, ...le(0, 4), ...le(data.length, 4), ...le(data.length, 4),
      ...le(nm.length, 2), ...le(0, 2), ...nm, ...data);
    central.push(...le(0x02014b50, 4), ...le(20, 2), ...le(20, 2), 0, 0, 0, 0, 0, 0, 0, 0, ...le(0, 4), ...le(data.length, 4),
      ...le(data.length, 4), ...le(nm.length, 2), 0, 0, 0, 0, 0, 0, 0, 0, ...le(0, 4), ...le(off, 4), ...nm);
  }
  const cdOff = parts.length;
  return Uint8Array.from([...parts, ...central, ...le(0x06054b50, 4), 0, 0, 0, 0, ...le(Object.keys(files).length, 2),
    ...le(Object.keys(files).length, 2), ...le(central.length, 4), ...le(cdOff, 4), 0, 0]);
}

beforeEach(async () => {
  await env.DB.batch(["releases", "counters", "sessions", "login_links"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
});

describe("releases", () => {
  it("takes owner-signed images only, and offers the newest", async () => {
    const cookie = await signIn();
    const up = (img: Uint8Array, q: string) => call(`/api/admin/releases?${q}`, { method: "POST", body: img, cookie });
    expect((await up(nova(1, 0x00020000, 1), "target=supervisor")).status).toBe(400); // developer-signed
    expect((await up(nova(1, 0x00020000, 0, new Uint8Array(32).fill(9)), "target=supervisor")).status).toBe(400); // other key
    expect((await up(nova(2, 0x00020000), "target=supervisor")).status).toBe(400); // card image
    const bad = nova(1, 0x00020000); bad[0x180] ^= 1;
    expect((await up(bad, "target=supervisor")).status).toBe(400); // tampered
    expect((await up(nova(1, 0x00020000), "target=supervisor")).status).toBe(200);
    expect((await up(nova(1, 0x00030001), "target=supervisor&channel=beta")).status).toBe(200);

    let r = (await (await call("/api/updates?target=supervisor&have=65536")).json()) as any;
    expect(r.update).toMatchObject({ version: 0x00020000, label: "0.2.0", size: 1256 });
    r = (await (await call("/api/updates?target=supervisor&have=65536&channel=beta")).json()) as any;
    expect(r.update.label).toBe("0.3.1");
    r = (await (await call("/api/updates?target=supervisor&have=131072")).json()) as any;
    expect(r.update).toBeNull();

    const f = await call(`/api/updates/file/${(await (await call("/api/updates?target=supervisor&have=0")).json() as any).update.id}`);
    expect(new Uint8Array(await f.arrayBuffer())).toEqual(nova(1, 0x00020000));
  });

  it("keeps the two nRF9151 firmware lines apart", async () => {
    const cookie = await signIn();
    const up = (img: Uint8Array, t: string) => call(`/api/admin/releases?target=${t}`, { method: "POST", body: img, cookie });
    expect((await up(nova(1, 0x00010000), "nrf-light")).status).toBe(400); // a supervisor image
    expect((await up(nova(3, 0x00040002), "nrf-light")).status).toBe(200);
    expect((await up(nova(3, 0x00010000), "nrf-nova")).status).toBe(200);
    const light = ((await (await call("/api/updates?target=nrf-light&have=0")).json()) as any).update;
    const fresh = ((await (await call("/api/updates?target=nrf-nova&have=0")).json()) as any).update;
    expect([light.label, fresh.label]).toEqual(["0.4.2", "0.1.0"]);
  });

  it("serves ranges, and retires", async () => {
    const cookie = await signIn();
    const apk = Uint8Array.from({ length: 5000 }, (_, i) => (i === 0 ? 0x50 : i === 1 ? 0x4b : i & 255));
    const res = await call("/api/admin/releases?target=app&version=7&label=0.1.1", { method: "POST", body: apk, cookie });
    const id = ((await res.json()) as any).id;
    const part = await call(`/api/updates/file/${id}`, { headers: { Range: "bytes=100-199" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("Content-Range")).toBe("bytes 100-199/5000");
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(apk.slice(100, 200));
    expect((await call("/api/admin/releases/retire", { method: "POST", body: JSON.stringify({ id }), cookie, headers: { "Content-Type": "application/json" } })).status).toBe(200);
    expect(((await (await call("/api/updates?target=app&have=1")).json()) as any).update).toBeNull();
  });

  it("registers an Android OTA from R2 and finds its payload", async () => {
    const cookie = await signIn();
    const payload = Uint8Array.from({ length: 3000 }, (_, i) => i & 255);
    const props = new TextEncoder().encode("FILE_HASH=abc\nFILE_SIZE=3000\nMETADATA_HASH=def\nMETADATA_SIZE=10\n");
    const z = zip({ "META-INF/com/android/metadata": new TextEncoder().encode("x"), "payload.bin": payload, "payload_properties.txt": props });
    await env.RELEASES!.put("ota/nova-20261127.zip", z);
    const found = await readOtaZip(env.RELEASES!, "ota/nova-20261127.zip");
    if (typeof found === "string") throw new Error(found);
    expect(z.slice(found.offset, found.offset + found.length)).toEqual(payload);
    const res = await call("/api/admin/releases/register", {
      method: "POST", cookie, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "android", key: "ota/nova-20261127.zip", version: 1795000000, label: "Nova OS 2026-11-27" }),
    });
    expect(res.status).toBe(200);
    const u = ((await (await call("/api/updates?target=android&have=1700000000")).json()) as any).update;
    expect(u.payload).toEqual({ offset: found.offset, size: 3000, headers: ["FILE_HASH=abc", "FILE_SIZE=3000", "METADATA_HASH=def", "METADATA_SIZE=10"] });
  });
});
