// Nova beta sign-up. Same-origin POST to /api/signup; native form submission is blocked by the
// CSP (form-action 'none'). The questions are in index.html: this reads whatever is there.
document.documentElement.classList.replace("no-js", "js");

const MAX = 5;
const OFFLINE = "Couldn't reach hardware.oceanlive.org. Check your connection and try again.";

const form = document.getElementById("beta-form");
const status = document.getElementById("status");
const button = form.querySelector('button[type="submit"]');
const featureBoxes = [...form.querySelectorAll('input[name="features"]')];
const pickedWrap = document.getElementById("picked");
const pickedList = document.getElementById("picked-list");
const live = document.getElementById("picked-live");

/** Feature ids in order of importance. */
let order = [];

const labelOf = (id) => {
  const box = featureBoxes.find((b) => b.value === id);
  const b = box && box.closest(".feature").querySelector("b");
  return b ? b.textContent : id;
};

function say(text, kind) {
  status.textContent = text;
  status.classList.toggle("is-error", kind === "error");
  status.classList.toggle("is-ok", kind === "ok");
}

function render() {
  const full = order.length >= MAX;
  for (const box of featureBoxes) {
    const i = order.indexOf(box.value);
    const card = box.closest(".feature");
    box.checked = i >= 0;
    card.classList.toggle("is-picked", i >= 0);
    card.classList.toggle("is-full", full);
    card.querySelector(".rank").textContent = i >= 0 ? String(i + 1) : "";
    // Screen readers hear the rank in the checkbox's name.
    box.setAttribute("aria-description", i >= 0 ? `Number ${i + 1} of ${MAX}` : full ? `You've picked ${MAX}. Untick one to choose this.` : "");
  }

  pickedWrap.hidden = order.length === 0;
  pickedList.replaceChildren(
    ...order.map((id, i) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.className = "p-name";
      name.textContent = labelOf(id);
      const btns = document.createElement("span");
      btns.className = "p-btns";
      const mk = (text, label, delta) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "icon-btn";
        b.textContent = text;
        b.setAttribute("aria-label", `${label}: ${labelOf(id)}`);
        b.dataset.id = id;
        b.dataset.delta = String(delta);
        return b;
      };
      const up = mk("↑", "Move up", -1);
      const down = mk("↓", "Move down", 1);
      const remove = mk("✕", "Remove", 0);
      up.disabled = i === 0;
      down.disabled = i === order.length - 1;
      btns.append(up, down, remove);
      li.append(name, btns);
      return li;
    }),
  );
}

for (const box of featureBoxes) {
  box.addEventListener("change", () => {
    if (box.checked) {
      if (order.length >= MAX) {
        box.checked = false;
        live.textContent = `You've already picked ${MAX}. Untick one first.`;
        return;
      }
      order.push(box.value);
      live.textContent = `${labelOf(box.value)} is number ${order.length}.`;
    } else {
      order = order.filter((id) => id !== box.value);
      live.textContent = `${labelOf(box.value)} removed.`;
    }
    form.querySelector("#features-group").removeAttribute("aria-invalid");
    render();
  });
}

pickedList.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-id]");
  if (!b) return;
  const id = b.dataset.id;
  const delta = Number(b.dataset.delta);
  const i = order.indexOf(id);
  if (delta === 0) {
    order.splice(i, 1);
    live.textContent = `${labelOf(id)} removed.`;
  } else {
    const j = i + delta;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    live.textContent = `${labelOf(id)} is now number ${j + 1}.`;
  }
  render();
  // Keep focus on the same button so the list can be reordered from the keyboard.
  const again = pickedList.querySelector(`button[data-id="${CSS.escape(id)}"][data-delta="${delta}"]`);
  if (again && !again.disabled) again.focus();
  else if (delta !== 0) pickedList.querySelector(`button[data-id="${CSS.escape(id)}"]`)?.focus();
  else (pickedList.querySelector("button") || featureBoxes[0]).focus();
});

const val = (name) => (form.elements.namedItem(name)?.value ?? "").trim();
const checkedValues = (name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (button.disabled) return;
  const email = form.elements.namedItem("email");
  const consent = form.elements.namedItem("consent");
  email.removeAttribute("aria-invalid");

  if (!email.value.trim() || !email.checkValidity()) {
    email.setAttribute("aria-invalid", "true");
    say("Enter a valid email address.", "error");
    email.focus();
    return;
  }
  if (order.length === 0 && !val("otherFeature")) {
    form.querySelector("#features-group").setAttribute("aria-invalid", "true");
    say("Pick at least one feature, or write one in.", "error");
    featureBoxes[0].focus();
    return;
  }
  if (!consent.checked) {
    say("Tick the box to say we may email you about the beta.", "error");
    consent.focus();
    return;
  }

  const data = {
    email: email.value.trim(),
    name: val("name"),
    region: val("region"),
    car: val("car"),
    phone: val("phone"),
    products: checkedValues("products"),
    features: order,
    otherFeature: val("otherFeature"),
    install: checkedValues("install")[0] || "",
    notes: val("notes"),
    consent: true,
    website: val("website"),
  };

  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  say("Sending…");
  let result;
  try {
    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      credentials: "omit",
      cache: "no-store",
    });
    let body = null;
    try { body = await res.json(); } catch { /* not JSON */ }
    if (res.ok && body && body.ok) result = { ok: true };
    else if (body && typeof body.error === "string") result = { error: body.error };
    else result = { error: "Something went wrong. Please try again later." };
  } catch {
    result = { error: OFFLINE };
  }
  button.disabled = false;
  button.removeAttribute("aria-busy");

  if (!result.ok) {
    say(result.error, "error");
    status.focus();
    return;
  }
  const thanks = document.createElement("div");
  thanks.className = "thanks";
  thanks.setAttribute("tabindex", "-1");
  const h = document.createElement("h3");
  h.textContent = "You're on the list. Thank you!";
  const p = document.createElement("p");
  p.textContent = "We'll email you when we pick beta testers. Changed your mind about a feature? Sign up again with the same email and your new answer replaces the old one.";
  thanks.append(h, p);
  form.replaceWith(thanks);
  thanks.focus();
});

// Closed for now? Say so instead of showing a form that will refuse.
fetch("/api/info", { cache: "no-store" })
  .then((r) => (r.ok ? r.json() : null))
  .then((info) => {
    if (info && info.open === false) {
      document.getElementById("closed-note").hidden = false;
      form.hidden = true;
    }
  })
  .catch(() => {});

render();
