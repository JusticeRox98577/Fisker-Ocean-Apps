/**
 * Just enough DER / X.509 to check an ECDSA certificate chain with WebCrypto: the signed part,
 * names, validity, public key, extensions and the signature of each certificate.
 */

export interface Cert {
  der: Uint8Array;
  /** The DER of tbsCertificate, the bytes the issuer signed. */
  tbs: Uint8Array;
  sigAlg: string;
  /** DER ECDSA-Sig-Value (SEQUENCE { r, s }). */
  signature: Uint8Array;
  issuer: Uint8Array;
  subject: Uint8Array;
  notBefore: number;
  notAfter: number;
  /** DER SubjectPublicKeyInfo. */
  spki: Uint8Array;
  /** The EC curve OID of the public key, or "" for other key types. */
  curve: string;
  extensions: Map<string, { critical: boolean; value: Uint8Array }>;
  isCA: boolean;
}

export const OID = {
  ecdsaSha256: "1.2.840.10045.4.3.2",
  ecdsaSha384: "1.2.840.10045.4.3.3",
  ecPublicKey: "1.2.840.10045.2.1",
  p256: "1.2.840.10045.3.1.7",
  p384: "1.3.132.0.34",
  basicConstraints: "2.5.29.19",
};

const CURVES: Record<string, { name: string; size: number }> = {
  [OID.p256]: { name: "P-256", size: 32 },
  [OID.p384]: { name: "P-384", size: 48 },
};
const HASHES: Record<string, string> = { [OID.ecdsaSha256]: "SHA-256", [OID.ecdsaSha384]: "SHA-384" };

interface Node {
  tag: number;
  /** Start of the whole TLV. */
  start: number;
  /** Start of the value. */
  body: number;
  end: number;
}

function read(b: Uint8Array, at: number, limit = b.length): Node {
  if (at + 2 > limit) throw new Error("der");
  const tag = b[at];
  if ((tag & 0x1f) === 0x1f) throw new Error("der"); // multi-byte tags never appear here
  let len = b[at + 1];
  let body = at + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4 || body + n > limit) throw new Error("der");
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + b[body + i];
    body += n;
  }
  const end = body + len;
  if (end > limit) throw new Error("der");
  return { tag, start: at, body, end };
}

function children(b: Uint8Array, n: Node): Node[] {
  const out: Node[] = [];
  for (let at = n.body; at < n.end; ) {
    const c = read(b, at, n.end);
    out.push(c);
    at = c.end;
  }
  return out;
}

function expect(n: Node | undefined, tag: number): Node {
  if (!n || n.tag !== tag) throw new Error("der");
  return n;
}

export function oidString(b: Uint8Array): string {
  if (b.length === 0) throw new Error("der");
  const parts = [Math.floor(b[0] / 40), b[0] % 40];
  if (b[0] >= 80) {
    parts[0] = 2;
    parts[1] = b[0] - 80;
  }
  let v = 0;
  for (let i = 1; i < b.length; i++) {
    v = v * 128 + (b[i] & 0x7f);
    if (!(b[i] & 0x80)) {
      parts.push(v);
      v = 0;
    }
  }
  return parts.join(".");
}

function time(b: Uint8Array, n: Node): number {
  const s = new TextDecoder().decode(b.subarray(n.body, n.end));
  let m: RegExpExecArray | null;
  if (n.tag === 0x17 && (m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s))) {
    const yy = +m[1];
    return Date.UTC(yy >= 50 ? 1900 + yy : 2000 + yy, +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  }
  if (n.tag === 0x18 && (m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s))) {
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  }
  throw new Error("der");
}

export function parseCert(der: Uint8Array): Cert {
  const top = expect(read(der, 0), 0x30);
  if (top.end !== der.length) throw new Error("der");
  const [tbsN, algN, sigN] = children(der, top);
  expect(tbsN, 0x30);
  const sigAlg = oidString(slice(der, expect(children(der, expect(algN, 0x30))[0], 0x06)));
  expect(sigN, 0x03);
  if (der[sigN.body] !== 0) throw new Error("der");
  const signature = der.slice(sigN.body + 1, sigN.end);

  const f = children(der, tbsN);
  let i = 0;
  if (f[i]?.tag === 0xa0) i++; // version
  expect(f[i++], 0x02); // serial
  const innerAlg = oidString(slice(der, expect(children(der, expect(f[i++], 0x30))[0], 0x06)));
  if (innerAlg !== sigAlg) throw new Error("der");
  const issuer = whole(der, expect(f[i++], 0x30));
  const validity = children(der, expect(f[i++], 0x30));
  const notBefore = time(der, validity[0]);
  const notAfter = time(der, validity[1]);
  const subject = whole(der, expect(f[i++], 0x30));
  const spkiN = expect(f[i++], 0x30);
  const spki = whole(der, spkiN);
  const keyAlg = children(der, expect(children(der, spkiN)[0], 0x30));
  const curve =
    keyAlg[0] && oidString(slice(der, expect(keyAlg[0], 0x06))) === OID.ecPublicKey && keyAlg[1]?.tag === 0x06
      ? oidString(slice(der, keyAlg[1]))
      : "";

  const extensions = new Map<string, { critical: boolean; value: Uint8Array }>();
  for (; i < f.length; i++) {
    if (f[i].tag !== 0xa3) continue;
    for (const ext of children(der, expect(children(der, f[i])[0], 0x30))) {
      const parts = children(der, expect(ext, 0x30));
      const oid = oidString(slice(der, expect(parts[0], 0x06)));
      let critical = false;
      let k = 1;
      if (parts[k]?.tag === 0x01) critical = der[parts[k++].body] !== 0;
      const value = slice(der, expect(parts[k], 0x04));
      if (extensions.has(oid)) throw new Error("der");
      extensions.set(oid, { critical, value });
    }
  }

  let isCA = false;
  const bc = extensions.get(OID.basicConstraints);
  if (bc) {
    const seq = expect(read(bc.value, 0), 0x30);
    const first = children(bc.value, seq)[0];
    isCA = first?.tag === 0x01 && bc.value[first.body] !== 0;
  }

  return { der, tbs: whole(der, tbsN), sigAlg, signature, issuer, subject, notBefore, notAfter, spki, curve, extensions, isCA };
}

function slice(b: Uint8Array, n: Node): Uint8Array {
  return b.slice(n.body, n.end);
}

function whole(b: Uint8Array, n: Node): Uint8Array {
  return b.slice(n.start, n.end);
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Imports an EC public key for ECDSA verification. */
export async function ecKey(cert: Cert): Promise<CryptoKey> {
  const curve = CURVES[cert.curve];
  if (!curve) throw new Error("curve");
  return crypto.subtle.importKey("spki", cert.spki, { name: "ECDSA", namedCurve: curve.name }, false, ["verify"]);
}

/** Is `child` signed by `parent`'s key? (ECDSA with SHA-256 or SHA-384 only.) */
export async function signedBy(child: Cert, parent: Cert): Promise<boolean> {
  const hash = HASHES[child.sigAlg];
  const curve = CURVES[parent.curve];
  if (!hash || !curve) return false;
  let raw: Uint8Array;
  try {
    raw = derSigToRaw(child.signature, curve.size);
  } catch {
    return false;
  }
  const key = await ecKey(parent);
  return crypto.subtle.verify({ name: "ECDSA", hash }, key, raw, child.tbs);
}

/** ECDSA-Sig-Value (DER) to the fixed-size r||s WebCrypto expects. */
export function derSigToRaw(sig: Uint8Array, size: number): Uint8Array {
  const seq = expect(read(sig, 0), 0x30);
  if (seq.end !== sig.length) throw new Error("der");
  const [r, s] = children(sig, seq);
  const out = new Uint8Array(size * 2);
  for (const [n, off] of [[expect(r, 0x02), 0], [expect(s, 0x02), size]] as const) {
    let v = sig.subarray(n.body, n.end);
    while (v.length > 1 && v[0] === 0) v = v.subarray(1);
    if (v.length > size) throw new Error("der");
    out.set(v, off + size - v.length);
  }
  return out;
}
