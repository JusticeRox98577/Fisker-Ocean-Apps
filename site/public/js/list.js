// Mailing list: the sign-up form (home page and /news) and the confirm and unsubscribe pages.
// Every call is a same-origin POST to /api/list/*, which src/worker.js forwards to the mail Worker.
// Native form submission is blocked by the CSP (form-action 'none'), so the forms only work here.

const API = {
  subscribe: "/api/list/subscribe",
  confirm: "/api/list/confirm",
  unsubscribe: "/api/list/unsubscribe",
};
const LANGS = ["en", "de", "fr", "es", "nl"];
const OFFLINE = "Couldn't reach oceanlive.org. Check your connection and try again.";

function pageLang() {
  for (const tag of navigator.languages || [navigator.language || ""]) {
    const base = String(tag).toLowerCase().split("-")[0];
    if (LANGS.includes(base)) return base;
  }
  return "en";
}

// POSTs JSON and returns {ok:true} or {error:"..."} (the server's message when it sent one).
async function post(url, data) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      credentials: "omit",
      cache: "no-store",
    });
  } catch {
    return { error: OFFLINE };
  }
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (res.ok && body && body.ok) return { ok: true };
  if (body && typeof body.error === "string" && body.error) return { error: body.error };
  if (res.status === 429) return { error: "Too many tries. Please wait a while and try again." };
  return { error: "Something went wrong. Please try again later." };
}

function say(el, text, kind) {
  el.textContent = text;
  el.classList.toggle("is-error", kind === "error");
  el.classList.toggle("is-ok", kind === "ok");
}

function busy(button, on, label) {
  if (on) {
    button.dataset.label = button.textContent;
    button.textContent = label;
  } else if (button.dataset.label) {
    button.textContent = button.dataset.label;
  }
  button.disabled = on;
  button.setAttribute("aria-busy", String(on));
}

function initSubscribe(form) {
  const email = form.elements.namedItem("email");
  const website = form.elements.namedItem("website");
  const button = form.querySelector('button[type="submit"]');
  const status = form.querySelector(".list-status");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (button.disabled) return;
    const address = email.value.trim();
    if (!address || !email.checkValidity()) {
      say(status, "Enter a valid email address.", "error");
      email.focus();
      return;
    }
    busy(button, true, "Sending…");
    say(status, "Sending…");
    const r = await post(API.subscribe, { email: address, lang: pageLang(), website: website ? website.value : "" });
    busy(button, false);
    if (r.ok) {
      form.reset();
      say(status, "Check your inbox to confirm. The link in the email works for 7 days.", "ok");
    } else {
      say(status, r.error, "error");
      email.focus();
    }
  });
  form.classList.add("is-ready");
}

// Confirm and unsubscribe pages: the token comes in the fragment (#t=…), so it never reaches a
// server log or a link scanner. It is taken out of the address bar straight away, and nothing is
// sent until the visitor presses the button (mail scanners and prefetchers open links too).
function initAction(box, url, done, missing) {
  const button = box.querySelector("button");
  const status = box.querySelector(".list-status");
  const m = /(?:^#|&)t=([A-Za-z0-9_-]+)/.exec(location.hash);
  const token = m ? m[1] : "";
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  if (!token) {
    button.hidden = true;
    say(status, missing, "error");
    return;
  }
  button.hidden = false;
  button.addEventListener("click", async () => {
    if (button.disabled) return;
    busy(button, true, "Working…");
    say(status, "Working…");
    const r = await post(url, { token });
    busy(button, false);
    if (r.ok) {
      button.hidden = true;
      say(status, done, "ok");
      status.focus();
    } else {
      say(status, r.error, "error");
    }
  });
}

for (const form of document.querySelectorAll('form[data-list="subscribe"]')) initSubscribe(form);
const confirmBox = document.querySelector('[data-list="confirm"]');
if (confirmBox) {
  initAction(confirmBox, API.confirm,
    "You're on the list. We'll email you when there's a new release or an important fix.",
    "This link is missing its code. Open the link in the email again, or sign up again at oceanlive.org/news.");
}
const unsubBox = document.querySelector('[data-list="unsubscribe"]');
if (unsubBox) {
  initAction(unsubBox, API.unsubscribe,
    "You're off the list. Your email address has been deleted.",
    "This link is missing its code. Open the unsubscribe link in the email again, or email justice@oceanlive.org and we'll remove you.");
}
