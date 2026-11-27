// Nova beta admin. Sign-in is a one-time link emailed to the admin address; the session is an
// HttpOnly cookie, so this script never sees it. Feature and product names come from the sign-up
// page itself, so editing index.html updates them here too.
document.documentElement.classList.replace("no-js", "js");

const $ = (id) => document.getElementById(id);
let data = { responses: [], boards: 4 };
let labels = { features: {}, products: {}, car: {}, phone: {}, install: {} };

function say(el, text, kind) {
  el.textContent = text;
  el.classList.toggle("is-error", kind === "error");
  el.classList.toggle("is-ok", kind === "ok");
}

async function call(url, body) {
  try {
    const res = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
    const out = await res.json().catch(() => null);
    if (res.status === 401 && url !== "/api/admin/session") return { signedOut: true };
    if (res.ok && out) return out;
    return { error: (out && out.error) || `Something went wrong (${res.status}).` };
  } catch {
    return { error: "Couldn't reach the server. Check your connection." };
  }
}

/** Names for the ids, read from the sign-up page. */
async function loadLabels() {
  try {
    const html = await (await fetch("/", { cache: "no-store" })).text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const box of doc.querySelectorAll('input[name="features"]')) {
      labels.features[box.value] = box.closest(".feature")?.querySelector("b")?.textContent || box.value;
    }
    for (const name of ["products", "install"]) {
      for (const box of doc.querySelectorAll(`input[name="${name}"]`)) {
        labels[name][box.value] = box.parentElement?.querySelector("span")?.textContent || box.value;
      }
    }
    for (const [name, id] of [["car", "f-car"], ["phone", "f-phone"]]) {
      for (const o of doc.querySelectorAll(`#${id} option`)) if (o.value) labels[name][o.value] = o.textContent;
    }
  } catch { /* ids are shown instead */ }
}
const label = (kind, id) => labels[kind][id] || id;

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const date = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");
const PICK_TEXT = { invited: "Invited, no answer yet", accepted: "Said yes", declined: "Said no" };
const active = () => data.responses.filter((r) => r.pick === "invited" || r.pick === "accepted");

function renderSlots() {
  const list = $("slots");
  const taken = active().sort((a, b) => (a.pickedAt < b.pickedAt ? -1 : 1));
  list.replaceChildren(
    ...Array.from({ length: data.boards }, (_, i) => {
      const r = taken[i];
      const li = el("li", `slot${r ? ` is-${r.pick}` : ""}`);
      li.append(el("span", "slot-n", `Board ${i + 1}`));
      if (r) {
        li.append(el("b", "", r.name || r.email), el("span", "slot-state", PICK_TEXT[r.pick]));
      } else {
        li.append(el("b", "", "Free"), el("span", "slot-state", "Pick someone below"));
      }
      return li;
    }),
  );
}

function tally() {
  const byFeature = new Map();
  const interest = {};
  for (const r of data.responses) {
    r.features.slice(0, 5).forEach((f, i) => {
      const t = byFeature.get(f) || { f, points: 0, picks: 0, first: 0 };
      t.points += 5 - i;
      t.picks += 1;
      if (i === 0) t.first += 1;
      byFeature.set(f, t);
    });
    for (const p of r.products) interest[p] = (interest[p] || 0) + 1;
  }
  return { features: [...byFeature.values()].sort((a, b) => b.points - a.points || b.first - a.first), interest };
}

function renderStats() {
  const { features, interest } = tally();
  const max = features[0]?.points || 1;
  $("ranking").replaceChildren(
    ...(features.length
      ? features.map((t) => {
          const li = el("li");
          const top = el("div", "rank-top");
          top.append(el("span", "rank-name", label("features", t.f)), el("span", "rank-pts", `${t.points} pts · ${t.picks} ${t.picks === 1 ? "pick" : "picks"} · ${t.first}× #1`));
          const bar = el("div", "bar");
          const fill = el("i");
          fill.style.width = `${Math.max(4, (t.points / max) * 100)}%`;
          bar.append(fill);
          li.append(top, bar);
          return li;
        })
      : [el("li", "muted", "No answers yet.")]),
  );
  const products = Object.entries(interest).sort((a, b) => b[1] - a[1]);
  $("interest").replaceChildren(
    ...(products.length
      ? products.map(([p, n]) => {
          const li = el("li");
          li.append(el("span", "", label("products", p)), el("b", "", String(n)));
          return li;
        })
      : [el("li", "muted", "No answers yet.")]),
  );
}

function matches(r, q, f) {
  if (f === "none" && r.pick) return false;
  if (f === "picked" && !(r.pick === "invited" || r.pick === "accepted")) return false;
  if (f === "declined" && r.pick !== "declined") return false;
  if (!q) return true;
  const hay = [r.email, r.name, r.region, r.car, label("car", r.car), r.notes, r.otherFeature, ...r.features.map((x) => label("features", x))]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

function renderPeople() {
  const q = $("search").value.trim().toLowerCase();
  const f = $("filter").value;
  const full = active().length >= data.boards;
  const rows = data.responses.filter((r) => matches(r, q, f)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  $("people-n").textContent = String(data.responses.length);
  $("people").replaceChildren(
    ...(rows.length
      ? rows.map((r) => {
          const li = el("li", "person panel");
          const head = el("div", "person-head");
          const who = el("div");
          who.append(el("h3", "", r.name || r.email));
          const mail = el("a", "small", r.email);
          mail.href = `mailto:${r.email}`;
          who.append(mail);
          head.append(who);
          if (r.pick) head.append(el("span", `pill is-${r.pick}`, PICK_TEXT[r.pick]));
          li.append(head);

          const facts = [
            r.car && label("car", r.car),
            r.region,
            r.phone && label("phone", r.phone),
            r.install && `Install: ${label("install", r.install)}`,
            `Signed up ${date(r.createdAt)}`,
          ].filter(Boolean);
          li.append(el("p", "facts", facts.join(" · ")));
          if (r.products.length) li.append(el("p", "small muted", `Wants to test: ${r.products.map((p) => label("products", p)).join(", ")}`));

          const ol = el("ol", "top5");
          for (const x of r.features) ol.append(el("li", "", label("features", x)));
          if (r.features.length) li.append(ol);
          if (r.otherFeature) li.append(el("p", "small", `Also wants: ${r.otherFeature}`));
          if (r.notes) li.append(el("p", "notes", r.notes));

          const actions = el("div", "actions");
          const btn = (text, cls, fn, disabled = false) => {
            const b = el("button", `btn btn-small ${cls}`, text);
            b.type = "button";
            b.disabled = disabled;
            b.addEventListener("click", () => fn(b));
            actions.append(b);
          };
          if (!r.pick || r.pick === "declined") {
            btn(full ? "All boards taken" : "Pick as tester", full ? "btn-ghost" : "btn-primary", (b) => act(b, "pick", r, `Email ${r.email} that they've been picked?`), full);
          }
          if (r.pick === "invited") btn("Re-send invitation", "btn-ghost", (b) => act(b, "pick", r, `Send ${r.email} a new invitation link? The old link stops working.`));
          if (r.pick === "invited" || r.pick === "accepted") btn("Un-pick", "btn-ghost", (b) => act(b, "unpick", r, `Free ${r.name || r.email}'s board? Their link stops working. No email is sent.`));
          const frees = r.pick === "invited" || r.pick === "accepted" ? " This also frees their board, and no email is sent." : "";
          btn("Delete", "btn-ghost btn-danger", (b) => act(b, "delete", r, `Delete ${r.email}'s answer for good?${frees}`));
          li.append(actions);
          return li;
        })
      : [el("li", "muted", data.responses.length ? "Nobody matches." : "No sign-ups yet.")]),
  );
}

function render() {
  renderSlots();
  renderStats();
  renderPeople();
}

async function act(button, what, r, question) {
  if (!confirm(question)) return;
  button.disabled = true;
  say($("dash-status"), what === "pick" ? "Sending the email…" : "Saving…");
  const out = await call(`/api/admin/${what}`, { email: r.email });
  if (out.signedOut) return showSignIn();
  if (out.error) {
    button.disabled = false;
    say($("dash-status"), out.error, "error");
    $("dash-status").focus();
    return;
  }
  const done = { pick: out.resent ? `New invitation sent to ${r.email}.` : `${r.email} is picked and has been emailed.`, unpick: "Board freed.", delete: "Deleted." };
  await load();
  say($("dash-status"), done[what], "ok");
}

async function load() {
  const out = await call("/api/admin/responses?format=json");
  if (out.signedOut) return showSignIn();
  if (out.error) return say($("dash-status"), out.error, "error");
  data = out;
  $("signin").hidden = true;
  $("dash").hidden = false;
  $("sign-out").hidden = false;
  render();
}

function showSignIn() {
  $("dash").hidden = true;
  $("sign-out").hidden = true;
  $("signin").hidden = false;
}

$("send-link").addEventListener("click", async () => {
  const b = $("send-link");
  b.disabled = true;
  say($("signin-status"), "Sending…");
  const out = await call("/api/admin/login", {});
  b.disabled = false;
  if (out.error) return say($("signin-status"), out.error, "error");
  say($("signin-status"), `Sent to ${out.to}. Open the link in this browser within 15 minutes.`, "ok");
});

$("sign-out").addEventListener("click", async () => {
  await call("/api/admin/logout", {});
  showSignIn();
});
$("search").addEventListener("input", renderPeople);
$("filter").addEventListener("change", renderPeople);

(async () => {
  const labelsReady = loadLabels();
  const m = location.hash.match(/^#login=([A-Za-z0-9_-]+)$/);
  if (m) {
    history.replaceState(null, "", location.pathname);
    const out = await call("/api/admin/session", { token: m[1] });
    if (out.error) {
      showSignIn();
      say($("signin-status"), out.error, "error");
      return;
    }
  }
  await labelsReady;
  await load();
})();
