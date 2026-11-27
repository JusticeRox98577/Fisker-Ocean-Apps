// The yes/no page a picked tester reaches from their email. The token is in the #fragment, so it never
// reaches server logs; it's sent in a POST body.
document.documentElement.classList.replace("no-js", "js");

const token = location.hash.slice(1);
const $ = (id) => document.getElementById(id);
const title = $("inv-title");
const status = $("inv-status");

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
    if (res.ok && body) return body;
    return { error: (body && body.error) || "Something went wrong. Please try again later." };
  } catch {
    return { error: "Couldn't reach hardware.oceanlive.org. Check your connection and try again." };
  }
}

function show(state, name) {
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

async function answer(a) {
  for (const b of document.querySelectorAll("[data-answer], #inv-undo")) b.disabled = true;
  status.textContent = "Sending…";
  const r = await post("/api/invite/answer", { token, answer: a });
  for (const b of document.querySelectorAll("[data-answer], #inv-undo")) b.disabled = false;
  if (r.error) {
    status.textContent = r.error;
    status.classList.add("is-error");
    status.focus();
    return;
  }
  status.textContent = "";
  show(r.status);
  title.focus?.();
}

for (const b of document.querySelectorAll("[data-answer]")) b.addEventListener("click", () => answer(b.dataset.answer));
$("inv-undo").addEventListener("click", () => answer("yes"));

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
  show(r.status, r.name);
})();
