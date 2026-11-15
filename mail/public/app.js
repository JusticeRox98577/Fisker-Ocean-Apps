// Ocean Live Mail web app. No frameworks. Message content is only ever put into the page as text
// (textContent) or inside the sandboxed iframe the server builds; never through innerHTML.
"use strict";

const $ = (sel) => document.querySelector(sel);
const state = {
  me: null, // { mailbox, name, csrf, domain }
  folder: "inbox",
  q: "",
  unread: false,
  messages: [],
  next: null,
  openId: null,
  open: null, // the message being read
  loading: false,
  view: "mail", // mail | list
};
const FOLDER_NAMES = { inbox: "Inbox", sent: "Sent", trash: "Trash" };

// ---------- Small DOM helpers ----------
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
function icon(name, label) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "i");
  if (label) { svg.setAttribute("role", "img"); svg.setAttribute("aria-label", label); }
  else svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}
function iconButton(name, label, onclick, extra = {}) {
  return h("button", { class: "icon-btn", type: "button", "aria-label": label, title: label, onclick, ...extra }, icon(name));
}

function toast(text, { error = false, action, onAction } = {}) {
  const el = h("div", { class: `toast${error ? " error" : ""}` }, h("span", {}, text));
  if (action) el.append(h("button", { type: "button", onclick: () => { el.remove(); onAction(); } }, action));
  $("#toasts").append(el);
  setTimeout(() => el.remove(), action ? 7000 : 4500);
}

function personLabel(p) {
  if (!p) return "";
  return p.name ? `${p.name} <${p.address}>` : p.address;
}
function shortPerson(p) {
  return (p && (p.name || p.address)) || "(unknown)";
}
function formatSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const yearFmt = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });
const fullFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" });
function listDate(ms) {
  const d = new Date(ms), now = new Date();
  if (d.toDateString() === now.toDateString()) return timeFmt.format(d);
  if (d.getFullYear() === now.getFullYear()) return dayFmt.format(d);
  return yearFmt.format(d);
}

// ---------- API ----------
class ApiError extends Error {
  constructor(status, body) { super(body?.error || `Error ${status}`); this.status = status; this.body = body; }
}
async function api(path, { method = "GET", json, form } = {}) {
  const headers = {};
  if (method !== "GET" && state.me) headers["X-CSRF-Token"] = state.me.csrf;
  let body;
  if (json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  if (form) body = form;
  let res;
  try {
    res = await fetch(path, { method, headers, body, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, { error: "No connection. Check your internet and try again." });
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/api/login") { showLogin(); throw new ApiError(401, data); }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

// ---------- Sign in ----------
function showLogin(prefill) {
  state.me = null;
  $("#app").hidden = true;
  $("#login").hidden = false;
  const addr = $("#login-address");
  if (prefill) addr.value = prefill;
  (addr.value ? $("#login-pin") : addr).focus();
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.submitter || $("#login-form button[type=submit]");
  const err = $("#login-error");
  err.textContent = "";
  const address = $("#login-address").value.trim();
  const pin = $("#login-pin").value;
  if (!address || !pin) { err.textContent = "Enter the mailbox address and the PIN."; return; }
  btn.disabled = true;
  try {
    const me = await api("/api/login", { method: "POST", json: { address, pin } });
    $("#login-pin").value = "";
    await start({ ...me, domain: address.split("@")[1] || "" });
  } catch (ex) {
    err.textContent = ex.message;
    $("#login-pin").select();
  } finally {
    btn.disabled = false;
  }
});

async function start(me) {
  state.me = me;
  try {
    const s = await api("/api/session");
    state.me = s;
  } catch { return; }
  try { localStorage.setItem("olmail:last", state.me.mailbox); } catch {}
  $("#login").hidden = true;
  $("#app").hidden = false;
  $("#me").textContent = state.me.mailbox;
  $("#compose-from").textContent = personLabel({ name: state.me.name, address: state.me.mailbox });
  document.title = `${state.me.mailbox} · Ocean Live Mail`;
  if (!location.hash) history.replaceState(null, "", "#/inbox");
  route();
  refreshCounts();
}

// ---------- Routing: #/folder or #/folder/id ----------
function parseHash() {
  const [, folder = "inbox", id = null] = location.hash.split("/");
  return { folder: FOLDER_NAMES[folder] ? folder : "inbox", id };
}
async function route() {
  if (!state.me) return;
  closeRail();
  if (location.hash.startsWith("#/list")) { showListView(); return; }
  hideListView();
  const { folder, id } = parseHash();
  if (folder !== state.folder || !state.messages.length) {
    const changed = folder !== state.folder;
    state.folder = folder;
    if (changed) { state.q = ""; $("#search").value = ""; }
    await loadList();
  }
  markNav();
  if (id) await openMessage(id);
  else showEmptyReader();
}
window.addEventListener("hashchange", route);

function markNav() {
  const current = state.view === "list" ? "list" : state.folder;
  for (const a of document.querySelectorAll(".folders a")) {
    if (a.dataset.folder === current) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  if (state.view === "list") return;
  $("#folder-title").textContent = FOLDER_NAMES[state.folder];
  $("#search").placeholder = `Search ${FOLDER_NAMES[state.folder]}`;
}

// ---------- List ----------
async function loadList({ append = false } = {}) {
  const params = new URLSearchParams({ folder: state.folder });
  if (state.q) params.set("q", state.q);
  if (state.unread) params.set("unread", "1");
  if (append && state.next) params.set("before", String(state.next));
  const status = $("#list-status");
  if (!append) status.textContent = "Loading…";
  state.loading = true;
  try {
    const data = await api(`/api/messages?${params}`);
    state.messages = append ? state.messages.concat(data.messages) : data.messages;
    state.next = data.next;
    status.textContent = "";
    renderList();
  } catch (ex) {
    status.textContent = ex.message;
  } finally {
    state.loading = false;
  }
}

function renderList() {
  const ul = $("#msg-list");
  ul.replaceChildren();
  if (!state.messages.length) {
    const what = state.q ? "No messages match your search." : state.unread ? "No unread messages." : `${FOLDER_NAMES[state.folder]} is empty.`;
    ul.append(h("li", { class: "empty" }, icon(state.folder === "sent" ? "send" : state.folder === "trash" ? "trash" : "inbox"), h("p", {}, what)));
  }
  for (const m of state.messages) ul.append(listRow(m));
  $("#more-btn").hidden = !state.next;
}

function listRow(m) {
  const who = state.folder === "sent" || m.folder === "sent"
    ? `To: ${m.to.map(shortPerson).join(", ") || "(no recipients)"}`
    : shortPerson(m.from);
  const a = h("a", {
    href: `#/${state.folder}/${m.id}`,
    class: m.seen ? "" : "unread",
    "aria-current": m.id === state.openId ? "true" : null,
  },
    h("span", { class: "who" }, who),
    h("time", { class: "when", datetime: new Date(m.date).toISOString() }, listDate(m.date)),
    h("span", { class: "subj" }, m.hasAttachments ? icon("clip", "Has attachments") : null, m.subject || "(no subject)"),
    h("span", { class: "snip" }, m.snippet),
  );
  if (!m.seen) a.prepend(h("span", { class: "visually-hidden" }, "Unread. "));
  return h("li", { "data-id": m.id }, a);
}

$("#more-btn").addEventListener("click", () => loadList({ append: true }));
$("#refresh-btn").addEventListener("click", async () => { await loadList(); refreshCounts(); toast("Up to date"); });
$("#unread-only").addEventListener("change", (e) => { state.unread = e.target.checked; loadList(); });
let searchTimer;
$("#search").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.q = e.target.value.trim(); loadList(); }, 300);
});

async function refreshCounts() {
  try {
    const c = await api("/api/counts");
    $("#count-inbox").textContent = c.inbox.unread ? String(c.inbox.unread) : "";
    $("#count-inbox").setAttribute("aria-label", c.inbox.unread ? `${c.inbox.unread} unread` : "");
    document.title = `${c.inbox.unread ? `(${c.inbox.unread}) ` : ""}${state.me.mailbox} · Ocean Live Mail`;
  } catch {}
}

// Check for new mail every minute while the tab is visible.
setInterval(() => {
  if (!state.me || document.hidden || state.loading) return;
  refreshCounts();
  if (state.folder === "inbox" && !state.next && !document.querySelector("#compose[open]")) loadList();
}, 60000);

// ---------- Reader ----------
function showEmptyReader() {
  state.openId = null;
  state.open = null;
  $(".panes").classList.remove("reading");
  for (const a of document.querySelectorAll(".msg-list a[aria-current]")) a.removeAttribute("aria-current");
  $("#reader").replaceChildren(
    h("div", { class: "reader-empty" },
      h("img", { src: "/icons/logo-rounded-96.webp", width: 64, height: 64, alt: "" }),
      h("p", {}, "Choose a message to read it."),
    ),
  );
}

async function openMessage(id) {
  state.openId = id;
  $(".panes").classList.add("reading");
  for (const a of document.querySelectorAll(".msg-list a")) {
    if (a.parentElement.dataset.id === id) a.setAttribute("aria-current", "true");
    else a.removeAttribute("aria-current");
  }
  const reader = $("#reader");
  reader.replaceChildren(h("div", { class: "reader-empty" }, h("div", { class: "spinner", role: "status", "aria-label": "Loading message" })));
  let m;
  try {
    m = await api(`/api/messages/${id}`);
  } catch (ex) {
    reader.replaceChildren(h("div", { class: "reader-empty" }, h("p", {}, ex.message), h("a", { href: `#/${state.folder}` }, `Back to ${FOLDER_NAMES[state.folder]}`)));
    return;
  }
  if (state.openId !== id) return;
  state.open = m;
  const row = state.messages.find((x) => x.id === id);
  if (row && !row.seen) { row.seen = true; renderList(); refreshCounts(); }
  renderReader(m, false);
}

function renderReader(m, images) {
  const reader = $("#reader");
  const inTrash = m.folder === "trash";
  const bar = h("div", { class: "reader-bar", role: "toolbar", "aria-label": "Message actions" },
    h("a", { class: "icon-btn only-stacked", href: `#/${state.folder}`, "aria-label": `Back to ${FOLDER_NAMES[state.folder]}`, title: "Back" }, icon("back")),
    iconButton("reply", "Reply", () => openCompose("reply", m)),
    iconButton("reply-all", "Reply all", () => openCompose("replyAll", m)),
    iconButton("forward", "Forward", () => openCompose("forward", m)),
    h("span", { class: "spacer" }),
    m.folder === "inbox" ? iconButton("unread", "Mark as unread", () => markUnread(m)) : null,
    inTrash
      ? iconButton("undo", m.prevFolder === "sent" ? "Move back to Sent" : "Move back to Inbox", () => moveMessage(m, "inbox"))
      : iconButton("trash", "Move to Trash", () => moveMessage(m, "trash")),
    inTrash ? iconButton("x", "Delete forever", () => deleteForever(m)) : null,
    h("a", { class: "icon-btn", href: `/api/messages/${m.id}/raw`, "aria-label": "Download original (.eml)", title: "Download original (.eml)", download: "" }, icon("download")),
  );

  const isSent = m.folder === "sent" || m.prevFolder === "sent";
  const meta = h("div", { class: "meta" },
    h("span", {}, "From ", h("b", {}, personLabel(m.from) || "(unknown)")),
    m.to.length ? h("span", {}, `To ${m.to.map(personLabel).join(", ")}`) : null,
    m.cc.length ? h("span", {}, `${isSent ? "Cc/Bcc" : "Cc"} ${m.cc.map(personLabel).join(", ")}`) : null,
    m.replyTo && m.replyTo !== m.from.address ? h("span", {}, `Reply to ${m.replyTo}`) : null,
    h("time", { datetime: new Date(m.date).toISOString() }, fullFmt.format(new Date(m.date))),
  );

  const parts = [bar, h("div", { class: "reader-head" }, h("h1", { tabindex: "-1", id: "reader-title" }, m.subject || "(no subject)"), meta)];
  if (m.authWarning) parts.push(h("p", { class: "notice warn", role: "note" }, icon("alert"), h("span", {}, m.authWarning)));

  if (m.hasHtml) {
    if (m.remoteImages && !images) {
      parts.push(h("div", { class: "notice info" }, icon("image"),
        h("span", {}, "Pictures from the internet are hidden, so the sender can't see when you open this."),
        h("button", { class: "btn btn-ghost btn-small", type: "button", onclick: () => renderReader(m, true) }, "Show pictures"),
      ));
    }
    parts.push(h("iframe", {
      class: "body-frame",
      title: `Message: ${m.subject || "no subject"}`,
      src: `/api/messages/${m.id}/body${images ? "?images=1" : ""}`,
      sandbox: "allow-popups allow-popups-to-escape-sandbox",
      referrerpolicy: "no-referrer",
      loading: "eager",
    }));
  } else {
    parts.push(textBody(m.text || ""));
  }

  if (m.attachments.length) {
    parts.push(h("h2", { class: "visually-hidden" }, "Attachments"));
    parts.push(h("ul", { class: "atts" }, m.attachments.map((a) =>
      h("li", {}, h("a", { href: `/api/messages/${m.id}/attachments/${a.id}`, download: a.filename },
        icon("clip"), h("span", { class: "name" }, a.filename), h("span", { class: "size" }, formatSize(a.size)))),
    )));
  }
  reader.replaceChildren(...parts);
  reader.scrollTop = 0;
  if (window.matchMedia("(max-width: 1099px)").matches) $("#reader-title").focus({ preventScroll: true });
}

function textBody(text) {
  const div = h("div", { class: "body-text" });
  for (const line of text.split("\n")) {
    const span = h("span", { class: /^\s*>/.test(line) ? "quote" : null });
    // Linkify http(s) URLs safely.
    let rest = line;
    const re = /\bhttps?:\/\/[^\s<>"']+/g;
    let last = 0, mm;
    while ((mm = re.exec(line))) {
      span.append(line.slice(last, mm.index));
      span.append(h("a", { href: mm[0], target: "_blank", rel: "noopener noreferrer" }, mm[0]));
      last = mm.index + mm[0].length;
    }
    span.append(rest.slice(last), "\n");
    div.append(span);
  }
  return div;
}

async function markUnread(m) {
  try {
    await api(`/api/messages/${m.id}`, { method: "PATCH", json: { seen: false } });
    const row = state.messages.find((x) => x.id === m.id);
    if (row) row.seen = false;
    location.hash = `#/${state.folder}`;
    renderList();
    refreshCounts();
  } catch (ex) { toast(ex.message, { error: true }); }
}

async function moveMessage(m, folder) {
  try {
    await api(`/api/messages/${m.id}`, { method: "PATCH", json: { folder } });
    state.messages = state.messages.filter((x) => x.id !== m.id);
    renderList();
    refreshCounts();
    location.hash = `#/${state.folder}`;
    if (folder === "trash") {
      toast("Moved to Trash", { action: "Undo", onAction: async () => {
        await api(`/api/messages/${m.id}`, { method: "PATCH", json: { folder: "inbox" } }).catch(() => {});
        await loadList();
        refreshCounts();
      } });
    } else toast(m.prevFolder === "sent" ? "Moved back to Sent" : "Moved back to Inbox");
  } catch (ex) { toast(ex.message, { error: true }); }
}

async function deleteForever(m) {
  if (!confirm(`Delete "${m.subject || "(no subject)"}" for good? This can't be undone.`)) return;
  try {
    await api(`/api/messages/${m.id}`, { method: "DELETE" });
    state.messages = state.messages.filter((x) => x.id !== m.id);
    renderList();
    location.hash = `#/${state.folder}`;
    toast("Deleted for good");
  } catch (ex) { toast(ex.message, { error: true }); }
}

// ---------- Compose ----------
const compose = $("#compose");
const draft = { replyTo: null, forwardOf: null, files: [], dirty: false };

function quoteText(m) {
  const body = (m.text || m.snippet || "").trimEnd();
  const when = fullFmt.format(new Date(m.date));
  return `\n\nOn ${when}, ${personLabel(m.from)} wrote:\n${body.split("\n").map((l) => `> ${l}`).join("\n")}`;
}
function prefixSubject(prefix, subject) {
  const s = subject || "";
  return new RegExp(`^${prefix}:`, "i").test(s) ? s : `${prefix}: ${s}`;
}
function addrList(list) {
  return list.map((p) => (p.name ? `${p.name.replace(/[",<>]/g, "")} <${p.address}>` : p.address)).join(", ");
}

function openCompose(mode = "new", m = null) {
  const form = $("#compose-form");
  form.reset();
  draft.replyTo = null; draft.forwardOf = null; draft.files = []; draft.dirty = false;
  $("#c-error").textContent = "";
  $("#cc-fields").hidden = true;
  $("#cc-toggle").setAttribute("aria-expanded", "false");
  $("#fwd-atts").hidden = true;
  $("#fwd-atts").replaceChildren();
  renderChips();
  let title = "New message";
  const mine = state.me.mailbox;

  if (m && (mode === "reply" || mode === "replyAll")) {
    title = mode === "reply" ? "Reply" : "Reply all";
    draft.replyTo = m.id;
    const sentByMe = m.from.address === mine;
    const primary = sentByMe ? m.to : [{ name: m.from.name, address: m.replyTo || m.from.address }];
    $("#c-to").value = addrList(primary);
    if (mode === "replyAll") {
      const seen = new Set([mine, ...primary.map((p) => p.address)]);
      const others = [...m.to, ...m.cc.filter((p) => !p.bcc)].filter((p) => !seen.has(p.address) && seen.add(p.address));
      if (others.length) { $("#c-cc").value = addrList(others); toggleCc(true); }
    }
    $("#c-subject").value = prefixSubject("Re", m.subject);
    $("#c-text").value = quoteText(m);
  } else if (m && mode === "forward") {
    title = "Forward";
    draft.forwardOf = m.id;
    $("#c-subject").value = prefixSubject("Fwd", m.subject);
    const head = [
      "---------- Forwarded message ----------",
      `From: ${personLabel(m.from)}`,
      `Date: ${fullFmt.format(new Date(m.date))}`,
      `Subject: ${m.subject}`,
      `To: ${m.to.map(personLabel).join(", ")}`,
      "",
    ].join("\n");
    $("#c-text").value = `\n\n${head}\n${m.text || m.snippet || ""}`;
    if (m.attachments.length) {
      const box = $("#fwd-atts");
      box.append(h("p", { class: "muted small" }, "Include attachments:"));
      for (const a of m.attachments) {
        box.append(h("label", {}, h("input", { type: "checkbox", name: "forwardAttachment", value: a.id, checked: true }), `${a.filename} (${formatSize(a.size)})`));
      }
      box.hidden = false;
    }
  }
  $("#compose-title").textContent = title;
  compose.showModal();
  if (!$("#c-to").value) $("#c-to").focus();
  else { const t = $("#c-text"); t.focus(); t.setSelectionRange(0, 0); t.scrollTop = 0; }
}

function toggleCc(force) {
  const show = force ?? $("#cc-fields").hidden;
  $("#cc-fields").hidden = !show;
  $("#cc-toggle").setAttribute("aria-expanded", String(show));
  if (show && force === undefined) $("#c-cc").focus();
}
$("#cc-toggle").addEventListener("click", () => toggleCc());

function renderChips() {
  const ul = $("#att-chips");
  ul.replaceChildren(...draft.files.map((f, i) =>
    h("li", {}, h("span", {}, `${f.name} (${formatSize(f.size)})`),
      iconButton("x", `Remove ${f.name}`, () => { draft.files.splice(i, 1); renderChips(); })),
  ));
}
$("#c-files").addEventListener("change", (e) => {
  draft.files.push(...e.target.files);
  e.target.value = "";
  draft.dirty = true;
  const total = draft.files.reduce((n, f) => n + f.size, 0);
  $("#c-error").textContent = total > 25 * 1024 * 1024 ? "Attachments are over 25 MB together. Remove some before sending." : "";
  renderChips();
});
$("#compose-form").addEventListener("input", () => { draft.dirty = true; });

function closeCompose() {
  if (draft.dirty && !confirm("Discard this message?")) return;
  draft.dirty = false;
  compose.close();
}
$("#compose-close").addEventListener("click", closeCompose);
$("#discard-btn").addEventListener("click", closeCompose);
compose.addEventListener("cancel", (e) => { e.preventDefault(); closeCompose(); });

$("#compose-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#c-error");
  err.textContent = "";
  if (!$("#c-to").value.trim()) { err.textContent = "Add at least one address in To."; $("#c-to").focus(); return; }
  const fd = new FormData();
  for (const k of ["to", "cc", "bcc", "subject", "text"]) fd.append(k, $(`#c-${k}`).value);
  if (draft.replyTo) fd.append("replyTo", draft.replyTo);
  if (draft.forwardOf) {
    fd.append("forwardOf", draft.forwardOf);
    for (const cb of document.querySelectorAll('#fwd-atts input[name="forwardAttachment"]:checked')) fd.append("forwardAttachment", cb.value);
  }
  for (const f of draft.files) fd.append("attachments", f, f.name);
  const btn = $("#send-btn");
  btn.disabled = true;
  btn.querySelector("span").textContent = "Sending…";
  try {
    await api("/api/send", { method: "POST", form: fd });
    draft.dirty = false;
    compose.close();
    toast("Sent");
    if (state.folder === "sent") loadList();
  } catch (ex) {
    err.textContent = ex.message;
    if (ex.body?.field === "to") $("#c-to").focus();
  } finally {
    btn.disabled = false;
    btn.querySelector("span").textContent = "Send";
  }
});

$("#compose-btn").addEventListener("click", () => openCompose());
$("#fab").addEventListener("click", () => openCompose());

// ---------- Folders drawer (phones) ----------
function openRail() {
  $("#rail").classList.add("open");
  $("#scrim").hidden = false;
  $("#menu-btn").setAttribute("aria-expanded", "true");
  $("#rail a[aria-current]")?.focus();
}
function closeRail() {
  if (!$("#rail").classList.contains("open")) return;
  $("#rail").classList.remove("open");
  $("#scrim").hidden = true;
  $("#menu-btn").setAttribute("aria-expanded", "false");
}
$("#menu-btn").addEventListener("click", () => ($("#rail").classList.contains("open") ? closeRail() : openRail()));
$("#scrim").addEventListener("click", closeRail);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $("#rail").classList.contains("open")) { closeRail(); $("#menu-btn").focus(); }
});

// ---------- Sign out ----------
$("#logout-btn").addEventListener("click", async () => {
  const addr = state.me?.mailbox;
  await api("/api/logout", { method: "POST" }).catch(() => {});
  location.hash = "";
  showLogin(addr);
});

// ---------- Mailboxes & settings ----------
const settings = $("#settings");
async function openSettings() {
  $("#r-name").value = state.me.name || "";
  $("#r-addr").textContent = state.me.mailbox;
  $("#n-domain").textContent = `@${state.me.domain || state.me.mailbox.split("@")[1]}`;
  $("#n-error").textContent = "";
  settings.showModal();
  await renderBoxes();
}
async function renderBoxes() {
  const ul = $("#boxes");
  try {
    const { mailboxes } = await api("/api/mailboxes");
    ul.replaceChildren(...mailboxes.map((b) => {
      const current = b.address === state.me.mailbox;
      return h("li", {}, h("button", {
        type: "button",
        "aria-current": current ? "true" : null,
        onclick: current ? () => settings.close() : () => switchTo(b.address),
      },
        h("span", {}, h("span", { class: "addr" }, b.address), h("br"), h("span", { class: "nm" }, current ? `${b.name || "No name"} · signed in` : b.name || "No name")),
        b.unread ? h("b", { class: "count", "aria-label": `${b.unread} unread` }, String(b.unread)) : null,
      ));
    }));
  } catch (ex) {
    ul.replaceChildren(h("li", { class: "field-error" }, ex.message));
  }
}
async function switchTo(address) {
  settings.close();
  await api("/api/logout", { method: "POST" }).catch(() => {});
  location.hash = "";
  showLogin(address);
}
$("#settings-btn").addEventListener("click", openSettings);
$("#settings-close").addEventListener("click", () => settings.close());

$("#rename-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const r = await api("/api/mailbox", { method: "PATCH", json: { name: $("#r-name").value } });
    state.me.name = r.name;
    $("#compose-from").textContent = personLabel({ name: r.name, address: state.me.mailbox });
    toast("Name saved");
    renderBoxes();
  } catch (ex) { toast(ex.message, { error: true }); }
});

$("#new-box-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#n-error");
  err.textContent = "";
  const local = $("#n-local").value.trim();
  if (!local) { err.textContent = "Type the part before the @."; $("#n-local").focus(); return; }
  try {
    const r = await api("/api/mailboxes", { method: "POST", json: { local, name: $("#n-name").value } });
    $("#new-box-form").reset();
    toast(`${r.address} is ready`);
    renderBoxes();
  } catch (ex) {
    err.textContent = ex.message;
    $("#n-local").focus();
  }
});

// ---------- Mailing list ----------
const lv = { overview: null, subs: [], next: null, q: "", status: "", sending: false, inviting: false };

function showListView() {
  state.view = "list";
  $("#main").hidden = true;
  $("#list-main").hidden = false;
  $(".search").hidden = true;
  $("#fab").hidden = true;
  document.title = `Mailing list · Ocean Live Mail`;
  markNav();
  loadListOverview();
  loadSubscribers();
}
function hideListView() {
  if (state.view !== "list") return;
  state.view = "mail";
  $("#list-main").hidden = true;
  $("#main").hidden = false;
  $(".search").hidden = false;
  $("#fab").hidden = false;
  refreshCounts();
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

async function loadListOverview() {
  try {
    const o = await api("/api/list");
    lv.overview = o;
    renderListOverview();
  } catch (ex) {
    $("#lv-counts").textContent = ex.message;
  }
}

function renderListOverview() {
  const o = lv.overview;
  $("#lv-counts").textContent =
    `${o.confirmed} confirmed · ${o.pending} not confirmed yet · ${o.sentToday} of ${o.perDay} list emails sent today (UTC; news, tests, confirmations and invitations)`;
  $("#lv-from").textContent = o.from;
  const notices = [];
  if (!o.sendingReady) {
    notices.push(h("p", { class: "notice warn", role: "note" }, icon("alert"),
      h("span", {}, "Sending isn't set up yet: the RESEND_API_KEY secret is missing.")));
  }
  if (!o.postalAddress) {
    notices.push(h("p", { class: "notice warn", role: "note" }, icon("alert"),
      h("span", {}, "No postal address is set. US anti-spam law (CAN-SPAM) asks for one in marketing email. Set LIST_POSTAL_ADDRESS in wrangler.jsonc and deploy.")));
  }
  $("#lv-notices").replaceChildren(...notices);
  $("#lv-send span").textContent = `Send to ${plural(o.confirmed, "subscriber", "subscribers")}`;
  $("#lv-send").disabled = lv.sending || !o.confirmed;

  const ul = $("#lv-campaigns");
  if (!o.campaigns.length) {
    ul.replaceChildren(h("li", { class: "muted" }, "Nothing sent yet."));
    return;
  }
  ul.replaceChildren(...o.campaigns.map((c) => {
    const counts = `${c.sent} of ${c.total} sent${c.failed ? ` · ${c.failed} failed` : ""}`;
    return h("li", {},
      h("span", { class: "lv-c-subj" }, c.subject),
      h("span", { class: "muted small" }, `${yearFmt.format(new Date(c.createdAt))} · ${counts}${c.status === "sending" ? " · not finished" : ""}`),
      c.status === "sending" && !lv.sending
        ? h("button", { class: "btn btn-ghost btn-small", type: "button", onclick: () => runCampaign({ campaign: c }, true) }, "Continue sending")
        : null,
    );
  }));
}

async function loadSubscribers({ append = false } = {}) {
  const params = new URLSearchParams();
  if (lv.q) params.set("q", lv.q);
  if (lv.status) params.set("status", lv.status);
  if (append && lv.next) params.set("cursor", lv.next);
  const status = $("#lv-subs-status");
  if (!append) status.textContent = "Loading…";
  try {
    const data = await api(`/api/list/subscribers?${params}`);
    lv.subs = append ? lv.subs.concat(data.subscribers) : data.subscribers;
    lv.next = data.next;
    status.textContent = lv.subs.length ? "" : lv.q || lv.status ? "No addresses match." : "Nobody has signed up yet.";
    renderSubscribers();
  } catch (ex) {
    status.textContent = ex.message;
  }
}

const LANG_NAMES = { en: "English", de: "German", fr: "French", es: "Spanish", nl: "Dutch" };
function renderSubscribers() {
  $("#lv-subs").replaceChildren(...lv.subs.map((s) => h("tr", {},
    h("td", { class: "lv-email" }, s.email),
    h("td", {}, s.status === "confirmed" ? "Confirmed" : "Not confirmed yet"),
    h("td", {}, LANG_NAMES[s.lang] || s.lang),
    h("td", {}, h("time", { datetime: new Date(s.createdAt).toISOString() }, yearFmt.format(new Date(s.createdAt)))),
    h("td", {}, h("button", { class: "btn btn-danger btn-small", type: "button", "aria-label": `Remove ${s.email}`, onclick: () => removeSubscriber(s) }, "Remove")),
  )));
  $("#lv-more").hidden = !lv.next;
}

async function removeSubscriber(s) {
  if (!confirm(`Remove ${s.email} from the list? The address is deleted.`)) return;
  try {
    await api(`/api/list/subscribers/${s.id}`, { method: "DELETE" });
    lv.subs = lv.subs.filter((x) => x.id !== s.id);
    renderSubscribers();
    toast(`${s.email} removed`);
    loadListOverview();
  } catch (ex) { toast(ex.message, { error: true }); }
}

let lvSearchTimer;
$("#lv-q").addEventListener("input", (e) => {
  clearTimeout(lvSearchTimer);
  lvSearchTimer = setTimeout(() => { lv.q = e.target.value.trim(); loadSubscribers(); }, 300);
});
$("#lv-status").addEventListener("change", (e) => { lv.status = e.target.value; loadSubscribers(); });
$("#lv-more").addEventListener("click", () => loadSubscribers({ append: true }));

function readListForm() {
  const err = $("#lv-error");
  err.textContent = "";
  const subject = $("#lv-subject").value.trim();
  const text = $("#lv-text").value;
  if (!subject) { err.textContent = "Add a subject."; $("#lv-subject").focus(); return null; }
  if (!text.trim()) { err.textContent = "Write the email first."; $("#lv-text").focus(); return null; }
  return { subject, text };
}

function setListBusy(busy) {
  lv.sending = busy;
  $("#lv-test").disabled = busy;
  $("#lv-send").disabled = busy || !lv.overview?.confirmed;
}

$("#lv-test").addEventListener("click", async () => {
  const c = readListForm();
  if (!c) return;
  setListBusy(true);
  try {
    const r = await api("/api/list/test", { method: "POST", json: c });
    toast(`Test sent to ${r.to}`);
    loadListOverview();
  } catch (ex) {
    $("#lv-error").textContent = ex.message;
  } finally {
    setListBusy(false);
  }
});

$("#lv-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (lv.sending) return;
  const c = readListForm();
  if (!c) return;
  const n = lv.overview?.confirmed ?? 0;
  if (!n) { $("#lv-error").textContent = "Nobody has confirmed a subscription yet."; return; }
  if (!confirm(`Send "${c.subject}" to ${plural(n, "subscriber", "subscribers")}? This can't be undone.`)) return;
  setListBusy(true);
  $("#lv-progress").textContent = "Sending…";
  try {
    const first = await api("/api/list/campaigns", { method: "POST", json: c });
    $("#lv-form").reset();
    await runCampaign(first, false);
  } catch (ex) {
    $("#lv-error").textContent = ex.message;
    $("#lv-progress").textContent = "";
    setListBusy(false);
  }
});

function progressText(s) {
  const c = s.campaign;
  const counts = `${c.sent} of ${c.total} sent${c.failed ? `, ${c.failed} failed` : ""}`;
  if (c.status === "done") return `Done: ${counts}.`;
  if (s.paused) return `${s.message || "Paused."} So far ${counts}.`;
  return `Sending "${c.subject}": ${counts}…`;
}

/** Calls Continue until the campaign is done or pauses (daily limit, Resend busy or failing). */
async function runCampaign(state0, resume) {
  setListBusy(true);
  renderListOverview();
  let s = state0;
  try {
    if (resume) s = await api(`/api/list/campaigns/${s.campaign.id}/continue`, { method: "POST" });
    while (s.campaign.status === "sending" && !s.paused) {
      $("#lv-progress").textContent = progressText(s);
      s = await api(`/api/list/campaigns/${s.campaign.id}/continue`, { method: "POST" });
    }
    $("#lv-progress").textContent = progressText(s);
  } catch (ex) {
    $("#lv-progress").textContent = `${ex.message} You can continue sending from the list below.`;
  } finally {
    setListBusy(false);
    loadListOverview();
  }
}

// ---------- Mailing list: invite testers ----------
const MAX_INVITES = 200;

/** One address per line or comma; "Name <a@b.c>" keeps just the address. Lowercase, no duplicates. */
function parseInviteList(text) {
  const out = [];
  for (const part of text.split(/[\n,;]+/)) {
    const angle = /<([^<>]*)>/.exec(part);
    const email = (angle ? angle[1] : part).trim().toLowerCase();
    if (email && !out.includes(email)) out.push(email);
  }
  return out;
}

function inviteResultText(r) {
  const parts = [`Invited ${r.invited}.`];
  if (r.deferred.length) parts.push(`${r.deferred.length} left for tomorrow: paste the list again then.`);
  if (r.skipped) parts.push(`Skipped ${plural(r.skipped, "address", "addresses")} already on the list or invited before.`);
  if (r.failed.length) parts.push(`${r.failed.length} failed: ${r.failed.map((f) => `${f.email} (${f.error})`).join("; ")}`);
  return parts.join(" ");
}

$("#lv-invite-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (lv.inviting) return;
  const box = $("#lv-invite-emails");
  const err = $("#lv-invite-error");
  const result = $("#lv-invite-result");
  err.textContent = "";
  const emails = parseInviteList(box.value);
  if (!emails.length) { err.textContent = "Paste at least one address."; box.focus(); return; }
  if (emails.length > MAX_INVITES) { err.textContent = `Invite at most ${MAX_INVITES} addresses at a time.`; box.focus(); return; }
  if (!confirm(`Send an invitation to ${plural(emails.length, "address", "addresses")}? Addresses already on the list or invited before are skipped. Nobody joins without clicking the link.`)) return;
  lv.inviting = true;
  $("#lv-invite-send").disabled = true;
  result.textContent = "Sending invitations…";
  try {
    const r = await api("/api/list/invite", { method: "POST", json: { emails } });
    result.textContent = inviteResultText(r);
    if (!r.deferred.length && !r.failed.length) box.value = "";
    loadListOverview();
    loadSubscribers();
  } catch (ex) {
    result.textContent = "";
    err.textContent = ex.message;
    box.focus();
  } finally {
    lv.inviting = false;
    $("#lv-invite-send").disabled = false;
  }
});

// ---------- Keyboard shortcuts: c = compose, / = search ----------
document.addEventListener("keydown", (e) => {
  if (!state.me || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t.closest("input, textarea, select, dialog[open]")) return;
  if (e.key === "c") { e.preventDefault(); openCompose(); }
  else if (e.key === "/") { e.preventDefault(); $("#search").focus(); }
});

// ---------- Boot ----------
(async () => {
  try {
    const last = localStorage.getItem("olmail:last");
    if (last) $("#login-address").value = last;
  } catch {}
  try {
    const me = await fetch("/api/session", { credentials: "same-origin" });
    if (me.ok) { await start(await me.json()); return; }
  } catch {}
  showLogin();
})();
