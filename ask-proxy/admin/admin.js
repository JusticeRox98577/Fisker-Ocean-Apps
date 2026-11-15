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
  no_report: "That report no longer exists.",
  no_suggestion: "That suggestion no longer exists.",
  already_reviewed: "Someone already reviewed that suggestion.",
  bad_title: "Write a title of 3 to 200 characters.",
  bad_body: "Write a text of 3 to 4,000 characters.",
  bad_code: "That isn't a fault code (like B208896 or P0A80).",
  no_item: "That note no longer exists.",
  no_feedback: "That feedback no longer exists.",
  bad_description: "Keep the description to 600 characters.",
  bad_status: "Pick planned, in progress or done.",
  too_many: "The roadmap is full (500 items). Delete some first.",
  status_unavailable: "The status page couldn't be reached.",
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
  clearData();
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
  $("tab-admins").hidden = !me.owner;
  $("link-admins").hidden = !me.owner;
  reportsLoaded = false;
  feedbackLoaded = false;
  selectTab(tabFromHash() || "home");
  show("app");
  renderTodo();
  loadStatus();
  loadRoadmap();
  loadUsage();
  loadRecent(false);
  // Also fills the Knowledge and Feedback counts on their tabs.
  loadKnowledge();
  loadFeedback(false);
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

// ── Tabs ─────────────────────────────────────────────────────

const TABS = ["home", "usage", "reports", "knowledge", "feedback", "roadmap", "accounts", "admins"];

function visibleTabs() {
  return TABS.filter((t) => !$(`tab-${t}`).hidden);
}

/** The tab named in the address (#usage, #roadmap, ...), if it's one this admin can see. */
function tabFromHash() {
  const name = location.hash.replace(/^#/, "");
  return TABS.includes(name) && !$(`tab-${name}`).hidden ? name : null;
}

/**
 * Shows one tab. The nav stays at the top of every tab (sticky), and the address keeps the tab (#name), so
 * a reload, the back button and the links on Home all land on the right tab.
 */
function selectTab(name, focusTab) {
  if (!TABS.includes(name) || $(`tab-${name}`).hidden) name = "home";
  for (const t of TABS) {
    const tab = $(`tab-${t}`);
    const on = t === name;
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
    $(`panel-${t}`).hidden = !on;
  }
  if (location.hash !== `#${name}`) history.replaceState(null, "", `#${name}`);
  if (focusTab) $(`tab-${name}`).focus();
  if (name === "reports" && !reportsLoaded) loadReports(false);
  if (name === "feedback" && !feedbackLoaded) loadFeedback(false);
}

// The links on Home (and the back button) change the address: show that tab and move focus to its heading.
window.addEventListener("hashchange", () => {
  if (!me) return;
  const name = tabFromHash();
  if (!name) return;
  selectTab(name);
  const heading = $(`panel-${name}`).querySelector("h1");
  if (heading) heading.focus();
});

for (const t of TABS) {
  const tab = $(`tab-${t}`);
  tab.addEventListener("click", () => selectTab(t));
  tab.addEventListener("keydown", (e) => {
    const list = visibleTabs();
    const i = list.indexOf(t);
    let next = null;
    if (e.key === "ArrowRight") next = list[(i + 1) % list.length];
    else if (e.key === "ArrowLeft") next = list[(i - 1 + list.length) % list.length];
    else if (e.key === "Home") next = list[0];
    else if (e.key === "End") next = list[list.length - 1];
    if (!next) return;
    e.preventDefault();
    selectTab(next, true);
  });
}

// ── Usage ────────────────────────────────────────────────────

const LANGS = { en: "English", de: "German", fr: "French", es: "Spanish", nl: "Dutch", it: "Italian", pt: "Portuguese", sv: "Swedish", da: "Danish", nb: "Norwegian", no: "Norwegian", fi: "Finnish", pl: "Polish" };

/** US dollars from micros (US dollars x 1,000,000). Small amounts keep more digits. */
function usd(micros, digits = 2) {
  return `$${(micros / 1e6).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function num(n) {
  return Number(n || 0).toLocaleString("en-US");
}

function pct(part, total) {
  return total > 0 ? `${Math.round((part / total) * 100)}%` : "0%";
}

function langName(code) {
  if (!code) return "Not sent";
  return LANGS[code] ? `${LANGS[code]} (${code})` : code;
}

function card(label, value, sub, extra) {
  const li = document.createElement("li");
  const l = document.createElement("span");
  l.className = "label";
  l.textContent = label;
  const v = document.createElement("span");
  v.className = "value";
  v.textContent = value;
  li.append(l, v);
  if (sub) {
    const s = document.createElement("span");
    s.className = "sub";
    s.textContent = sub;
    li.appendChild(s);
  }
  if (extra) li.appendChild(extra);
  return li;
}

function renderCards(u) {
  const cards = $("cards");
  cards.replaceChildren();
  const spent = u.spend.monthMicros;
  const cap = u.spend.capMicros;
  const share = cap > 0 ? Math.min(1, spent / cap) : 0;
  const meter = document.createElement("div");
  meter.className = share >= 0.8 ? "meter high" : "meter";
  meter.setAttribute("aria-hidden", "true");
  const fill = document.createElement("span");
  meter.appendChild(fill);
  // The width is set through CSSOM (allowed by the page's CSP, unlike a style attribute).
  fill.style.width = `${Math.round(share * 100)}%`;

  cards.append(
    card("Questions today", num(u.questions.today), `${num(u.questions.month)} this month`),
    card("AI cost today", usd(u.costMicros.today), `${usd(u.costMicros.month)} this month`),
    card("Spend this month", usd(spent), `of the ${usd(cap)} monthly cap (${pct(spent, cap)})`, meter),
    card("Accounts", num(u.accounts.total), `${num(u.accounts.newLast7Days)} new in the last 7 days`),
    card("Paid questions today", num(u.paid.today.questions), paidSub(u.paid.today)),
    card("Paid questions this month", num(u.paid.month.questions), paidSub(u.paid.month)),
    card("Outstanding balances", dollars(u.balances.totalCents), `across ${num(u.balances.accounts)} accounts`),
    card("Store rewards claimed", num(u.rewards.play + u.rewards.apple), `Google Play ${num(u.rewards.play)} · App Store ${num(u.rewards.apple)}`),
  );
  const reportsCard = card("Open reports", num(u.openReports), u.openReports ? "" : "Nothing to look at");
  if (u.openReports) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-ghost";
    b.textContent = "See reports";
    b.addEventListener("click", () => selectTab("reports", true));
    reportsCard.appendChild(b);
  }
  cards.appendChild(reportsCard);
  // The count is read with the tab name ("Reports 3 open"): the " open" is visually hidden in the page.
  $("reports-badge").hidden = !u.openReports;
  $("reports-count").textContent = String(u.openReports);
  setCount("reports", u.openReports);
}

/** "$0.12 charged", plus the charges that never settled (shown as free under Recent questions). */
function paidSub(p) {
  const base = `${dollars(p.cents)} charged`;
  return p.unsettled ? `${base}, ${num(p.unsettled)} never settled (shown as free below)` : base;
}

/** 1, 2, 5 x 10^n at or above v (at least 1). */
function niceMax(v) {
  if (v <= 1) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

const SVG = "http://www.w3.org/2000/svg";
function svgEl(name, attrs, text) {
  const el = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

/**
 * A bar chart of one value per day, drawn as inline SVG. The table under the charts has the same numbers.
 * It's drawn at the container's own width (one SVG unit = one CSS pixel), so the 11px labels stay 11px
 * on a phone; the charts are redrawn when their width changes. `minMax`: the smallest top of the scale.
 */
function barChart(container, days, value, format, cls, what, minMax = 1) {
  const W = Math.max(240, Math.round(container.clientWidth || 600));
  const H = 170;
  const left = 60;
  const right = 6;
  const top = 10;
  const bottom = 24;
  const values = days.map(value);
  const max = niceMax(Math.max(minMax, ...values));
  const total = values.reduce((a, b) => a + b, 0);
  const peak = values.indexOf(Math.max(...values));
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", focusable: "false" });
  const label = `${what} per day, last ${days.length} days: ${format(total)} in total, highest ${format(values[peak] || 0)} on ${days[peak] ? days[peak].day : "-"}.`;
  svg.setAttribute("aria-label", label);
  svg.appendChild(svgEl("title", {}, label));
  const plotH = H - top - bottom;
  for (const f of [0, 0.5, 1]) {
    const y = top + plotH - plotH * f;
    svg.appendChild(svgEl("line", { class: "gridline", x1: left, x2: W - right, y1: y, y2: y }));
    svg.appendChild(svgEl("text", { x: left - 6, y: y + 4, "text-anchor": "end" }, format(max * f)));
  }
  const step = (W - left - right) / days.length;
  days.forEach((d, i) => {
    const v = values[i];
    const h = v > 0 ? Math.max(1, (v / max) * plotH) : 0;
    const bar = svgEl("rect", { class: `bar ${cls}`, x: left + i * step + 1, y: top + plotH - h, width: Math.max(1, step - 2), height: h });
    bar.appendChild(svgEl("title", {}, `${d.day}: ${format(v)}`));
    svg.appendChild(bar);
  });
  const first = days[0];
  const last = days[days.length - 1];
  if (first && last) {
    svg.appendChild(svgEl("text", { x: left, y: H - 6, "text-anchor": "start" }, first.day.slice(5)));
    svg.appendChild(svgEl("text", { x: W - right, y: H - 6, "text-anchor": "end" }, `${last.day.slice(5)} (today)`));
  }
  container.replaceChildren(svg);
}

/** The cost axis: under $1 the steps are fractions of a cent, so they get 4 decimals ($0.0250, not $0.03). */
function costAxis(maxMicros) {
  const digits = niceMax(Math.max(COST_MIN_MAX, maxMicros)) < 1e6 ? 4 : 2;
  return (v) => usd(v, digits);
}
// The smallest top of each scale, so a quiet month still has exact labels (0, 1, 2 and $0.0000 to $0.0100).
const COST_MIN_MAX = 10_000;
const QUESTIONS_MIN_MAX = 2;

let lastDays = null;

function drawCharts() {
  if (!lastDays) return;
  const days = lastDays;
  barChart($("chart-questions"), days, (d) => d.questions, (v) => (Number.isInteger(v) ? num(v) : v.toFixed(1)), "", "Questions", QUESTIONS_MIN_MAX);
  const cost = costAxis(Math.max(0, ...days.map((d) => d.costMicros)));
  barChart($("chart-cost"), days, (d) => d.costMicros, cost, "cost", "AI cost", COST_MIN_MAX);
}

// Redraw at the new width (also when the Usage tab is shown again after being hidden).
let chartWidth = 0;
if (typeof ResizeObserver === "function") {
  new ResizeObserver((entries) => {
    // 0 while the Usage tab is hidden (a chart drawn then falls back to 600 wide): redraw once shown.
    const w = Math.round(entries[0].contentRect.width);
    if (w === chartWidth) return;
    chartWidth = w;
    if (w > 0) drawCharts();
  }).observe($("chart-questions"));
}

function renderChart(u) {
  lastDays = u.days;
  drawCharts();
  const body = $("days-table");
  body.replaceChildren();
  for (const d of [...u.days].reverse()) {
    const tr = document.createElement("tr");
    cell(tr, d.day);
    cell(tr, num(d.questions), "num");
    cell(tr, usd(d.costMicros, 4), "num");
    body.appendChild(tr);
  }
}

function renderSplit(u) {
  // Shares of all questions in the 30 days (the server lists the 20 most used languages only).
  const total = u.signedIn.signedIn + u.signedIn.anonymous;
  const langs = $("lang-table");
  langs.replaceChildren();
  for (const l of u.languages) {
    const tr = document.createElement("tr");
    cell(tr, langName(l.lang));
    cell(tr, num(l.questions), "num");
    cell(tr, pct(l.questions, total), "num");
    langs.appendChild(tr);
  }
  if (!u.languages.length) {
    const tr = document.createElement("tr");
    cell(tr, "No questions yet.");
    tr.firstChild.colSpan = 3;
    langs.appendChild(tr);
  }
  const signed = $("signed-table");
  signed.replaceChildren();
  const all = u.signedIn.signedIn + u.signedIn.anonymous;
  for (const [name, n] of [["Signed in", u.signedIn.signedIn], ["Without an account", u.signedIn.anonymous]]) {
    const tr = document.createElement("tr");
    cell(tr, name);
    cell(tr, num(n), "num");
    cell(tr, pct(n, all), "num");
    signed.appendChild(tr);
  }
}

async function loadUsage() {
  $("usage-error").textContent = "";
  const r = await api("/admin/usage");
  if (signedOut(r)) return;
  if (!r.ok) {
    $("usage-error").textContent = message(r.data.error);
    return;
  }
  const u = r.data;
  $("usage-when").textContent = `Days and months are UTC. Updated ${when(u.generated)} UTC.`;
  renderCards(u);
  renderChart(u);
  renderSplit(u);
}

function text(cls, value) {
  const p = document.createElement("p");
  p.className = cls;
  p.textContent = value;
  return p;
}

function meta(parts) {
  const div = document.createElement("div");
  div.className = "qmeta";
  for (const p of parts) {
    if (!p) continue;
    if (typeof p === "string") {
      const s = document.createElement("span");
      s.textContent = p;
      div.appendChild(s);
    } else div.appendChild(p);
  }
  return div;
}

function pill(cls, value) {
  const s = document.createElement("span");
  s.className = `pill ${cls}`;
  s.textContent = value;
  return s;
}

function expandable(summaryText, body) {
  const d = document.createElement("details");
  const s = document.createElement("summary");
  s.textContent = summaryText;
  d.append(s, ...body);
  return d;
}

function answerBlock(answer) {
  return answer ? text("qanswer", answer) : text("qanswer muted", "No answer (Claude declined).");
}

let recentNext = null;
// Bumped by every load; an answer to an older load (e.g. "Show older" when Refresh was pressed) is dropped.
let recentGen = 0;

function questionItem(q) {
  const li = document.createElement("li");
  li.appendChild(
    meta([
      `${when(q.ts)} UTC`,
      langName(q.lang ? q.lang.slice(0, 2).toLowerCase() : ""),
      `AI cost ${usd(q.costMicros, 4)}`,
      q.paid ? pill("paid", `Paid ${dollars(q.chargedCents || 0)}`) : pill("", "Free"),
    ]),
  );
  li.appendChild(text("qtext", q.question));
  const body = [answerBlock(q.answer)];
  if (q.car) body.push(expandable("Car readings sent with it", [text("qtext mono small", q.car)]));
  li.appendChild(expandable("Answer", body));
  return li;
}

/** Loads the newest page, or with `more` the next older one. Returns the first item it added. */
async function loadRecent(more) {
  if (more && !recentNext) return null;
  const gen = ++recentGen;
  $("recent-error").textContent = "";
  // While the newest page reloads, "Show older" would page from the old cursor.
  if (!more) $("recent-more").disabled = true;
  const r = await api(`/admin/usage/questions${more ? `?before=${recentNext}` : ""}`);
  if (gen !== recentGen) return null;
  if (!more) $("recent-more").disabled = false;
  if (signedOut(r)) return null;
  if (!r.ok) {
    $("recent-error").textContent = message(r.data.error);
    return null;
  }
  const list = $("recent");
  if (!more) list.replaceChildren();
  let first = null;
  for (const q of r.data.questions || []) {
    const li = questionItem(q);
    first = first || li;
    list.appendChild(li);
  }
  if (!list.children.length) list.appendChild(text("muted", "No questions logged yet."));
  recentNext = r.data.next;
  $("recent-more").hidden = !recentNext;
  return first;
}

/** After "Show older" hid itself (the last page), focus moves to the first item it added, not to the page top. */
function focusAfterMore(button, first, list) {
  if (!button.hidden) return;
  const target = first || list;
  target.tabIndex = -1;
  target.focus();
}

$("recent-more").addEventListener("click", async (e) => {
  const button = e.currentTarget;
  busy(button, true);
  const first = await loadRecent(true);
  busy(button, false);
  focusAfterMore(button, first, $("recent"));
});

$("usage-refresh").addEventListener("click", async (e) => {
  busy(e.target, true);
  await Promise.all([loadUsage(), loadRecent(false)]);
  busy(e.target, false);
  say("Usage updated.");
});

// ── Reports ──────────────────────────────────────────────────

const REASONS = { offensive: "Offensive", harmful: "Harmful", wrong: "Wrong", other: "Other" };
let reportsNext = null;
let reportsLoaded = false;
let reportsGen = 0;

function reportStatus() {
  const checked = document.querySelector('input[name="rstatus"]:checked');
  return checked ? checked.value : "open";
}

function reportItem(rep) {
  const li = document.createElement("li");
  const resolved = document.createElement("span");
  resolved.textContent = rep.resolvedAt ? `Resolved by ${rep.resolvedBy || "an admin"} on ${when(rep.resolvedAt)} UTC` : "Open";
  li.appendChild(meta([`Reported ${when(rep.created)} UTC`, pill("reason", REASONS[rep.reason] || rep.reason), resolved]));
  if (rep.note) li.appendChild(text("qtext", `Note: ${rep.note}`));
  if (rep.question === null || rep.question === undefined) {
    li.appendChild(text("muted small", "The question is no longer in the log."));
  } else {
    li.appendChild(text("small muted", `Question asked ${when(rep.questionTs)} UTC · ${langName(rep.lang ? rep.lang.slice(0, 2).toLowerCase() : "")}`));
    li.appendChild(text("qtext", rep.question));
    li.appendChild(expandable("Answer", [answerBlock(rep.answer)]));
  }
  if (!rep.resolvedAt) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-ghost";
    b.textContent = "Resolve…";
    b.setAttribute("aria-label", `Resolve the report from ${when(rep.created)}`);
    b.addEventListener("click", () => resolve(rep, b, resolved));
    const row = document.createElement("div");
    row.className = "row";
    row.appendChild(b);
    li.appendChild(row);
  }
  return li;
}

/** Like loadRecent: the newest page, or with `more` the next older one; a stale answer is dropped. */
async function loadReports(more) {
  if (more && !reportsNext) return null;
  reportsLoaded = true;
  const gen = ++reportsGen;
  $("reports-error").textContent = "";
  const params = new URLSearchParams({ status: reportStatus() });
  if (more) params.set("before", String(reportsNext));
  if (!more) $("reports-more").disabled = true;
  const r = await api(`/admin/reports?${params}`);
  if (gen !== reportsGen) return null;
  if (!more) $("reports-more").disabled = false;
  if (signedOut(r)) return null;
  if (!r.ok) {
    $("reports-error").textContent = message(r.data.error);
    return null;
  }
  const list = $("reports");
  if (!more) list.replaceChildren();
  let first = null;
  for (const rep of r.data.reports || []) {
    const li = reportItem(rep);
    first = first || li;
    list.appendChild(li);
  }
  if (!list.children.length) list.appendChild(text("muted", reportStatus() === "open" ? "No open reports." : "No reports."));
  reportsNext = r.data.next;
  $("reports-more").hidden = !reportsNext;
  return first;
}

async function resolve(rep, button, statusEl) {
  const ok = await confirmDialog("Resolve this report?", "Mark it as dealt with. Your email is recorded with it and in the admin log.", "Resolve");
  if (!ok) return;
  busy(button, true);
  const r = await api("/admin/reports/resolve", "POST", { id: rep.id });
  busy(button, false);
  if (signedOut(r)) return;
  if (!r.ok) {
    $("reports-error").textContent = message(r.data.error);
    return;
  }
  statusEl.textContent = `Resolved by ${r.data.resolvedBy} on ${when(r.data.resolvedAt)} UTC`;
  // The focused button goes away: keep focus on the report, at its new status.
  statusEl.tabIndex = -1;
  statusEl.focus();
  button.parentElement.remove();
  say(r.data.alreadyResolved ? "That report was already resolved." : "Report resolved.");
  loadUsage();
  if (me.owner) loadLog();
}

for (const input of document.querySelectorAll('input[name="rstatus"]')) input.addEventListener("change", () => loadReports(false));
$("reports-more").addEventListener("click", async (e) => {
  const button = e.currentTarget;
  busy(button, true);
  const first = await loadReports(true);
  busy(button, false);
  focusAfterMore(button, first, $("reports"));
});

// ── Knowledge ────────────────────────────────────────────────
//
// Everything owners sent is shown with textContent and form values only, never as HTML.

const KINDS = { fault_code: "Fault code", fix_tip: "Fix or tip", car_fact: "Car fact" };
let knowledgeGen = 0;

function field(labelText, input) {
  const wrap = document.createElement("div");
  wrap.className = "kform";
  const label = document.createElement("label");
  label.htmlFor = input.id;
  label.textContent = labelText;
  wrap.append(label, input);
  return wrap;
}

/** The title / kind / code / text fields for a note. `prefix` keeps the element IDs unique. */
function noteFields(prefix, values, withKind) {
  const title = document.createElement("input");
  title.type = "text";
  title.id = `${prefix}-title`;
  title.maxLength = 200;
  title.autocomplete = "off";
  title.value = values.title || "";
  const body = document.createElement("textarea");
  body.id = `${prefix}-body`;
  body.maxLength = 4000;
  body.value = values.body || "";
  const code = document.createElement("input");
  code.type = "text";
  code.id = `${prefix}-code`;
  code.maxLength = 7;
  code.autocomplete = "off";
  code.spellcheck = false;
  code.value = values.code || "";
  const codeField = field("Fault code (optional, like B208896)", code);
  const parts = [field("Title (3 to 200 characters)", title)];
  let kind = null;
  if (withKind) {
    kind = document.createElement("select");
    kind.id = `${prefix}-kind`;
    for (const [value, name] of Object.entries(KINDS)) {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = name;
      kind.appendChild(o);
    }
    kind.value = values.kind in KINDS ? values.kind : "fix_tip";
    parts.push(field("Kind", kind));
  }
  const showCode = () => { codeField.hidden = (kind ? kind.value : values.kind) !== "fault_code"; };
  if (kind) kind.addEventListener("change", showCode);
  showCode();
  parts.push(codeField, field("Text used in answers (3 to 4,000 characters)", body));
  return {
    parts,
    read: () => ({
      title: title.value.trim(),
      body: body.value.trim(),
      code: codeField.hidden ? "" : code.value.trim().toUpperCase(),
      ...(kind ? { kind: kind.value } : {}),
    }),
    focus: () => title.focus(),
  };
}

function checkNote(v) {
  if (v.title.length < 3 || v.title.length > 200) return "bad_title";
  if (v.body.length < 3 || v.body.length > 4000) return "bad_body";
  if (v.code && !/^[PCBU][0-9A-F]{4}([0-9A-F]{2})?$/.test(v.code)) return "bad_code";
  return null;
}

function pendingItem(sug) {
  const li = document.createElement("li");
  li.appendChild(meta([`Sent ${when(sug.created)} UTC`, pill("", KINDS[sug.kind] || sug.kind), sug.code ? `Code ${sug.code}` : ""]));
  li.appendChild(text("qtext", sug.summary));
  if (sug.details) li.appendChild(text("qtext small", sug.details));
  if (sug.question) li.appendChild(expandable("The owner's message in the chat", [text("small muted", `Asked ${when(sug.questionTs)} UTC`), text("qtext", sug.question)]));
  const f = noteFields(`s${sug.id}`, { title: sug.summary, body: sug.details || sug.summary, code: sug.code, kind: sug.kind }, true);
  const err = document.createElement("p");
  err.className = "field-error";
  err.setAttribute("role", "alert");
  const approveBtn = document.createElement("button");
  approveBtn.type = "button";
  approveBtn.className = "btn btn-primary";
  approveBtn.textContent = "Approve…";
  approveBtn.setAttribute("aria-label", `Approve the suggestion sent ${when(sug.created)}`);
  const rejectBtn = document.createElement("button");
  rejectBtn.type = "button";
  rejectBtn.className = "btn btn-danger";
  rejectBtn.textContent = "Reject…";
  rejectBtn.setAttribute("aria-label", `Reject the suggestion sent ${when(sug.created)}`);
  const row = document.createElement("div");
  row.className = "row";
  row.append(approveBtn, rejectBtn);
  li.appendChild(expandable("Review", [...f.parts, err, row]));

  approveBtn.addEventListener("click", async () => {
    err.textContent = "";
    const v = f.read();
    const bad = checkNote(v);
    if (bad) {
      err.textContent = message(bad);
      return;
    }
    const ok = await confirmDialog("Approve this note?", `"${v.title}" will be used in every "Any questions?" answer from now on, for everyone. You can edit or retire it later.`, "Approve");
    if (!ok) return;
    busy(approveBtn, true);
    const r = await api("/admin/knowledge/approve", "POST", { id: sug.id, ...v });
    busy(approveBtn, false);
    if (signedOut(r)) return;
    if (!r.ok) {
      err.textContent = message(r.data.error);
      return;
    }
    say("Approved. It's used in answers now.");
    await loadKnowledge();
    $("knowledge-title").focus();
    if (me.owner) loadLog();
  });
  rejectBtn.addEventListener("click", async () => {
    err.textContent = "";
    const ok = await confirmDialog("Reject this suggestion?", "It won't be used in answers. It is deleted later with the question log.", "Reject");
    if (!ok) return;
    busy(rejectBtn, true);
    const r = await api("/admin/knowledge/reject", "POST", { id: sug.id });
    busy(rejectBtn, false);
    if (signedOut(r)) return;
    if (!r.ok) {
      err.textContent = message(r.data.error);
      return;
    }
    say("Suggestion rejected.");
    await loadKnowledge();
    $("knowledge-title").focus();
    if (me.owner) loadLog();
  });
  return li;
}

function approvedItem(item) {
  const li = document.createElement("li");
  li.appendChild(
    meta([
      pill(item.retired ? "retired" : "", item.retired ? "Retired" : "In use"),
      KINDS[item.kind] || item.kind,
      item.code ? `Code ${item.code}` : "",
      `Approved by ${item.approvedBy} on ${when(item.created)} UTC`,
      item.updated ? `Changed ${when(item.updated)} UTC` : "",
    ]),
  );
  const heading = text("qtext", item.title);
  heading.tabIndex = -1;
  li.appendChild(heading);
  li.appendChild(text("qtext small", item.body));
  const f = noteFields(`i${item.id}`, item, false);
  const err = document.createElement("p");
  err.className = "field-error";
  err.setAttribute("role", "alert");
  const save = document.createElement("button");
  save.type = "button";
  save.className = "btn btn-primary";
  save.textContent = "Save changes…";
  li.appendChild(expandable("Edit", [...f.parts, save]));
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = item.retired ? "btn btn-ghost" : "btn btn-danger";
  toggle.textContent = item.retired ? "Use again…" : "Retire…";
  toggle.setAttribute("aria-label", `${item.retired ? "Use again" : "Retire"}: ${item.title}`);
  const row = document.createElement("div");
  row.className = "row";
  row.appendChild(toggle);
  li.append(err, row);

  save.addEventListener("click", async () => {
    err.textContent = "";
    const v = f.read();
    const bad = checkNote(v);
    if (bad) {
      err.textContent = message(bad);
      return;
    }
    const ok = await confirmDialog("Save this note?", item.retired ? "The note stays retired." : "Answers use the new text from now on.", "Save");
    if (!ok) return;
    busy(save, true);
    const r = await api("/admin/knowledge/edit", "POST", { id: item.id, ...v });
    busy(save, false);
    if (signedOut(r)) return;
    if (!r.ok) {
      err.textContent = message(r.data.error);
      return;
    }
    say("Note saved.");
    await loadKnowledge();
    $("items-title").focus();
    if (me.owner) loadLog();
  });
  toggle.addEventListener("click", async () => {
    err.textContent = "";
    const retire = !item.retired;
    const ok = await confirmDialog(
      retire ? "Retire this note?" : "Use this note again?",
      retire ? `"${item.title}" won't be used in answers any more. You can use it again later.` : `"${item.title}" will be used in every answer again.`,
      retire ? "Retire" : "Use again",
    );
    if (!ok) return;
    busy(toggle, true);
    const r = await api("/admin/knowledge/retire", "POST", { id: item.id, retired: retire });
    busy(toggle, false);
    if (signedOut(r)) return;
    if (!r.ok) {
      err.textContent = message(r.data.error);
      return;
    }
    say(retire ? "Note retired." : "Note is used again.");
    await loadKnowledge();
    $("items-title").focus();
    if (me.owner) loadLog();
  });
  return li;
}

async function loadKnowledge() {
  const gen = ++knowledgeGen;
  $("knowledge-error").textContent = "";
  const r = await api("/admin/knowledge");
  if (gen !== knowledgeGen) return;
  if (signedOut(r)) return;
  if (!r.ok) {
    $("knowledge-error").textContent = message(r.data.error);
    return;
  }
  const pending = $("pending");
  pending.replaceChildren(...(r.data.pending || []).map(pendingItem));
  if (!pending.children.length) pending.appendChild(text("muted", "Nothing to review."));
  const items = $("items");
  items.replaceChildren(...(r.data.items || []).map(approvedItem));
  if (!items.children.length) items.appendChild(text("muted", "No approved notes yet."));
  const n = r.data.pendingCount || 0;
  $("knowledge-badge").hidden = !n;
  $("knowledge-count").textContent = String(n);
  setCount("knowledge", n);
}

$("knowledge-refresh").addEventListener("click", async (e) => {
  busy(e.target, true);
  await loadKnowledge();
  busy(e.target, false);
  say("Knowledge updated.");
});

// ── Feedback ─────────────────────────────────────────────────

let feedbackNext = null;
let feedbackLoaded = false;
let feedbackGen = 0;

function feedbackStatus() {
  const checked = document.querySelector('input[name="fstatus"]:checked');
  return checked ? checked.value : "open";
}

function feedbackItem(fb) {
  const li = document.createElement("li");
  const state = document.createElement("span");
  state.textContent = fb.status === "done" ? `Done by ${fb.handledBy || "an admin"} on ${when(fb.handledAt)} UTC` : "Open";
  li.appendChild(meta([`Sent ${when(fb.created)} UTC`, state]));
  li.appendChild(text("qtext", fb.summary));
  if (fb.details) li.appendChild(text("qtext small", fb.details));
  if (fb.question) li.appendChild(expandable("The owner's message in the chat", [text("small muted", `Asked ${when(fb.questionTs)} UTC`), text("qtext", fb.question)]));
  if (fb.status !== "done") {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-ghost";
    b.textContent = "Mark done…";
    b.setAttribute("aria-label", `Mark the feedback from ${when(fb.created)} done`);
    b.addEventListener("click", () => feedbackDone(fb, b, state));
    const row = document.createElement("div");
    row.className = "row";
    row.appendChild(b);
    li.appendChild(row);
  }
  li.appendChild(promoteForm(fb));
  return li;
}

async function loadFeedback(more) {
  if (more && !feedbackNext) return null;
  feedbackLoaded = true;
  const gen = ++feedbackGen;
  $("feedback-error").textContent = "";
  const params = new URLSearchParams({ status: feedbackStatus() });
  if (more) params.set("before", String(feedbackNext));
  if (!more) $("feedback-more").disabled = true;
  const r = await api(`/admin/feedback?${params}`);
  if (gen !== feedbackGen) return null;
  if (!more) $("feedback-more").disabled = false;
  if (signedOut(r)) return null;
  if (!r.ok) {
    $("feedback-error").textContent = message(r.data.error);
    return null;
  }
  const list = $("feedback");
  if (!more) list.replaceChildren();
  let first = null;
  for (const fb of r.data.feedback || []) {
    const li = feedbackItem(fb);
    first = first || li;
    list.appendChild(li);
  }
  if (!list.children.length) list.appendChild(text("muted", feedbackStatus() === "open" ? "No open feedback." : "No feedback yet."));
  feedbackNext = r.data.next;
  $("feedback-more").hidden = !feedbackNext;
  const n = r.data.openCount || 0;
  $("feedback-badge").hidden = !n;
  $("feedback-count").textContent = String(n);
  setCount("feedback", n);
  return first;
}

async function feedbackDone(fb, button, stateEl) {
  const ok = await confirmDialog("Mark this feedback done?", "Your email is recorded with it and in the admin log.", "Mark done");
  if (!ok) return;
  busy(button, true);
  const r = await api("/admin/feedback/done", "POST", { id: fb.id });
  busy(button, false);
  if (signedOut(r)) return;
  if (!r.ok) {
    $("feedback-error").textContent = message(r.data.error);
    return;
  }
  stateEl.textContent = `Done by ${r.data.handledBy} on ${when(r.data.handledAt)} UTC`;
  stateEl.tabIndex = -1;
  stateEl.focus();
  button.parentElement.remove();
  say(r.data.alreadyDone ? "That feedback was already done." : "Feedback marked done.");
  const count = Math.max(0, (parseInt($("feedback-count").textContent, 10) || 0) - (r.data.alreadyDone ? 0 : 1));
  $("feedback-count").textContent = String(count);
  $("feedback-badge").hidden = !count;
  setCount("feedback", count);
  if (me.owner) loadLog();
}

for (const input of document.querySelectorAll('input[name="fstatus"]')) input.addEventListener("change", () => loadFeedback(false));
$("feedback-more").addEventListener("click", async (e) => {
  const button = e.currentTarget;
  busy(button, true);
  const first = await loadFeedback(true);
  busy(button, false);
  focusAfterMore(button, first, $("feedback"));
});

// ── Home ─────────────────────────────────────────────────────

/** Open reports, suggestions to review, open feedback and roadmap items; null until loaded. */
const counts = { reports: null, knowledge: null, feedback: null, roadmap: null };

function setCount(name, n) {
  counts[name] = n;
  renderTodo();
}

const TODO = [
  ["reports", "Open reports", (n) => (n ? "Answers people reported" : "Nothing reported"), "See reports"],
  ["knowledge", "Knowledge to review", (n) => (n ? "Not used until approved" : "Nothing waiting"), "Review"],
  ["feedback", "Open feedback", (n) => (n ? "From the chat" : "All dealt with"), "See feedback"],
  ["roadmap", "Roadmap items", () => "Public on oceanlive.org/roadmap", "Edit roadmap"],
];

function renderTodo() {
  const list = $("todo");
  list.replaceChildren();
  for (const [name, label, sub, action] of TODO) {
    const n = counts[name];
    const li = card(label, n === null ? "…" : num(n), n === null ? "" : sub(n));
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-ghost";
    b.textContent = action;
    b.addEventListener("click", () => {
      selectTab(name);
      $(`panel-${name}`).querySelector("h1").focus();
    });
    li.appendChild(b);
    list.appendChild(li);
  }
}

const STATE_TEXT = { up: "Up", down: "Down", unknown: "Not known" };
const OVERALL_TEXT = {
  up: "Everything is up.",
  partial: "Something is down.",
  down: "Everything is down.",
  unknown: "Status not known right now.",
};
let statusGen = 0;

async function loadStatus() {
  const gen = ++statusGen;
  const r = await api("/admin/status");
  if (gen !== statusGen) return;
  if (signedOut(r)) return;
  const services = $("live-services");
  services.replaceChildren();
  if (!r.ok || !r.data.ok) {
    $("live-overall").className = "live unknown";
    $("live-text").textContent = message(r.data.error || "status_unavailable");
    $("live-when").textContent = "";
    return;
  }
  const st = r.data;
  $("live-overall").className = `live ${st.overall}`;
  $("live-text").textContent = OVERALL_TEXT[st.overall] || OVERALL_TEXT.unknown;
  for (const svc of st.services || []) {
    const li = document.createElement("li");
    li.className = `svc ${svc.state}`;
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.textContent = `${svc.name}: ${STATE_TEXT[svc.state] || svc.state}`;
    li.append(dot, name);
    const extra = [svc.latencyMs !== null ? `${num(svc.latencyMs)} ms` : "", svc.uptime24h !== null ? `${(svc.uptime24h * 100).toFixed(1)}% up in 24 h` : ""].filter(Boolean).join(" · ");
    if (extra) {
      const s = document.createElement("span");
      s.className = "small muted";
      s.textContent = extra;
      li.appendChild(s);
    }
    services.appendChild(li);
  }
  const parts = [];
  if (st.checkedAt) parts.push(`Last checked ${when(st.checkedAt)} UTC.`);
  if (st.stale) parts.push("The checks are late, so this may be out of date.");
  if (st.notice) parts.push(st.notice);
  $("live-when").textContent = parts.join(" ");
}

$("home-refresh").addEventListener("click", async (e) => {
  busy(e.target, true);
  await Promise.all([loadStatus(), loadUsage(), loadKnowledge(), loadFeedback(false), loadRoadmap()]);
  busy(e.target, false);
  say("Home updated.");
});

// ── Roadmap ──────────────────────────────────────────────────
//
// Titles and descriptions are shown with textContent and form values only, never as HTML.

const STATUSES = { planned: "Planned", in_progress: "In progress", done: "Done" };
let roadmapItems = [];
let roadmapGen = 0;

/** Title, description and status fields. `prefix` keeps the element IDs unique. */
function roadmapFields(prefix, values) {
  const title = document.createElement("input");
  title.type = "text";
  title.id = `${prefix}-title`;
  title.maxLength = 120;
  title.autocomplete = "off";
  title.value = values.title || "";
  const description = document.createElement("textarea");
  description.id = `${prefix}-description`;
  description.maxLength = 600;
  description.value = values.description || "";
  const status = document.createElement("select");
  status.id = `${prefix}-status`;
  for (const [value, name] of Object.entries(STATUSES)) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = name;
    status.appendChild(o);
  }
  status.value = values.status in STATUSES ? values.status : "planned";
  return {
    parts: [field("Title (3 to 120 characters, shown publicly)", title), field("Description (optional, up to 600 characters, shown publicly)", description), field("Status", status)],
    read: () => ({ title: title.value.trim(), description: description.value.trim(), status: status.value }),
    clear: () => {
      title.value = "";
      description.value = "";
      status.value = "planned";
    },
    focus: () => title.focus(),
  };
}

function checkRoadmap(v) {
  if (v.title.length < 3 || v.title.length > 120) return "bad_title";
  if (v.description.length > 600) return "bad_description";
  return null;
}

const ROADMAP_TITLE = "Write a title of 3 to 120 characters.";

function roadmapError(code) {
  return code === "bad_title" ? ROADMAP_TITLE : message(code);
}

function roadmapItem(item, index) {
  const li = document.createElement("li");
  li.appendChild(
    meta([
      pill(item.status === "done" ? "retired" : item.status === "in_progress" ? "paid" : "", STATUSES[item.status] || item.status),
      `${num(item.votes)} ${item.votes === 1 ? "vote" : "votes"}`,
      `Added by ${item.createdBy} on ${when(item.created).slice(0, 10)}`,
      item.updated && item.updated !== item.created ? `Changed ${when(item.updated)} UTC` : "",
      item.feedbackId ? "From feedback" : "",
    ]),
  );
  const heading = text("qtext", item.title);
  heading.classList.add("strong");
  heading.tabIndex = -1;
  li.appendChild(heading);
  if (item.description) li.appendChild(text("qtext small", item.description));

  const f = roadmapFields(`r${item.id}`, item);
  const err = document.createElement("p");
  err.className = "field-error";
  err.setAttribute("role", "alert");
  const save = document.createElement("button");
  save.type = "button";
  save.className = "btn btn-primary";
  save.textContent = "Save changes…";
  li.appendChild(expandable("Edit", [...f.parts, save]));

  const row = document.createElement("div");
  row.className = "row";
  const up = document.createElement("button");
  up.type = "button";
  up.className = "btn btn-ghost";
  up.textContent = "Move up";
  up.disabled = index === 0;
  up.setAttribute("aria-label", `Move up: ${item.title}`);
  const down = document.createElement("button");
  down.type = "button";
  down.className = "btn btn-ghost";
  down.textContent = "Move down";
  down.disabled = index === roadmapItems.length - 1;
  down.setAttribute("aria-label", `Move down: ${item.title}`);
  const del = document.createElement("button");
  del.type = "button";
  del.className = "btn btn-danger";
  del.textContent = "Delete…";
  del.setAttribute("aria-label", `Delete: ${item.title}`);
  row.append(up, down, del);
  li.append(err, row);

  save.addEventListener("click", async () => {
    err.textContent = "";
    const v = f.read();
    const bad = checkRoadmap(v);
    if (bad) {
      err.textContent = roadmapError(bad);
      return;
    }
    const ok = await confirmDialog("Save this item?", `The public roadmap shows "${v.title}" (${STATUSES[v.status]}) from now on.`, "Save");
    if (!ok) return;
    busy(save, true);
    const r = await api("/admin/roadmap/save", "POST", { id: item.id, ...v });
    busy(save, false);
    if (signedOut(r)) return;
    if (!r.ok) {
      err.textContent = roadmapError(r.data.error);
      return;
    }
    say("Roadmap item saved.");
    await loadRoadmap();
    focusRoadmapItem(item.id);
    if (me.owner) loadLog();
  });
  up.addEventListener("click", () => move(item.id, -1, up));
  down.addEventListener("click", () => move(item.id, 1, down));
  del.addEventListener("click", async () => {
    err.textContent = "";
    const votes = item.votes ? ` Its ${num(item.votes)} ${item.votes === 1 ? "vote goes" : "votes go"} with it.` : "";
    const ok = await confirmDialog("Delete this item?", `"${item.title}" is taken off the public roadmap for good.${votes}`, "Delete");
    if (!ok) return;
    busy(del, true);
    const r = await api("/admin/roadmap/delete", "POST", { id: item.id });
    busy(del, false);
    if (signedOut(r)) return;
    if (!r.ok) {
      err.textContent = roadmapError(r.data.error);
      return;
    }
    say("Roadmap item deleted.");
    await loadRoadmap();
    $("roadmap-title").focus();
    if (me.owner) loadLog();
  });
  li.dataset.id = String(item.id);
  return li;
}

function focusRoadmapItem(id) {
  const li = $("roadmap").querySelector(`li[data-id="${id}"]`);
  const heading = li && li.querySelector(".qtext");
  if (heading) heading.focus();
}

async function move(id, by, button) {
  const ids = roadmapItems.map((i) => i.id);
  const i = ids.indexOf(id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  busy(button, true);
  const r = await api("/admin/roadmap/order", "POST", { ids });
  busy(button, false);
  if (signedOut(r)) return;
  if (!r.ok) {
    $("roadmap-error").textContent = roadmapError(r.data.error);
    return;
  }
  renderRoadmap(r.data.items || []);
  say(`Moved ${by < 0 ? "up" : "down"}.`);
  // Keep focus on the same button of the moved item, or its title when that button is now disabled.
  const li = $("roadmap").querySelector(`li[data-id="${id}"]`);
  if (li) {
    const again = [...li.querySelectorAll(".row button")].find((b) => b.textContent === (by < 0 ? "Move up" : "Move down"));
    if (again && !again.disabled) again.focus();
    else focusRoadmapItem(id);
  }
  if (me.owner) loadLog();
}

function renderRoadmap(items) {
  roadmapItems = items;
  const list = $("roadmap");
  list.replaceChildren(...items.map(roadmapItem));
  if (!items.length) list.appendChild(text("muted", "No roadmap items yet. Add the first one below."));
  setCount("roadmap", items.length);
}

async function loadRoadmap() {
  const gen = ++roadmapGen;
  $("roadmap-error").textContent = "";
  const r = await api("/admin/roadmap");
  if (gen !== roadmapGen) return;
  if (signedOut(r)) return;
  if (!r.ok) {
    $("roadmap-error").textContent = roadmapError(r.data.error);
    return;
  }
  renderRoadmap(r.data.items || []);
}

const newRoadmap = roadmapFields("rnew", {});
$("roadmap-new-fields").append(...newRoadmap.parts);

$("roadmap-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("roadmap-new-error");
  err.textContent = "";
  const v = newRoadmap.read();
  const bad = checkRoadmap(v);
  if (bad) {
    err.textContent = roadmapError(bad);
    newRoadmap.focus();
    return;
  }
  const ok = await confirmDialog("Add this item?", `"${v.title}" (${STATUSES[v.status]}) goes on the public roadmap, at the bottom.`, "Add");
  if (!ok) return;
  const button = e.target.querySelector("button[type=submit]");
  busy(button, true);
  const r = await api("/admin/roadmap/save", "POST", v);
  busy(button, false);
  if (signedOut(r)) return;
  if (!r.ok) {
    err.textContent = roadmapError(r.data.error);
    return;
  }
  newRoadmap.clear();
  say("Added to the roadmap.");
  await loadRoadmap();
  if (r.data.item) focusRoadmapItem(r.data.item.id);
  if (me.owner) loadLog();
});

$("roadmap-refresh").addEventListener("click", async (e) => {
  busy(e.target, true);
  await loadRoadmap();
  busy(e.target, false);
  say("Roadmap updated.");
});

/** "Add to roadmap" under a feedback item: the admin writes the public title and text, prefilled from the feedback. */
function promoteForm(fb) {
  const f = roadmapFields(`p${fb.id}`, { title: fb.summary.slice(0, 120), description: "", status: "planned" });
  const err = document.createElement("p");
  err.className = "field-error";
  err.setAttribute("role", "alert");
  const go = document.createElement("button");
  go.type = "button";
  go.className = "btn btn-primary";
  go.textContent = "Add to the roadmap…";
  const note = text("small muted", "Everything here is public. Rewrite it in your own words and leave out anything personal from the feedback.");
  const box = expandable("Add to roadmap", [note, ...f.parts, err, go]);
  go.addEventListener("click", async () => {
    err.textContent = "";
    const v = f.read();
    const bad = checkRoadmap(v);
    if (bad) {
      err.textContent = roadmapError(bad);
      return;
    }
    const ok = await confirmDialog("Add to the roadmap?", `"${v.title}" (${STATUSES[v.status]}) goes on the public roadmap, and this feedback is marked done.`, "Add");
    if (!ok) return;
    busy(go, true);
    const r = await api("/admin/roadmap/promote", "POST", { feedbackId: fb.id, ...v });
    busy(go, false);
    if (signedOut(r)) return;
    if (!r.ok) {
      err.textContent = roadmapError(r.data.error);
      return;
    }
    say("Added to the roadmap. The feedback is marked done.");
    await Promise.all([loadFeedback(false), loadRoadmap()]);
    $("feedback-title").focus();
    if (me.owner) loadLog();
  });
  return box;
}

// ── Sign in / out ────────────────────────────────────────────

/**
 * Removes everything shown while signed in (logged questions, answers, car readings, reports, the
 * account found), so none of it stays in the page after signing out or after the session ends.
 */
function clearData() {
  current = null;
  $("account").hidden = true;
  recentNext = null;
  reportsNext = null;
  reportsLoaded = false;
  feedbackNext = null;
  feedbackLoaded = false;
  lastDays = null;
  roadmapItems = [];
  for (const k of Object.keys(counts)) counts[k] = null;
  statusGen++;
  roadmapGen++;
  // Answers still on their way are dropped.
  recentGen++;
  reportsGen++;
  knowledgeGen++;
  feedbackGen++;
  $("feedback-more").hidden = true;
  $("knowledge-badge").hidden = true;
  $("feedback-badge").hidden = true;
  $("recent-more").hidden = true;
  $("reports-more").hidden = true;
  $("reports-badge").hidden = true;
  for (const id of ["cards", "recent", "reports", "chart-questions", "chart-cost", "days-table", "lang-table", "signed-table", "results", "ledger", "admin-list", "log", "pending", "items", "feedback", "todo", "live-services", "roadmap"]) $(id).replaceChildren();
  $("live-text").textContent = "Checking…";
  $("live-overall").className = "live";
  $("live-when").textContent = "";
}

$("signout").addEventListener("click", async () => {
  await api("/auth/signout", "POST");
  me = null;
  clearData();
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
    const heading = $(`panel-${tabFromHash() || "home"}`).querySelector("h1");
    if (heading) heading.focus();
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
