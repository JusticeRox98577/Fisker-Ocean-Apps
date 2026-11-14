// Turns a Fisker DTC table into a file for `wrangler kv bulk put`.
//
//   node scripts/build-dtc-kv.mjs <table.json> [more.json ...]   ->  dtc-kv.json (git-ignored)
//
// Accepts the formats Ocean Live imports: {"CODE": {"name", "ecu", "severity", "fix"}},
// {"codes": [{"code", "name", "ecu", "severity", "one_line_fix"}]} or {"dtcLabels": {...}}.
// Codes are grouped by their first three characters ("dtc:B20" holds every B20xxxx code), so
// the whole table is a few hundred KV keys, inside the free plan's 1,000 writes a day.
// The table itself is never committed: only the person deploying the proxy uploads it.
import { readFileSync, writeFileSync } from "node:fs";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node scripts/build-dtc-kv.mjs <table.json> [more.json ...]");
  process.exit(1);
}

const CODE = /^[PCBU][0-9A-F]{4}([0-9A-F]{2})?$/;
const clean = (s) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "") || undefined;
const codes = new Map();

for (const file of files) {
  const root = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, ""));
  const table = root.dtcLabels ?? root.codes ?? root;
  const entries = Array.isArray(table) ? table.map((e) => [e.code, e]) : Object.entries(table);
  for (const [raw, v] of entries) {
    const code = String(raw ?? "").trim().toUpperCase();
    if (!CODE.test(code)) continue;
    const e = typeof v === "string" ? { name: v } : v ?? {};
    const entry = {
      name: clean(e.name ?? e.description ?? e.title ?? e.label),
      module: clean(e.ecu),
      severity: clean(e.severity),
      fix: clean(e.fix ?? e.one_line_fix ?? e.oneLineFix),
    };
    if (!entry.name && !entry.fix) continue;
    // Earlier files win; later files only fill gaps.
    const old = codes.get(code) ?? {};
    codes.set(code, { ...entry, ...Object.fromEntries(Object.entries(old).filter(([, x]) => x)) });
  }
}

const groups = new Map();
for (const [code, entry] of codes) {
  const key = `dtc:${code.slice(0, 3)}`;
  if (!groups.has(key)) groups.set(key, {});
  groups.get(key)[code] = entry;
}

const bulk = [...groups].map(([key, value]) => ({ key, value: JSON.stringify(value) }));
writeFileSync("dtc-kv.json", JSON.stringify(bulk));
console.log(`${codes.size} codes in ${bulk.length} keys written to dtc-kv.json`);
