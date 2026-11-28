/**
 * SuperNova boxes (Oceanlive-nova docs/nrf.md).
 *
 * The car (nRF9151, either build of the Nova firmware):
 *   POST /api/box/checkin { uid, fw, lat, lon, fix, rsrp, gear, speed, ignition, v12, phones, counter, cmd: [action, result] }
 *        -> { commands: [hex] }   signed commands for this car that are still valid and not used yet
 *   A Nova Light (kind "light") adds { state, budget, alerts, rn: [first, last], r: [[t, mV, flags], ...] }:
 *   its stored 12 V readings, kept as telemetry; the answer adds { ack: last, t: server time } and never
 *   carries commands (the Light is listen-only). When a newer Light build is published (stable channel,
 *   release target nrf-light) it adds { update: { id, v, size } }: the Light downloads
 *   /api/updates/file/<id> with Range while the car is awake and its bootloader installs it.
 * The Nova screen (compute module), to pair a phone:
 *   POST /api/box/pair/start { uid }        -> { code, secret, expiresIn }   the code is shown on screen;
 *                                              the secret never leaves the car screen
 *   GET  /api/box/pair/poll?code=&secret=   -> { status, phoneName, phonePub }
 *   POST /api/box/pair/finish { code, secret, slot } (slot from the nRF9151, or refused: true)
 * The phone (Ocean Live app):
 *   POST /api/box/pair/request { code, phonePub, phoneName } -> { uid }
 *   GET  /api/box/pair/status?code=         -> { status, slot, uid }
 *   POST /api/box/command { uid, cmd }       a command signed on the phone (standard Ed25519)
 *   GET  /api/box/status?uid&slot&t&sig     the car's last check-in; sig = Ed25519 over "nova-status:<uid>:<t>"
 *   POST /api/box/claim { code, phonePub, phoneName } -> { uid, slot }
 *        a Nova Light (no screen): the code printed inside its box pairs the phone at once
 * Admin:
 *   POST /api/admin/boxes/code { uid } -> { code }   a new box code for that device ID (the old one stops
 *        working); shown once, to print
 *
 * The cloud carries commands; it can't make one (only the phone's key can), and the car checks every
 * command again. Pairing needs the code on the car screen and a tap on Approve in the car.
 */
import { ed25519 } from "@noble/curves/ed25519";
import { hex, unhex } from "./dev";
import type { Env } from "./env";
import { json, randomToken, sha256 } from "./util";

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
  const light = b.kind === "light";
  const readings = light ? lightReadings(b, now) : null;
  if (readings === "bad") return json({ error: "readings" }, 400);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO boxes (uid, first_seen, last_seen, fw, lat, lon, fix, rsrp, gear, speed, ignition, v12, phones, counter,
         last_cmd_action, last_cmd_result, kind, state, budget_kb, alerts)
       VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
       ON CONFLICT(uid) DO UPDATE SET last_seen = ?2, fw = ?3, lat = COALESCE(?4, lat), lon = COALESCE(?5, lon), fix = ?6,
         rsrp = ?7, gear = ?8, speed = ?9, ignition = ?10, v12 = ?11, phones = ?12, counter = ?13,
         last_cmd_action = ?14, last_cmd_result = ?15, kind = ?16, state = ?17, budget_kb = ?18, alerts = ?19`,
    ).bind(uid, now, num(b.fw), lat, lon, fix ? 1 : 0, num(b.rsrp), num(b.gear), num(b.speed), b.ignition ? 1 : 0,
      num(b.v12), num(b.phones), counter, cmd[0] ?? 0, cmd[1] ?? 0, light ? "light" : "supernova",
      light ? num(b.state) : 0, light ? num(b.budget) : 0, light ? num(b.alerts) : 0),
    // a Light's stored readings: one row each (sent again after a lost answer: kept once)
    ...(readings?.rows ?? []).map(([at, mv, awake]) =>
      env.DB.prepare("INSERT OR IGNORE INTO box_telemetry (uid, at, v12, ignition) VALUES (?1, ?2, ?3, ?4)").bind(uid, at, mv, awake)),
    env.DB.prepare(
      `INSERT OR IGNORE INTO box_telemetry (uid, at, lat, lon, v12, gear, speed, ignition, rsrp)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
       WHERE NOT EXISTS (SELECT 1 FROM box_telemetry WHERE uid = ?1 AND at > ?2 - 55000)`,
    ).bind(uid, now, lat, lon, num(b.v12), num(b.gear), num(b.speed), b.ignition ? 1 : 0, num(b.rsrp)),
    // the result of the last command the car acted on
    env.DB.prepare("UPDATE commands SET result = ?3 WHERE uid = ?1 AND counter = ?2 AND result IS NULL")
      .bind(uid, counter, cmd[1] ?? 0),
  ]);
  if (light) {
    const rel = await env.DB.prepare(
      `SELECT id, version, size FROM releases WHERE target = 'nrf-light' AND retired = 0 AND channel = 'stable'
         AND version > ?1 AND size <= ?2 ORDER BY version DESC LIMIT 1`,
    ).bind(num(b.fw), LIGHT_STAGING).first<{ id: number; version: number; size: number }>();
    return json({
      commands: [], t: Math.floor(now / 1000),
      ...(readings?.ack !== undefined ? { ack: readings.ack } : {}),
      ...(rel ? { update: { id: rel.id, v: rel.version, size: rel.size } } : {}),
    });
  }
  // commands still valid and above the car's counter (it ignores the rest anyway)
  const { results } = await env.DB.prepare(
    "SELECT cmd FROM commands WHERE uid = ?1 AND expires_at > ?2 AND counter > ?3 ORDER BY counter LIMIT 4",
  ).bind(uid, now, counter).all<{ cmd: string }>();
  return json({ commands: results.map((r) => r.cmd) });
}

const NOCLOCK = 0x20; // reading flag: t is seconds since the Light's boot, not Unix time
const AWAKE = 0x01;
const MAX_READINGS = 200;
/** The Light's staging area (Oceanlive-nova fw/nrf/pm_static_light.yml): bigger images can't be offered. */
const LIGHT_STAGING = 0x58000;

/** A Light's readings as telemetry rows [ms, mV, awake]; ack = the last record number sent. */
export function lightReadings(b: Record<string, unknown>, now: number): { rows: [number, number, number][]; ack?: number } | "bad" {
  if (b.r === undefined) return { rows: [] };
  const r = b.r, rn = b.rn;
  if (!Array.isArray(r) || r.length > MAX_READINGS || !Array.isArray(rn) || rn.length !== 2) return "bad";
  const [first, last] = rn.map(Number);
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first || last > 0xffffffff) return "bad";
  const rows: [number, number, number][] = [];
  for (const x of r) {
    if (!Array.isArray(x) || x.length !== 3 || !x.every((v) => Number.isInteger(v) && v >= 0)) return "bad";
    const [t, mv, fl] = x as number[];
    // readings from before the Light knew the time can't be placed; ones from the future are wrong
    if (fl & NOCLOCK || t < 1_600_000_000 || t * 1000 > now + 300_000 || mv > 65535) continue;
    rows.push([t * 1000, mv, fl & AWAKE ? 1 : 0]);
  }
  return { rows, ack: last };
}

/* ---- box codes (Nova Light) ---- */

const BOX_CODE_LEN = 12; // 60 bits from CODE_CHARS, shown as XXXX-XXXX-XXXX
const MAX_PHONES = 4;
const cleanCode = (c: unknown) => String(c ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function makeBoxCode(env: Env, b: Record<string, unknown>, now: number): Promise<Response> {
  if (!uidOk(b.uid)) return json({ error: "The device ID is 24 hex digits (nova id on the board)." }, 400);
  const r = crypto.getRandomValues(new Uint8Array(BOX_CODE_LEN));
  const c = [...r].map((x) => CODE_CHARS[x & 31]).join("");
  await env.DB.prepare(
    `INSERT INTO box_codes (uid, code_hash, created_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(uid) DO UPDATE SET code_hash = ?2, created_at = ?3`,
  ).bind(b.uid, await sha256(`box-code:${c}`), now).run();
  return json({ uid: b.uid, code: `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}` });
}

export async function claim(env: Env, b: Record<string, unknown>, now: number): Promise<Response> {
  const c = cleanCode(b.code);
  const pub = unhex(b.phonePub);
  if (c.length !== BOX_CODE_LEN || !/^[A-Z2-9]+$/.test(c)) return json({ error: "That code isn't right. It's the 12-letter code inside the box." }, 404);
  if (!pub || pub.length !== 32) return json({ error: "phonePub" }, 400);
  const row = await env.DB.prepare("SELECT uid FROM box_codes WHERE code_hash = ?1").bind(await sha256(`box-code:${c}`))
    .first<{ uid: string }>();
  if (!row) return json({ error: "That code isn't right. It's the 12-letter code inside the box." }, 404);
  const { results } = await env.DB.prepare("SELECT slot, pub FROM phones WHERE uid = ?1").bind(row.uid).all<{ slot: number; pub: string }>();
  const mine = results.find((p) => p.pub === hex(pub));
  if (mine) return json({ uid: row.uid, slot: mine.slot }); // this phone again: the same answer
  let slot = 0;
  while (slot < MAX_PHONES && results.some((p) => p.slot === slot)) slot++;
  if (slot >= MAX_PHONES) return json({ error: "Four phones are paired with this Nova already." }, 409);
  await env.DB.prepare("INSERT INTO phones (uid, slot, pub, name, paired_at) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(row.uid, slot, hex(pub), String(b.phoneName ?? "Phone").slice(0, 40), now).run();
  return json({ uid: row.uid, slot });
}

/* ---- pairing ---- */

export async function pairStart(env: Env, b: Record<string, unknown>, now: number): Promise<Response> {
  if (!uidOk(b.uid)) return json({ error: "uid" }, 400);
  const c = code();
  const secret = randomToken();
  await env.DB.prepare("INSERT INTO pairings (code, uid, created_at, expires_at, secret_hash) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(c, b.uid, now, now + PAIR_MS, await sha256(secret)).run();
  return json({ code: c, secret, expiresIn: PAIR_MS / 1000 });
}

/** Whether the caller is the car screen that started this pairing. */
async function fromCarScreen(p: { secret_hash: string | null }, secret: unknown): Promise<boolean> {
  return typeof secret === "string" && secret.length > 0 && p.secret_hash !== null && (await sha256(secret)) === p.secret_hash;
}

async function pairing(env: Env, c: unknown, now: number) {
  if (typeof c !== "string" || !/^[A-Z2-9]{8}$/.test(c)) return null;
  return env.DB.prepare("SELECT * FROM pairings WHERE code = ?1 AND expires_at > ?2").bind(c, now)
    .first<{ code: string; uid: string; status: string; phone_pub: string | null; phone_name: string | null; slot: number | null; secret_hash: string | null }>();
}

export async function pairRequest(env: Env, b: Record<string, unknown>, now: number): Promise<Response> {
  const p = await pairing(env, String(b.code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""), now);
  if (!p) return json({ error: "That code isn't valid or has expired. Start again on the car screen." }, 404);
  const pub = unhex(b.phonePub);
  if (!pub || pub.length !== 32) return json({ error: "phonePub" }, 400);
  // the same phone asking again (it lost track, or was reinstalled mid-pairing) just gets the answer again
  if (p.status !== "waiting") {
    if (p.phone_pub === hex(pub)) return json({ ok: true, uid: p.uid });
    return json({ error: "That code has been used. Start again on the car screen." }, 404);
  }
  const name = String(b.phoneName ?? "Phone").slice(0, 40);
  await env.DB.prepare("UPDATE pairings SET status = 'requested', phone_pub = ?2, phone_name = ?3 WHERE code = ?1")
    .bind(p.code, hex(pub), name).run();
  return json({ ok: true, uid: p.uid });
}

/** The car screen: who is asking to pair (needs the secret from pair/start). */
export async function pairPoll(env: Env, c: string, secret: string, now: number): Promise<Response> {
  const p = await pairing(env, c, now);
  if (!p) return json({ error: "expired" }, 404);
  if (!(await fromCarScreen(p, secret))) return json({ error: "Not the car screen that started this pairing." }, 403);
  return json({ status: p.status, phoneName: p.phone_name, phonePub: p.phone_pub, slot: p.slot, uid: p.uid });
}

/** The phone: whether the car approved it. Says nothing about the phone. */
export async function pairStatus(env: Env, c: string, now: number): Promise<Response> {
  const p = await pairing(env, c, now);
  if (!p) return json({ error: "That code has expired. Start again on the car screen." }, 404);
  return json(p.status === "paired" ? { status: p.status, slot: p.slot, uid: p.uid } : { status: p.status });
}

export async function pairFinish(env: Env, b: Record<string, unknown>, now: number): Promise<Response> {
  const p = await pairing(env, b.code, now);
  if (!p || p.status !== "requested" || !p.phone_pub) return json({ error: "Nothing to finish." }, 404);
  if (!(await fromCarScreen(p, b.secret))) return json({ error: "Not the car screen that started this pairing." }, 403);
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
    `SELECT b.uid, b.kind, b.last_seen, b.fw, b.v12, b.rsrp, b.phones, b.ignition, b.state, b.budget_kb, b.alerts,
       b.last_cmd_action, b.last_cmd_result,
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
