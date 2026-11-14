// Deploys oceanlive.org (the static-assets Worker in wrangler.jsonc) without losing the APK downloads.
//
// The APKs are not in git. Before deploying, every download channel this run does not replace is
// fetched from the live site (latest.json and the files it lists), checked against its SHA-256 and
// put back into public/downloads/, so the deploy keeps it. public/downloads/ is removed afterwards.
//
// Channels:  stable  -> /downloads/OceanLive-Android.apk, /downloads/OceanLive-Wear.apk, /downloads/latest.json
//            preview -> the same under /downloads/preview/ (unlisted; never used by the pages)
//
// Usage (from the repository root or site/; Node 20+, no dependencies):
//   node site/tools/deploy.mjs                       site only, both channels kept as they are
//   node site/tools/deploy.mjs --channel stable|preview --android <apk> --wear <apk> \
//        --version <x.y.z> --build <n> --commit <sha>  publish new APKs to one channel
//   add --dry-run to fetch, verify and stage everything without calling wrangler.
// Wrangler reads CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID from the environment.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const WRANGLER = "wrangler@4.162.0";
const SITE = fileURLToPath(new URL("../", import.meta.url));
const DL = join(SITE, "public", "downloads");
const MAX_BYTES = 25 * 1024 * 1024; // Workers static assets: 25 MiB per file
const CHANNELS = { stable: "/downloads/", preview: "/downloads/preview/" };
const FILES = { android: "OceanLive-Android.apk", wear: "OceanLive-Wear.apk" };

const { values: opt } = parseArgs({
  options: {
    channel: { type: "string" },
    android: { type: "string" },
    wear: { type: "string" },
    version: { type: "string" },
    build: { type: "string" },
    commit: { type: "string" },
    base: { type: "string", default: "https://oceanlive.org" },
    "dry-run": { type: "boolean", default: false },
  },
  strict: true,
});

class DeployError extends Error {}
const die = (msg) => { throw new DeployError(msg); };
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const mib = (n) => (n / 1048576).toFixed(1) + " MiB";
const local = (urlPath) => join(SITE, "public", ...urlPath.split("/").filter(Boolean));

function checkArgs() {
  // Checked first, for every mode: the kept downloads are fetched from --base and then deployed.
  if (!/^(https:\/\/[^/]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/.test(opt.base)) die(`--base must be an https origin (or http://localhost for testing)`);
  // Another origin is for testing the fetch and verify logic only: never deploy its files to oceanlive.org.
  if (opt.base !== "https://oceanlive.org" && !opt["dry-run"]) die(`--base ${opt.base} is only allowed with --dry-run`);
  if (!opt.channel) {
    for (const k of ["android", "wear", "version", "build", "commit"]) if (opt[k]) die(`--${k} needs --channel`);
    return;
  }
  if (!(opt.channel in CHANNELS)) die(`--channel must be stable or preview, not "${opt.channel}"`);
  for (const k of ["android", "wear", "version", "build", "commit"]) if (!opt[k]) die(`--channel ${opt.channel} needs --${k}`);
  if (!/^\d+(\.\d+){1,3}$/.test(opt.version)) die(`--version "${opt.version}" is not x.y.z`);
  if (!/^\d+$/.test(opt.build)) die(`--build "${opt.build}" is not a number`);
  if (!/^[0-9a-f]{7,40}$/i.test(opt.commit)) die(`--commit "${opt.commit}" is not a commit SHA`);
}

async function get(url, what) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // Cache-busting query: the live copy, not one an edge or proxy kept.
      const r = await fetch(url + "?v=" + Date.now(), { headers: { "Cache-Control": "no-cache" }, redirect: "error" });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      last = e;
      if (attempt < 3) await new Promise((ok) => setTimeout(ok, 2000 * attempt));
    }
  }
  die(`could not fetch ${what} (${url}): ${last.message}. Not deploying, so the live downloads stay as they are.`);
}

// Fetches one live channel into public/downloads/. Returns false if it was never published.
async function keepLive(name) {
  const prefix = CHANNELS[name];
  const raw = await get(opt.base + prefix + "latest.json", `the ${name} latest.json`);
  if (!raw) { console.log(`${name}: not published yet (404), nothing to keep`); return false; }
  let info;
  try { info = JSON.parse(raw.toString("utf8")); } catch { die(`${name}: latest.json is not valid JSON`); }
  if (!info || typeof info.files !== "object") die(`${name}: latest.json has no files`);
  writeTo(prefix + "latest.json", raw);
  for (const [key, file] of Object.entries(FILES)) {
    const f = info.files[key];
    const path = prefix + file;
    if (!f) die(`${name}: latest.json does not list ${key}`);
    // Only the fixed paths are accepted, so latest.json can never point the deploy anywhere else.
    if (f.path !== path) die(`${name}: latest.json lists ${key} at "${f.path}", expected "${path}"`);
    if (!/^[0-9a-f]{64}$/.test(f.sha256)) die(`${name}: latest.json has no valid sha256 for ${key}`);
    const buf = await get(opt.base + path, `${name} ${file}`);
    if (!buf) die(`${name}: latest.json lists ${path} but it is missing (404)`);
    const got = sha256(buf);
    if (got !== f.sha256) die(`HASH MISMATCH for ${name} ${path}: latest.json says ${f.sha256}, downloaded file is ${got}. Not deploying.`);
    if (buf.length !== f.size) die(`SIZE MISMATCH for ${name} ${path}: latest.json says ${f.size} bytes, downloaded ${buf.length}. Not deploying.`);
    writeTo(path, buf);
    console.log(`${name}: kept ${path} (${mib(buf.length)}, sha256 ${got}) from ${info.version} build ${info.build}`);
  }
  return true;
}

// Puts the new APKs and their latest.json into public/downloads/ for one channel.
function publishNew(name) {
  const prefix = CHANNELS[name];
  const files = {};
  for (const [key, file] of Object.entries(FILES)) {
    const src = resolve(opt[key]);
    if (!existsSync(src) || !statSync(src).isFile()) die(`--${key} ${src} does not exist`);
    const buf = readFileSync(src);
    if (buf.length >= MAX_BYTES) die(`${src} is ${mib(buf.length)}; Cloudflare Workers static assets take files up to 25 MiB. Not deploying.`);
    if (buf.subarray(0, 4).toString("binary") !== "PK\x03\x04") die(`${src} is not an APK (zip) file`);
    const version = opt.version.replace(/\.0$/, "");
    files[key] = {
      name: `OceanLive-${version}-${key === "android" ? "Android" : "Wear"}.apk`,
      path: prefix + file,
      size: buf.length,
      sha256: sha256(buf),
    };
    writeTo(prefix + file, buf);
    console.log(`${name}: new ${prefix + file} (${mib(buf.length)}, sha256 ${files[key].sha256})`);
  }
  const info = {
    version: opt.version,
    short: opt.version.replace(/\.0$/, ""),
    build: Number(opt.build),
    commit: opt.commit,
    date: new Date().toISOString(),
    files,
  };
  writeTo(prefix + "latest.json", JSON.stringify(info, null, 2) + "\n");
}

function writeTo(urlPath, data) {
  const p = local(urlPath);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
}

function wrangler() {
  if (!process.env.CLOUDFLARE_API_TOKEN) console.log("CLOUDFLARE_API_TOKEN is not set: wrangler will use its own login, if any.");
  const r = spawnSync("npx", ["--yes", WRANGLER, "deploy"], { cwd: SITE, stdio: "inherit", shell: process.platform === "win32" });
  if (r.error) die(`could not start wrangler: ${r.error.message}`);
  if (r.status !== 0) die(`wrangler deploy failed (exit ${r.status})`);
}

let code = 0;
try {
  checkArgs();
  // Anything left from an earlier run is stale: start from an empty folder.
  rmSync(DL, { recursive: true, force: true });
  for (const name of Object.keys(CHANNELS)) {
    if (name === opt.channel) publishNew(name);
    else await keepLive(name);
  }
  if (opt["dry-run"]) {
    console.log("Dry run: staged the downloads above, skipped wrangler.");
  } else {
    wrangler();
    console.log(`Deployed${opt.channel ? `, with ${opt.channel} ${opt.version} build ${opt.build}` : " (site only, downloads kept)"}.`);
  }
} catch (e) {
  console.error(`::error::deploy: ${e instanceof DeployError ? e.message : e.stack || e}`);
  code = 1;
} finally {
  // Never leave APKs in the working tree.
  rmSync(DL, { recursive: true, force: true });
}
process.exit(code);
