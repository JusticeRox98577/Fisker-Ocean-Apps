/** Small helpers shared by the Worker. */

const API_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(API_HEADERS)) if (!headers.has(k)) headers.set(k, v);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function fail(status: number, error: string, extra: Record<string, unknown> = {}): Response {
  return json({ error, ...extra }, { status });
}

export function withApiHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(API_HEADERS)) if (!out.headers.has(k)) out.headers.set(k, v);
  return out;
}

export function randomToken(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return base64url(b);
}

export function base64url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export async function sha256(data: string | Uint8Array): Promise<ArrayBuffer> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return crypto.subtle.digest("SHA-256", bytes);
}

export async function sha256hex(data: string | Uint8Array): Promise<string> {
  return [...new Uint8Array(await sha256(data))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Time-sortable id: 9 base36 chars of milliseconds, then 10 random ones. */
export function newId(now = Date.now()): string {
  const rnd = [...crypto.getRandomValues(new Uint8Array(10))].map((b) => (b % 36).toString(36)).join("");
  return now.toString(36).padStart(9, "0") + rnd;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Lowercase, trim, drop a +tag. Returns "" for anything that is not one plain address. */
export function canonicalAddress(input: string): string {
  const a = String(input ?? "").trim().toLowerCase();
  const m = /^([a-z0-9._%+-]+)@([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/.exec(a);
  if (!m) return "";
  const local = m[1].split("+")[0];
  return local ? `${local}@${m[2]}` : "";
}

export function isValidAddress(a: string): boolean {
  return /^[^\s@<>()",;:\[\]]{1,64}@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(a) && a.length <= 254;
}

/** One header line: no line breaks, limited length. */
export function oneLine(s: unknown, max = 998): string {
  return String(s ?? "").replace(/[\r\n\t]+/g, " ").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
}

/** Collapse text for a list preview. */
export function snippetOf(text: string, html: string): string {
  let s = text;
  if (!s && html) {
    s = html
      .replace(/<(style|script|head|title)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&quot;/gi, '"');
  }
  return s.replace(/\s+/g, " ").trim().slice(0, 200);
}

export function getCookie(req: Request, name: string): string | null {
  const header = req.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
