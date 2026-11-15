/**
 * Verifies a StoreKit 2 AppTransaction JWS (AppTransaction.shared's jwsRepresentation) the way Apple's
 * App Store Server Library does (verifyAndDecodeAppTransaction): ES256 signed by the leaf certificate
 * in `x5c`, chain leaf -> Apple WWDR intermediate -> Apple Root CA - G3 (pinned below), Apple's marker
 * extensions on the intermediate and the leaf, and every certificate valid on the signing date.
 */

import { parseCert, sameBytes, signedBy, ecKey, OID, type Cert } from "./x509";

/**
 * Apple Root CA - G3, from https://www.apple.com/certificateauthority/AppleRootCA-G3.cer.
 * SHA-256 63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79,
 * as Apple publishes it (https://support.apple.com/en-us/126047); checked by a test. Valid until 2039-04-30.
 */
export const APPLE_ROOT_CA_G3 =
  "MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwSQXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcNMTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBSb290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtfTjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySrMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gAMGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM6BgD56KyKA==";

/** On Apple's WWDR intermediate certificates. */
const OID_WWDR_INTERMEDIATE = "1.2.840.113635.100.6.2.1";
/** On the leaf that signs App Store receipts and transactions. */
const OID_RECEIPT_SIGNING = "1.2.840.113635.100.6.11.1";
const SKEW_MS = 60_000;

/** JWSAppTransactionDecodedPayload (only the fields used here). */
export interface AppTransactionPayload {
  receiptType?: string;
  bundleId?: string;
  appAppleId?: number;
  appTransactionId?: string;
  originalPurchaseDate?: number;
  receiptCreationDate?: number;
  preorderDate?: number;
  [k: string]: unknown;
}

/**
 * Returns the verified payload, or null for anything that isn't a well-formed JWS signed by Apple.
 * `root` is the trusted root's DER; production always uses Apple Root CA - G3.
 */
export async function verifyAppTransaction(jws: string, root: Uint8Array = base64(APPLE_ROOT_CA_G3), now = Date.now()): Promise<AppTransactionPayload | null> {
  try {
    const parts = jws.split(".");
    if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return null;
    const header = JSON.parse(new TextDecoder().decode(unbase64url(parts[0]))) as { alg?: unknown; x5c?: unknown };
    if (header.alg !== "ES256") return null;
    const x5c = header.x5c;
    if (!Array.isArray(x5c) || x5c.length !== 3 || !x5c.every((c) => typeof c === "string")) return null;
    const ders = x5c.map((c: string) => base64(c));
    // The chain must end in the pinned root, byte for byte.
    if (!sameBytes(ders[2], root)) return null;
    const [leaf, intermediate, top] = ders.map(parseCert) as [Cert, Cert, Cert];

    if (!intermediate.isCA || !intermediate.extensions.has(OID_WWDR_INTERMEDIATE)) return null;
    if (!leaf.extensions.has(OID_RECEIPT_SIGNING)) return null;
    if (!sameBytes(leaf.issuer, intermediate.subject) || !sameBytes(intermediate.issuer, top.subject)) return null;
    if (!(await signedBy(intermediate, top)) || !(await signedBy(leaf, intermediate))) return null;

    // ES256 needs a P-256 leaf key; the JWS signature is raw r||s, which WebCrypto takes as is.
    if (leaf.curve !== OID.p256) return null;
    const sig = unbase64url(parts[2]);
    if (sig.length !== 64) return null;
    const key = await ecKey(leaf);
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sig, new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;

    const payload = JSON.parse(new TextDecoder().decode(unbase64url(parts[1]))) as AppTransactionPayload;
    if (!payload || typeof payload !== "object") return null;

    // Like Apple's library without online checks: the certificates must be valid when the App Store signed
    // it (receiptCreationDate). A device can keep its AppTransaction for a long time, so "now" would refuse
    // genuine older ones. A signing date in the future is refused.
    const signed = typeof payload.receiptCreationDate === "number" ? payload.receiptCreationDate : now;
    if (signed > now + SKEW_MS) return null;
    for (const c of [leaf, intermediate, top]) {
      if (signed < c.notBefore - SKEW_MS || signed > c.notAfter + SKEW_MS) return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function base64(s: string): Uint8Array {
  const b = atob(s);
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

function unbase64url(s: string): Uint8Array {
  return base64(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
}
