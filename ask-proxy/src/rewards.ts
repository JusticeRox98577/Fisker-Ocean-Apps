/**
 * Store rewards: US$5 of balance and the Early supporter badge for Google Play pre-registration and
 * App Store pre-orders. One reward per store purchase and one per Ocean Live account.
 *
 * POST /rewards/play  { productId, purchaseToken }   (Android, bearer session)
 * POST /rewards/apple { appTransaction }             (iPhone, bearer session; the AppTransaction JWS)
 *
 * Answers { ok: true, balanceCents, badges, alreadyClaimed? } or { error }.
 */

import { verifyAppTransaction } from "./apple";
import { isReviewAccount, sessionAccount, sha256Hex, type AuthEnv } from "./auth";
import { badgesOf, balanceOf, creditReward } from "./balance";
import { acknowledge, getPurchase, serviceAccount, StoreUnavailable, type PlayEnv } from "./play";

export interface RewardsEnv extends AuthEnv, PlayEnv {
  /** The Play reward product (a one-time product). Default prereg_credit_5. */
  PLAY_REWARD_PRODUCT?: string;
  /** "true": also accept Play test purchases (license testers). For testing only. */
  PLAY_ALLOW_TEST?: string;
  /** Last day rewards can be claimed (ISO date or date-time, UTC). Empty: open. */
  REWARD_CLAIM_UNTIL?: string;
  /** "true": also accept App Store Sandbox AppTransactions. For testing only. */
  APPLE_ALLOW_SANDBOX?: string;
  /** The app's Apple ID (numeric, from App Store Connect). When set, Production AppTransactions must match it. */
  APPLE_APP_ID?: string;
  /** Tests only: the DER of a test root certificate that replaces Apple Root CA - G3. Can't be set from wrangler.toml. */
  APPLE_TEST_ROOT?: Uint8Array;
}

export const APPLE_BUNDLE_ID = "com.justice.OceanABRP";

export async function handleRewards(request: Request, env: RewardsEnv, path: string): Promise<Response | null> {
  if (path !== "/rewards/play" && path !== "/rewards/apple") return null;
  if (request.method !== "POST") return json({ error: "method" }, 405);
  if (!env.LOG_DB) return json({ error: "not_configured" }, 503);
  const db = env.LOG_DB;
  const account = await sessionAccount(request, env);
  if (!account) return json({ error: "signin_required" }, 401);
  // The store reviewers' account (REVIEW_EMAIL) never gets a reward or a balance.
  if (await isReviewAccount(db, env, account)) return json({ error: "review_account" }, 403);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
    if (!body || typeof body !== "object") throw new Error();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  let ref: string;
  let note: string;
  let verify: () => Promise<Response | null>;

  if (path === "/rewards/play") {
    const product = env.PLAY_REWARD_PRODUCT?.trim() || "prereg_credit_5";
    const { productId, purchaseToken } = body;
    if (typeof productId !== "string" || typeof purchaseToken !== "string" || !/^[\w.:-]{10,2048}$/.test(purchaseToken)) {
      return json({ error: "bad_request" }, 400);
    }
    if (productId !== product) return json({ error: "invalid_purchase" }, 400);
    ref = `play:${await sha256Hex(purchaseToken)}`;
    note = `Google Play ${product}`;
    verify = async () => {
      const sa = serviceAccount(env);
      if (!sa) return json({ error: "not_configured" }, 503);
      const p = await getPurchase(env, sa, productId, purchaseToken);
      if (!p || !playRewardOk(p, productId, env.PLAY_ALLOW_TEST === "true")) return json({ error: "invalid_purchase" }, 400);
      // Unacknowledged purchases are refunded by Google after 3 days. The app acknowledges too; this covers it.
      if (p.acknowledgementState !== 1) await acknowledge(env, sa, productId, purchaseToken);
      return null;
    };
  } else {
    const jws = body.appTransaction;
    if (typeof jws !== "string" || jws.length > 20_000) return json({ error: "bad_request" }, 400);
    const root = env.APPLE_TEST_ROOT instanceof Uint8Array ? env.APPLE_TEST_ROOT : undefined;
    const payload = await verifyAppTransaction(jws, root);
    if (!payload) return json({ error: "invalid_purchase" }, 400);
    const envs = env.APPLE_ALLOW_SANDBOX === "true" ? ["Production", "Sandbox"] : ["Production"];
    const appId = env.APPLE_APP_ID?.trim();
    const ok =
      payload.bundleId === APPLE_BUNDLE_ID &&
      typeof payload.receiptType === "string" &&
      envs.includes(payload.receiptType) &&
      (payload.receiptType !== "Production" || !appId || String(payload.appAppleId) === appId) &&
      typeof payload.preorderDate === "number" &&
      payload.preorderDate > 0 &&
      // The per-Apple-Account ID. Without it a reward can't be kept to one per App Store account, so it is refused.
      typeof payload.appTransactionId === "string" &&
      payload.appTransactionId.length > 0;
    if (!ok) return json({ error: "invalid_purchase" }, 400);
    ref = `apple:${await sha256Hex(payload.appTransactionId!)}`;
    note = `App Store pre-order (${payload.receiptType})`;
    verify = async () => null;
  }

  // Asking again for a reward this account already has always answers, even after the claim window.
  const done = async (alreadyClaimed: boolean) =>
    json({ ok: true, balanceCents: await balanceOf(db, account.id), badges: await badgesOf(db, account.id), ...(alreadyClaimed ? { alreadyClaimed: true } : {}) });
  const owner = await db.prepare("SELECT account_id FROM ledger WHERE ref = ?").bind(ref).first<{ account_id: string }>();
  if (owner?.account_id === account.id) return done(true);
  if (owner) return json({ error: "already_claimed_other_account" }, 409);
  // Claimed by an account that has been deleted since: the store purchase stays used.
  if (await db.prepare("SELECT 1 AS x FROM reward_claims WHERE ref = ?").bind(ref).first()) {
    return json({ error: "already_claimed_other_account" }, 409);
  }
  if (claimClosed(env.REWARD_CLAIM_UNTIL)) return json({ error: "claim_closed" }, 410);

  try {
    const bad = await verify();
    if (bad) return bad;
  } catch (e) {
    if (e instanceof StoreUnavailable) return json({ error: "store_unavailable" }, 502);
    throw e;
  }

  const result = await creditReward(db, account.id, ref, note);
  if (result === "other_account") return json({ error: "already_claimed_other_account" }, 409);
  return done(result === "already_claimed");
}

/**
 * Is this Play purchase a valid reward?
 *
 * Pre-registration rewards are delivered like promo-code redemptions; Google doesn't document which
 * purchaseType they carry, so a missing purchaseType (normal purchase) and 1 (promo) are both accepted.
 * The product is only ever granted as the reward (the app never sells it); should someone still buy it,
 * they paid for the credit, so it is credited once like a reward. Rewarded-ad purchases (2) never count,
 * and test purchases (0) only with PLAY_ALLOW_TEST.
 */
export function playRewardOk(p: { purchaseState?: number; purchaseType?: number; productId?: string }, productId: string, allowTest: boolean): boolean {
  if (p.purchaseState !== 0) return false;
  if (p.productId !== undefined && p.productId !== productId) return false;
  if (p.purchaseType === undefined || p.purchaseType === null || p.purchaseType === 1) return true;
  return p.purchaseType === 0 && allowTest;
}

/** REWARD_CLAIM_UNTIL: a date (that whole day UTC counts) or a date-time. Empty or invalid: open. */
export function claimClosed(until: string | undefined, now = Date.now()): boolean {
  const v = until?.trim();
  if (!v) return false;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(v);
  const t = Date.parse(dateOnly ? `${v}T23:59:59.999Z` : v);
  return Number.isFinite(t) && now > t;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
