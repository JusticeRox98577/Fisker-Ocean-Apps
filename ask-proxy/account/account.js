// Ocean Live account page (account.oceanlive.org).
//
// The session lives in an HttpOnly cookie the server sets after sign-in; this script never sees the
// token and stores nothing in the browser. All calls are same-origin, so the browser sends the cookie
// and the Origin header the server checks before any change.

const $ = (id) => document.getElementById(id);

const views = { loading: $("loading"), signin: $("signin"), account: $("account") };
const status = $("status");
let pendingEmail = "";
let googleNonce = "";

const ERRORS = {
  bad_email: "That doesn't look like an email address.",
  rate_limited: "Too many codes asked for. Wait an hour and try again.",
  email_failed: "The email couldn't be sent. Try again in a few minutes.",
  method_unavailable: "This way of signing in isn't set up yet.",
  wrong_code: "That code isn't right. Check it and try again.",
  code_expired: "That code has expired or was tried too often. Ask for a new one.",
  invalid_token: "Google sign-in didn't work. Try again.",
  provider_unavailable: "Google couldn't be reached. Try again in a minute.",
  signin_required: "You've been signed out. Sign in again.",
  no_account: "No Ocean Live account uses this sign-in. Accounts are made in the app: sign in there first, or use the email or Google account you signed in with in the app.",
  accounts_unavailable: "Accounts are unavailable right now. Try again later.",
  origin: "This request was blocked. Reload the page and try again.",
};

function message(code) {
  return ERRORS[code] || "Something went wrong. Try again.";
}

/** Calls the server. Returns { ok, status, data }. Network errors come back as status 0. */
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

function say(text) {
  status.textContent = text;
}

function show(name) {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
  views.loading.setAttribute("aria-busy", String(name === "loading"));
}

function focusHeading(id) {
  const h = $(id);
  if (h) h.focus();
}

function busy(button, on) {
  button.disabled = on;
  button.setAttribute("aria-busy", String(on));
}

// ── Signed in ───────────────────────────────────────────────

const PROVIDERS = { email: "Email code", google: "Google", apple: "Apple" };

function showAccount(a, focus = true) {
  $("acc-email").textContent = a.email || "None";
  $("acc-name").textContent = a.name || "None";
  const created = new Date(a.created);
  $("acc-created").textContent = isNaN(created) ? a.created : created.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  $("acc-providers").textContent = (a.providers || []).map((p) => PROVIDERS[p] || p).join(", ") || "None";
  $("name").value = a.name || "";
  // Future: credits and badges would be filled in here once the server has them (see index.html).
  show("account");
  if (focus) focusHeading("account-title");
}

$("name-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.submitter || e.target.querySelector("button");
  $("name-error").textContent = "";
  busy(btn, true);
  const r = await api("/account", "PATCH", { name: $("name").value });
  busy(btn, false);
  if (r.ok) {
    showAccount(r.data, false);
    say("Name saved.");
  } else if (r.status === 401) {
    signedOut(message("signin_required"));
  } else {
    $("name-error").textContent = message(r.data.error);
  }
});

$("signout").addEventListener("click", async () => {
  const btn = $("signout");
  busy(btn, true);
  const r = await api("/auth/signout", "POST", {});
  busy(btn, false);
  if (r.ok) signedOut("You're signed out on this browser.");
  else say(message(r.data.error));
});

// Delete: a dialog with a typed confirmation.
const dialog = $("delete-dialog");
const confirmInput = $("delete-confirm");
const deleteGo = $("delete-go");

$("delete-open").addEventListener("click", () => {
  confirmInput.value = "";
  deleteGo.disabled = true;
  $("delete-error").textContent = "";
  dialog.showModal();
  confirmInput.focus();
});
$("delete-cancel").addEventListener("click", () => dialog.close());
dialog.addEventListener("close", () => $("delete-open").focus());
confirmInput.addEventListener("input", () => {
  deleteGo.disabled = confirmInput.value.trim().toLowerCase() !== "delete";
});

$("delete-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (confirmInput.value.trim().toLowerCase() !== "delete") return;
  busy(deleteGo, true);
  const r = await api("/account", "DELETE");
  busy(deleteGo, false);
  if (r.ok) {
    dialog.close();
    signedOut("Your account has been deleted. Your phones are signed out too.");
  } else if (r.status === 401) {
    dialog.close();
    signedOut(message("signin_required"));
  } else {
    $("delete-error").textContent = message(r.data.error);
  }
});

// ── Signed out ──────────────────────────────────────────────

function signedOut(note = "") {
  say(note);
  resetEmail();
  show("signin");
  focusHeading("signin-title");
}

function resetEmail() {
  pendingEmail = "";
  $("email-form").hidden = false;
  $("code-form").hidden = true;
  $("code").value = "";
  $("email-error").textContent = "";
  $("code-error").textContent = "";
}

async function sendCode(email) {
  return api("/auth/email/start", "POST", { email });
}

$("email-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.submitter || e.target.querySelector("button");
  const email = $("email").value.trim();
  $("email-error").textContent = "";
  if (!email) {
    $("email-error").textContent = "Enter your email address.";
    $("email").focus();
    return;
  }
  busy(btn, true);
  const r = await sendCode(email);
  busy(btn, false);
  if (!r.ok) {
    $("email-error").textContent = message(r.data.error);
    $("email").focus();
    return;
  }
  pendingEmail = email;
  $("code-sent").textContent = `We sent a 6-digit code to ${email}. It works for 10 minutes.`;
  $("email-form").hidden = true;
  $("code-form").hidden = false;
  say("Code sent. Check your email.");
  $("code").focus();
});

$("code-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.submitter || e.target.querySelector("button[type=submit]");
  const code = $("code").value.replace(/\D/g, "");
  $("code-error").textContent = "";
  if (code.length !== 6) {
    $("code-error").textContent = "Enter the 6 digits from the email.";
    $("code").focus();
    return;
  }
  busy(btn, true);
  const r = await api("/auth/email/verify", "POST", { email: pendingEmail, code });
  busy(btn, false);
  if (r.ok && r.data.account) {
    say("You're signed in.");
    showAccount(r.data.account);
  } else {
    $("code-error").textContent = message(r.data.error);
    $("code").focus();
  }
});

$("code-resend").addEventListener("click", async () => {
  if (!pendingEmail) return;
  const r = await sendCode(pendingEmail);
  if (r.ok) say("A new code is on its way.");
  else $("code-error").textContent = message(r.data.error);
});

$("code-back").addEventListener("click", () => {
  resetEmail();
  $("email").focus();
});

// ── Google (only when the server has a web client ID) ───────

function randomNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function setUpGoogle(clientId) {
  const script = document.createElement("script");
  script.src = "https://accounts.google.com/gsi/client";
  script.async = true;
  script.onload = () => {
    const gsi = window.google && window.google.accounts && window.google.accounts.id;
    if (!gsi) return;
    googleNonce = randomNonce();
    gsi.initialize({ client_id: clientId, callback: onGoogle, nonce: googleNonce, auto_select: false, cancel_on_tap_outside: true });
    gsi.renderButton($("google-button"), { theme: "filled_black", size: "large", text: "signin_with", shape: "pill", width: 300 });
    $("google").hidden = false;
  };
  document.head.appendChild(script);
}

async function onGoogle(response) {
  $("google-error").textContent = "";
  const r = await api("/auth/google", "POST", { idToken: response.credential, nonce: googleNonce });
  if (r.ok && r.data.account) {
    say("You're signed in.");
    showAccount(r.data.account);
  } else {
    $("google-error").textContent = message(r.data.error);
  }
}

// ── Start ───────────────────────────────────────────────────

async function start() {
  const [config, me] = await Promise.all([api("/auth/config"), api("/account")]);
  if (me.ok) {
    showAccount(me.data, false);
    return;
  }
  show("signin");
  if (me.status === 0) say("Can't reach Ocean Live. Check your connection and reload.");
  else if (me.status !== 401) say(message(me.data.error));
  if (config.ok && config.data.email === false) {
    $("email-error").textContent = message("method_unavailable");
  }
  if (config.ok && config.data.google && config.data.googleWebClientId) setUpGoogle(config.data.googleWebClientId);
}

start();
