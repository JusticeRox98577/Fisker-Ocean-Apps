// Puts the real KV namespace and D1 database ids, and the [vars] kept out of this public repo, into
// wrangler.toml during a Cloudflare Workers Build. The committed file keeps its REPLACE_WITH_*
// placeholders and empty values; they come from build variables:
//   ASK_KV_ID, ASK_D1_ID                        the ids
//   GOOGLE_WEB_CLIENT_ID, GOOGLE_IOS_CLIENT_ID  [vars] of the same name (Sign in with Google)
//   REVIEW_EMAIL                                [vars] of the same name (store review sign-in)
// Every one is required: every deploy gives the live Worker the [vars] in this file, so a build
// without them would turn Google sign-in and the review sign-in off.
//
//   node scripts/fill-ids.mjs                           in a Workers Build (it sets WORKERS_CI=1)
//   node scripts/fill-ids.mjs --force --config <copy>   anywhere else, on a copy of the file
//
// It stops with an error when a variable is missing or doesn't look right, and then changes nothing.
// It never prints the ids or the values. Running it again with the same variables changes nothing.
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GOOGLE_CLIENT_ID = /^[0-9A-Za-z-]+\.apps\.googleusercontent\.com$/;
// Plain characters only, so the value can go between quotes in the file as it is.
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

const IDS = [
  { placeholder: "REPLACE_WITH_YOUR_KV_NAMESPACE_ID", variable: "ASK_KV_ID", what: "the ASK_KV namespace id (32 hex characters)", format: /^[0-9a-f]{32}$/i },
  { placeholder: "REPLACE_WITH_YOUR_D1_DATABASE_ID", variable: "ASK_D1_ID", what: "the ocean-live-ask-log database id (a UUID)", format: UUID },
];
const VARS = [
  { name: "GOOGLE_WEB_CLIENT_ID", what: "the Google web client ID (it ends in .apps.googleusercontent.com)", format: GOOGLE_CLIENT_ID },
  { name: "GOOGLE_IOS_CLIENT_ID", what: "the Google iOS client ID (it ends in .apps.googleusercontent.com)", format: GOOGLE_CLIENT_ID },
  { name: "REVIEW_EMAIL", what: "the store review sign-in address (an email address)", format: EMAIL },
];

function fail(...lines) {
  for (const line of lines) console.error(`fill-ids: ${line}`);
  process.exit(1);
}

let force = false;
let configPath = fileURLToPath(new URL("../wrangler.toml", import.meta.url));
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--force") force = true;
  else if (args[i] === "--config" && args[i + 1]) configPath = resolve(args[++i]);
  else fail(`unknown argument "${args[i]}".`, "Usage: node scripts/fill-ids.mjs [--force] [--config <file>]");
}
const file = basename(configPath);

// Anywhere but a Workers Build this would write the ids into the committed file.
const ci = String(process.env.WORKERS_CI ?? "").toLowerCase();
if (ci !== "1" && ci !== "true" && !force) {
  fail(
    `this only runs in a Cloudflare Workers Build (WORKERS_CI=1), so the committed ${file} keeps its placeholders.`,
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

// A build variable's value, or null (with the reason in errors) when it is missing or malformed.
function variable(name, what, format) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) errors.push(`the build variable ${name} is not set. It must hold ${what}.`);
  else if (!format.test(value)) errors.push(`the build variable ${name} doesn't look like ${what}.`);
  else return value;
  return null;
}

const filled = [];
for (const { placeholder, variable: name, what, format } of IDS) {
  const value = variable(name, what, format);
  if (value === null) continue;
  const quoted = `"${placeholder}"`;
  const count = text.split(quoted).length - 1;
  if (count === 1) {
    text = text.replace(quoted, () => `"${value}"`);
    filled.push(name);
  } else if (count > 1) {
    errors.push(`${placeholder} is in ${file} ${count} times; expected once.`);
  } else if (!text.includes(`"${value}"`)) {
    errors.push(`${file} has neither ${placeholder} nor the id from ${name}.`);
  }
}

// A placeholder nobody fills would make the deploy fail later with a less clear message.
const known = new Set(IDS.map((f) => `"${f.placeholder}"`));
const left = [...new Set(text.match(/"REPLACE_WITH_[A-Z0-9_]+"/g) ?? [])].filter((p) => !known.has(p));
if (left.length > 0) errors.push(`${file} still has ${left.join(", ")} with no build variable for it.`);

// The [vars] table: from the line after its header to the next table header, or the end of the file.
const header = /^\[vars\][ \t]*\r?$/m.exec(text);
const setVars = [];
if (!header) {
  errors.push(`${file} has no [vars] table.`);
} else {
  const start = text.indexOf("\n", header.index) + 1;
  const next = text.slice(start).search(/^[ \t]*\[/m);
  const end = next < 0 ? text.length : start + next;
  let body = text.slice(start, end);
  for (const { name, what, format } of VARS) {
    const value = variable(name, what, format);
    if (value === null) continue;
    // NAME = "value" on one line, a plain string (an optional comment after it).
    const line = new RegExp(`^([ \\t]*${name}[ \\t]*=[ \\t]*)"([^"\\\\\\r\\n]*)"`, "gm");
    const found = [...body.matchAll(line)];
    if (found.length !== 1) {
      errors.push(found.length === 0 ? `[vars] in ${file} has no ${name} = "".` : `[vars] in ${file} has ${name} ${found.length} times; expected once.`);
    } else if (found[0][2] === "") {
      body = body.replace(line, (_, lead) => `${lead}"${value}"`);
      setVars.push(name);
    } else if (found[0][2] !== value) {
      errors.push(`${name} in [vars] of ${file} already has another value. Keep it "" in the repo; the build variable ${name} sets it.`);
    }
  }
  text = text.slice(0, start) + body + text.slice(end);
}

if (errors.length > 0) fail(...errors, `${file} was not changed.`);

if (text !== original) writeFileSync(configPath, text);
console.log(filled.length > 0 ? `fill-ids: put ${filled.join(" and ")} into ${file}.` : `fill-ids: the ids were already in ${file}.`);
console.log(
  setVars.length > 0
    ? `fill-ids: set ${setVars.join(", ")} in [vars] of ${file}.`
    : `fill-ids: ${VARS.map((v) => v.name).join(", ")} were already set in ${file}.`,
);
