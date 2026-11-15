// Writes public/data/ocean-codes.json, the data behind oceanlive.org/codes, from the committed owner
// guide (ask-proxy/knowledge/ocean-guide.md) and nothing else: the code letters, the confirmed
// Ocean codes, the modules the app scans and the failure-type suffixes.
// The full fault code table is never published; this tool never reads it.
// Usage (from site/): node tools/build-codes.mjs, then node tools/build-pages.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const GUIDE = new URL("../../ask-proxy/knowledge/ocean-guide.md", import.meta.url);
const OUT = new URL("../public/data/ocean-codes.json", import.meta.url);

const md = readFileSync(GUIDE, "utf8").replace(/\r\n?/g, "\n");

// The text under a heading, up to the next heading of any level.
function section(title) {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => /^#{2,3} /.test(l) && l.replace(/^#+ /, "").trim() === title);
  if (start < 0) throw new Error(`"${title}" not found in ocean-guide.md`);
  const end = lines.findIndex((l, i) => i > start && /^#{1,3} /.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
}
const oneLine = (s) => s.replace(/\s+/g, " ").trim();
const CODE = /^[PCBU][0-9A-F]{6}$/;

// "a letter for the system (P powertrain, C chassis, B body, U network)"
const faults = section("Fault codes");
const letters = (faults.match(/letter for the system \(([^)]+)\)/) || [])[1];
if (!letters) throw new Error("system letters not found");
const systems = Object.fromEntries([...letters.matchAll(/\b([PCBU]) ([a-z]+)/g)].map((m) => [m[1], m[2]]));
if (Object.keys(systems).length !== 4) throw new Error("expected 4 system letters");

// The codes the guide calls common after the O-Loop / ovloop update.
const oloopLine = oneLine(faults).match(/Codes ([^.]*?) are common on cars running the O-Loop[^.]*\./);
if (!oloopLine) throw new Error("O-Loop note not found");
const oloop = new Set(oloopLine[1].match(/[PCBU][0-9A-F]{6}/g));
const OLOOP_NOTE = "Common on cars running the O-Loop / ovloop 2.2.3+ software, where it is usually a side effect of the update.";

// | Code | Meaning | rows; a row can list several codes ("U201162, U201262", "U114281 / U1142F1").
const codes = [];
for (const line of section("Ocean-specific codes confirmed from real cars").split("\n")) {
  const m = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/);
  if (!m || m[1] === "Code" || /^-+$/.test(m[1])) continue;
  const list = m[1].split(/\s*[,/]\s*/);
  for (const c of list) if (!CODE.test(c)) throw new Error(`not a code: ${c}`);
  const entry = { codes: list, meaning: m[2] };
  if (list.some((c) => oloop.has(c))) entry.note = OLOOP_NOTE;
  codes.push(entry);
}
if (codes.length < 5) throw new Error("too few codes parsed");

// "BMS (HV battery), BCM (body control), ..."
const modules = [...oneLine(section("Modules Ocean Live scans")).matchAll(/(?:^|,\s*)([^,(]+?)\s*\(([^)]+)\)/g)]
  .map((m) => ({ ids: m[1].trim(), name: m[2].trim() }));
if (modules.length < 20) throw new Error("too few modules parsed");

// "11 short to ground, 12 short to battery, ..."
const suffixes = Object.fromEntries([...oneLine(section("Common failure-type suffixes (last two characters)")).matchAll(/(?:^|,\s*)([0-9A-F]{2}) ([^,.]+)/g)]
  .map((m) => [m[1], m[2].trim()]));
if (Object.keys(suffixes).length < 10) throw new Error("too few suffixes parsed");

const data = { source: "ask-proxy/knowledge/ocean-guide.md", systems, suffixes, codes, modules };
mkdirSync(new URL(".", OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(data, null, 1) + "\n");
console.log(`wrote data/ocean-codes.json: ${codes.length} rows, ${modules.length} module groups, ${Object.keys(suffixes).length} suffixes`);
