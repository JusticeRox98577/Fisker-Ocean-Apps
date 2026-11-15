/**
 * Google Play Developer API calls for the pre-registration reward, with a service account.
 *
 * OAuth: a JWT signed with the service account's RSA key (RS256, WebCrypto) is exchanged for an access
 * token at https://oauth2.googleapis.com/token (the JWT bearer flow); the token is kept in KV until
 * shortly before it expires. https://developers.google.com/identity/protocols/oauth2/service-account
 *
 * Purchases: purchases.products.get and purchases.products.acknowledge (v3).
 * https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products
 */

export const PLAY_PACKAGE = "com.justicemw.oceanlive";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";
const TOKEN_KEY = "gplay:token";

export interface PlayEnv {
  ASK_KV: KVNamespace;
  /** The service account's JSON key (secret). */
  GOOGLE_PLAY_SERVICE_ACCOUNT?: string;
  /** Tests only: replaces fetch() for calls to Google. */
  GOOGLE_FETCH?: typeof fetch;
}

/** ProductPurchase (v3), the fields used here. */
export interface ProductPurchase {
  /** 0 purchased, 1 canceled, 2 pending. */
  purchaseState?: number;
  /** 0 not yet acknowledged, 1 acknowledged. */
  acknowledgementState?: number;
  /** 0 not yet consumed, 1 consumed. */
  consumptionState?: number;
  /** Only set when not bought through the normal flow: 0 test, 1 promo, 2 rewarded (ad). */
  purchaseType?: number;
  productId?: string;
  orderId?: string;
}

/** The store couldn't be asked (network, permissions, Google down). Not the purchase's fault. */
export class StoreUnavailable extends Error {}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  private_key_id?: string;
}

export function serviceAccount(env: PlayEnv): ServiceAccount | null {
  try {
    const sa = JSON.parse(env.GOOGLE_PLAY_SERVICE_ACCOUNT ?? "") as Partial<ServiceAccount>;
    if (typeof sa.client_email !== "string" || typeof sa.private_key !== "string") return null;
    return { client_email: sa.client_email, private_key: sa.private_key, private_key_id: typeof sa.private_key_id === "string" ? sa.private_key_id : undefined };
  } catch {
    return null;
  }
}

/** Returns the purchase, or null when Google says there is no such purchase for this product. */
export async function getPurchase(env: PlayEnv, sa: ServiceAccount, productId: string, purchaseToken: string): Promise<ProductPurchase | null> {
  const url = `${API}/${PLAY_PACKAGE}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
  const res = await call(env, sa, url, { method: "GET" });
  // 400: malformed token, 404: unknown, 410: gone (e.g. refunded long ago).
  if (res.status === 400 || res.status === 404 || res.status === 410) return null;
  if (!res.ok) throw new StoreUnavailable(`get ${res.status}`);
  return (await res.json()) as ProductPurchase;
}

export async function acknowledge(env: PlayEnv, sa: ServiceAccount, productId: string, purchaseToken: string): Promise<void> {
  const url = `${API}/${PLAY_PACKAGE}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`;
  const res = await call(env, sa, url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (!res.ok) throw new StoreUnavailable(`acknowledge ${res.status}`);
}

async function call(env: PlayEnv, sa: ServiceAccount, url: string, init: RequestInit): Promise<Response> {
  const f = env.GOOGLE_FETCH ?? fetch;
  let token = await accessToken(env, sa);
  let res: Response;
  try {
    res = await f(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } });
    if (res.status === 401) {
      // The cached token was revoked or expired early: get a new one once.
      token = await accessToken(env, sa, true);
      res = await f(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } });
    }
  } catch (e) {
    if (e instanceof StoreUnavailable) throw e;
    throw new StoreUnavailable("network");
  }
  return res;
}

async function accessToken(env: PlayEnv, sa: ServiceAccount, fresh = false): Promise<string> {
  if (!fresh) {
    const hit = await env.ASK_KV.get<{ token: string; exp: number; sa: string }>(TOKEN_KEY, "json");
    if (hit && hit.sa === sa.client_email && hit.exp > Date.now() + 60_000) return hit.token;
  }
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", ...(sa.private_key_id ? { kid: sa.private_key_id } : {}) };
  const claims = { iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("pkcs8", pemToDer(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  } catch {
    throw new StoreUnavailable("key");
  }
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
  const assertion = `${unsigned}.${b64url(sig)}`;
  let res: Response;
  try {
    res = await (env.GOOGLE_FETCH ?? fetch)(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    });
  } catch {
    throw new StoreUnavailable("network");
  }
  if (!res.ok) throw new StoreUnavailable(`token ${res.status}`);
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new StoreUnavailable("token");
  const life = Math.max(120, Math.min(3600, body.expires_in ?? 3600));
  await env.ASK_KV.put(TOKEN_KEY, JSON.stringify({ token: body.access_token, exp: Date.now() + life * 1000, sa: sa.client_email }), {
    expirationTtl: Math.max(60, life - 60),
  });
  return body.access_token;
}

function pemToDer(pem: string): Uint8Array {
  const b64 = pem
    .replace(/\\n/g, "\n")
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function b64url(v: string | Uint8Array): string {
  const bytes = typeof v === "string" ? new TextEncoder().encode(v) : v;
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
