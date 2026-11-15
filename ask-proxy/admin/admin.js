// Ocean Live admin page (admin.oceanlive.org).
//
// Sign in with Google only. The session lives in an HttpOnly cookie the server sets; this script never
// sees it and stores nothing in the browser. All calls are same-origin, so the browser sends the cookie
// and the Origin header the server checks before any change.

const $ = (id) => document.getElementById(id);

const views = { loading: $("loading"), signin: $("signin"), app: $("app") };
const status = $("status");
let me = null;
let current = null;
let googleNonce = "";

const ERRORS = {
  not_admin: "This Google account isn't an admin.",
  invalid_token: "Google sign-in didn't work. Try again.",
  provider_unavailable: "Google couldn't be reached. Try again in a minute.",
  method_unavailable: "Google sign-in isn't set up on the server yet.",
  rate_limited: "Too many tries. Wait a while and try again.",
  origin: "This request was blocked. Reload the page and try again.",
  not_found: "You've been signed out. Sign in again.",
  owner_only: "Only owners can do that.",
  no_account: "That account no longer exists.",
  review_account: "The store review account can't have a balance or badges.",
  insufficient_balance: "The balance can't go below $0.00.",
  bad_amount: "Enter an amount between $0.01 and $1,000.00.",
  note_required: "Write a note of 3 to 200 characters.",
  bad_email: "That doesn't look like an email address.",
  already_owner: "That address is already an owner.",
  owner_fixed: "Owners can't be removed here.",
  not_allowed: "That address can't be an admin.",
  unavailable: "The server's database is unavailable. Try again later.",
  bad_request: "That didn't work. Check what you entered.",
  network: "Can't reach the server. Check your connection.",
};

function message(code) {
  return ERRORS[code] || "Something went wrong. Try again.";
}

async function api(path, method = "GET", body) {
  try {
    const res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    });
    let data = {};
    try { data = await res.json(); } catch { /* empty body */ }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "network" } };
  }
}

/** A 404 on /admin/* means the session is gone (expired, signed out, or no longer an admin). */
function signedOut(r) {
  if (r.status !== 404 || r.data.error !== "not_found") return false;
  me = null;
  showSignIn();
  say(message("not_found"));
  return true;
}

function say(text) {
  status.textContent = text;
}

function show(name) {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
  views.loading.setAttribute("aria-busy", String(name === "loading"));
  $("who").hidden = name !== "app";
}

function busy(button, on) {
  button.disabled = on;
  button.setAttribute("aria-busy", String(on));
}

function dollars(cents) {
  const sign = cents < 0 ? "−" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function when(iso) {
  return iso ? iso.slice(0, 16).replace("T", " ") : "";
}

/** "5", "5.5", "$5.00", "5,50" -> cents, or null. */
function parseCents(text) {
  const m = /^\$?\s*(\d{1,4})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  const cents = parseInt(m[1], 10) * 100 + (m[2] ? parseInt(m[2].padEnd(2, "0"), 10) : 0);
  return cents > 0 ? cents : null;
}

/** Shows the confirm dialog. Resolves true when confirmed. */
function confirmDialog(title, text, action) {
  const dialog = $("confirm");
  $("confirm-title").textContent = title;
  $("confirm-text").textContent = text;
  $("confirm-go").textContent = action;
  dialog.returnValue = "";
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
    dialog.showModal();
  });
}

function cell(row, text, cls) {
  const td = document.createElement("td");
  td.textContent = text;
  if (cls) td.className = cls;
  row.appendChild(td);
}

// ── Signed in ───────────────────────────────────────────────

function showApp() {
  $("who-email").textContent = me.email;
  $("who-role").textContent = me.owner ? "owner" : "admin";
  $("admins").hidden = !me.owner;
  $("activity").hidden = !me.owner;
  show("app");
  if (me.owner) {
    loadAdmins();
    loadLog();
  }
}

$("find-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("find").value.trim();
  $("find-error").textContent = "";
  if (!q) {
    $("find-error").textContent = "Enter an email address or an account ID.";
    return;
  }
  await find(q);
});

async function find(q, keepId) {
  const param = q.includes("@") ? `email=${encodeURIComponent(q)}` : `id=${encodeURIComponent(q)}`;
  const r = await api(`/admin/accounts?${param}`);
  if (signedOut(r)) return;
  if (!r.ok) {
    $("find-error").textContent = message(r.data.error);
    return;
  }
  const list = r.data.accounts || [];
  const results = $("results");
  results.replaceChildren();
  results.hidden = list.length < 2;
  if (list.length === 0) {
    $("find-error").textContent = "No account found.";
    $("account").hidden = true;
    current = null;
    return;
  }
  if (list.length > 1) {
    for (const a of list) {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = `${a.email || "(no email)"} · ${a.name || "(no name)"} · created ${when(a.created)} · ${a.id}`;
      b.addEventListener("click", () => showAccount(a, true));
      li.appendChild(b);
      results.appendChild(li);
    }
  }
  const pick = (keepId && list.find((a) => a.id === keepId)) || list[0];
  showAccount(pick, !keepId);
}

function showAccount(a, focus) {
  current = a;
  $("account").hidden = false;
  $("acc-review").hidden = !a.review;
  $("acc-email").textContent = a.email || "(none)";
  $("acc-name").textContent = a.name || "(none)";
  $("acc-id").textContent = a.id;
  $("acc-created").textContent = when(a.created);
  $("acc-providers").textContent = (a.providers || []).join(", ") || "(none)";
  $("acc-balance").textContent = dollars(a.balanceCents);
  const hasBadge = (a.badges || []).includes("early_supporter");
  $("acc-badges").textContent = (a.badges || []).map((b) => (b === "early_supporter" ? "Early supporter" : b)).join(", ") || "(none)";
  $("badge-state").textContent = hasBadge ? "This account has the Early supporter badge." : "This account doesn't have the Early supporter badge.";
  $("badge-toggle").textContent = hasBadge ? "Remove badge…" : "Grant badge…";
  $("badge-toggle").className = hasBadge ? "btn btn-danger" : "btn btn-ghost";
  $("balance-form").hidden = !!a.review;
  $("badge-toggle").disabled = !!a.review;
  const body = $("ledger");
  body.replaceChildren();
  for (const l of a.ledger || []) {
    const tr = document.createElement("tr");
    cell(tr, when(l.created));
    cell(tr, dollars(l.deltaCents), "num");
    cell(tr, l.kind);
    cell(tr, l.note || "");
    body.appendChild(tr);
  }
  if (!(a.ledger || []).length) {
    const tr = document.createElement("tr");
    cell(tr, "No entries yet.");
    tr.firstChild.colSpan = 4;
    body.appendChild(tr);
  }
  if (focus) $("acc-title").focus();
}

$("balance-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!current) return;
  const err = $("balance-error");
  err.textContent = "";
  const cents = parseCents($("amount").value);
  if (!cents || cents > 100000) {
    err.textContent = message("bad_amount");
    $("amount").focus();
    return;
  }
  const note = $("note").value.trim();
  if (note.length < 3 || note.length > 200) {
    err.textContent = message("note_required");
    $("note").focus();
    return;
  }
  const add = new FormData(e.target).get("dir") !== "remove";
  const delta = add ? cents : -cents;
  const after = current.balanceCents + delta;
  if (after < 0) {
    err.textContent = message("insufficient_balance");
    return;
  }
  const who = current.email || current.id;
  const ok = await confirmDialog(
    add ? "Add credit?" : "Remove credit?",
    `${add ? "Add" : "Remove"} ${dollars(cents)} ${add ? "to" : "from"} ${who}. The balance goes from ${dollars(current.balanceCents)} to ${dollars(after)}. Note: "${note}"`,
    add ? `Add ${dollars(cents)}` : `Remove ${dollars(cents)}`,
  );
  if (!ok) return;
  const button = e.target.querySelector("button[type=submit]");
  busy(button, true);
  const r = await api("/admin/balance", "POST", { accountId: current.id, deltaCents: delta, note });
  busy(button, false);
  if (signedOut(r)) return;
  if (!r.ok) {
    err.textContent = message(r.data.error);
    return;
  }
  say(`Balance changed. New balance: ${dollars(r.data.balanceCents)}.`);
  $("amount").value = "";
  $("note").value = "";
  await find(current.id, current.id);
  if (me.owner) loadLog();
});

$("badge-toggle").addEventListener("click", async (e) => {
  if (!current) return;
  const err = $("badge-error");
  err.textContent = "";
  const grant = !(current.badges || []).includes("early_supporter");
  const who = current.email || current.id;
  const ok = await confirmDialog(
    grant ? "Grant the badge?" : "Remove the badge?",
    grant ? `Give ${who} the Early supporter badge.` : `Take the Early supporter badge away from ${who}.`,
    grant ? "Grant badge" : "Remove badge",
  );
  if (!ok) return;
  busy(e.target, true);
  const r = await api("/admin/badge", "POST", { accountId: current.id, badge: "early_supporter", grant });
  busy(e.target, false);
  if (signedOut(r)) return;
  if (!r.ok) {
    err.textContent = message(r.data.error);
    return;
  }
  say(grant ? "Badge granted." : "Badge removed.");
  await find(current.id, current.id);
  if (me.owner) loadLog();
});

// ── Admins (owners only) ─────────────────────────────────────

function renderAdmins(data) {
  const list = $("admin-list");
  list.replaceChildren();
  for (const email of data.owners || []) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = `${email} (owner)`;
    li.appendChild(span);
    list.appendChild(li);
  }
  for (const a of data.admins || []) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = `${a.email} · added by ${a.addedBy} on ${when(a.created).slice(0, 10)}`;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-danger";
    b.textContent = "Remove…";
    b.setAttribute("aria-label", `Remove ${a.email}`);
    b.addEventListener("click", () => removeAdmin(a.email, b));
    li.append(span, b);
    list.appendChild(li);
  }
}

async function loadAdmins() {
  const r = await api("/admin/admins");
  if (signedOut(r)) return;
  if (r.ok) renderAdmins(r.data);
}

async function loadLog() {
  const r = await api("/admin/log");
  if (signedOut(r) || !r.ok) return;
  const body = $("log");
  body.replaceChildren();
  for (const l of r.data.log || []) {
    const tr = document.createElement("tr");
    cell(tr, when(l.created));
    cell(tr, l.email);
    cell(tr, l.action);
    cell(tr, [l.accountId, l.detail].filter(Boolean).join(" "));
    body.appendChild(tr);
  }
}

$("admin-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("admin-error");
  err.textContent = "";
  const email = $("admin-email").value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    err.textContent = message("bad_email");
    return;
  }
  const ok = await confirmDialog("Add an admin?", `${email} will be able to sign in here with Google and change balances and badges.`, "Add admin");
  if (!ok) return;
  const r = await api("/admin/admins/add", "POST", { email });
  if (signedOut(r)) return;
  if (!r.ok) {
    err.textContent = message(r.data.error);
    return;
  }
  $("admin-email").value = "";
  say(`${email} is now an admin.`);
  renderAdmins(r.data);
  loadLog();
});

async function removeAdmin(email, button) {
  const ok = await confirmDialog("Remove this admin?", `${email} won't be an admin any more and is signed out straight away.`, "Remove admin");
  if (!ok) return;
  busy(button, true);
  const r = await api("/admin/admins/remove", "POST", { email });
  busy(button, false);
  if (signedOut(r)) return;
  if (!r.ok) {
    $("admin-error").textContent = message(r.data.error);
    return;
  }
  say(`${email} is no longer an admin.`);
  renderAdmins(r.data);
  loadLog();
}

// ── Sign in / out ────────────────────────────────────────────

$("signout").addEventListener("click", async () => {
  await api("/auth/signout", "POST");
  me = null;
  current = null;
  $("account").hidden = true;
  showSignIn();
  say("You're signed out.");
});

function randomNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

let googleReady = false;
let clientId = null;

function showSignIn() {
  show("signin");
  if (!clientId) {
    $("signin-error").textContent = message("method_unavailable");
    return;
  }
  if (googleReady) return;
  const script = document.createElement("script");
  script.src = "https://accounts.google.com/gsi/client";
  script.async = true;
  script.onload = () => {
    const gsi = window.google && window.google.accounts && window.google.accounts.id;
    if (!gsi) return;
    googleNonce = randomNonce();
    gsi.initialize({ client_id: clientId, callback: onGoogle, nonce: googleNonce, auto_select: false, cancel_on_tap_outside: true });
    gsi.renderButton($("google-button"), { theme: "outline", size: "large", text: "signin_with", shape: "pill", width: 300 });
    googleReady = true;
  };
  document.head.appendChild(script);
}

async function onGoogle(response) {
  $("signin-error").textContent = "";
  const r = await api("/auth/google", "POST", { idToken: response.credential, nonce: googleNonce });
  if (r.ok && r.data.email) {
    me = r.data;
    say("You're signed in.");
    showApp();
    $("find-title").focus();
  } else {
    $("signin-error").textContent = message(r.data.error);
  }
}

async function start() {
  const [config, who] = await Promise.all([api("/auth/config"), api("/admin/me")]);
  clientId = config.ok && config.data.google ? config.data.googleWebClientId : null;
  if (who.ok) {
    me = who.data;
    showApp();
    return;
  }
  if (who.status === 0) say(message("network"));
  showSignIn();
}

start();
