const HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

export function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...HEADERS, "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}

export function plainHeaders(extra: Record<string, string>): Record<string, string> {
  return { ...HEADERS, ...extra };
}

export async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A token as it arrives from a page: the shape randomToken makes, or "" for anything else. */
export function tokenFrom(v: unknown): string {
  const s = String(v ?? "");
  return /^[A-Za-z0-9_-]{20,100}$/.test(s) ? s : "";
}

/** JSON body of a POST from a page on this site; null when it isn't one. */
export async function readJson(req: Request, maxBytes = 16 * 1024): Promise<Record<string, unknown> | null | "too-big"> {
  if (!(req.headers.get("Content-Type") ?? "").toLowerCase().startsWith("application/json")) return null;
  const raw = await req.text();
  if (raw.length > maxBytes) return "too-big";
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** The request comes from a page on this site (or from no browser page at all, like curl). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("Origin");
  if (origin && origin !== new URL(req.url).origin) return false;
  const site = req.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin" && site !== "none") return false;
  return true;
}

export function getCookie(req: Request, name: string): string {
  for (const part of (req.headers.get("Cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}

/** Fixed-window counter; returns the count including this one. */
export async function bump(db: D1Database, key: string, windowMs: number, now: number): Promise<number> {
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

/** Drops expired counters, sign-in links and sessions. */
export async function cleanup(db: D1Database, now: number): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM counters WHERE reset_at <= ?1").bind(now),
    db.prepare("DELETE FROM login_links WHERE expires_at <= ?1").bind(now),
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?1").bind(now),
  ]);
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
