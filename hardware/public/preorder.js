// The pre-order page: prices and counts from /api/preorder/info, the form posts to /api/preorder.
document.documentElement.classList.replace("no-js", "js");

const $ = (id) => document.getElementById(id);
const form = $("preorder-form");
const status = $("status");
const money = (cents) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

function setStatus(msg, error = false) {
  status.textContent = msg;
  status.classList.toggle("is-error", error);
}

async function load() {
  try {
    const res = await fetch("/api/preorder/info", { credentials: "omit", cache: "no-store" });
    if (!res.ok) return;
    const info = await res.json();
    if (!info.open) {
      $("closed-note").hidden = false;
      form.hidden = true;
    }
    for (const p of info.products) {
      const card = document.querySelector(`.product[data-product="${p.id}"]`);
      if (card) {
        card.querySelector("[data-price]").textContent = money(p.price);
        card.querySelector("[data-reserved]").textContent = String(p.reserved);
        card.querySelector("[data-goal]").textContent = String(p.goal);
        card.querySelector("[data-bar]").style.width = `${Math.min(100, (100 * p.reserved) / p.goal)}%`;
        card.querySelector(".progress").hidden = false;
      }
      for (const el of document.querySelectorAll(`[data-chip="${p.id}"]`)) el.textContent = `${p.name} · ${money(p.price)}`;
      for (const el of document.querySelectorAll(`[data-deposit="${p.id}"]`)) el.textContent = money(p.deposit);
    }
  } catch {
    /* the page still works with the prices written in it */
  }
}

for (const b of document.querySelectorAll("[data-pick]")) {
  b.addEventListener("click", () => {
    const radio = form.querySelector(`input[name="product"][value="${b.dataset.pick}"]`);
    if (radio) radio.checked = true;
    $("reserve").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    $("p-email").focus({ preventScroll: true });
  });
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = new FormData(form);
  const product = data.get("product");
  if (!product) return setStatus("Pick the Nova Light or the SuperNova.", true);
  const email = String(data.get("email") || "").trim();
  if (!email || !$("p-email").checkValidity()) {
    $("p-email").focus();
    return setStatus("Enter a valid email address.", true);
  }
  if (!$("p-consent").checked) return setStatus("Tick the box to agree to the pre-order terms.", true);

  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  setStatus("Sending…");
  try {
    const res = await fetch("/api/preorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      cache: "no-store",
      body: JSON.stringify({
        product,
        email,
        name: data.get("name"),
        region: data.get("region"),
        car: data.get("car"),
        notes: data.get("notes"),
        website: data.get("website"),
        consent: true,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.error) {
      setStatus((body && body.error) || "Something went wrong. Please try again later.", true);
      status.focus();
      return;
    }
    setStatus("");
    form.hidden = true;
    $("thanks").hidden = false;
    $("thanks").focus();
  } catch {
    setStatus("Couldn't reach the server. Check your connection and try again.", true);
  } finally {
    button.disabled = false;
  }
});

$("again").addEventListener("click", () => {
  form.reset();
  $("thanks").hidden = true;
  form.hidden = false;
  $("p-email").focus();
});

load();
