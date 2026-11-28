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
// Features taken off the sign-up page: earlier answers still show a readable name.
const RETIRED = { features: { carplay: "CarPlay / Android Auto (no longer offered)" } };
const label = (kind, id) => labels[kind][id] || RETIRED[kind]?.[id] || id;

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

// ---- Nova boxes (SuperNova and Nova Light) ---------------------------------------------------------------------------

const TX = ["sent", "not parked", "12 V low", "not set up for this car yet", "gate not raised", "not a SuperNova"];
async function loadBoxes() {
  const out = await call("/api/admin/boxes");
  if (out.signedOut || out.error) return;
  $("box-n").textContent = String(out.boxes.length);
  $("boxes").replaceChildren(...(out.boxes.length ? out.boxes.map((b) => {
    const li = el("li", "person panel");
    const light = b.kind === "light";
    li.append(el("h3", "", `${light ? "Nova Light" : "SuperNova"} ${b.uid}`));
    li.append(el("p", "facts", [
      `Last seen ${when(b.last_seen)}`,
      `firmware ${ver(b.fw)}`,
      b.v12 ? `12 V ${(b.v12 / 1000).toFixed(1)} V` : "12 V not measured",
      b.rsrp ? `signal ${b.rsrp} dBm` : "",
      ...(light ? [
        ["starting", "parked", "car awake", "self-protect (12 V low)"][b.state] || "",
        `${b.budget_kb} kB of data this month`,
        b.alerts ? "12 V alert open" : "",
      ] : [
        `${b.phones} paired phone${b.phones === 1 ? "" : "s"}`,
        `${b.commands} remote commands`,
        b.last_cmd_action ? `last: ${b.last_cmd_result >= 128 ? "refused by the car" : TX[b.last_cmd_result] || b.last_cmd_result}` : "",
      ]),
    ].filter(Boolean).join(" · ")));
    return li;
  }) : [el("li", "muted", "No Nova box has checked in yet.")]));
}

// ---- pre-orders ---------------------------------------------------------------------------------

const PRE_STATUS = { unconfirmed: "not confirmed yet", confirmed: "reserved", deposit_requested: "deposit asked",
  deposit_paid: "deposit paid", cancelled: "cancelled" };
const usd = (c) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;

function preProduct(p, rows) {
  const li = el("li", "slot");
  li.append(el("span", "slot-n", p.name), el("b", "", `${p.reserved} of ${p.goal} reserved`),
    el("span", "slot-state", `${usd(p.price)}, deposit ${usd(p.deposit)}`));
  const waiting = rows.filter((r) => r.product === p.id && r.status === "confirmed").length;
  if (p.reserved < p.goal || !waiting) return li;
  const link = el("input", "input");
  link.placeholder = "Deposit payment link (https://…)";
  link.setAttribute("aria-label", `${p.name} deposit payment link`);
  const send = el("button", "btn btn-small btn-primary", `Email the deposit link to ${waiting}`);
  send.type = "button";
  send.addEventListener("click", async () => {
    if (!window.confirm(`Email the ${p.name} deposit link to ${waiting} people?`)) return;
    send.disabled = true;
    const r = await call("/api/admin/preorders/request", { product: p.id, link: link.value.trim() });
    send.disabled = false;
    if (r.error) return say($("dash-status"), r.error, "error");
    const missed = r.failed.length ? ` Not sent to: ${r.failed.join(", ")}.` : "";
    say($("dash-status"), `Sent to ${r.sent}.${missed}`, missed ? "error" : "ok");
    loadPreorders();
  });
  li.append(link, send);
  return li;
}

function preRow(r, names) {
  const li = el("li", "person panel");
  li.append(el("h3", "", `${names[r.product] || r.product}: ${r.name || r.email}`));
  li.append(el("p", "facts", [r.email, PRE_STATUS[r.status] || r.status, usd(r.price), r.region, r.car,
    r.confirmedAt ? `confirmed ${when(r.confirmedAt)}` : `asked ${when(r.createdAt)}`,
    r.paidAt ? `paid ${when(r.paidAt)}` : ""].filter(Boolean).join(" · ")));
  if (r.notes) li.append(el("p", "notes", r.notes));
  const actions = el("div", "actions");
  const button = (label, status, question) => {
    const b = el("button", "btn btn-small btn-ghost", label);
    b.type = "button";
    b.addEventListener("click", async () => {
      if (question && !window.confirm(question)) return;
      b.disabled = true;
      const x = await call("/api/admin/preorders/mark", { id: r.id, status });
      b.disabled = false;
      if (x.error) return say($("dash-status"), x.error, "error");
      loadPreorders();
    });
    actions.append(b);
  };
  if (r.status === "deposit_requested") button("Deposit paid", "deposit_paid");
  if (r.status !== "cancelled") button("Cancel", "cancelled", `Cancel ${r.email}'s reservation? Refund any deposit in the payment provider yourself.`);
  if (r.status === "cancelled" || r.status === "deposit_paid") button("Back to reserved", "confirmed");
  if (actions.childElementCount) li.append(actions);
  return li;
}

async function loadPreorders() {
  const out = await call("/api/admin/preorders");
  if (out.signedOut || out.error) return;
  const names = Object.fromEntries(out.products.map((p) => [p.id, p.name]));
  $("pre-products").replaceChildren(...out.products.map((p) => preProduct(p, out.preorders)));
  $("preorders").replaceChildren(...(out.preorders.length
    ? out.preorders.map((r) => preRow(r, names))
    : [el("li", "muted", "No reservations yet.")]));
}

// ---- box codes (Nova Light) ---------------------------------------------------------------------

$("code-make").addEventListener("click", async () => {
  const uid = $("code-uid").value.trim().toLowerCase();
  $("code-out").hidden = true;
  if (!/^[0-9a-f]{24}$/.test(uid)) {
    $("code-msg").textContent = "The device ID is 24 hex digits (nova id on the board).";
    return;
  }
  $("code-msg").textContent = "Making it…";
  const out = await call("/api/admin/boxes/code", { uid });
  if (out.signedOut || out.error) {
    $("code-msg").textContent = out.error || "Sign in again.";
    return;
  }
  $("code-msg").textContent = `Code for ${out.uid}: print it now, it isn't shown again.`;
  $("code-out").textContent = out.code;
  $("code-out").hidden = false;
});

// ---- releases -----------------------------------------------------------------------------------

const TARGET_NAME = { supervisor: "Supervisor firmware", card: "Video card firmware", app: "Nova app", android: "Android",
  "nrf-light": "nRF9151 · Nova Light (Light build)", "nrf-nova": "nRF9151 · SuperNova build" };
const mb = (n) => `${(n / 1048576).toFixed(n > 10485760 ? 0 : 1)} MB`;

async function loadReleases() {
  const out = await call("/api/admin/releases");
  if (out.signedOut || out.error) return;
  $("releases").replaceChildren(...(out.releases.length ? out.releases.map((r) => {
    const li = el("li", "person panel");
    const head = el("div", "person-head");
    const who = el("div");
    who.append(el("h3", "", `${TARGET_NAME[r.target] || r.target} ${r.label}`), el("span", "small muted", `${mb(r.size)} · ${r.channel} · ${when(r.created_at)}`));
    head.append(who, el("span", `pill is-${r.retired ? "declined" : "accepted"}`, r.retired ? "Retired" : "Live"));
    li.append(head);
    if (r.notes) li.append(el("p", "notes", r.notes));
    if (!r.retired) {
      const actions = el("div", "actions");
      const b = el("button", "btn btn-small btn-ghost btn-danger", "Retire");
      b.type = "button";
      b.addEventListener("click", async () => {
        if (!confirm(`Stop offering ${TARGET_NAME[r.target]} ${r.label}? Boxes that have it keep it.`)) return;
        const res = await call("/api/admin/releases/retire", { id: r.id });
        if (res.error) return say($("dash-status"), res.error, "error");
        loadReleases();
      });
      actions.append(b);
      li.append(actions);
    }
    return li;
  }) : [el("li", "muted", out.storage ? "No releases yet." : "The RELEASES R2 bucket isn't set up yet.")]));
}

// the two nRF9151 lines: quick picks for the target menu
for (const [id, target] of [["rel-nrf-light", "nrf-light"], ["rel-nrf-nova", "nrf-nova"]]) {
  $(id).addEventListener("click", () => {
    $("rel-target").value = target;
    $("rel-target").dispatchEvent(new Event("change"));
    for (const b of ["rel-nrf-light", "rel-nrf-nova"]) $(b).classList.toggle("btn-primary", b === id);
    $("rel-file").focus();
  });
}

$("rel-target").addEventListener("change", () => {
  const android = $("rel-target").value === "android";
  $("rel-file").hidden = android;
  $("rel-key").hidden = !android;
});

$("rel-send").addEventListener("click", async () => {
  const target = $("rel-target").value;
  const b = $("rel-send");
  const common = { version: $("rel-version").value.trim(), label: $("rel-label").value.trim(), channel: $("rel-channel").value, notes: $("rel-notes").value };
  let out;
  b.disabled = true;
  say($("dash-status"), "Publishing…");
  if (target === "android") {
    out = await call("/api/admin/releases/register", { target, key: $("rel-key").value.trim(), ...common });
  } else {
    const file = $("rel-file").files[0];
    if (!file) { b.disabled = false; return say($("dash-status"), "Choose the file.", "error"); }
    const q = new URLSearchParams({ target, ...common });
    try {
      const res = await fetch(`/api/admin/releases?${q}`, { method: "POST", body: file, credentials: "same-origin",
        headers: { "Content-Type": "application/octet-stream" } });
      out = await res.json().catch(() => ({ error: `Upload failed (${res.status}).` }));
      if (res.status === 401) out = { signedOut: true };
    } catch {
      out = { error: "Couldn't reach the server." };
    }
  }
  b.disabled = false;
  if (out.signedOut) return showSignIn();
  if (out.error) return say($("dash-status"), out.error, "error");
  say($("dash-status"), `Published ${TARGET_NAME[target]} ${out.label || ""}.`, "ok");
  $("rel-file").value = "";
  loadReleases();
});

// ---- developer access (docs: Oceanlive-nova docs/updates.md) --------------------------------------

const ver = (v) => (v ? `${v >>> 24}.${(v >>> 16) & 0xff}.${v & 0xffff}` : "–");
const when = (ms) => (ms ? new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never");
const START_CHECK = ["may start", "no image", "wrong chip", "too big", "bad signature", "no certificate",
  "certificate not owner-signed", "certificate for another box", "chip not covered", "other certificate",
  "", "flash error", "", "revoked", "lease ran out", "bad token"];

async function loadDev() {
  const out = await call("/api/admin/dev");
  if (out.signedOut || out.error) return;
  const keys = [];
  if (!out.ownerKeySet) keys.push("OWNER_PUB isn't set, so certificates can't be registered.");
  if (!out.leaseKeySet) keys.push("LEASE_KEY isn't set, so leases can't be renewed or revoked.");
  $("dev-keys").textContent = keys.join(" ");
  $("dev-n").textContent = String(out.certs.length);
  $("dev-certs").replaceChildren(...(out.certs.length ? out.certs.map(devCard) : [el("li", "muted", "No developer certificates yet.")]));
}

function devCard(c) {
  const li = el("li", "person panel");
  const head = el("div", "person-head");
  const who = el("div");
  who.append(el("h3", "", `${c.holder} · certificate ${c.serial}`), el("span", "small muted", `Box ${c.uid}`));
  head.append(who, el("span", `pill is-${c.status === "active" ? "accepted" : "declined"}`, c.status === "active" ? "Active" : "Revoked"));
  li.append(head);
  const covers = [c.targets & 2 ? "supervisor" : "", c.targets & 4 ? "video card" : ""].filter(Boolean).join(" + ");
  li.append(el("p", "facts", [
    `Covers ${covers || "nothing"}`,
    c.lease ? `lease ${c.lease} starts` : "no lease",
    `registered ${when(c.registered_at)}`,
  ].join(" · ")));
  li.append(el("p", "facts", [
    `Last seen ${when(c.last_seen)}`,
    `${c.checkins_30d ?? 0} check-ins in 30 days (${c.checkins ?? 0} in all)`,
  ].join(" · ")));
  if (c.last_seen) {
    li.append(el("p", "facts", [
      `Running ${c.signer === 1 ? "their firmware" : "your firmware"} ${ver(c.fw_version)}`,
      `${c.dev_builds ?? 0} developer builds seen`,
      `${c.dev_starts ?? 0} developer starts${c.lease ? `, lease to ${c.lease_until}` : ""}`,
      c.app_version ? `Nova app ${c.app_version}` : "",
    ].filter(Boolean).join(" · ")));
  }
  if (c.status === "revoked") li.append(el("p", "small muted", `Revoked ${when(c.revoked_at)}${c.revoke_reason ? `: ${c.revoke_reason}` : ""}`));
  if (c.notes) li.append(el("p", "notes", c.notes));

  const actions = el("div", "actions");
  const log = el("ol", "small dev-log");
  log.hidden = true;
  const b1 = el("button", "btn btn-small btn-ghost", "Check-ins");
  b1.type = "button";
  b1.addEventListener("click", async () => {
    if (!log.hidden) { log.hidden = true; return; }
    const out = await call(`/api/admin/dev/checkins?serial=${c.serial}`);
    if (out.error) return say($("dash-status"), out.error, "error");
    log.replaceChildren(...(out.checkins.length ? out.checkins.map((k) => el("li", "", [
      when(k.at),
      `${k.signer === 1 ? "their" : "your"} firmware ${ver(k.fw_version)}`,
      `${k.dev_starts} starts`,
      `start check: ${START_CHECK[k.start_check] || k.start_check}`,
      k.nova_on_screen ? "Nova on screen" : "factory screen",
      k.token ? `sent ${k.token}` : "",
    ].filter(Boolean).join(" · "))) : [el("li", "muted", "No check-ins yet.")]));
    log.hidden = false;
  });
  actions.append(b1);
  if (c.status === "active") {
    const b2 = el("button", "btn btn-small btn-ghost btn-danger", "Revoke");
    b2.type = "button";
    b2.addEventListener("click", async () => {
      const reason = prompt(`Revoke ${c.holder}'s certificate ${c.serial}? Their box gets the revocation at its next check-in and start. Reason (kept here):`);
      if (reason === null) return;
      const out = await call("/api/admin/dev/revoke", { serial: c.serial, reason });
      if (out.error) return say($("dash-status"), out.error, "error");
      say($("dash-status"), `Certificate ${c.serial} revoked.`, "ok");
      loadDev();
    });
    actions.append(b2);
  }
  li.append(actions, log);
  return li;
}

$("dev-register").addEventListener("click", async () => {
  const out = await call("/api/admin/dev/register", { cert: $("dev-cert").value.replace(/\s+/g, ""), notes: $("dev-notes").value });
  if (out.signedOut) return showSignIn();
  if (out.error) return say($("dash-status"), out.error, "error");
  say($("dash-status"), `Registered certificate ${out.cert.serial} for ${out.cert.holder}.`, "ok");
  $("dev-cert").value = "";
  $("dev-notes").value = "";
  loadDev();
});

async function load() {
  const out = await call("/api/admin/responses?format=json");
  if (out.signedOut) return showSignIn();
  if (out.error) return say($("dash-status"), out.error, "error");
  data = out;
  $("signin").hidden = true;
  $("dash").hidden = false;
  $("sign-out").hidden = false;
  render();
  loadDev();
  loadReleases();
  loadBoxes();
  loadPreorders();
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
