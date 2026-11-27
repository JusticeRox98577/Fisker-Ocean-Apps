/**
 * Developer access to Nova boxes (Oceanlive-nova docs/updates.md).
 *
 * Boxes whose bootloader holds a developer certificate check in here through the Nova app:
 *   POST /api/dev/checkin { hello: hex (the bootloader's 35-byte HELLO), app, android, uptimeS, power, onScreen }
 *     -> { tokens: [hex] }   lease renewals while the certificate is active, a revocation once it isn't
 * The owner sees and controls them in /admin:
 *   GET  /api/admin/dev               certificates with their usage
 *   GET  /api/admin/dev/checkins ?serial=N
 *   POST /api/admin/dev/register { cert: hex }   a certificate made with novaboot.py cert
 *   POST /api/admin/dev/revoke { serial, reason }
 *
 * Tokens are signed with LEASE_KEY (a secret): EdDSA with BLAKE2b, the same as the bootloader's
 * Monocypher. The lease key can only renew or revoke; firmware and certificates need the owner key,
 * which never comes here.
 */
import { twistedEdwards } from "@noble/curves/abstract/edwards";
import { ed25519 } from "@noble/curves/ed25519";
import { blake2b } from "@noble/hashes/blake2b";
import type { Env } from "./env";
import { json } from "./util";

const eddsa = twistedEdwards({ ...ed25519.CURVE, hash: (m: Uint8Array | string) => blake2b(m, { dkLen: 64 }) });

const CERT_MAGIC = 0x4344564e;
const TOKEN_MAGIC = 0x544c564e;
export const TOKEN_RENEW = 1;
export const TOKEN_REVOKE = 2;

export const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
export function unhex(s: unknown): Uint8Array | null {
  const t = String(s ?? "").trim().toLowerCase();
  if (!/^([0-9a-f]{2})*$/.test(t)) return null;
  return Uint8Array.from(t.match(/../g) ?? [], (x) => parseInt(x, 16));
}
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
function put32(b: Uint8Array, o: number, v: number) {
  b[o] = v & 255; b[o + 1] = (v >>> 8) & 255; b[o + 2] = (v >>> 16) & 255; b[o + 3] = (v >>> 24) & 255;
}

export interface Cert {
  serial: number; uid: string; holder: string; devPub: string; targets: number; lease: number;
}

/** A 160-byte certificate, checked against the owner's public key. */
export function parseCert(raw: Uint8Array, ownerPub: Uint8Array): Cert | string {
  if (raw.length !== 160 || u32(raw, 0) !== CERT_MAGIC || raw[4] !== 1) return "That isn't a Nova developer certificate.";
  if (!eddsa.verify(raw.slice(96), raw.slice(0, 96), ownerPub)) return "The certificate isn't signed by the owner key.";
  const holderBytes = raw.slice(56, 96);
  const end = holderBytes.indexOf(0);
  return {
    serial: u32(raw, 8),
    uid: hex(raw.slice(12, 24)),
    devPub: hex(raw.slice(24, 56)),
    holder: new TextDecoder().decode(end >= 0 ? holderBytes.slice(0, end) : holderBytes),
    targets: raw[5],
    lease: raw[6] | (raw[7] << 8),
  };
}

export function makeToken(seed: Uint8Array, kind: number, serial: number, uid: Uint8Array, until: number, issued: number): Uint8Array {
  const body = new Uint8Array(32);
  put32(body, 0, TOKEN_MAGIC);
  body[4] = 1;
  body[5] = kind;
  put32(body, 8, serial);
  body.set(uid, 12);
  put32(body, 24, until);
  put32(body, 28, issued);
  const out = new Uint8Array(96);
  out.set(body);
  out.set(eddsa.sign(body, seed), 32);
  return out;
}

export interface Hello {
  uid: string; valid: boolean; serial: number; fwVersion: number; signer: number;
  devStarts: number; leaseUntil: number; certLease: number; startCheck: number;
}

/** The bootloader's HELLO (fw/lib/novaboot nb_hello). */
export function parseHello(b: Uint8Array): Hello | null {
  if (b.length < 35 || b[0] !== 1) return null;
  return {
    uid: hex(b.slice(2, 14)), valid: b[14] === 1, serial: u32(b, 15), fwVersion: u32(b, 19), signer: b[23],
    devStarts: u32(b, 24), leaseUntil: u32(b, 28), certLease: b[32] | (b[33] << 8), startCheck: b[34],
  };
}

function leaseSeed(env: Env): Uint8Array | null {
  const k = unhex(env.LEASE_KEY);
  return k && (k.length === 64 || k.length === 32) ? k.slice(0, 32) : null;
}

interface CertRow {
  serial: number; uid: string; holder: string; dev_pub: string; targets: number; lease: number; status: string;
  notes: string; registered_at: number; revoked_at: number | null; revoke_reason: string;
}

/** POST /api/dev/checkin */
export async function checkin(env: Env, body: Record<string, unknown>, now: number): Promise<Response> {
  const raw = unhex(body.hello);
  const h = raw ? parseHello(raw) : null;
  if (!h) return json({ error: "Send the bootloader HELLO as hex." }, 400);
  const str = (v: unknown, n: number) => String(v ?? "").slice(0, n);
  const int = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0);

  const tokens: Uint8Array[] = [];
  let sent = "";
  const seed = leaseSeed(env);
  const uid = raw!.slice(2, 14);
  const issued = Math.floor(now / 1000);

  // revocations for this box: any revoked certificate issued for it, whatever it reports now
  const { results: revoked } = await env.DB.prepare("SELECT serial FROM dev_certs WHERE uid = ?1 AND status = 'revoked'")
    .bind(h.uid).all<{ serial: number }>();
  if (seed) for (const r of revoked) tokens.push(makeToken(seed, TOKEN_REVOKE, r.serial, uid, 0, issued));
  if (revoked.length) sent = "revoke";

  if (h.serial && seed) {
    const cert = await env.DB.prepare("SELECT * FROM dev_certs WHERE serial = ?1").bind(h.serial).first<CertRow>();
    if (cert && cert.status === "active" && cert.uid === h.uid && cert.lease > 0) {
      // renew when half the lease is used (or it ran out)
      const left = h.leaseUntil > h.devStarts ? h.leaseUntil - h.devStarts : 0;
      if (left * 2 <= cert.lease) {
        tokens.push(makeToken(seed, TOKEN_RENEW, cert.serial, uid, h.devStarts + cert.lease, issued));
        sent = sent ? `${sent}+renew` : "renew";
      }
    }
  }

  await env.DB.prepare(
    `INSERT INTO dev_checkins (serial, uid, at, signer, fw_version, dev_starts, lease_until, start_check,
       app_version, android, uptime_s, power_state, nova_on_screen, token)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
  ).bind(h.serial, h.uid, now, h.signer, h.fwVersion, h.devStarts, h.leaseUntil, h.startCheck,
    str(body.app, 40), str(body.android, 40), int(body.uptimeS), int(body.power), body.onScreen ? 1 : 0, sent).run();

  return json({ tokens: tokens.map(hex) });
}

/** GET /api/admin/dev: every certificate with a usage summary. */
export async function listCerts(env: Env, now: number): Promise<Response> {
  const DAY = 86400000;
  const { results } = await env.DB.prepare(
    `SELECT c.*,
       (SELECT MAX(at) FROM dev_checkins k WHERE k.serial = c.serial) AS last_seen,
       (SELECT COUNT(*) FROM dev_checkins k WHERE k.serial = c.serial AND k.at > ?1) AS checkins_30d,
       (SELECT COUNT(*) FROM dev_checkins k WHERE k.serial = c.serial) AS checkins,
       (SELECT dev_starts FROM dev_checkins k WHERE k.serial = c.serial ORDER BY at DESC LIMIT 1) AS dev_starts,
       (SELECT lease_until FROM dev_checkins k WHERE k.serial = c.serial ORDER BY at DESC LIMIT 1) AS lease_until,
       (SELECT fw_version FROM dev_checkins k WHERE k.serial = c.serial ORDER BY at DESC LIMIT 1) AS fw_version,
       (SELECT signer FROM dev_checkins k WHERE k.serial = c.serial ORDER BY at DESC LIMIT 1) AS signer,
       (SELECT app_version FROM dev_checkins k WHERE k.serial = c.serial ORDER BY at DESC LIMIT 1) AS app_version,
       (SELECT COUNT(DISTINCT fw_version) FROM dev_checkins k WHERE k.serial = c.serial AND k.signer = 1) AS dev_builds
     FROM dev_certs c ORDER BY c.registered_at DESC`,
  ).bind(now - 30 * DAY).all();
  return json({ certs: results, ownerKeySet: !!unhex(env.OWNER_PUB)?.length, leaseKeySet: !!leaseSeed(env) });
}

export async function checkins(env: Env, serial: number): Promise<Response> {
  const { results } = await env.DB.prepare("SELECT * FROM dev_checkins WHERE serial = ?1 ORDER BY at DESC LIMIT 200")
    .bind(serial).all();
  return json({ checkins: results });
}

export async function register(env: Env, body: Record<string, unknown>, now: number): Promise<Response> {
  const owner = unhex(env.OWNER_PUB);
  if (!owner || owner.length !== 32) return json({ error: "OWNER_PUB isn't set: add the owner public key to wrangler.jsonc." }, 500);
  const raw = unhex(body.cert);
  if (!raw) return json({ error: "Paste the certificate as hex (novaboot.py cert prints it)." }, 400);
  const c = parseCert(raw, owner);
  if (typeof c === "string") return json({ error: c }, 400);
  const existing = await env.DB.prepare("SELECT status FROM dev_certs WHERE serial = ?1").bind(c.serial).first<{ status: string }>();
  if (existing) return json({ error: `Certificate ${c.serial} is already registered (${existing.status}). Serials can't be reused.` }, 409);
  await env.DB.prepare(
    `INSERT INTO dev_certs (serial, uid, holder, dev_pub, targets, lease, cert, notes, registered_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  ).bind(c.serial, c.uid, c.holder, c.devPub, c.targets, c.lease, hex(raw), String(body.notes ?? "").slice(0, 500), now).run();
  return json({ ok: true, cert: c });
}

export async function revoke(env: Env, body: Record<string, unknown>, now: number): Promise<Response> {
  const serial = Number(body.serial);
  if (!Number.isInteger(serial) || serial <= 0) return json({ error: "Which certificate?" }, 400);
  const r = await env.DB.prepare(
    "UPDATE dev_certs SET status = 'revoked', revoked_at = ?2, revoke_reason = ?3 WHERE serial = ?1 AND status = 'active'",
  ).bind(serial, now, String(body.reason ?? "").slice(0, 300)).run();
  if (!r.meta.changes) return json({ error: "No active certificate with that serial." }, 404);
  return json({ ok: true });
}
