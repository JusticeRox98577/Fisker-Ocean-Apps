/**
 * Account balance in US cents, with a ledger of every credit and spend, and badges.
 *
 * The balance pays for extra "Any questions?" questions (beyond the free daily ones) and, later,
 * add-ons. Every ledger row has a unique `ref`, so a credit or a charge can never happen twice.
 * Tables: see migrations/0003_balance.sql.
 */

export const REWARD_CENTS = 500;
export const EARLY_SUPPORTER = "early_supporter";

/** The account's balance in cents (0 without a row, or when the tables aren't there yet). */
export async function balanceOf(db: D1Database, accountId: string): Promise<number> {
  try {
    const row = await db.prepare("SELECT cents FROM balances WHERE account_id = ?").bind(accountId).first<{ cents: number }>();
    return row?.cents ?? 0;
  } catch {
    return 0;
  }
}

export async function badgesOf(db: D1Database, accountId: string): Promise<string[]> {
  try {
    const rows = await db.prepare("SELECT badge FROM badges WHERE account_id = ? ORDER BY created, badge").bind(accountId).all<{ badge: string }>();
    return rows.results.map((r) => r.badge);
  } catch {
    return [];
  }
}

export type RewardResult = "credited" | "already_claimed" | "other_account";

/**
 * Credits the store reward (REWARD_CENTS and the Early supporter badge) to an account, once.
 *
 * - The same store purchase (`ref`) again for the same account: already_claimed, nothing changes.
 * - The same store purchase for another account, or for an account since deleted: other_account.
 * - An account that already has a reward and brings another store purchase: already_claimed. The
 *   purchase is recorded against this account (0 cents) so no other account can use it.
 */
export async function creditReward(db: D1Database, accountId: string, ref: string, note: string): Promise<RewardResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const seen = await existingClaim(db, accountId, ref);
    if (seen) return seen;
    const now = new Date().toISOString();
    const hasReward = await db.prepare("SELECT 1 AS x FROM ledger WHERE account_id = ? AND kind = 'reward'").bind(accountId).first();
    try {
      if (hasReward) {
        await db.batch([
          db.prepare("INSERT INTO reward_claims (ref, claimed) VALUES (?, ?)").bind(ref, now),
          db.prepare("INSERT INTO ledger (account_id, delta_cents, kind, ref, note, created) VALUES (?, 0, 'adjust', ?, ?, ?)")
            .bind(accountId, ref, `${note}; account already had its reward`, now),
          db.prepare("INSERT OR IGNORE INTO badges (account_id, badge, created) VALUES (?, ?, ?)").bind(accountId, EARLY_SUPPORTER, now),
        ]);
        return "already_claimed";
      }
      // One batch is one transaction: the claim, the ledger row, the balance and the badge all happen, or none.
      await db.batch([
        db.prepare("INSERT INTO reward_claims (ref, claimed) VALUES (?, ?)").bind(ref, now),
        db.prepare("INSERT INTO ledger (account_id, delta_cents, kind, ref, note, created) VALUES (?, ?, 'reward', ?, ?, ?)")
          .bind(accountId, REWARD_CENTS, ref, note, now),
        db.prepare(
          "INSERT INTO balances (account_id, cents, updated) VALUES (?, ?, ?) " +
            "ON CONFLICT (account_id) DO UPDATE SET cents = cents + excluded.cents, updated = excluded.updated",
        ).bind(accountId, REWARD_CENTS, now),
        db.prepare("INSERT OR IGNORE INTO badges (account_id, badge, created) VALUES (?, ?, ?)").bind(accountId, EARLY_SUPPORTER, now),
      ]);
      return "credited";
    } catch (e) {
      // A parallel claim won the race (unique ref or one reward per account): look again.
      if (attempt === 1) throw e;
    }
  }
  throw new Error("unreachable");
}

async function existingClaim(db: D1Database, accountId: string, ref: string): Promise<RewardResult | null> {
  const row = await db.prepare("SELECT account_id FROM ledger WHERE ref = ?").bind(ref).first<{ account_id: string }>();
  if (row) return row.account_id === accountId ? "already_claimed" : "other_account";
  // Claimed by an account that was deleted since.
  const gone = await db.prepare("SELECT 1 AS x FROM reward_claims WHERE ref = ?").bind(ref).first();
  return gone ? "other_account" : null;
}

/** Cents for an answer that cost `micros` (US dollars x 1,000,000): rounded up to the next cent, at least 1. */
export function centsFor(micros: number): number {
  return Math.max(1, Math.ceil(Math.max(0, micros) / 10_000));
}

/**
 * Paid questions reserve credit before Claude is asked, so parallel requests can't share one balance.
 *
 * holdQuestion takes `hold` cents off the balance and writes a ledger row (kind 'question', note
 * 'hold') in one transaction, only if the balance covers it and the account has had fewer than
 * `dailyLimit` paid questions since `dayStart` (counted from the ledger, so it is atomic too).
 * settleQuestion then charges the real cost and releaseHold gives the hold back when nothing was
 * answered. A hold that is never settled (the Worker stopped mid-question) stays as a charge.
 */
export type HoldResult = "held" | "low_balance" | "paid_limit";

export async function holdQuestion(
  db: D1Database,
  accountId: string,
  hold: number,
  ref: string,
  dayStart: string,
  dailyLimit: number,
): Promise<HoldResult> {
  const cents = Math.max(1, Math.floor(hold));
  const now = new Date().toISOString();
  const [ins] = await db.batch<{ id: number }>([
    db.prepare(
      "INSERT INTO ledger (account_id, delta_cents, kind, ref, note, created) " +
        "SELECT account_id, ?, 'question', ?, 'hold', ? FROM balances WHERE account_id = ? AND cents >= ? " +
        "AND (SELECT COUNT(*) FROM ledger WHERE account_id = ? AND kind = 'question' AND created >= ?) < ? RETURNING id",
    ).bind(-cents, ref, now, accountId, cents, accountId, dayStart, dailyLimit),
    // Follows the INSERT above: only when the hold row was written.
    db.prepare("UPDATE balances SET cents = cents - ?, updated = ? WHERE account_id = ? AND EXISTS (SELECT 1 FROM ledger WHERE ref = ? AND note = 'hold')")
      .bind(cents, now, accountId, ref),
  ]);
  if (ins.results.length > 0) return "held";
  const used = await db
    .prepare("SELECT COUNT(*) AS n FROM ledger WHERE account_id = ? AND kind = 'question' AND created >= ?")
    .bind(accountId, dayStart)
    .first<{ n: number }>();
  return (used?.n ?? 0) >= dailyLimit ? "paid_limit" : "low_balance";
}

/** Gives an unsettled hold back (the question failed or was declined). Safe to call twice. */
export async function releaseHold(db: D1Database, accountId: string, ref: string): Promise<void> {
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(
      "UPDATE balances SET cents = cents - (SELECT delta_cents FROM ledger WHERE ref = ? AND note = 'hold'), updated = ? " +
        "WHERE account_id = ? AND EXISTS (SELECT 1 FROM ledger WHERE ref = ? AND note = 'hold')",
    ).bind(ref, now, accountId, ref),
    db.prepare("DELETE FROM ledger WHERE ref = ? AND note = 'hold'").bind(ref),
  ]);
}

/**
 * Turns a hold into the real charge: gives the hold back, then charges `cents`, never more than the
 * balance, all in one transaction. The ledger row keeps its place and gets the final `ref`
 * (question:<id>). Returns what was charged and the balance after.
 */
export async function settleQuestion(
  db: D1Database,
  accountId: string,
  holdRef: string,
  cents: number,
  ref: string,
): Promise<{ charged: number; balance: number }> {
  const now = new Date().toISOString();
  const want = Math.max(0, Math.floor(cents));
  const results = await db.batch<{ delta_cents?: number; cents?: number }>([
    db.prepare(
      "UPDATE balances SET cents = cents - (SELECT delta_cents FROM ledger WHERE ref = ? AND note = 'hold'), updated = ? " +
        "WHERE account_id = ? AND EXISTS (SELECT 1 FROM ledger WHERE ref = ? AND note = 'hold')",
    ).bind(holdRef, now, accountId, holdRef),
    db.prepare(
      "UPDATE ledger SET ref = ?, note = 'settling', delta_cents = -MIN(?, (SELECT cents FROM balances WHERE account_id = ?)) " +
        "WHERE ref = ? AND note = 'hold' RETURNING delta_cents",
    ).bind(ref, want, accountId, holdRef),
    db.prepare(
      "UPDATE balances SET cents = cents + (SELECT delta_cents FROM ledger WHERE ref = ?), updated = ? " +
        "WHERE account_id = ? AND EXISTS (SELECT 1 FROM ledger WHERE ref = ? AND note = 'settling') RETURNING cents",
    ).bind(ref, now, accountId, ref),
    db.prepare("UPDATE ledger SET note = NULL WHERE ref = ? AND note = 'settling'").bind(ref),
  ]);
  const settled = results[1].results[0];
  if (!settled) return { charged: 0, balance: await balanceOf(db, accountId) };
  return { charged: -(settled.delta_cents ?? 0), balance: results[2].results[0]?.cents ?? (await balanceOf(db, accountId)) };
}
