// The pre-order page: live prices and counts from /api/preorder/info, the build trackers from
// /api/preorder/build, the signed first-generation disclosure (a <dialog> on this page), and the order
// status lookup.
document.documentElement.classList.replace("no-js", "js");

const $ = (id) => document.getElementById(id);
const form = $("preorder-form");
const status = $("status");
const money = (cents) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
let info = null;

function setStatus(el, msg, error = false) {
  el.textContent = msg;
  el.classList.toggle("is-error", error);
}

async function postJson(url, data) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      cache: "no-store",
      body: JSON.stringify(data),
    });
    const body = await res.json().catch(() => null);
    if (res.ok && body && !body.error) return body;
    return { error: (body && body.error) || "Something went wrong. Please try again later." };
  } catch {
    return { error: "Couldn't reach the server. Check your connection and try again." };
  }
}

// ---- live prices -------------------------------------------------------------------------------

const product = (id) => info && info.products.find((p) => p.id === id);
const lightBundle = () => {
  const l = product("light");
  return l ? l.price - info.lightBundleOff : 12900;
};

function renderPrices() {
  if (!info) return;
  if (!info.open) {
    $("closed-note").hidden = false;
    form.hidden = true;
  }
  for (const p of info.products) {
    const card = document.querySelector(`.product[data-product="${p.id}"]`);
    if (card) {
      card.querySelector("[data-price]").textContent = money(p.price);
      const bundle = card.querySelector("[data-bundle]");
      if (bundle) bundle.textContent = `+ Nova Light ${money(lightBundle())} = ${money(p.price + lightBundle())}`;
      card.querySelector("[data-reserved]").textContent = String(p.reserved);
      card.querySelector("[data-goal]").textContent = String(p.goal);
      card.querySelector("[data-bar]").style.width = `${Math.min(100, (100 * p.reserved) / p.goal)}%`;
      const next = p.tiers.find(([from]) => from > p.reserved);
      card.querySelector("[data-next]").textContent = next
        ? `${next[0] - p.reserved} more and it drops to ${money(next[1])} for everyone`
        : "lowest price reached";
      card.querySelector("[data-tiers]").replaceChildren(...p.tiers.map(([from, cents], i) => {
        const to = p.tiers[i + 1] ? p.tiers[i + 1][0] - 1 : null;
        const li = document.createElement("li");
        li.textContent = `${from === 1 ? "1" : from}${to ? `–${to}` : "+"}: ${money(cents)}`;
        if (cents === p.price) li.className = "is-now";
        return li;
      }));
      card.querySelector(".progress").hidden = false;
    }
  }
  updateBundle();
}

/** The product choices: a Flare or Quasar shows its total with the Light it needs, unless they have one. */
function renderChips() {
  const own = $("p-has-light").checked;
  for (const el of document.querySelectorAll("[data-chip]")) {
    const id = el.dataset.chip;
    const p = product(id);
    const name = p ? p.name : el.textContent.split(" · ")[0].replace(" + Light", "");
    const price = p ? p.price : { light: 17900, supernova: 59900, flare: 47000, quasar: 50000 }[id];
    const needs = id === "flare" || id === "quasar";
    el.textContent = needs && !own
      ? `${name} + Light · ${money(price + lightBundle())}`
      : `${name} · ${money(price)}`;
  }
}

async function loadInfo() {
  try {
    const res = await fetch("/api/preorder/info", { credentials: "omit", cache: "no-store" });
    if (res.ok) {
      info = await res.json();
      renderPrices();
    }
  } catch {
    /* the page still works with the prices written in it */
  }
}

// ---- the form --------------------------------------------------------------------------------------

function picked() {
  return form.querySelector('input[name="product"]:checked')?.value || "";
}

function updateBundle() {
  renderChips();
  const id = picked();
  const p = product(id);
  const needs = id === "flare" || id === "quasar";
  $("light-row").hidden = !needs;
  if (!needs) return;
  const own = $("p-has-light").checked;
  const price = p ? p.price : id === "flare" ? 47000 : 50000;
  $("bundle-total").textContent = own
    ? `${money(price)} for the ${id === "flare" ? "Flare" : "Quasar"}, used with your own Nova Light.`
    : `${money(price)} + Nova Light ${money(lightBundle())} = ${money(price + lightBundle())} right now. The ${id === "flare" ? "Flare" : "Quasar"} needs a Light, so one is reserved with it.`;
}
form.addEventListener("change", updateBundle);

for (const b of document.querySelectorAll("[data-pick]")) {
  b.addEventListener("click", () => {
    const radio = form.querySelector(`input[name="product"][value="${b.dataset.pick}"]`);
    if (radio) radio.checked = true;
    updateBundle();
    $("reserve").scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
    $("p-email").focus({ preventScroll: true });
  });
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!picked()) return setStatus(status, "Pick a product.", true);
  if (!$("p-email").value.trim() || !$("p-email").checkValidity()) {
    $("p-email").focus();
    return setStatus(status, "Enter a valid email address.", true);
  }
  setStatus(status, "");
  openDisclosure(true);
});

$("again").addEventListener("click", () => {
  form.reset();
  $("thanks").hidden = true;
  form.hidden = false;
  updateBundle();
  $("p-email").focus();
});

// ---- the disclosure and signature ------------------------------------------------------------------

const dialog = $("disclosure");
const pad = $("d-pad");
const ctx = pad.getContext("2d");
let strokes = [];
let drawing = null;

function sizePad() {
  const r = pad.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  pad.width = Math.round(r.width * dpr);
  pad.height = Math.round(r.height * dpr);
  redraw();
}

function redraw() {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, pad.width, pad.height);
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#EAF4FF";
  ctx.lineWidth = 2.2;
  ctx.lineCap = ctx.lineJoin = "round";
  for (const s of strokes) {
    ctx.beginPath();
    s.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (s.length === 1) ctx.lineTo(s[0][0] + 0.1, s[0][1]);
    ctx.stroke();
  }
}

function point(e) {
  const r = pad.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}
pad.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  pad.setPointerCapture(e.pointerId);
  drawing = [point(e)];
  strokes.push(drawing);
  redraw();
});
pad.addEventListener("pointermove", (e) => {
  if (!drawing) return;
  drawing.push(point(e));
  redraw();
});
for (const ev of ["pointerup", "pointercancel"]) pad.addEventListener(ev, () => { drawing = null; checkReady(); });
$("d-clear").addEventListener("click", () => { strokes = []; redraw(); checkReady(); });

/** The signature for the record: black ink on white, whatever the page theme. */
function signaturePng() {
  const r = pad.getBoundingClientRect();
  const c = document.createElement("canvas");
  c.width = Math.round(r.width);
  c.height = Math.round(r.height);
  const x = c.getContext("2d");
  x.fillStyle = "#fff";
  x.fillRect(0, 0, c.width, c.height);
  x.strokeStyle = "#0B2545";
  x.lineWidth = 2.2;
  x.lineCap = x.lineJoin = "round";
  for (const s of strokes) {
    x.beginPath();
    s.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py)));
    if (s.length === 1) x.lineTo(s[0][0] + 0.1, s[0][1]);
    x.stroke();
  }
  return c.toDataURL("image/png");
}

const inkLength = () => strokes.reduce((n, s) => n + s.length, 0);
function checkReady() {
  $("d-submit").disabled = !($("d-agree").checked && $("d-name").value.trim().length >= 3 && inkLength() >= 10);
}
$("d-agree").addEventListener("change", checkReady);
$("d-name").addEventListener("input", checkReady);

function openDisclosure(signing) {
  $("d-sign").hidden = !signing;
  $("d-date").textContent = new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  if (signing && !$("d-name").value) $("d-name").value = $("p-name").value;
  setStatus($("d-status"), "");
  dialog.showModal();
  $("d-body").scrollTop = 0;
  if (signing) sizePad();
  checkReady();
}
const closeDisclosure = () => dialog.close();
$("d-close").addEventListener("click", closeDisclosure);
$("d-cancel").addEventListener("click", closeDisclosure);
$("read-disclosure").addEventListener("click", () => openDisclosure(false));
dialog.addEventListener("click", (e) => { if (e.target === dialog) closeDisclosure(); });
window.addEventListener("resize", () => { if (dialog.open && !$("d-sign").hidden) sizePad(); });

$("d-submit").addEventListener("click", async () => {
  const b = $("d-submit");
  b.disabled = true;
  setStatus($("d-status"), "Sending…");
  const data = new FormData(form);
  const r = await postJson("/api/preorder", {
    product: picked(),
    email: String(data.get("email") || "").trim(),
    name: data.get("name"),
    region: data.get("region"),
    car: data.get("car"),
    notes: data.get("notes"),
    website: data.get("website"),
    hasLight: $("p-has-light").checked,
    consent: true,
    signedName: $("d-name").value.trim(),
    signature: signaturePng(),
  });
  if (r.error) {
    b.disabled = false;
    return setStatus($("d-status"), r.error, true);
  }
  dialog.close();
  strokes = [];
  $("d-agree").checked = false;
  form.hidden = true;
  $("thanks").hidden = false;
  $("thanks").focus();
  loadInfo();
});

// ---- build trackers ----------------------------------------------------------------------------------

const tracker = $("tracker");
let builds = null;

async function openTracker(id) {
  $("t-title").textContent = `${product(id)?.name || "Nova"} build tracker`;
  $("t-list").replaceChildren();
  $("t-line").textContent = "Loading…";
  tracker.showModal();
  if (!builds) {
    try {
      const res = await fetch("/api/preorder/build", { credentials: "omit", cache: "no-store" });
      builds = res.ok ? await res.json() : null;
    } catch {
      builds = null;
    }
  }
  const b = builds && builds.products.find((x) => x.id === id);
  if (!b) {
    $("t-line").textContent = "Couldn't load the tracker. Please try again later.";
    return;
  }
  $("t-line").textContent = b.batch
    ? `Batch ${b.batch}: ${b.units} ${b.units === 1 ? "unit" : "units"}. Each step is ticked off as it happens.`
    : "No batch has started yet. The first one starts when 10 people have reserved and paid, right before the parts are ordered. Here's what happens then:";
  $("t-list").replaceChildren(...b.steps.map((s) => {
    const li = document.createElement("li");
    li.className = s.doneAt ? "is-done" : "";
    li.append(Object.assign(document.createElement("span"), { className: "tick", textContent: s.doneAt ? "✓" : "" }));
    li.append(Object.assign(document.createElement("span"), { textContent: s.label }));
    if (s.doneAt) {
      li.append(Object.assign(document.createElement("span"), {
        className: "when", textContent: new Date(s.doneAt).toLocaleDateString(undefined, { day: "numeric", month: "short" }),
      }));
    }
    return li;
  }));
}
for (const card of document.querySelectorAll(".product[data-product]")) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "link-btn small";
  b.textContent = "Build tracker";
  b.addEventListener("click", () => openTracker(card.dataset.product));
  card.append(b);
}
$("t-close").addEventListener("click", () => tracker.close());
tracker.addEventListener("click", (e) => { if (e.target === tracker) tracker.close(); });

// ---- order status lookup -------------------------------------------------------------------------------

$("lookup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("l-email");
  if (!input.value.trim() || !input.checkValidity()) return setStatus($("l-status"), "Enter the email address you reserved with.", true);
  const b = e.submitter || $("lookup-form").querySelector("button");
  b.disabled = true;
  setStatus($("l-status"), "Sending…");
  const r = await postJson("/api/preorder/lookup", { email: input.value.trim(), website: $("l-website").value });
  b.disabled = false;
  if (r.error) return setStatus($("l-status"), r.error, true);
  setStatus($("l-status"), "If that address has a reservation, a link to its status is on its way. Check your email.");
});

if (location.hash === "#disclosure") openDisclosure(false);
loadInfo();
