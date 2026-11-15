// oceanlive.org: the static site plus a tiny proxy for the mailing list.
//
// wrangler.jsonc runs this script first only for /api/*; every other path is served straight from
// public/ by the assets binding. The mailing list itself lives in the mail Worker (ocean-live-mail,
// bound as MAIL): this script only forwards its three public endpoints to it, so the pages can call
// them same-origin and the site's CSP (connect-src 'self') stays as it is.
//
//   POST /api/list/subscribe     {email, lang, website}  -> {ok:true} or {error:"..."}
//   POST /api/list/confirm       {token}
//   POST /api/list/unsubscribe   {token}, or RFC 8058 one-click (?t=<token>, List-Unsubscribe=One-Click)
//   GET  /api/list/unsubscribe?t=<token>  -> 303 to the unsubscribe page (a GET never unsubscribes)
//   anything else under /api/    -> 404 JSON
//
// Plain JS, no dependencies. Tested by tools/worker.test.mjs (node --test).

const PUBLIC = new Set(["/api/list/subscribe", "/api/list/confirm", "/api/list/unsubscribe"]);
const MAX_BODY = 16 * 1024;
const UNAVAILABLE = "The mailing list isn't available right now. Try again later."; // the requests are a few hundred bytes

const API_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};

function json(data, status, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...API_HEADERS, "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}

async function proxy(request, env, url) {
  if (request.method === "GET" && url.pathname === "/api/list/unsubscribe") {
    // Someone opened the List-Unsubscribe link in a browser: show the page with the button. The
    // token moves to the fragment, so it stays out of the page's logs and referrers.
    const t = url.searchParams.get("t") || "";
    const to = new URL("/list/unsubscribe", url.origin);
    if (/^[A-Za-z0-9_-]{1,200}$/.test(t)) to.hash = "t=" + t;
    return new Response(null, { status: 303, headers: { ...API_HEADERS, Location: to.toString() } });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { Allow: "POST" });
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_BODY) return json({ error: "Request too large." }, 413);
  if (!env.MAIL) return json({ error: UNAVAILABLE }, 503);

  // Forward as is (method, query, body and headers, including CF-Connecting-IP for the mail
  // Worker's rate limits), minus the visitor's cookies and credentials: the list needs none.
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY) return json({ error: "Request too large." }, 413);
  const headers = new Headers(request.headers);
  headers.delete("Cookie");
  headers.delete("Authorization");
  headers.delete("Content-Length");
  let res;
  try {
    res = await env.MAIL.fetch(new Request(url.toString(), { method: "POST", headers, body }));
  } catch {
    return json({ error: UNAVAILABLE }, 503);
  }
  // The list's public endpoints never answer 401 or 404. Those come from a mail Worker without the list
  // code (the old one answers "Signed out."), so visitors get the plain "not available" message instead.
  if (res.status === 401 || res.status === 404) return json({ error: UNAVAILABLE }, 503);
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(API_HEADERS)) if (!out.headers.has(k)) out.headers.set(k, v);
  out.headers.delete("Set-Cookie");
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (PUBLIC.has(url.pathname)) return proxy(request, env, url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return json({ error: "Not found." }, 404);
    return env.ASSETS.fetch(request);
  },
};
