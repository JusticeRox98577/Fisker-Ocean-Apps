/**
 * SuperNova boxes (Oceanlive-nova docs/nrf.md).
 *
 * The car (nRF9151):
 *   POST /api/box/checkin { uid, fw, lat, lon, fix, rsrp, gear, speed, ignition, v12, phones, counter, cmd: [action, result] }
 *        -> { commands: [hex] }   signed commands for this car that are still valid and not used yet
 * The Nova screen (compute module), to pair a phone:
 *   POST /api/box/pair/start { uid }        -> { code, expiresIn }   shown on the car screen
 *   GET  /api/box/pair/poll?code=           -> { status, phoneName, phonePub }
 *   POST /api/box/pair/finish { code, slot } (slot from the nRF9151, or refused: true)
 * The phone (Ocean Live app):
 *   POST /api/box/pair/request { code, phonePub, phoneName } -> { uid }
 *   GET  /api/box/pair/status?code=         -> { status, slot, uid }
 *   POST /api/box/command { uid, cmd }       a command signed on the phone (standard Ed25519)
 *   GET  /api/box/status?uid&slot&t&sig     the car's last check-in; sig = Ed25519 over "nova-status:<uid>:<t>"
 *
 * The cloud carries commands; it can't make one (only the phone's key can), and the car checks every
 * command again. Pairing needs the code on the car screen and a tap on Approve in the car.
 */
import { ed25519 } from "@noble/curves/ed25519";
import { hex, unhex } from "./dev";
import type { Env } from "./env";
import { json } from "./util";

const PAIR_MS = 10 * 60 * 1000;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I
const uidOk = (u: unknown): u is string => typeof u === "string" && /^[0-9a-f]{24}$/.test(u);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);

function code(): string {
  const r = crypto.getRandomValues(new Uint8Array(8));
  return [...r].map((x) => CODE_CHARS[x & 31]).join("");
}

/* ---- the car ---- */

export async function checkin(env: Env, b: Record<string, unknown>, now: number): Promise<Response> {
  if (!uidOk(b.uid)) return json({ error: "uid" }, 400);
  const uid = b.uid;
  const fix = !!b.fix;
  const lat = fix ? num(b.lat) / 1e7 : null;
  const lon = fix ? num(b.lon) / 1e7 : null;
  const cmd = Array.isArray(b.cmd) ? b.cmd.map(num) : [0, 0];
  const counter = num(b.counter);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO boxes (uid, first_seen, last_seen, fw, lat, lon, fix, rsrp, gear, speed, ignition, v12, phones, counter, last_cmd_action, last_cmd_result)
       VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
       ON CONFLICT(uid) DO UPDATE SET last_seen = ?2, fw = ?3, lat = COALESCE(?4, lat), lon = COALESCE(?5, lon), fix = ?6,
         rsrp = ?7, gear = ?8, speed = ?9, ignition = ?10, v12 = ?11, phones = ?12, counter = ?13,
         last_cmd_action = ?14, last_cmd_result = ?15`,
    ).bind(uid, now, num(b.fw), lat, lon, fix ? 1 : 0, num(b.rsrp), num(b.gear), num(b.speed), b.ignition ? 1 : 0,
      num(b.v12), num(b.phones), counter, cmd[0] ?? 0, cmd[1] ?? 0),
    env.DB.prepare(
      `INSERT INTO box_telemetry (uid, at, lat, lon, v12, gear, speed, ignition, rsrp)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
       WHERE NOT EXISTS (SELECT 1 FROM box_telemetry WHERE uid = ?1 AND at > ?2 - 55000)`,
    ).bind(uid, now, lat, lon, num(b.v12), num(b.gear), num(b.speed), b.ignition ? 1 : 0, num(b.rsrp)),
    // the result of the last command the car acted on
    env.DB.prepare("UPDATE commands SET result = ?3 WHERE uid = ?1 AND counter = ?2 AND result IS NULL")
      .bind(uid, counter, cmd[1] ?? 0),
  ]);
  // commands still valid and above the car's counter (it ignores the rest anyway)
  const { results } = await env.DB.prepare(
    "SELECT cmd FROM commands WHERE uid = ?1 AND expires_at > ?2 AND counter > ?3 ORDER BY counter LIMIT 4",
  ).bind(uid, now, counter).all<{ cmd: string }>();
  return json({ commands: results.map((r) => r.cmd) });
}

/* ---- pairing ---- */

export async function pairStart(env: Env, b: Record<string, unknown>, now: number): Promise<Response> {
  if (!uidOk(b.uid)) return json({ error: "uid" }, 400);
  const c = code();
  await env.DB.prepare("INSERT INTO pairings (code, uid, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(c, b.uid, now, now + PAIR_MS).run();
  return json({ code: c, expiresIn: PAIR_MS / 1000 });
}

async function pairing(env: Env, c: unknown, now: number) {
  if (typeof c !== "string" || !/^[A-Z2-9]{8}$/.test(c)) return null;
  return env.DB.prepare("SELECT * FROM pairings WHERE code = ?1 AND expires_at > ?2").bind(c, now)
    .first<{ code: string; uid: string; status: string; phone_pub: string | null; phone_name: string | null; slot: number | null }>();
}

export async function pairRequest(env: Env, b: Record<string, unknown>, now: number): Promise<Response> {
  const p = await pairing(env, String(b.code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""), now);
  if (!p || p.status !== "waiting") return json({ error: "That code isn't valid or has expired. Start again on the car screen." }, 404);
  const pub = unhex(b.phonePub);
  if (!pub || pub.length !== 32) return json({ error: "phonePub" }, 400);
  const name = String(b.phoneName ?? "Phone").slice(0, 40);
  await env.DB.prepare("UPDATE pairings SET status = 'requested', phone_pub = ?2, phone_name = ?3 WHERE code = ?1")
    .bind(p.code, hex(pub), name).run();
  return json({ ok: true, uid: p.uid });
}

export async function pairPoll(env: Env, c: string, now: number): Promise<Response> {
  const p = await pairing(env, c, now);
  if (!p) return json({ error: "expired" }, 404);
  return json({ status: p.status, phoneName: p.phone_name, phonePub: p.phone_pub, slot: p.slot, uid: p.uid });
}

export async function pairFinish(env: Env, b: Record<string, unknown>, now: number): Promise<Response> {
  const p = await pairing(env, b.code, now);
  if (!p || p.status !== "requested" || !p.phone_pub) return json({ error: "Nothing to finish." }, 404);
  if (b.refused === true || !Number.isInteger(b.slot) || (b.slot as number) < 0 || (b.slot as number) > 3) {
    await env.DB.prepare("UPDATE pairings SET status = 'refused' WHERE code = ?1").bind(p.code).run();
    return json({ ok: true, status: "refused" });
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE pairings SET status = 'paired', slot = ?2 WHERE code = ?1").bind(p.code, b.slot),
    env.DB.prepare(
      `INSERT INTO phones (uid, slot, pub, name, paired_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(uid, slot) DO UPDATE SET pub = ?3, name = ?4, paired_at = ?5`,
    ).bind(p.uid, b.slot, p.phone_pub, p.phone_name ?? "", now),
  ]);
  return json({ ok: true, status: "paired" });
}

/* ---- commands and status, from a paired phone ---- */

async function phoneKey(env: Env, uid: string, slot: number): Promise<Uint8Array | null> {
  const r = await env.DB.prepare("SELECT pub FROM phones WHERE uid = ?1 AND slot = ?2").bind(uid, slot).first<{ pub: string }>();
  return r ? unhex(r.pub) : null;
}

export async function command(env: Env, b: Record<string, unknown>, now: number): Promise<Response> {
  if (!uidOk(b.uid)) return json({ error: "uid" }, 400);
  const c = unhex(b.cmd);
  if (!c || c.length !== 104 || u32(c, 0) !== 0x4d43564e || c[4] !== 1) return json({ error: "That isn't a Nova command." }, 400);
  if (hex(c.slice(8, 20)) !== b.uid) return json({ error: "The command is for another car." }, 400);
  const key = await phoneKey(env, b.uid, c[32]);
  if (!key || !ed25519.verify(c.slice(40), c.slice(0, 40), key)) return json({ error: "Not signed by a phone paired with this car." }, 403);
  const expires = u32(c, 28) * 1000;
  if (expires <= now) return json({ error: "The command has expired." }, 400);
  await env.DB.prepare("INSERT INTO commands (uid, cmd, action, counter, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
    .bind(b.uid, hex(c), c[5], u32(c, 20), now, expires).run();
  return json({ ok: true });
}

export async function status(env: Env, url: URL, now: number): Promise<Response> {
  const uid = url.searchParams.get("uid");
  const slot = Number(url.searchParams.get("slot"));
  const t = Number(url.searchParams.get("t"));
  const sig = unhex(url.searchParams.get("sig"));
  if (!uidOk(uid) || !Number.isInteger(slot) || !sig || sig.length !== 64) return json({ error: "uid, slot, t, sig" }, 400);
  if (Math.abs(now / 1000 - t) > 300) return json({ error: "Check the phone's clock." }, 401);
  const key = await phoneKey(env, uid, slot);
  if (!key || !ed25519.verify(sig, new TextEncoder().encode(`nova-status:${uid}:${t}`), key)) return json({ error: "Not a paired phone." }, 403);
  const box = await env.DB.prepare("SELECT * FROM boxes WHERE uid = ?1").bind(uid).first();
  const { results: cmds } = await env.DB.prepare(
    "SELECT action, counter, created_at, result FROM commands WHERE uid = ?1 ORDER BY id DESC LIMIT 10",
  ).bind(uid).all();
  return json({ box, commands: cmds });
}

/* ---- admin ---- */

export async function listBoxes(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT b.uid, b.last_seen, b.fw, b.v12, b.rsrp, b.phones, b.ignition, b.last_cmd_action, b.last_cmd_result,
       (SELECT COUNT(*) FROM commands c WHERE c.uid = b.uid) AS commands
     FROM boxes b ORDER BY b.last_seen DESC LIMIT 200`,
  ).all();
  return json({ boxes: results });
}

/** Daily: old telemetry, expired pairing codes and commands. */
export async function cleanup(env: Env, now: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM box_telemetry WHERE at < ?1").bind(now - 30 * 86400000),
    env.DB.prepare("DELETE FROM pairings WHERE expires_at < ?1").bind(now - 86400000),
    env.DB.prepare("DELETE FROM commands WHERE expires_at < ?1").bind(now - 30 * 86400000),
  ]);
}
