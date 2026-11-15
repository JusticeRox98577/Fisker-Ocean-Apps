// /roadmap: the public roadmap with vote counts, from /api/roadmap (src/worker.js forwards it to
// the Ocean Live server). Voting happens on account.oceanlive.org, with an Ocean Live account.
// Everything from the server is inserted as text.

const root = document.querySelector("[data-roadmap]");
const STATUSES = ["in_progress", "planned", "done"];

async function load() {
  if (!root) return;
  const status = root.querySelector(".roadmap-status");
  let items;
  try {
    const res = await fetch("/api/roadmap", { credentials: "omit", headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    if (!data || !Array.isArray(data.items)) throw new Error("bad data");
    items = data.items;
  } catch {
    status.textContent = "The roadmap isn't available right now. Try again later, or see what's already out on Releases.";
    status.classList.add("is-error");
    return;
  }
  const valid = items.filter((i) => i && typeof i.title === "string" && STATUSES.includes(i.status));
  if (!valid.length) {
    status.textContent = "Nothing on the roadmap yet. Check back soon.";
    return;
  }
  for (const s of STATUSES) {
    const section = root.querySelector(`.roadmap-col[data-status="${s}"]`);
    const list = section.querySelector(".roadmap-list");
    const mine = valid.filter((i) => i.status === s);
    list.replaceChildren(...mine.map(card));
    section.hidden = mine.length === 0;
  }
  status.textContent = `${valid.length} ${valid.length === 1 ? "item" : "items"}.`;
  status.classList.add("is-quiet");
}

function card(item) {
  const li = document.createElement("li");
  li.className = "roadmap-item";
  const h = document.createElement("h3");
  h.textContent = item.title;
  li.append(h);
  if (typeof item.description === "string" && item.description.trim()) {
    const p = document.createElement("p");
    p.textContent = item.description;
    li.append(p);
  }
  const votes = Math.max(0, Math.floor(Number(item.votes) || 0));
  const meta = document.createElement("p");
  meta.className = "roadmap-votes";
  meta.textContent = `${votes} ${votes === 1 ? "vote" : "votes"}`;
  li.append(meta);
  return li;
}

load();
