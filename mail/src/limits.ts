/** Fixed-window counters in D1, for sign-in and sending limits. */

export async function bump(db: D1Database, key: string, windowMs: number, now = Date.now()): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO counters (key, count, reset_at) VALUES (?1, 1, ?2)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN reset_at <= ?3 THEN 1 ELSE count + 1 END,
         reset_at = CASE WHEN reset_at <= ?3 THEN ?2 ELSE reset_at END
       RETURNING count`,
    )
    .bind(key, now + windowMs, now)
    .first<{ count: number }>();
  return row?.count ?? 1;
}

export async function current(db: D1Database, key: string, now = Date.now()): Promise<number> {
  const row = await db
    .prepare("SELECT count FROM counters WHERE key = ?1 AND reset_at > ?2")
    .bind(key, now)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function clear(db: D1Database, key: string): Promise<void> {
  await db.prepare("DELETE FROM counters WHERE key = ?1").bind(key).run();
}
