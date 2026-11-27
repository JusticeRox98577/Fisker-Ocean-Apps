// Puts the real D1 database id into wrangler.jsonc during a Cloudflare Workers Build. The
// committed file keeps its REPLACE_WITH_* placeholder; the id comes from the build variable
// HARDWARE_D1_ID.
//
//   node scripts/fill-ids.mjs                           in a Workers Build (it sets WORKERS_CI=1)
//   node scripts/fill-ids.mjs --force --config <copy>   anywhere else, on a copy of the file
//
// It stops with an error when a variable is missing or doesn't look right, and it never prints the
// id. Running it again with the same variables changes nothing.
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FILLS = [
  {
    placeholder: "REPLACE_WITH_YOUR_D1_DATABASE_ID",
    variable: "HARDWARE_D1_ID",
    what: "the ocean-live-hardware database id (a UUID)",
    format: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  },
];

function fail(...lines) {
  for (const line of lines) console.error(`fill-ids: ${line}`);
  process.exit(1);
}

let force = false;
let configPath = fileURLToPath(new URL("../wrangler.jsonc", import.meta.url));
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--force") force = true;
  else if (args[i] === "--config" && args[i + 1]) configPath = resolve(args[++i]);
  else fail(`unknown argument "${args[i]}".`, "Usage: node scripts/fill-ids.mjs [--force] [--config <file>]");
}
const file = basename(configPath);

// Anywhere but a Workers Build this would write the id into the committed file.
const ci = String(process.env.WORKERS_CI ?? "").toLowerCase();
if (ci !== "1" && ci !== "true" && !force) {
  fail(
    `this only runs in a Cloudflare Workers Build (WORKERS_CI=1), so the committed ${file} keeps its placeholder.`,
    "To try it, copy the file and run: node scripts/fill-ids.mjs --force --config <copy>",
  );
}

let text;
try {
  text = readFileSync(configPath, "utf8");
} catch (e) {
  fail(`can't read ${configPath} (${e.code ?? e.message}).`);
}
const original = text;

const errors = [];
const filled = [];
for (const { placeholder, variable, what, format } of FILLS) {
  const value = String(process.env[variable] ?? "").trim();
  if (!value) {
    errors.push(`the build variable ${variable} is not set. It must hold ${what}.`);
    continue;
  }
  if (!format.test(value)) {
    errors.push(`the build variable ${variable} doesn't look like ${what}.`);
    continue;
  }
  const quoted = `"${placeholder}"`;
  const count = text.split(quoted).length - 1;
  if (count === 1) {
    text = text.replace(quoted, () => `"${value}"`);
    filled.push(variable);
  } else if (count > 1) {
    errors.push(`${placeholder} is in ${file} ${count} times; expected once.`);
  } else if (!text.includes(`"${value}"`)) {
    errors.push(`${file} has neither ${placeholder} nor the id from ${variable}.`);
  }
}

// A placeholder nobody fills would make the deploy fail later with a less clear message.
const known = new Set(FILLS.map((f) => `"${f.placeholder}"`));
const left = [...new Set(text.match(/"REPLACE_WITH_[A-Z0-9_]+"/g) ?? [])].filter((p) => !known.has(p));
if (left.length > 0) errors.push(`${file} still has ${left.join(", ")} with no build variable for it.`);

if (errors.length > 0) fail(...errors, `${file} was not changed.`);

if (text !== original) writeFileSync(configPath, text);
console.log(filled.length > 0 ? `fill-ids: put ${filled.join(" and ")} into ${file}.` : `fill-ids: the id was already in ${file}.`);
