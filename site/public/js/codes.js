// /codes: search the confirmed Ocean codes. The table is in the page already (written by
// tools/build-pages.mjs); this only filters its rows and explains a code that isn't listed,
// using /data/ocean-codes.json (made by tools/build-codes.mjs from the owner guide).

const form = document.querySelector(".codes-search");
const table = document.querySelector(".codes-table");

async function init() {
  if (!form || !table) return;
  let data;
  try {
    const res = await fetch("/data/ocean-codes.json", { credentials: "omit" });
    if (!res.ok) throw new Error(String(res.status));
    data = await res.json();
  } catch {
    return; // the search stays hidden; the full list is still on the page
  }
  const input = form.querySelector("input");
  const status = form.querySelector(".codes-status");
  const rows = [...table.querySelectorAll("tbody tr[data-i]")];
  const entries = rows.map((row) => {
    const e = data.codes[Number(row.dataset.i)] || { codes: [], meaning: "" };
    return { row, codes: e.codes, text: `${e.codes.join(" ")} ${e.meaning} ${e.note || ""}`.toLowerCase() };
  });

  function describe(code) {
    const parts = [];
    const system = data.systems[code[0]];
    if (system) parts.push(`${code[0]} means ${system}`);
    if (code.length === 7) {
      const suffix = data.suffixes[code.slice(5)];
      parts.push(suffix ? `the failure type ${code.slice(5)} usually means ${suffix}` : `the failure type is ${code.slice(5)}`);
    }
    return parts.length ? ` In ${code}, ${parts.join(" and ")}.` : "";
  }

  function search() {
    const raw = input.value.trim();
    // A pasted code may have spaces or a dash: "B2088-96", "b2088 96".
    const code = raw.toUpperCase().replace(/[\s-]/g, "");
    const isCode = /^[PCBU][0-9A-F]{4}([0-9A-F]{2})?$/.test(code);
    const q = raw.toLowerCase();
    let shown = 0;
    for (const e of entries) {
      const hit = !raw || (isCode ? e.codes.some((c) => c === code || (code.length === 5 && c.startsWith(code))) : e.text.includes(q));
      e.row.hidden = !hit;
      if (hit) shown++;
    }
    if (!raw) status.textContent = "";
    else if (shown) status.textContent = `${shown} ${shown === 1 ? "code matches" : "codes match"}.`;
    else if (isCode) status.textContent = `${code} is not in this list, which only has codes confirmed on Ocean cars.${describe(code)} Scan in Ocean Live's Faults tab and tap the code for its description when known, or ask "Any questions?" in the app.`;
    else status.textContent = `Nothing in this list matches "${raw}". Try a code, like B208896, or a word, like steering.`;
  }

  input.addEventListener("input", search);
  form.addEventListener("submit", (e) => { e.preventDefault(); search(); });
  form.hidden = false;
  if (input.value) search();
}

init();
