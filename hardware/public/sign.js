// The first-generation disclosure window, shared by the pre-order page and the beta tester invite page.
// It loads public/disclosure.html into the page, and only lets someone sign after scrolling to the end
// and having it open for at least a minute; then a tick, their typed full name and a drawn signature.
//
//   const d = await loadDisclosure({ mode: "reserve" | "tester", submitLabel, onSign })
//   d.open(signing, defaultName)   signing = false: read only
//   d.close()
//   onSign({ signedName, signature }) -> Promise<string | null>: an error message, or null when done

const READ_MS = 60 * 1000;

export function showDialog(d) {
  if (typeof d.showModal === "function") d.showModal();
  else {
    d.setAttribute("open", "");
    d.classList.add("is-fallback");
  }
  document.documentElement.classList.add("has-dialog");
}

export function hideDialog(d) {
  if (typeof d.close === "function" && d.open) d.close();
  d.removeAttribute("open");
  d.classList.remove("is-fallback");
  document.documentElement.classList.remove("has-dialog");
}

function setStatus(el, msg, error = false) {
  el.textContent = msg;
  el.classList.toggle("is-error", error);
}

export async function loadDisclosure({ mode = "reserve", submitLabel = "Sign and reserve", onSign }) {
  let html = "";
  try {
    const res = await fetch("/disclosure.html", { credentials: "omit" });
    if (res.ok) html = await res.text();
  } catch {
    /* handled below */
  }
  if (!html.includes('id="disclosure"')) throw new Error("Couldn't load the disclosure. Reload the page and try again.");
  document.body.insertAdjacentHTML("beforeend", html);

  const $ = (id) => document.getElementById(id);
  const dialog = $("disclosure");
  const body = $("d-body");
  const pad = $("d-pad");
  const submit = $("d-submit");
  const status = $("d-status");
  for (const n of dialog.querySelectorAll("[data-for]")) n.hidden = n.dataset.for !== mode;
  submit.dataset.label = submitLabel;

  // ---- reading: time open and scrolled to the end ----
  let readBefore = 0;
  let openedAt = 0;
  let reachedEnd = false;
  let tick = 0;
  const readMs = () => readBefore + (openedAt ? Date.now() - openedAt : 0);
  const leftS = () => Math.max(0, Math.ceil((READ_MS - readMs()) / 1000));
  const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  // ---- the signature pad ----
  const ctx = pad.getContext("2d");
  let strokes = [];
  let drawing = null;
  const inkLength = () => strokes.reduce((n, s) => n + s.length, 0);
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
  function sizePad() {
    const r = pad.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    pad.width = Math.round(r.width * dpr);
    pad.height = Math.round(r.height * dpr);
    redraw();
  }
  const point = (e) => {
    const r = pad.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
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

  /** The signature for the record: dark ink on white, whatever the page theme. */
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

  // ---- what's missing before signing ----
  function missing() {
    if (!reachedEnd) return "Please read the whole disclosure first: scroll to the end of it.";
    if (leftS() > 0) return `Please take at least a minute to read it: ${mmss(leftS())} to go.`;
    if (!$("d-agree").checked) return "Tick the box to say you've read and agree to the disclosure.";
    if ($("d-name").value.trim().length < 3) return "Type your full name.";
    if (inkLength() < 10) return "Draw your signature in the box (with your finger or mouse).";
    return "";
  }
  function checkReady() {
    const need = missing();
    submit.classList.toggle("is-waiting", !!need);
    submit.textContent = !reachedEnd ? "Scroll to the end first"
      : leftS() > 0 ? `${submit.dataset.label} · ${mmss(leftS())}`
      : submit.dataset.label;
    if (!need) setStatus(status, "");
    else if (status.classList.contains("is-error")) setStatus(status, need, true); // keep a shown hint current
  }
  function checkEnd() {
    if (body.scrollTop + body.clientHeight >= body.scrollHeight - 12) reachedEnd = true;
    $("d-more").hidden = reachedEnd;
    checkReady();
  }
  body.addEventListener("scroll", checkEnd, { passive: true });
  $("d-agree").addEventListener("change", checkReady);
  $("d-name").addEventListener("input", checkReady);

  function stopClock() {
    if (openedAt) readBefore += Date.now() - openedAt;
    openedAt = 0;
    clearInterval(tick);
  }
  function close() {
    stopClock();
    hideDialog(dialog);
  }
  function open(signing, defaultName = "") {
    $("d-sign").hidden = !signing;
    $("d-date").textContent = new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
    if (signing && !$("d-name").value) $("d-name").value = defaultName;
    setStatus(status, "");
    showDialog(dialog);
    openedAt = Date.now();
    if (!reachedEnd) body.scrollTop = 0;
    clearInterval(tick);
    tick = setInterval(checkReady, 1000);
    if (signing) sizePad();
    checkEnd();
  }
  $("d-close").addEventListener("click", close);
  $("d-cancel").addEventListener("click", close);
  dialog.addEventListener("click", (e) => { if (e.target === dialog) close(); });
  dialog.addEventListener("close", () => { stopClock(); document.documentElement.classList.remove("has-dialog"); });
  window.addEventListener("resize", () => { if (dialog.open && !$("d-sign").hidden) sizePad(); });

  submit.addEventListener("click", async () => {
    const need = missing();
    if (need) return setStatus(status, need, true);
    submit.disabled = true;
    setStatus(status, "Sending…");
    const err = await onSign({ signedName: $("d-name").value.trim(), signature: signaturePng() });
    submit.disabled = false;
    if (err) return setStatus(status, err, true);
    strokes = [];
    redraw();
    $("d-agree").checked = false;
    close();
  });

  return { open, close, dialog };
}
