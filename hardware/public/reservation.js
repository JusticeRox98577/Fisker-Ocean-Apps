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
  deposit_paid: "Your deposit is in. I'll email you before your unit ships.",
};

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
  const facts = [
    `Your price: ${money(r.price)}, locked at what it was when you reserved.`,
    `Refundable deposit when the batch is built: ${money(r.deposit)}. The rest is due before shipping.`,
    r.status === "deposit_paid" ? "Cancelling before shipping refunds your deposit." : "Nothing has been charged.",
  ];
  $("r-facts").replaceChildren(...facts.map((t) => Object.assign(document.createElement("li"), { textContent: t })));
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
