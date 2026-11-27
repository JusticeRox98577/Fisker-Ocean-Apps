import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { ed25519 } from "@noble/curves/ed25519";
import { beforeEach, describe, expect, it } from "vitest";
import { hex } from "../src/dev";
import worker from "../src/index";

const ORIGIN = "https://hardware.oceanlive.org";
const UID = "0102030405060708090a0b0c";
const phone = new Uint8Array(32).fill(7);
const stranger = new Uint8Array(32).fill(8);

async function call(path: string, body?: unknown) {
  const ctx = createExecutionContext();
  const init: RequestInit = body === undefined ? {} : { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } };
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, init), env, ctx);
  await waitOnExecutionContext(ctx);
  return { status: res.status, body: (await res.json()) as any };
}

/** A command as the phone makes it (fw/lib/novacmd layout), signed with standard Ed25519. */
function command(key: Uint8Array, action: number, counter: number, issued: number, slot = 0, uid = UID): string {
  const b = new Uint8Array(40);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, 0x4d43564e, true); b[4] = 1; b[5] = action;
  b.set(Uint8Array.from(uid.match(/../g)!.map((x) => parseInt(x, 16))), 8);
  dv.setUint32(20, counter, true); dv.setUint32(24, issued, true); dv.setUint32(28, issued + 120, true); b[32] = slot;
  return hex(b) + hex(ed25519.sign(b, key));
}

beforeEach(async () => {
  await env.DB.batch(["boxes", "box_telemetry", "pairings", "phones", "commands", "counters"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
});

async function pair(): Promise<void> {
  const start = await call("/api/box/pair/start", { uid: UID });
  const { code, secret } = start.body;
  expect(code).toMatch(/^[A-Z2-9]{8}$/);
  expect((await call(`/api/box/pair/poll?code=${code}&secret=${secret}`)).body.status).toBe("waiting");
  const req = await call("/api/box/pair/request", { code: code.toLowerCase().replace(/(....)/, "$1-"), phonePub: hex(ed25519.getPublicKey(phone)), phoneName: "Pixel" });
  expect(req.body.uid).toBe(UID);
  const poll = (await call(`/api/box/pair/poll?code=${code}&secret=${secret}`)).body;
  expect(poll).toMatchObject({ status: "requested", phoneName: "Pixel" });
  // the car screen: approved, the nRF9151 put the phone in slot 0
  expect((await call("/api/box/pair/finish", { code, secret, slot: 0 })).body.status).toBe("paired");
  expect((await call(`/api/box/pair/status?code=${code}`)).body).toMatchObject({ status: "paired", slot: 0, uid: UID });
}

describe("SuperNova boxes", () => {
  it("lets only the car screen that started a pairing see the request and approve it", async () => {
    const { code, secret } = (await call("/api/box/pair/start", { uid: UID })).body;
    const pub = hex(ed25519.getPublicKey(phone));
    await call("/api/box/pair/request", { code, phonePub: pub, phoneName: "Pixel" });
    // someone who only saw the code on screen
    expect((await call(`/api/box/pair/poll?code=${code}`)).status).toBe(403);
    expect((await call(`/api/box/pair/poll?code=${code}&secret=x${secret}`)).status).toBe(403);
    expect((await call("/api/box/pair/finish", { code, slot: 0 })).status).toBe(403);
    expect((await call("/api/box/pair/finish", { code, secret: "nope", slot: 0 })).status).toBe(403);
    expect((await call(`/api/box/pair/status?code=${code}`)).body).toEqual({ status: "requested" });
    // another phone can't take over the code; the same phone asking again is fine
    expect((await call("/api/box/pair/request", { code, phonePub: hex(ed25519.getPublicKey(stranger)) })).status).toBe(404);
    expect((await call("/api/box/pair/request", { code, phonePub: pub })).body.uid).toBe(UID);
    expect((await call("/api/box/pair/finish", { code, secret, slot: 1 })).body.status).toBe("paired");
    expect((await call("/api/box/pair/request", { code, phonePub: pub })).body.uid).toBe(UID);
    expect((await call(`/api/box/pair/status?code=${code}`)).body).toEqual({ status: "paired", slot: 1, uid: UID });
  });

  it("pairs a phone only through a code from the car screen", async () => {
    expect((await call("/api/box/pair/request", { code: "AAAAAAAA", phonePub: hex(ed25519.getPublicKey(phone)) })).status).toBe(404);
    await pair();
  });

  it("relays only commands signed by a paired phone, until the car has used them", async () => {
    await pair();
    const now = Math.floor(Date.now() / 1000);
    expect((await call("/api/box/command", { uid: UID, cmd: command(stranger, 1, 10, now) })).status).toBe(403);
    expect((await call("/api/box/command", { uid: UID, cmd: command(phone, 1, 10, now, 0, "ff".repeat(12)) })).status).toBe(400);
    expect((await call("/api/box/command", { uid: UID, cmd: command(phone, 1, 10, now) })).status).toBe(200);

    let r = await call("/api/box/checkin", { uid: UID, fw: 65536, fix: 1, lat: 512345678, lon: -1141234567, v12: 12600, counter: 0, cmd: [0, 0] });
    expect(r.body.commands).toHaveLength(1);
    // the car used it (counter 10) and reports the gate's answer (3 = not configured)
    r = await call("/api/box/checkin", { uid: UID, fw: 65536, v12: 12600, counter: 10, cmd: [1, 3] });
    expect(r.body.commands).toHaveLength(0);

    const t = Math.floor(Date.now() / 1000);
    const sig = hex(ed25519.sign(new TextEncoder().encode(`nova-status:${UID}:${t}`), phone));
    const st = await call(`/api/box/status?uid=${UID}&slot=0&t=${t}&sig=${sig}`);
    expect(st.status).toBe(200);
    expect(st.body.box).toMatchObject({ v12: 12600, lat: 51.2345678, counter: 10 });
    expect(st.body.commands[0]).toMatchObject({ action: 1, result: 3 });
    const bad = hex(ed25519.sign(new TextEncoder().encode(`nova-status:${UID}:${t}`), stranger));
    expect((await call(`/api/box/status?uid=${UID}&slot=0&t=${t}&sig=${bad}`)).status).toBe(403);
  });
});
