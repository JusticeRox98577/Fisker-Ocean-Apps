// The APK download channels in R2: the layout, and the publish, seed and check steps of tools/downloads.mjs.
// Kept apart from that script so tools/downloads.test.mjs can run them against a fake bucket.
//
// Bucket ocean-live-downloads (bound as DOWNLOADS in wrangler.jsonc; src/worker.js serves it):
//   <channel>/b<build>-<commit>/OceanLive-Android.apk   one folder per build; a file oceanlive.org
//   <channel>/b<build>-<commit>/OceanLive-Wear.apk      serves is never overwritten
//   <channel>/latest.json   the public latest.json, plus per file "object" (the key its fixed URL serves)
//                           and "previous" (the build before, kept so downloads already running can finish)
// Channels: stable (/downloads/, the one the pages use) and preview (/downloads/preview/, unlisted).
//
// A publish uploads the build's two files and reads them back, writes latest.json last (the one write
// that switches oceanlive.org to the new build), then deletes the build before the previous one.
import { createHash } from "node:crypto";

export const CHANNELS = { stable: "/downloads/", preview: "/downloads/preview/" };
export const FILES = { android: "OceanLive-Android.apk", wear: "OceanLive-Wear.apk" };
export const APK_TYPE = "application/vnd.android.package-archive";
export const JSON_TYPE = "application/json";
export const MAX_BYTES = 300 * 1024 * 1024; // wrangler r2 object put uploads files up to 300 MiB
// The same pattern as DOWNLOAD_OBJECT in src/worker.js, which serves nothing else.
export const OBJECT_KEY = /^(stable|preview)\/b\d{1,9}-[0-9a-f]{7,8}\/(OceanLive-(?:Android|Wear)\.apk)$/;

export class DownloadsError extends Error {}
export const die = (msg) => {
  throw new DownloadsError(msg);
};
export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
export const mib = (n) => (n / 1048576).toFixed(1) + " MiB";
export const latestKey = (channel) => `${channel}/latest.json`;
export const shortVersion = (version) => version.replace(/\.0$/, "");
const validName = (name) => (typeof name === "string" && /^[\w.-]{1,100}\.apk$/.test(name) ? name : null);

export function checkChannel(channel) {
  if (!Object.hasOwn(CHANNELS, String(channel))) die(`channel must be stable or preview, not "${channel}"`);
}
export function checkVersion(version) {
  if (typeof version !== "string" || !/^\d+(\.\d+){1,3}$/.test(version)) die(`version "${version}" is not x.y.z`);
}
export function checkBuild(build) {
  if (!/^\d{1,9}$/.test(String(build))) die(`build "${build}" is not a number`);
}
export function checkCommit(commit) {
  if (typeof commit !== "string" || !/^[0-9a-f]{7,40}$/i.test(commit)) die(`commit "${commit}" is not a commit SHA`);
}
export function checkApk(buf, what) {
  if (!buf || !buf.length) die(`${what} is empty`);
  if (buf.length > MAX_BYTES) die(`${what} is ${mib(buf.length)}; wrangler uploads files up to 300 MiB`);
  if (Buffer.from(buf.subarray(0, 4)).toString("binary") !== "PK\x03\x04") die(`${what} is not an APK (zip) file`);
}

// The R2 key of one build's file, for example preview/b123-0123abcd/OceanLive-Android.apk.
export function objectKey(channel, build, commit, key) {
  const k = `${channel}/b${Number(build)}-${commit.slice(0, 8).toLowerCase()}/${FILES[key]}`;
  if (!OBJECT_KEY.test(k)) die(`${k} is not a valid download object key`);
  return k;
}

// The name the browser saves the file as, for example OceanLive-1.4-Android.apk.
export const fileName = (version, key) => `OceanLive-${shortVersion(version)}-${key === "android" ? "Android" : "Wear"}.apk`;

// Reads a latest.json: the one deployed in public/ the old way (stored = false), or the one in R2
// (stored = true, with "object" and "previous"). Throws a DownloadsError when anything is off.
export function parseLatest(raw, channel, stored) {
  let info;
  try {
    info = JSON.parse(Buffer.from(raw).toString("utf8"));
  } catch {
    die(`${channel}: latest.json is not valid JSON`);
  }
  if (!info || typeof info !== "object" || !info.files || typeof info.files !== "object") die(`${channel}: latest.json has no files`);
  checkVersion(info.version);
  if (!Number.isSafeInteger(info.build)) die(`${channel}: latest.json has no build number`);
  checkBuild(info.build);
  checkCommit(info.commit);
  const objectOk = (k, file) => {
    const m = typeof k === "string" ? OBJECT_KEY.exec(k) : null;
    return !!m && m[1] === channel && m[2] === file;
  };
  for (const [key, file] of Object.entries(FILES)) {
    const f = info.files[key];
    const path = CHANNELS[channel] + file;
    if (!f || typeof f !== "object") die(`${channel}: latest.json does not list ${key}`);
    // Only the fixed paths are accepted, so latest.json can never point anywhere else.
    if (f.path !== path) die(`${channel}: latest.json lists ${key} at "${f.path}", expected "${path}"`);
    if (typeof f.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(f.sha256)) die(`${channel}: latest.json has no valid sha256 for ${key}`);
    if (!Number.isSafeInteger(f.size) || f.size <= 0) die(`${channel}: latest.json has no valid size for ${key}`);
    if (stored && !objectOk(f.object, file)) die(`${channel}: latest.json names "${f.object}" for ${key}, not a ${channel} object`);
    if (stored && info.previous != null && !objectOk(info.previous[key], file)) die(`${channel}: latest.json has an invalid previous ${key}`);
  }
  return info;
}

// The "previous" of a new latest.json: the build the old one served, so a download that started on it
// can finish. Publishing the same build again (a re-run) keeps the build before it instead.
export function previousOf(old, objects) {
  if (!old) return null;
  const current = Object.fromEntries(Object.keys(FILES).map((k) => [k, old.files[k].object]));
  if (Object.keys(FILES).every((k) => current[k] === objects[k])) return old.previous || null;
  return current;
}

// The objects the old latest.json used that the new one doesn't: the build before the previous one.
// Only build objects of this channel, never latest.json or anything else.
export function cleanupKeys(old, next, channel) {
  const used = (info) => (info ? [...Object.values(info.files).map((f) => f.object), ...Object.values(info.previous || {})] : []);
  const keep = new Set(used(next));
  return [...new Set(used(old))].filter((k) => !keep.has(k) && OBJECT_KEY.exec(k)?.[1] === channel);
}

/**
 * Publishes one build to a channel and returns its new latest.json (null when nothing was written).
 * r2: { get(key) -> Buffer | null, put(key, buffer, contentType), delete(key) }; apks: { android, wear } Buffers.
 * onlyIfNew leaves a channel that R2 already has as it is. dryRun checks everything and touches no R2.
 */
export async function publish({ r2, channel, apks, version, build, commit, date, names = {}, onlyIfNew = false, dryRun = false, log = console.log, warn = console.log }) {
  checkChannel(channel);
  checkVersion(version);
  checkBuild(build);
  checkCommit(commit);
  const files = {};
  const objects = {};
  for (const [key, file] of Object.entries(FILES)) {
    const buf = apks[key];
    checkApk(buf, `the ${key} APK`);
    objects[key] = objectKey(channel, build, commit, key);
    files[key] = {
      name: validName(names[key]) || fileName(version, key),
      path: CHANNELS[channel] + file,
      size: buf.length,
      sha256: sha256(buf),
      object: objects[key],
    };
  }

  let old = null;
  if (dryRun) {
    log(`${channel}: dry run, so R2 is not read: the previous build and the clean-up are not worked out`);
  } else {
    const raw = await r2.get(latestKey(channel));
    if (raw && onlyIfNew) {
      log(`${channel}: already in R2, left as it is`);
      return null;
    }
    if (raw) {
      try {
        old = parseLatest(raw, channel, true);
      } catch (e) {
        if (!(e instanceof DownloadsError)) throw e;
        warn(`${channel}: the latest.json in R2 is not valid (${e.message}); replacing it, without cleaning up its files`);
      }
    }
  }

  const info = {
    version,
    short: shortVersion(version),
    build: Number(build),
    commit,
    date: typeof date === "string" && date ? date : new Date().toISOString(),
    files,
    previous: previousOf(old, objects),
  };

  for (const key of Object.keys(FILES)) {
    const k = objects[key];
    const f = files[key];
    const served = old && old.files[key].object === k ? old.files[key] : null;
    if (served) {
      // The same build again: its file is the one oceanlive.org serves now, so it is never overwritten.
      if (served.sha256 !== f.sha256 || served.size !== f.size) {
        die(`${k} is the file oceanlive.org serves now (sha256 ${served.sha256}) and this ${key} APK is different (sha256 ${f.sha256}). Not overwriting a served file: publish it with a new build number.`);
      }
      log(`${channel}: ${k} is already in R2 with the same SHA-256, not uploaded again`);
      continue;
    }
    if (dryRun) {
      log(`${channel}: would upload ${k} (${mib(f.size)}, sha256 ${f.sha256})`);
      continue;
    }
    await r2.put(k, apks[key], APK_TYPE);
    // Read it back: latest.json only ever names a file that matches its SHA-256 and size.
    const back = await r2.get(k);
    if (!back || back.length !== f.size || sha256(back) !== f.sha256) {
      die(`${k} in R2 does not match the file uploaded. latest.json is unchanged, so oceanlive.org still offers the build it had.`);
    }
    log(`${channel}: uploaded ${k} (${mib(f.size)}, sha256 ${f.sha256})`);
  }

  const json = JSON.stringify(info, null, 2) + "\n";
  if (dryRun) {
    log(`${channel}: would write ${latestKey(channel)} last:\n${json.trimEnd()}`);
    return info;
  }
  if (onlyIfNew && (await r2.get(latestKey(channel)))) {
    warn(`${channel}: a latest.json appeared in R2 meanwhile; left as it is (the files uploaded above are not used)`);
    return null;
  }
  await r2.put(latestKey(channel), Buffer.from(json), JSON_TYPE);
  log(`${channel}: ${latestKey(channel)} now names ${version} build ${info.build}`);

  for (const k of cleanupKeys(old, info, channel)) {
    try {
      await r2.delete(k);
      log(`${channel}: deleted ${k}`);
    } catch (e) {
      warn(`${channel}: could not delete ${k} (${e.message}); the downloads are not affected`);
    }
  }
  return info;
}

/**
 * Checks that R2 has a valid stable channel, the download the pages offer. Run before every deploy of
 * the site, so the Worker that serves R2 never goes live without it. A missing or broken preview is only
 * reported. Reads latest.json only; returns { stable, preview } (null for a preview that isn't usable).
 */
export async function checkR2({ r2, log = console.log, warn = console.log }) {
  const out = {};
  for (const channel of Object.keys(CHANNELS)) {
    const raw = await r2.get(latestKey(channel));
    let info = null;
    let problem = raw ? null : `R2 has no ${latestKey(channel)}`;
    if (raw) {
      try {
        info = parseLatest(raw, channel, true);
      } catch (e) {
        if (!(e instanceof DownloadsError)) throw e;
        problem = `the ${latestKey(channel)} in R2 is not valid (${e.message})`;
      }
    }
    if (problem && channel === "stable") {
      die(`stable: ${problem}, so oceanlive.org would offer no download. Copy the old site's downloads first (downloads.mjs seed), or publish the latest release (downloads.mjs publish --channel stable ...).`);
    }
    if (problem) warn(`${channel}: ${problem}; its download URLs answer 404 or 503 until the next publish to it`);
    else log(`${channel}: ${info.version} build ${info.build} (${info.files.android.object}, ${info.files.wear.object})`);
    out[channel] = info;
  }
  return out;
}

/**
 * Copies each channel R2 doesn't have yet from the downloads deployed in public/ the old way.
 * fetchLive(path) -> Buffer, or null for a 404. Every file is checked against the live latest.json's
 * SHA-256 and size before anything is uploaded, and latest.json is written last, as in publish.
 * A channel R2 already has is never overwritten; when the site offers a newer build of it (a release
 * published the old way after the copy), that is reported. It fails when the stable channel is neither
 * in R2 nor on the site, or the site's stable build is newer than R2's, so it never reports success
 * while oceanlive.org would offer no download or an older one.
 * skip: channels left out, such as the one the Android workflow publishes right after (that publish
 * replaces it anyway, and fixes a missing or broken one). Returns what happened to each channel.
 */
export async function seed({ r2, fetchLive, skip = [], dryRun = false, log = console.log, warn = console.log }) {
  const problems = [];
  const done = {};
  for (const channel of Object.keys(CHANNELS)) {
    if (skip.includes(channel)) {
      log(`${channel}: skipped`);
      done[channel] = "skipped";
      continue;
    }
    if (dryRun) log(`${channel}: dry run, so R2 is not checked for this channel`);
    else {
      const stored = await r2.get(latestKey(channel));
      if (stored) {
        const problem = await compareWithSite(channel, stored, fetchLive, log);
        if (problem && channel === "stable") problems.push(problem);
        else if (problem) warn(problem);
        done[channel] = "already in R2";
        continue;
      }
    }
    const raw = await fetchLive(CHANNELS[channel] + "latest.json");
    if (!raw) {
      if (channel === "stable") {
        problems.push(`stable: the site has no stable channel to copy (404)${dryRun ? "" : " and R2 has none either"}. If Cloudflare already deploys the site from R2, publish the latest GitHub release to R2 by hand (downloads.mjs publish --channel stable ...).`);
      } else log(`${channel}: not on the site (404), nothing to copy`);
      done[channel] = "not on the site";
      continue;
    }
    const live = parseLatest(raw, channel, false);
    const apks = {};
    for (const key of Object.keys(FILES)) {
      const f = live.files[key];
      const buf = await fetchLive(f.path);
      if (!buf) die(`${channel}: latest.json lists ${f.path} but it is missing (404)`);
      const got = sha256(buf);
      if (got !== f.sha256) die(`HASH MISMATCH for ${channel} ${f.path}: latest.json says ${f.sha256}, the downloaded file is ${got}. Nothing copied for ${channel}.`);
      if (buf.length !== f.size) die(`SIZE MISMATCH for ${channel} ${f.path}: latest.json says ${f.size} bytes, downloaded ${buf.length}. Nothing copied for ${channel}.`);
      apks[key] = buf;
      log(`${channel}: fetched ${f.path} (${mib(buf.length)}, sha256 ${got}) of ${live.version} build ${live.build}`);
    }
    const info = await publish({
      r2,
      channel,
      apks,
      version: live.version,
      build: live.build,
      commit: live.commit,
      date: live.date,
      names: { android: live.files.android.name, wear: live.files.wear.name },
      onlyIfNew: true,
      dryRun,
      log,
      warn,
    });
    done[channel] = dryRun ? "checked (dry run)" : info ? "copied" : "already in R2";
  }
  if (problems.length) die(problems.join(" "));
  return done;
}

// A channel R2 already has, against the site's: a message when R2's latest.json is broken or the site
// offers a newer build, else null. Once the site serves R2 the two are the same.
async function compareWithSite(channel, stored, fetchLive, log) {
  let inR2;
  try {
    inR2 = parseLatest(stored, channel, true);
  } catch (e) {
    if (!(e instanceof DownloadsError)) throw e;
    return `${channel}: the latest.json in R2 is not valid (${e.message}). Publish the channel again by hand (downloads.mjs publish --channel ${channel} ...).`;
  }
  const raw = await fetchLive(CHANNELS[channel] + "latest.json");
  let live = null;
  try {
    live = raw ? parseLatest(raw, channel, false) : null;
  } catch (e) {
    if (!(e instanceof DownloadsError)) throw e;
  }
  if (live && live.build > inR2.build) {
    return `${channel}: the site offers ${live.version} build ${live.build}, but R2 has build ${inR2.build} (a release published the old way after the copy). R2 is never overwritten by seed: publish build ${live.build} to R2 by hand (downloads.mjs publish --channel ${channel} ...) before Cloudflare deploys the site.`;
  }
  log(`${channel}: already in R2 (build ${inR2.build}), left as it is`);
  return null;
}
