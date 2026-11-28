// The yes/no page a picked tester reaches from their email. The token is in the #fragment, so it never
// reaches server logs; it's sent in a POST body. Saying yes means signing the first-generation
// disclosure (sign.js), the same one pre-order customers sign.
import { loadDisclosure } from "./sign.js";

document.documentElement.classList.replace("no-js", "js");

const token = location.hash.slice(1);
const $ = (id) => document.getElementById(id);
const title = $("inv-title");
const status = $("inv-status");
let name = "";

async function post(url, data) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      credentials: "omit",
      cache: "no-store",
    });
    const body = await res.json().catch(() => null);
    if (res.ok && body && !body.error) return body;
    return { error: (body && body.error) || "Something went wrong. Please try again later." };
  } catch {
    return { error: "Couldn't reach hardware.oceanlive.org. Check your connection and try again." };
  }
}

// EDIT: how each product is installed, for the "What testing involves" list.
const INSTALL = {
  light: "plugs into the spider port behind the dash trim and takes power from a fuse tap",
  supernova: "goes behind the center console trim: it plugs into the spider port, takes power from a fuse tap, and goes inline with the center screen's video cable",
  flare: "goes behind the center console trim, inline with the center screen's video cable, and works with a Nova Light at the spider port",
  quasar: "goes behind the center console trim, inline with the center screen's video cable, and works with a Nova Light at the spider port",
};
function installLine(products) {
  const which = (products || []).filter((p) => INSTALL[p]);
  const p = which.includes("supernova") ? "supernova" : which[0];
  $("inv-install").textContent = p
    ? `You install it: the ${{ light: "Nova Light", supernova: "SuperNova", flare: "Nova Flare", quasar: "Nova Quasar" }[p]} ${INSTALL[p]}. There's a guide, and I can talk you through it. Then you use it in your Ocean day to day.`
    : "You install it: a Nova Light plugs into the spider port behind the dash trim and takes power from a fuse tap; the screen products also go behind the center console. There's a guide, and I can talk you through it. Then you use it in your Ocean day to day.";
}

function show(state) {
  $("inv-ask").hidden = state !== "invited";
  $("inv-yes").hidden = state !== "accepted";
  $("inv-no").hidden = state !== "declined";
  title.textContent =
    state === "accepted" ? "You're testing Nova" :
    state === "declined" ? "Thanks for letting me know" :
    "You've been picked to test Nova";
  if (state === "invited") {
    $("inv-hello").textContent = `${name ? `Hi ${name}, t` : "T"}hanks for signing up. You're one of the few people I'd like to send a Nova test board to.`;
  }
}

async function sayNo() {
  for (const b of document.querySelectorAll("button")) b.disabled = true;
  status.textContent = "Sending…";
  const r = await post("/api/invite/answer", { token, answer: "no" });
  for (const b of document.querySelectorAll("button")) b.disabled = false;
  if (r.error) {
    status.textContent = r.error;
    status.classList.add("is-error");
    return status.focus();
  }
  status.textContent = "";
  show(r.status);
  title.focus();
}

const disclosure = loadDisclosure({
  mode: "tester",
  submitLabel: "Sign and say yes",
  onSign: async ({ signedName, signature }) => {
    const r = await post("/api/invite/answer", { token, answer: "yes", signedName, signature });
    if (r.error) return r.error;
    status.textContent = "";
    show(r.status);
    setTimeout(() => title.focus(), 0);
    return null;
  },
}).catch((e) => {
  status.textContent = e.message;
  status.classList.add("is-error");
  return null;
});

async function openDisclosure(signing) {
  const d = await disclosure;
  if (d) d.open(signing, name);
}

$("inv-yes-btn").addEventListener("click", () => openDisclosure(true));
$("inv-undo").addEventListener("click", () => openDisclosure(true));
$("inv-read").addEventListener("click", () => openDisclosure(false));
$("inv-reread").addEventListener("click", () => openDisclosure(false));
for (const b of document.querySelectorAll('[data-answer="no"]')) b.addEventListener("click", sayNo);

(async () => {
  if (!token) {
    title.textContent = "This link is incomplete";
    status.textContent = "Open the link from your invitation email again, or copy the whole link into your browser.";
    return;
  }
  const r = await post("/api/invite", { token });
  if (r.error) {
    title.textContent = "This link doesn't work";
    status.textContent = r.error;
    status.classList.add("is-error");
    return;
  }
  name = r.name || "";
  installLine(r.products);
  show(r.status);
})();
