// Ocean Live Status: reads /api/status (same origin) and draws it. Updates every minute while the tab is open.

const REFRESH_MS = 60_000;
const overall = document.getElementById("overall");
const title = document.getElementById("overall-title");
const checked = document.getElementById("checked");
const notice = document.getElementById("notice");
const list = document.getElementById("services");
const tpl = document.getElementById("service-tpl");

const OVERALL_TEXT = {
  up: "Everything is working",
  partial: "Some services have a problem",
  down: "Ocean Live is down",
  unknown: "Status unknown",
};

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", timeZone: "UTC" });

function pct(share) {
  if (share === null) return "No data";
  const p = share * 100;
  return `${p === 100 ? "100" : p.toFixed(p >= 99 ? 2 : 1)}% up`;
}

function minutesAgo(ms) {
  const m = Math.round((Date.now() - ms) / 60_000);
  if (m < 1) return "just now";
  if (m === 1) return "1 minute ago";
  if (m < 120) return `${m} minutes ago`;
  return `at ${timeFmt.format(ms)}`;
}

function bars(el, buckets, label) {
  el.replaceChildren(
    ...buckets.map((b) => {
      const s = document.createElement("span");
      s.className = b.total === 0 ? "" : b.up === b.total ? "up" : b.up === 0 ? "down" : "some";
      s.title = `${label(b.start)}: ${b.total ? `${b.up} of ${b.total} checks worked` : "no checks"}`;
      return s;
    }),
  );
}

function drawService(s) {
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.state = s.state;
  node.querySelector("h3").textContent = s.name;
  node.querySelector(".about-line").textContent = s.about;
  const state = node.querySelector(".service-state");
  state.textContent = s.state === "up" ? "Working" : s.state === "down" ? "Not working" : "Unknown";
  const detail = document.createElement("small");
  if (s.state === "up" && s.latencyMs !== null) detail.textContent = `Answered in ${s.latencyMs} ms`;
  else if (s.state === "down" && s.error) detail.textContent = s.error;
  if (detail.textContent) state.append(detail);

  node.querySelector(".pct-24").textContent = pct(s.uptime24h);
  node.querySelector(".pct-90").textContent = pct(s.uptime90d);
  const b24 = node.querySelector(".bars-24");
  const b90 = node.querySelector(".bars-90");
  bars(b24, s.last24h, (start) => `${timeFmt.format(start)}`);
  bars(b90, s.last90d, (start) => dayFmt.format(new Date(`${start}T00:00:00Z`)));
  b24.setAttribute("aria-label", `${s.name}, last 24 hours: ${pct(s.uptime24h)}`);
  b90.setAttribute("aria-label", `${s.name}, last 90 days: ${pct(s.uptime90d)}`);
  return node;
}

function draw(data) {
  overall.dataset.state = data.overall;
  title.textContent = data.stale && data.checkedAt !== null ? "Checks are running late" : OVERALL_TEXT[data.overall];
  checked.textContent =
    data.checkedAt === null ? "No checks yet. The first one runs within 5 minutes." : `Last checked ${minutesAgo(data.checkedAt)}.`;
  notice.textContent = data.notice;
  notice.hidden = !data.notice;
  list.replaceChildren(...data.services.map(drawService));
}

let timer = 0;

async function refresh() {
  clearTimeout(timer);
  try {
    const res = await fetch("/api/status", { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    draw(await res.json());
  } catch {
    if (overall.dataset.state === "loading") {
      overall.dataset.state = "unknown";
      title.textContent = OVERALL_TEXT.unknown;
    }
    checked.textContent = "Could not load the latest results. Trying again in a minute.";
  }
  if (!document.hidden) timer = setTimeout(refresh, REFRESH_MS);
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) clearTimeout(timer);
  else refresh();
});

refresh();
