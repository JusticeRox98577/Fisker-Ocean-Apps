/**
 * Nova releases: the files boxes update to (Oceanlive-nova docs/updates.md).
 *
 *   GET  /api/updates?target=supervisor|card|app|android|nrf-light|nrf-nova&have=<version>&channel=stable|beta
 *        -> { update: null } or { update: { id, target, version, label, size, sha256, url, payload? } }
 *   GET  /api/updates/file/<id>         the file, with HTTP Range support (Android's update_engine streams)
 * Admin:
 *   GET  /api/admin/releases
 *   POST /api/admin/releases?target=&version=&label=&channel=&notes=   body: the file (up to 90 MB)
 *   POST /api/admin/releases/register { target: "android", key, version, label, channel, notes }
 *        an Android OTA zip already put in R2 with wrangler (they are too big to upload here)
 *   POST /api/admin/releases/retire { id }
 *
 * Supervisor and card images must be owner-signed .nova files: checked here against OWNER_PUB before they
 * are offered (the boxes check them again). Developer-signed images are refused: developers install their
 * own builds with novaboot.py.
 */
import { twistedEdwards } from "@noble/curves/abstract/edwards";
import { ed25519 } from "@noble/curves/ed25519";
import { blake2b } from "@noble/hashes/blake2b";
import { hex, unhex } from "./dev";
import type { Env } from "./env";
import { json } from "./util";

const eddsa = twistedEdwards({ ...ed25519.CURVE, hash: (m: Uint8Array | string) => blake2b(m, { dkLen: 64 }) });
export const TARGETS = ["supervisor", "card", "app", "android", "nrf-light", "nrf-nova"] as const;
type Target = (typeof TARGETS)[number];
// .nova chip numbers (fw/lib/novaboot enum nb_target). The nRF9151 (SuperNova) has two firmware lines:
// nrf-light and nrf-nova: the Nova firmware's Light build (Nova Light boards) and SuperNova build.
const FW_TARGET: Record<string, number> = { supervisor: 1, card: 2, "nrf-light": 3, "nrf-nova": 3 };
const CHIP: Record<number, string> = { 1: "supervisor", 2: "video card", 3: "nRF9151" };
const MAX_UPLOAD = 90 * 1024 * 1024;

const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
export const fwLabel = (v: number) => `${v >>> 24}.${(v >>> 16) & 0xff}.${v & 0xffff}`;

interface ReleaseRow {
  id: number; target: string; version: number; label: string; channel: string; r2_key: string; size: number;
  sha256: string; payload_offset: number | null; payload_size: number | null; payload_props: string | null;
  notes: string; created_at: number; retired: number;
}

/** A .nova image (fw/lib/novaboot): owner-signed, for the named chip. Returns its version or an error. */
export function checkNova(img: Uint8Array, target: Target, ownerPub: Uint8Array): number | string {
  if (img.length < 0x200 + 8 || u32(img, 0) !== 0x4d49564e || img[4] !== 1) return "That isn't a signed Nova image (.nova).";
  if (img[5] !== FW_TARGET[target]) return `That image is for the ${CHIP[img[5]] ?? "?"}.`;
  if (img[6] !== 0) return "That image is signed with a developer key. Releases must be signed with the owner key.";
  const size = u32(img, 12);
  const area = img[5] === 3 ? 0x200 : 0x100; // header area: 0x200 on the nRF9151 (TF-M alignment)
  if (img.length !== area + size) return "The image size doesn't match its header.";
  const digest = blake2b(new Uint8Array([...img.slice(0, 64), ...img.slice(area)]), { dkLen: 64 });
  if (!eddsa.verify(img.slice(64, 128), digest, ownerPub)) return "The signature doesn't match the owner key.";
  return u32(img, 8);
}

async function sha256(data: ArrayBuffer): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", data)));
}

function update(r: ReleaseRow) {
  return {
    id: r.id, target: r.target, version: r.version, label: r.label, size: r.size, sha256: r.sha256,
    url: `/api/updates/file/${r.id}`,
    ...(r.payload_offset != null
      ? { payload: { offset: r.payload_offset, size: r.payload_size, headers: (r.payload_props ?? "").split("\n").filter(Boolean) } }
      : {}),
  };
}

/** GET /api/updates */
export async function check(env: Env, url: URL): Promise<Response> {
  const target = url.searchParams.get("target") ?? "";
  const have = Number(url.searchParams.get("have") ?? "0");
  const beta = url.searchParams.get("channel") === "beta";
  if (!(TARGETS as readonly string[]).includes(target) || !Number.isFinite(have)) return json({ error: "target and have, please." }, 400);
  const r = await env.DB.prepare(
    `SELECT * FROM releases WHERE target = ?1 AND retired = 0 AND version > ?2 AND (channel = 'stable' OR ?3)
     ORDER BY version DESC LIMIT 1`,
  ).bind(target, have, beta ? 1 : 0).first<ReleaseRow>();
  return json({ update: r ? update(r) : null }, 200, { "Cache-Control": "public, max-age=300" });
}

/** GET /api/updates/file/<id>, with Range. */
export async function file(env: Env, req: Request, id: number): Promise<Response> {
  const r = await env.DB.prepare("SELECT * FROM releases WHERE id = ?1").bind(id).first<ReleaseRow>();
  if (!r || !env.RELEASES) return json({ error: "Not found." }, 404);
  const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.get("Range") ?? "");
  if (m) {
    const start = Number(m[1]);
    const end = m[2] ? Math.min(Number(m[2]), r.size - 1) : r.size - 1;
    if (start > end || start >= r.size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${r.size}` } });
    const obj = await env.RELEASES.get(r.r2_key, { range: { offset: start, length: end - start + 1 } });
    if (!obj) return json({ error: "Not found." }, 404);
    return new Response(obj.body, {
      status: 206,
      headers: { "Content-Range": `bytes ${start}-${end}/${r.size}`, "Content-Length": String(end - start + 1),
        "Accept-Ranges": "bytes", "Content-Type": "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable" },
    });
  }
  const obj = await env.RELEASES.get(r.r2_key);
  if (!obj) return json({ error: "Not found." }, 404);
  return new Response(obj.body, {
    headers: { "Content-Length": String(r.size), "Accept-Ranges": "bytes", "Content-Type": "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable" },
  });
}

export async function list(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT id, target, version, label, channel, size, sha256, notes, created_at, retired, payload_offset FROM releases ORDER BY created_at DESC LIMIT 200",
  ).all();
  return json({ releases: results, storage: !!env.RELEASES });
}

function meta(get: (k: string) => unknown) {
  const channel = get("channel") === "beta" ? "beta" : "stable";
  return { channel, label: String(get("label") ?? "").slice(0, 40), notes: String(get("notes") ?? "").slice(0, 1000) };
}

/** POST /api/admin/releases?target=...  body: the file */
export async function upload(env: Env, req: Request, now: number): Promise<Response> {
  if (!env.RELEASES) return json({ error: "The RELEASES bucket isn't set up." }, 500);
  const url = new URL(req.url);
  const target = url.searchParams.get("target") as Target;
  if (!["supervisor", "card", "app", "nrf-light", "nrf-nova"].includes(target)) {
    return json({ error: "Upload firmware or app files here; Android OTAs go through R2 (register)." }, 400);
  }
  const len = Number(req.headers.get("Content-Length") ?? "0");
  if (len > MAX_UPLOAD) return json({ error: "Too big to upload here." }, 413);
  const data = await req.arrayBuffer();
  if (data.byteLength > MAX_UPLOAD || data.byteLength === 0) return json({ error: "Empty or too big." }, 400);
  const bytes = new Uint8Array(data);
  const m = meta((k) => url.searchParams.get(k));
  let version: number;
  if (target === "app") {
    version = Number(url.searchParams.get("version"));
    if (!Number.isInteger(version) || version <= 0) return json({ error: "Give the app's versionCode." }, 400);
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return json({ error: "That isn't an APK." }, 400);
  } else {
    const owner = unhex(env.OWNER_PUB);
    if (!owner || owner.length !== 32) return json({ error: "OWNER_PUB isn't set." }, 500);
    const v = checkNova(bytes, target, owner);
    if (typeof v === "string") return json({ error: v }, 400);
    if (target === "nrf-light" && bytes.length > 0x58000) {
      return json({ error: "Too big for a Nova Light: its staging area holds 352 KB (header, TF-M and firmware)." }, 400);
    }
    version = v;
    m.label = m.label || fwLabel(v);
  }
  const sum = await sha256(data);
  const key = `releases/${target}/${version}-${sum.slice(0, 12)}`;
  await env.RELEASES.put(key, data);
  const r = await env.DB.prepare(
    `INSERT INTO releases (target, version, label, channel, r2_key, size, sha256, notes, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING id`,
  ).bind(target, version, m.label || String(version), m.channel, key, data.byteLength, sum, m.notes, now).first<{ id: number }>();
  return json({ ok: true, id: r?.id, version, label: m.label || String(version) });
}

/** Finds payload.bin and payload_properties.txt in an Android OTA zip in R2, with ranged reads. */
export async function readOtaZip(bucket: R2Bucket, key: string): Promise<{ size: number; offset: number; length: number; props: string } | string> {
  const head = await bucket.head(key);
  if (!head) return "No such object in R2.";
  const size = head.size;
  const tailLen = Math.min(size, 65557);
  const tail = new Uint8Array(await (await bucket.get(key, { range: { offset: size - tailLen, length: tailLen } }))!.arrayBuffer());
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return "That isn't a zip file.";
  let cdSize = u32(tail, eocd + 12);
  let cdOff = u32(tail, eocd + 16);
  if (cdOff === 0xffffffff) {
    // zip64: the locator sits just before the end record
    const loc = eocd - 20;
    if (loc < 0 || u32(tail, loc) !== 0x07064b50) return "A zip64 file without its locator.";
    const recOff = Number(new DataView(tail.buffer).getBigUint64(loc + 8, true));
    const rec = new Uint8Array(await (await bucket.get(key, { range: { offset: recOff, length: 56 } }))!.arrayBuffer());
    const dv = new DataView(rec.buffer);
    cdSize = Number(dv.getBigUint64(40, true));
    cdOff = Number(dv.getBigUint64(48, true));
  }
  const cd = new Uint8Array(await (await bucket.get(key, { range: { offset: cdOff, length: cdSize } }))!.arrayBuffer());
  const entries = new Map<string, { method: number; csize: number; local: number }>();
  for (let p = 0; p + 46 <= cd.length && u32(cd, p) === 0x02014b50;) {
    const nameLen = u16(cd, p + 28), extraLen = u16(cd, p + 30), commentLen = u16(cd, p + 32);
    const name = new TextDecoder().decode(cd.slice(p + 46, p + 46 + nameLen));
    let csize = u32(cd, p + 20), local = u32(cd, p + 42);
    if (csize === 0xffffffff || local === 0xffffffff) {
      // zip64 extra field: uncompressed, compressed, local offset (only those that overflowed)
      const ex = cd.slice(p + 46 + nameLen, p + 46 + nameLen + extraLen);
      for (let q = 0; q + 4 <= ex.length;) {
        const id = u16(ex, q), n = u16(ex, q + 2);
        if (id === 1) {
          const dv = new DataView(ex.buffer, ex.byteOffset + q + 4, n);
          let k = 0;
          if (u32(cd, p + 24) === 0xffffffff) k += 8;
          if (csize === 0xffffffff) { csize = Number(dv.getBigUint64(k, true)); k += 8; }
          if (local === 0xffffffff) local = Number(dv.getBigUint64(k, true));
        }
        q += 4 + n;
      }
    }
    entries.set(name, { method: u16(cd, p + 10), csize, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  const dataAt = async (e: { local: number }) => {
    const lh = new Uint8Array(await (await bucket.get(key, { range: { offset: e.local, length: 30 } }))!.arrayBuffer());
    return e.local + 30 + u16(lh, 26) + u16(lh, 28);
  };
  const payload = entries.get("payload.bin");
  const propsE = entries.get("payload_properties.txt");
  if (!payload || !propsE) return "Not an A/B OTA: payload.bin or payload_properties.txt is missing.";
  if (payload.method !== 0) return "payload.bin must be stored uncompressed (as Android builds it).";
  const pOff = await dataAt(propsE);
  let props = new Uint8Array(await (await bucket.get(key, { range: { offset: pOff, length: propsE.csize } }))!.arrayBuffer());
  if (propsE.method === 8) {
    const s = new Blob([props]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    props = new Uint8Array(await new Response(s).arrayBuffer());
  }
  return { size, offset: await dataAt(payload), length: payload.csize, props: new TextDecoder().decode(props).trim() };
}

/** POST /api/admin/releases/register */
export async function register(env: Env, body: Record<string, unknown>, now: number): Promise<Response> {
  if (!env.RELEASES) return json({ error: "The RELEASES bucket isn't set up." }, 500);
  if (body.target !== "android") return json({ error: "Only Android OTAs are registered from R2." }, 400);
  const key = String(body.key ?? "");
  const version = Number(body.version);
  if (!key || !Number.isInteger(version) || version <= 0) return json({ error: "key and version (the build's ro.build.date.utc), please." }, 400);
  const z = await readOtaZip(env.RELEASES, key);
  if (typeof z === "string") return json({ error: z }, 400);
  const m = meta((k) => body[k]);
  const r = await env.DB.prepare(
    `INSERT INTO releases (target, version, label, channel, r2_key, size, sha256, payload_offset, payload_size, payload_props, notes, created_at)
     VALUES ('android', ?1, ?2, ?3, ?4, ?5, '', ?6, ?7, ?8, ?9, ?10) RETURNING id`,
  ).bind(version, m.label || String(version), m.channel, key, z.size, z.offset, z.length, z.props, m.notes, now).first<{ id: number }>();
  return json({ ok: true, id: r?.id, payload: { offset: z.offset, size: z.length } });
}

export async function retire(env: Env, body: Record<string, unknown>): Promise<Response> {
  const r = await env.DB.prepare("UPDATE releases SET retired = 1 WHERE id = ?1").bind(Number(body.id)).run();
  return r.meta.changes ? json({ ok: true }) : json({ error: "No such release." }, 404);
}
