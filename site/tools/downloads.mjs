// Publishes the Android APKs to oceanlive.org's downloads: files in the R2 bucket ocean-live-downloads,
// which src/worker.js serves at fixed URLs. The site itself is not deployed. Layout and steps:
// tools/downloads-lib.mjs.
//
// Channels:  stable  -> /downloads/OceanLive-Android.apk, /downloads/OceanLive-Wear.apk, /downloads/latest.json
//            preview -> the same under /downloads/preview/ (unlisted; never used by the pages)
//
// Usage (from the repository root or site/; Node 20+, no dependencies):
//   node site/tools/downloads.mjs publish --channel stable|preview --android <apk> --wear <apk> \
//        --version <x.y.z> --build <n> --commit <sha>    upload a build and switch the channel to it
//   node site/tools/downloads.mjs seed [--base <origin>] [--skip <channel>]
//                                    copy each channel R2 doesn't have yet from the downloads deployed in
//                                    public/ the old way; --skip leaves a channel out (the Android workflow
//                                    skips the one it publishes next)
//   node site/tools/downloads.mjs check                   read-only: fail unless R2 has a valid stable
//                                                          channel (run before every deploy of the site)
//   add --dry-run to publish or seed to check (and for seed, fetch and verify) everything without calling wrangler.
// Wrangler reads CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID from the environment.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { DownloadsError, checkApk, checkChannel, checkR2, die, publish, seed } from "./downloads-lib.mjs";

const WRANGLER = "wrangler@4.162.0";
const BUCKET = "ocean-live-downloads";
// The site's workers.dev address: the same files, but outside oceanlive.org's bot protection.
const LIVE = "https://ocean-live-site.justicemw9857.workers.dev";
const NOT_FOUND = /The specified key does not exist/;

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const warn = (msg) => console.log(`::warning::${msg}`);

// R2 through wrangler (--remote: wrangler 4 works on a local copy otherwise). Each call is tried up to
// three times; a missing key is an answer, not a failure.
function wranglerR2(dir) {
  let n = 0;
  const win = process.platform === "win32";
  function run(what, args, capture) {
    let r;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const argv = ["--yes", WRANGLER, ...args, "--remote"];
      // On Windows npx is a .cmd file, which only starts through the shell.
      r = spawnSync("npx", win ? argv.map((a) => `"${a}"`) : argv, {
        cwd: dir,
        shell: win,
        encoding: "utf8",
        stdio: capture ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
        timeout: 10 * 60 * 1000,
        maxBuffer: 16 * 1024 * 1024,
      });
      if (r.error) die(`could not start wrangler for ${what}: ${r.error.message}`);
      if (r.status === 0 || (capture && NOT_FOUND.test(r.stdout + r.stderr))) return r;
      if (attempt < 3) {
        console.log(`${what} failed (exit ${r.status}), trying again`);
        sleep(2000 * attempt);
      }
    }
    if (capture) process.stderr.write(r.stderr || "");
    die(`${what} failed (exit ${r.status})`);
  }
  return {
    async get(key) {
      const file = join(dir, `get-${++n}`);
      const r = run(`reading ${key}`, ["r2", "object", "get", `${BUCKET}/${key}`, "--file", file], true);
      if (r.status !== 0) return null;
      const buf = readFileSync(file);
      rmSync(file, { force: true });
      return buf;
    },
    async put(key, buf, type) {
      const file = join(dir, `put-${++n}`);
      writeFileSync(file, buf);
      run(`uploading ${key}`, ["r2", "object", "put", `${BUCKET}/${key}`, "--file", file, "--content-type", type], false);
      rmSync(file, { force: true });
    },
    async delete(key) {
      run(`deleting ${key}`, ["r2", "object", "delete", `${BUCKET}/${key}`], false);
    },
  };
}

// A dry run never reaches R2; publish and seed don't call it then, and this makes sure.
const refuse = async () => die("a dry run must not touch R2");
const noR2 = { get: refuse, put: refuse, delete: refuse };

function readApk(path, flag) {
  const src = resolve(path);
  if (!existsSync(src) || !statSync(src).isFile()) die(`--${flag} ${src} does not exist`);
  const buf = readFileSync(src);
  checkApk(buf, src);
  return buf;
}

// Fetches a file of the site as deployed (the old static downloads); null for a 404.
function liveFetcher(base) {
  return async (path) => {
    let last;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        // Cache-busting query: the live copy, not one an edge or proxy kept.
        const r = await fetch(base + path + "?v=" + Date.now(), { headers: { "Cache-Control": "no-cache" }, redirect: "error" });
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return Buffer.from(await r.arrayBuffer());
      } catch (e) {
        last = e;
        if (attempt < 3) await new Promise((ok) => setTimeout(ok, 2000 * attempt));
      }
    }
    die(`could not fetch ${base + path}: ${last.message}. Nothing copied.`);
  };
}

let code = 0;
const tmp = mkdtempSync(join(tmpdir(), "ol-downloads-"));
try {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      strict: true,
      options: {
        channel: { type: "string" },
        android: { type: "string" },
        wear: { type: "string" },
        version: { type: "string" },
        build: { type: "string" },
        commit: { type: "string" },
        base: { type: "string" },
        skip: { type: "string" },
        "dry-run": { type: "boolean", default: false },
      },
    });
  } catch (e) {
    die(e.message);
  }
  const { values: opt, positionals } = parsed;
  const [command, ...extra] = positionals;
  if (extra.length) die(`unexpected argument "${extra[0]}"`);
  const dryRun = opt["dry-run"];
  const r2 = dryRun ? noR2 : wranglerR2(tmp);
  const tokenNote = () => {
    if (!dryRun && !process.env.CLOUDFLARE_API_TOKEN) console.log("CLOUDFLARE_API_TOKEN is not set: wrangler will use its own login, if any.");
  };

  if (command === "publish") {
    if (opt.base || opt.skip) die(`--${opt.base ? "base" : "skip"} is for seed only`);
    for (const k of ["channel", "android", "wear", "version", "build", "commit"]) if (!opt[k]) die(`publish needs --${k}`);
    checkChannel(opt.channel);
    const apks = { android: readApk(opt.android, "android"), wear: readApk(opt.wear, "wear") };
    tokenNote();
    const info = await publish({
      r2,
      channel: opt.channel,
      apks,
      version: opt.version,
      build: opt.build,
      commit: opt.commit,
      dryRun,
      warn,
    });
    console.log(dryRun ? "Dry run: nothing uploaded." : `Published ${info.version} build ${info.build} to the ${opt.channel} channel.`);
  } else if (command === "seed") {
    for (const k of ["channel", "android", "wear", "version", "build", "commit"]) if (opt[k]) die(`--${k} is for publish only`);
    const base = opt.base || LIVE;
    if (!/^(https:\/\/[^/]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/.test(base)) die("--base must be an https origin (or http://localhost for testing)");
    // Another origin is for testing the fetch and verify steps only: never copy its files into R2.
    if (![LIVE, "https://oceanlive.org"].includes(base) && !dryRun) die(`--base ${base} is only allowed with --dry-run`);
    if (opt.skip) checkChannel(opt.skip);
    tokenNote();
    const done = await seed({ r2, fetchLive: liveFetcher(base), skip: opt.skip ? [opt.skip] : [], dryRun, warn });
    const summary = Object.entries(done).map(([channel, what]) => `${channel} ${what}`).join(", ");
    console.log(`Seed done: ${summary}.${dryRun ? " Dry run: nothing uploaded." : ""}`);
  } else if (command === "check") {
    for (const k of ["channel", "android", "wear", "version", "build", "commit", "base", "skip"]) if (opt[k]) die(`--${k} is not used by check`);
    if (dryRun) die("check only reads R2; it has no --dry-run");
    tokenNote();
    await checkR2({ r2, warn });
    console.log("R2 has the stable downloads, so the site can be deployed.");
  } else {
    die(`the first argument must be publish, seed or check${command ? `, not "${command}"` : ""} (usage at the top of site/tools/downloads.mjs)`);
  }
} catch (e) {
  console.error(`::error::downloads: ${e instanceof DownloadsError ? e.message : e.stack || e}`);
  code = 1;
} finally {
  // Never leave APK copies behind.
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(code);
