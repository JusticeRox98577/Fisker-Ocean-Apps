// The page the reservation emails link to. The token is in the #fragment, so it never reaches server
// logs; it's sent in a POST body. Opening the link from the first email confirms the reservation.
document.documentElement.classList.replace("no-js", "js");

const token = location.hash.slice(1);
const $ = (id) => document.getElementById(id);
const title = $("r-title");
const status = $("r-status");
const money = (cents) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

async function post(url) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      credentials: "omit",
      cache: "no-store",
    });
    const body = await res.json().catch(() => null);
    if (res.ok && body) return body;
    return { error: (body && body.error) || "Something went wrong. Please try again later." };
  } catch {
    return { error: "Couldn't reach the server. Check your connection and try again." };
  }
}

function fail(msg) {
  status.textContent = msg;
  status.classList.add("is-error");
}

const LINES = {
  deposit_requested: "The deposit link is in your email. Pay it to keep your place.",
  deposit_paid: "Your deposit is in. I'll email you for the rest right before I order the parts.",
  balance_requested: "The parts are about to be ordered: the link for the rest of the price is in your email.",
  paid: "You've paid in full. Follow your batch's build below.",
};

function renderBuild(r) {
  const list = $("r-build");
  $("r-build-line").textContent = r.batch
    ? `Batch ${r.batch}. Each step is ticked off as it happens.`
    : "Your batch starts when it's paid in full, right before the parts are ordered. Here's what happens then:";
  list.replaceChildren(...(r.build || []).map((s) => {
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

function show(r) {
  const cancelled = r.status === "cancelled";
  const left = Math.max(0, r.goal - r.reserved);
  title.textContent = cancelled ? `Your ${r.productName} reservation is cancelled` : `You've reserved a ${r.productName}`;
  let text = LINES[r.status] || "";
  if (cancelled) text = "Nothing was charged. You can reserve again below.";
  if (r.status === "confirmed") {
    text = left > 0
      ? `You're number ${r.position} in line. ${left} more ${left === 1 ? "reservation" : "reservations"} and this batch gets built.`
      : `You're number ${r.position} in line. This batch has enough reservations: watch your email for the deposit link.`;
  }
  $("r-line").textContent = text;
  $("r-bar").style.width = `${Math.min(100, (100 * r.reserved) / r.goal)}%`;
  $("r-count").textContent = `${r.reserved} of ${r.goal} reserved`;
  const closed = r.status === "balance_requested" || r.status === "paid";
  const next = (r.tiers || []).find(([from]) => from > r.reserved);
  const off = r.bundleOff || 0;
  const facts = [
    closed
      ? `Your batch's final price: ${money(r.price)}.`
      : `Your price right now: ${money(r.price)}${r.price < r.reservedAt ? ` (down from ${money(r.reservedAt)} when you reserved)` : ""}. You never pay more than ${money(r.reservedAt)}.`,
    !closed && next ? `${next[0] - r.reserved} more reservations and it drops to ${money(Math.min(r.reservedAt, next[1] - off))} for everyone in your batch.` : "",
    r.bundle === "light" ? "A Nova Light was reserved with it at the bundle price; it has its own reservation and status link." : "",
    r.bundleOff ? "This Light is at the bundle price, because it came with a Flare or Quasar." : "",
    `Refundable deposit at ${r.goal} reservations: ${money(r.deposit)}. The rest is due right before the parts are ordered.`,
    r.status === "paid" ? "Paid in full."
      : ["deposit_paid", "balance_requested"].includes(r.status) ? "Deposit paid. You can cancel and get it back until you've paid in full."
      : "Nothing has been charged.",
  ].filter(Boolean);
  $("r-facts").replaceChildren(...facts.map((t) => Object.assign(document.createElement("li"), { textContent: t })));
  renderBuild(r);
  $("r-cancel-row").hidden = cancelled;
  $("r-sure").hidden = true;
  $("r-again-row").hidden = !cancelled;
  $("r-view").hidden = false;
}

async function act(url, working) {
  const buttons = document.querySelectorAll("#r-view button");
  for (const b of buttons) b.disabled = true;
  status.textContent = working;
  status.classList.remove("is-error");
  const r = await post(url);
  for (const b of buttons) b.disabled = false;
  if (r.error) return fail(r.error);
  status.textContent = "";
  show(r);
  title.focus();
}

$("r-cancel").addEventListener("click", () => {
  $("r-cancel-row").hidden = true;
  $("r-sure").hidden = false;
  $("r-cancel-yes").focus();
});
$("r-cancel-no").addEventListener("click", () => {
  $("r-sure").hidden = true;
  $("r-cancel-row").hidden = false;
});
$("r-cancel-yes").addEventListener("click", () => act("/api/reservation/cancel", "Cancelling…"));
$("r-again").addEventListener("click", () => act("/api/reservation/confirm", "Reserving…"));

(async () => {
  if (!token) {
    title.textContent = "This link is incomplete";
    return fail("Open the link from your email again, or copy the whole link into your browser.");
  }
  let r = await post("/api/reservation");
  if (r.error) {
    title.textContent = "This link doesn't work";
    return fail(r.error);
  }
  if (r.status === "unconfirmed") {
    r = await post("/api/reservation/confirm");
    if (r.error) return fail(r.error);
    status.textContent = "Confirmed. Thank you!";
  }
  show(r);
})();
