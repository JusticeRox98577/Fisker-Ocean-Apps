/**
 * Tests only: a throwaway certificate authority shaped like Apple's (root -> WWDR-like intermediate -> leaf,
 * with Apple's marker extensions) and a signer for AppTransaction-style JWS. Nothing here is trusted in
 * production: the Worker only uses it when a test passes its root as APPLE_TEST_ROOT.
 */

const te = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function tlv(tag: number, ...parts: Uint8Array[]): Uint8Array {
  const body = concat(...parts);
  const n = body.length;
  const len = n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : n < 0x10000 ? [0x82, n >> 8, n & 0xff] : [0x83, n >> 16, (n >> 8) & 0xff, n & 0xff];
  return concat(new Uint8Array([tag, ...len]), body);
}

const seq = (...p: Uint8Array[]) => tlv(0x30, ...p);
const set = (...p: Uint8Array[]) => tlv(0x31, ...p);

function int(bytes: Uint8Array | number[]): Uint8Array {
  let v = Uint8Array.from(bytes);
  while (v.length > 1 && v[0] === 0 && !(v[1] & 0x80)) v = v.subarray(1);
  if (v[0] & 0x80) v = concat(new Uint8Array([0]), v);
  return tlv(0x02, v);
}

function oid(s: string): Uint8Array {
  const n = s.split(".").map(Number);
  const out = [n[0] * 40 + n[1]];
  for (const v of n.slice(2)) {
    const b = [v & 0x7f];
    for (let x = Math.floor(v / 128); x > 0; x = Math.floor(x / 128)) b.unshift((x & 0x7f) | 0x80);
    out.push(...b);
  }
  return tlv(0x06, new Uint8Array(out));
}

function time(ms: number): Uint8Array {
  const d = new Date(ms).toISOString().replace(/[-:T]/g, "").slice(0, 14) + "Z";
  const year = new Date(ms).getUTCFullYear();
  return year >= 1950 && year < 2050 ? tlv(0x17, te.encode(d.slice(2))) : tlv(0x18, te.encode(d));
}

const name = (cn: string) => seq(set(seq(oid("2.5.4.3"), tlv(0x0c, te.encode(cn)))));
const ext = (id: string, critical: boolean, value: Uint8Array) =>
  seq(oid(id), ...(critical ? [tlv(0x01, new Uint8Array([0xff]))] : []), tlv(0x04, value));

const ECDSA_SHA256 = "1.2.840.10045.4.3.2";
export const OID_WWDR = "1.2.840.113635.100.6.2.1";
export const OID_LEAF = "1.2.840.113635.100.6.11.1";
const NULL = new Uint8Array([0x05, 0x00]);

export async function newKey(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
}

/** ECDSA raw r||s to DER ECDSA-Sig-Value. */
function rawToDer(raw: Uint8Array): Uint8Array {
  const h = raw.length / 2;
  return seq(int(raw.subarray(0, h)), int(raw.subarray(h)));
}

interface CertSpec {
  subject: string;
  issuer: string;
  key: CryptoKey; // subject public key
  signer: CryptoKey; // issuer private key
  ca?: boolean;
  extraOids?: string[];
  notBefore?: number;
  notAfter?: number;
  serial?: number;
}

export async function makeCert(s: CertSpec): Promise<Uint8Array> {
  const spki = new Uint8Array((await crypto.subtle.exportKey("spki", s.key)) as ArrayBuffer);
  const exts = [
    ...(s.ca ? [ext("2.5.29.19", true, seq(tlv(0x01, new Uint8Array([0xff]))))] : []),
    ...(s.extraOids ?? []).map((o) => ext(o, false, NULL)),
  ];
  const tbs = seq(
    tlv(0xa0, int([2])),
    int([s.serial ?? 1]),
    seq(oid(ECDSA_SHA256)),
    name(s.issuer),
    seq(time(s.notBefore ?? Date.now() - 30 * 86_400_000), time(s.notAfter ?? Date.now() + 365 * 86_400_000)),
    name(s.subject),
    spki,
    ...(exts.length ? [tlv(0xa3, seq(...exts))] : []),
  );
  const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, s.signer, tbs));
  return seq(tbs, seq(oid(ECDSA_SHA256)), tlv(0x03, new Uint8Array([0]), rawToDer(raw)));
}

export interface Chain {
  root: Uint8Array;
  intermediate: Uint8Array;
  leaf: Uint8Array;
  leafKey: CryptoKeyPair;
}

/** A root, a WWDR-like intermediate and a signing leaf. Options break one part for negative tests. */
export async function makeChain(o: { leafOid?: boolean; interOid?: boolean; leafNotAfter?: number; leafNotBefore?: number } = {}): Promise<Chain> {
  const [rootKey, interKey, leafKey] = await Promise.all([newKey(), newKey(), newKey()]);
  const root = await makeCert({ subject: "Test Root", issuer: "Test Root", key: rootKey.publicKey, signer: rootKey.privateKey, ca: true });
  const intermediate = await makeCert({
    subject: "Test WWDR",
    issuer: "Test Root",
    key: interKey.publicKey,
    signer: rootKey.privateKey,
    ca: true,
    extraOids: o.interOid === false ? [] : [OID_WWDR],
    serial: 2,
  });
  const leaf = await makeCert({
    subject: "Test Leaf",
    issuer: "Test WWDR",
    key: leafKey.publicKey,
    signer: interKey.privateKey,
    extraOids: o.leafOid === false ? [] : [OID_LEAF],
    notAfter: o.leafNotAfter,
    notBefore: o.leafNotBefore,
    serial: 3,
  });
  return { root, intermediate, leaf, leafKey };
}

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const b64url = (b: Uint8Array) => b64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Signs `payload` as an ES256 JWS with the chain in x5c, like the App Store does. */
export async function signJws(payload: unknown, chain: Chain, key: CryptoKey = chain.leafKey.privateKey): Promise<string> {
  const header = { alg: "ES256", x5c: [b64(chain.leaf), b64(chain.intermediate), b64(chain.root)] };
  const unsigned = `${b64url(te.encode(JSON.stringify(header)))}.${b64url(te.encode(JSON.stringify(payload)))}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(unsigned)));
  return `${unsigned}.${b64url(sig)}`;
}
