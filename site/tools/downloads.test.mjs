// Tests for tools/downloads-lib.mjs (the R2 layout of the downloads, publish and seed), with a bucket in memory.
// Usage (from site/): node --test tools/downloads.test.mjs   (Node 20+, no dependencies)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DownloadsError, OBJECT_KEY, checkApk, checkR2, cleanupKeys, objectKey, parseLatest, previousOf, publish, seed } from "./downloads-lib.mjs";

const hex = (data) => createHash("sha256").update(data).digest("hex");
const apk = (text) => Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.from(text)]);
const quiet = () => {};
const SHA = "abcdef0123456789abcdef0123456789abcdef01";

// A bucket in memory that records every call, in order.
function memoryR2(initial = {}) {
  const objects = new Map(Object.entries(initial).map(([k, v]) => [k, Buffer.from(v)]));
  const calls = [];
  return {
    objects,
    calls,
    async get(key) {
      calls.push(["get", key]);
      return objects.has(key) ? Buffer.from(objects.get(key)) : null;
    },
    async put(key, data, type) {
      calls.push(["put", key, type]);
      objects.set(key, Buffer.from(data));
    },
    async delete(key) {
      calls.push(["delete", key]);
      objects.delete(key);
    },
  };
}
const build = (n, channel = "preview", tag = String(n)) => ({
  r2: null,
  channel,
  apks: { android: apk(`phone ${tag}`), wear: apk(`watch ${tag}`) },
  version: "1.5.0",
  build: String(n),
  commit: SHA,
  log: quiet,
  warn: quiet,
});
const latestOf = (r2, channel = "preview") => JSON.parse(r2.objects.get(`${channel}/latest.json`).toString("utf8"));

test("object keys: one folder per build and channel, the form src/worker.js accepts", () => {
  assert.equal(objectKey("preview", "123", SHA, "android"), "preview/b123-abcdef01/OceanLive-Android.apk");
  assert.equal(objectKey("stable", 7, "ABCDEF0", "wear"), "stable/b7-abcdef0/OceanLive-Wear.apk");
  assert.equal(objectKey("stable", "007", SHA, "wear"), "stable/b7-abcdef01/OceanLive-Wear.apk");
  for (const k of ["preview/b123-abcdef01/OceanLive-Android.apk", "stable/b1-0123abc/OceanLive-Wear.apk"]) assert.ok(OBJECT_KEY.test(k), k);
  for (const k of ["stable/latest.json", "beta/b1-0123abcd/OceanLive-Wear.apk", "stable/b1-0123abcd/x.apk", "stable/b1-0123abcd/../OceanLive-Wear.apk"]) assert.ok(!OBJECT_KEY.test(k), k);
  assert.throws(() => objectKey("stable", "1234567890", SHA, "wear"), DownloadsError);
});

test("checkApk refuses empty and non-zip files", () => {
  assert.throws(() => checkApk(Buffer.alloc(0), "x"), /empty/);
  assert.throws(() => checkApk(Buffer.from("<html>"), "x"), /not an APK/);
  checkApk(apk("ok"), "x");
});

test("previous and clean-up: current and previous are kept, the build before is deleted", () => {
  const info = (n, prev) => ({
    files: { android: { object: `preview/b${n}-abcdef01/OceanLive-Android.apk` }, wear: { object: `preview/b${n}-abcdef01/OceanLive-Wear.apk` } },
    previous: prev ? { android: `preview/b${prev}-abcdef01/OceanLive-Android.apk`, wear: `preview/b${prev}-abcdef01/OceanLive-Wear.apk` } : null,
  });
  const objects = (n) => ({ android: info(n).files.android.object, wear: info(n).files.wear.object });
  assert.equal(previousOf(null, objects(1)), null);
  assert.deepEqual(previousOf(info(2, 1), objects(3)), objects(2));
  // The same build again: the previous one stays.
  assert.deepEqual(previousOf(info(2, 1), objects(2)), objects(1));
  assert.deepEqual(cleanupKeys(info(2, 1), info(3, 2), "preview"), Object.values(objects(1)));
  assert.deepEqual(cleanupKeys(info(2, 1), info(2, 1), "preview"), []);
  assert.deepEqual(cleanupKeys(null, info(1), "preview"), []);
  // Going back to the previous build deletes nothing.
  assert.deepEqual(cleanupKeys(info(2, 1), info(1, 2), "preview"), []);
  // Never anything outside this channel's build objects.
  const odd = { files: { android: { object: "stable/latest.json" }, wear: { object: "stable/b1-abcdef01/OceanLive-Wear.apk" } }, previous: null };
  assert.deepEqual(cleanupKeys(odd, info(3, 2), "preview"), []);
});

test("publish uploads both files, reads them back, writes latest.json last, then cleans up", async () => {
  const r2 = memoryR2();
  for (const n of [1, 2, 3]) await publish({ ...build(n), r2 });
  const writes = r2.calls.filter((c) => c[0] !== "get");
  assert.deepEqual(writes, [
    ["put", "preview/b1-abcdef01/OceanLive-Android.apk", "application/vnd.android.package-archive"],
    ["put", "preview/b1-abcdef01/OceanLive-Wear.apk", "application/vnd.android.package-archive"],
    ["put", "preview/latest.json", "application/json"],
    ["put", "preview/b2-abcdef01/OceanLive-Android.apk", "application/vnd.android.package-archive"],
    ["put", "preview/b2-abcdef01/OceanLive-Wear.apk", "application/vnd.android.package-archive"],
    ["put", "preview/latest.json", "application/json"],
    ["put", "preview/b3-abcdef01/OceanLive-Android.apk", "application/vnd.android.package-archive"],
    ["put", "preview/b3-abcdef01/OceanLive-Wear.apk", "application/vnd.android.package-archive"],
    ["put", "preview/latest.json", "application/json"],
    ["delete", "preview/b1-abcdef01/OceanLive-Android.apk"],
    ["delete", "preview/b1-abcdef01/OceanLive-Wear.apk"],
  ]);
  // Each upload is read back before latest.json is written.
  const i = r2.calls.findIndex((c) => c[0] === "put" && c[1] === "preview/b3-abcdef01/OceanLive-Wear.apk");
  assert.deepEqual(r2.calls[i + 1], ["get", "preview/b3-abcdef01/OceanLive-Wear.apk"]);
  const latest = latestOf(r2);
  assert.deepEqual(Object.keys(latest), ["version", "short", "build", "commit", "date", "files", "previous"]);
  assert.equal(latest.version, "1.5.0");
  assert.equal(latest.short, "1.5");
  assert.equal(latest.build, 3);
  assert.equal(latest.commit, SHA);
  assert.match(latest.date, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(latest.files.android, {
    name: "OceanLive-1.5-Android.apk",
    path: "/downloads/preview/OceanLive-Android.apk",
    size: apk("phone 3").length,
    sha256: hex(apk("phone 3")),
    object: "preview/b3-abcdef01/OceanLive-Android.apk",
  });
  assert.equal(latest.files.wear.path, "/downloads/preview/OceanLive-Wear.apk");
  assert.deepEqual(latest.previous, { android: "preview/b2-abcdef01/OceanLive-Android.apk", wear: "preview/b2-abcdef01/OceanLive-Wear.apk" });
  assert.deepEqual(parseLatest(r2.objects.get("preview/latest.json"), "preview", true).build, 3);
});

test("publishing the same build again never overwrites the served file", async () => {
  const r2 = memoryR2();
  await publish({ ...build(1), r2 });
  await publish({ ...build(2), r2 });
  r2.calls.length = 0;
  // A re-run with the same files: nothing uploaded, the previous build stays, nothing deleted.
  await publish({ ...build(2), r2 });
  assert.deepEqual(r2.calls.filter((c) => c[0] !== "get").map((c) => c[1]), ["preview/latest.json"]);
  assert.equal(latestOf(r2).previous.android, "preview/b1-abcdef01/OceanLive-Android.apk");
  // Different files under the same build number: refused before anything is written.
  r2.calls.length = 0;
  const before = Buffer.from(r2.objects.get("preview/latest.json"));
  await assert.rejects(publish({ ...build(2, "preview", "rebuilt"), r2 }), /Not overwriting a served file/);
  assert.deepEqual(r2.calls.filter((c) => c[0] !== "get"), []);
  assert.deepEqual(r2.objects.get("preview/latest.json"), before);
});

test("an upload that doesn't read back the same leaves latest.json unchanged", async () => {
  const r2 = memoryR2();
  await publish({ ...build(1), r2 });
  const before = Buffer.from(r2.objects.get("preview/latest.json"));
  const put = r2.put;
  r2.put = async (key, data, type) => put(key, key.endsWith("Wear.apk") ? Buffer.concat([data, Buffer.from("!")]) : data, type);
  await assert.rejects(publish({ ...build(2), r2 }), /does not match the file uploaded/);
  assert.deepEqual(r2.objects.get("preview/latest.json"), before);
});

test("a failing upload or latest.json write stops the publish; a failing delete only warns", async () => {
  const r2 = memoryR2();
  await publish({ ...build(1), r2 });
  const before = Buffer.from(r2.objects.get("preview/latest.json"));
  const put = r2.put;
  r2.put = async (key, ...rest) => {
    if (key.endsWith("Wear.apk")) throw new Error("network");
    return put(key, ...rest);
  };
  await assert.rejects(publish({ ...build(2), r2 }), /network/);
  assert.deepEqual(r2.objects.get("preview/latest.json"), before);
  r2.put = put;
  await publish({ ...build(2), r2 });
  r2.delete = async () => { throw new Error("no"); };
  const warnings = [];
  await publish({ ...build(3), r2, warn: (m) => warnings.push(m) });
  assert.equal(latestOf(r2).build, 3);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /could not delete preview\/b1-abcdef01\/OceanLive-Android\.apk/);
});

test("a broken latest.json in R2 is replaced, with a warning", async () => {
  const r2 = memoryR2({ "preview/latest.json": "{oops" });
  const warnings = [];
  await publish({ ...build(5), r2, warn: (m) => warnings.push(m) });
  assert.equal(latestOf(r2).build, 5);
  assert.equal(latestOf(r2).previous, null);
  assert.match(warnings[0], /not valid/);
  // One that names another channel's object is broken too: replaced, its objects never deleted.
  const other = memoryR2();
  await publish({ ...build(1, "stable"), r2: other });
  other.objects.set("preview/latest.json", other.objects.get("stable/latest.json"));
  await publish({ ...build(2), r2: other, warn: quiet });
  assert.ok(other.objects.has("stable/b1-abcdef01/OceanLive-Android.apk"));
  assert.ok(!other.calls.some((c) => c[0] === "delete"));
});

test("publish checks its input before touching R2", async () => {
  const r2 = memoryR2();
  const bad = [
    { channel: "beta" },
    { version: "1.5.x" },
    { build: "12a" },
    { commit: "not-a-sha" },
    { apks: { android: Buffer.from("<html>"), wear: apk("w") } },
    { apks: { android: apk("a"), wear: Buffer.alloc(0) } },
  ];
  for (const edit of bad) {
    await assert.rejects(publish({ ...build(1), r2, ...edit }), DownloadsError, JSON.stringify(Object.keys(edit)));
  }
  assert.deepEqual(r2.calls, []);
});

test("a dry run touches no R2 and shows the latest.json it would write", async () => {
  const lines = [];
  const refuse = async () => { throw new Error("R2 touched"); };
  const info = await publish({ ...build(4), r2: { get: refuse, put: refuse, delete: refuse }, dryRun: true, log: (m) => lines.push(m) });
  assert.equal(info.files.android.object, "preview/b4-abcdef01/OceanLive-Android.apk");
  assert.ok(lines.some((l) => l.includes("would upload preview/b4-abcdef01/OceanLive-Wear.apk")));
  assert.ok(lines.some((l) => l.includes("would write preview/latest.json last")));
});

// The old static site: latest.json and the two files of each channel it has.
function oldSite(channels) {
  const files = new Map();
  for (const [channel, prefix, n] of channels) {
    const apks = { android: apk(`old phone ${channel}`), wear: apk(`old watch ${channel}`) };
    const info = {
      version: "1.4.0",
      short: "1.4",
      build: n,
      commit: SHA,
      date: "2026-11-01T10:00:00.000Z",
      files: {
        android: { name: "OceanLive-1.4-Android.apk", path: prefix + "OceanLive-Android.apk", size: apks.android.length, sha256: hex(apks.android) },
        wear: { name: "OceanLive-1.4-Wear.apk", path: prefix + "OceanLive-Wear.apk", size: apks.wear.length, sha256: hex(apks.wear) },
      },
    };
    files.set(prefix + "latest.json", Buffer.from(JSON.stringify(info, null, 2)));
    files.set(prefix + "OceanLive-Android.apk", apks.android);
    files.set(prefix + "OceanLive-Wear.apk", apks.wear);
  }
  const fetched = [];
  return { files, fetched, fetchLive: async (path) => (fetched.push(path), files.has(path) ? Buffer.from(files.get(path)) : null) };
}

test("seed copies each channel R2 doesn't have, verified, keeping its version, build, date and names", async () => {
  const site = oldSite([["stable", "/downloads/", 40], ["preview", "/downloads/preview/", 55]]);
  const r2 = memoryR2();
  await publish({ ...build(60), r2 }); // the preview is already in R2: left as it is
  r2.calls.length = 0;
  await seed({ r2, fetchLive: site.fetchLive, log: quiet, warn: quiet });
  // The preview's latest.json is only compared: the site's build 55 is older than R2's 60.
  assert.deepEqual(site.fetched, ["/downloads/latest.json", "/downloads/OceanLive-Android.apk", "/downloads/OceanLive-Wear.apk", "/downloads/preview/latest.json"]);
  assert.ok(!r2.calls.some((c) => c[0] !== "get" && c[1].startsWith("preview/")));
  assert.equal(latestOf(r2).build, 60);
  const stable = latestOf(r2, "stable");
  assert.equal(stable.build, 40);
  assert.equal(stable.version, "1.4.0");
  assert.equal(stable.date, "2026-11-01T10:00:00.000Z");
  assert.equal(stable.files.android.name, "OceanLive-1.4-Android.apk");
  assert.equal(stable.files.android.sha256, hex(apk("old phone stable")));
  assert.equal(stable.files.android.object, "stable/b40-abcdef01/OceanLive-Android.apk");
  assert.deepEqual(r2.objects.get("stable/b40-abcdef01/OceanLive-Wear.apk"), apk("old watch stable"));
  assert.equal(r2.calls.filter((c) => c[0] === "put").at(-1)[1], "stable/latest.json");
  // Run again: both channels are in R2 now, only their latest.json is fetched, nothing is written.
  site.fetched.length = 0;
  r2.calls.length = 0;
  await seed({ r2, fetchLive: site.fetchLive, log: quiet, warn: quiet });
  assert.deepEqual(site.fetched, ["/downloads/latest.json", "/downloads/preview/latest.json"]);
  assert.ok(!r2.calls.some((c) => c[0] !== "get"));
});

test("seed fails when the stable channel is neither in R2 nor on the site", async () => {
  // The late case: the site already serves an empty R2, so it has nothing to copy either.
  const site = oldSite([["preview", "/downloads/preview/", 55]]);
  const r2 = memoryR2();
  await assert.rejects(seed({ r2, fetchLive: site.fetchLive, log: quiet, warn: quiet }), /the site has no stable channel to copy \(404\) and R2 has none either/);
  // The preview it could copy is still copied.
  assert.equal(latestOf(r2).build, 55);
  assert.ok(!r2.objects.has("stable/latest.json"));
});

test("seed never overwrites R2, but fails when the site offers a newer stable build", async () => {
  const r2 = memoryR2();
  await seed({ r2, fetchLive: oldSite([["stable", "/downloads/", 40], ["preview", "/downloads/preview/", 55]]).fetchLive, log: quiet, warn: quiet });
  const before = new Map(r2.objects);
  // Releases published the old way after the copy: stable 42 and preview 57 on the site.
  const newer = oldSite([["stable", "/downloads/", 42], ["preview", "/downloads/preview/", 57]]);
  r2.calls.length = 0;
  const warnings = [];
  await assert.rejects(seed({ r2, fetchLive: newer.fetchLive, log: quiet, warn: (m) => warnings.push(m) }), /site offers 1\.4\.0 build 42, but R2 has build 40/);
  assert.deepEqual(r2.objects, before);
  assert.ok(!r2.calls.some((c) => c[0] !== "get"));
  // A newer preview is only a warning: the next push publishes a newer one to R2 anyway.
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^preview: the site offers 1\.4\.0 build 57, but R2 has build 55/);
  // A broken latest.json in R2 is reported, never replaced.
  r2.objects.set("stable/latest.json", Buffer.from("{oops"));
  await assert.rejects(seed({ r2, fetchLive: newer.fetchLive, log: quiet, warn: quiet }), /stable: the latest\.json in R2 is not valid/);
  assert.deepEqual(r2.objects.get("stable/latest.json"), Buffer.from("{oops"));
});

test("seed --skip leaves out the channel published next, so a missing or broken one never blocks that publish", async () => {
  // A push run: preview is published next, so only stable is copied, and nothing of preview is read.
  const site = oldSite([["stable", "/downloads/", 40], ["preview", "/downloads/preview/", 55]]);
  const r2 = memoryR2();
  assert.deepEqual(await seed({ r2, fetchLive: site.fetchLive, skip: ["preview"], log: quiet, warn: quiet }), { stable: "copied", preview: "skipped" });
  assert.equal(latestOf(r2, "stable").build, 40);
  assert.ok(!r2.objects.has("preview/latest.json"));
  assert.ok(!site.fetched.some((p) => p.startsWith("/downloads/preview/")));
  assert.ok(!r2.calls.some((c) => c[1].startsWith("preview/")));
  assert.deepEqual(await seed({ r2, fetchLive: site.fetchLive, skip: ["preview"], log: quiet, warn: quiet }), { stable: "already in R2", preview: "skipped" });
  // A release run with stable neither in R2 nor on the site: the release publish that follows fixes it.
  const empty = memoryR2();
  const previewOnly = oldSite([["preview", "/downloads/preview/", 55]]);
  assert.deepEqual(await seed({ r2: empty, fetchLive: previewOnly.fetchLive, skip: ["stable"], log: quiet, warn: quiet }), { stable: "skipped", preview: "copied" });
  // A push run in the same state still fails loudly: nothing would publish stable.
  await assert.rejects(seed({ r2: memoryR2(), fetchLive: previewOnly.fetchLive, skip: ["preview"], log: quiet, warn: quiet }), /no stable channel to copy/);
  // A broken stable latest.json is left to the release publish, which replaces it.
  empty.objects.set("stable/latest.json", Buffer.from("{oops"));
  await seed({ r2: empty, fetchLive: previewOnly.fetchLive, skip: ["stable"], log: quiet, warn: quiet });
  await publish({ ...build(41, "stable"), r2: empty });
  assert.equal(latestOf(empty, "stable").build, 41);
});

test("check: R2 must have a valid stable channel; a missing or broken preview is only reported", async () => {
  const r2 = memoryR2();
  await assert.rejects(checkR2({ r2, log: quiet, warn: quiet }), /stable: R2 has no stable\/latest\.json/);
  await publish({ ...build(7, "stable"), r2 });
  r2.calls.length = 0;
  const warnings = [];
  const got = await checkR2({ r2, log: quiet, warn: (m) => warnings.push(m) });
  assert.equal(got.stable.build, 7);
  assert.equal(got.preview, null);
  assert.match(warnings[0], /^preview: R2 has no preview\/latest\.json/);
  // It only reads latest.json.
  assert.deepEqual(r2.calls, [["get", "stable/latest.json"], ["get", "preview/latest.json"]]);
  r2.objects.set("preview/latest.json", Buffer.from("{oops"));
  warnings.length = 0;
  await checkR2({ r2, log: quiet, warn: (m) => warnings.push(m) });
  assert.match(warnings[0], /^preview: the preview\/latest\.json in R2 is not valid/);
  // A stable latest.json that names another channel's file is not valid.
  r2.objects.set("stable/latest.json", Buffer.from(r2.objects.get("stable/latest.json").toString("utf8").replaceAll("stable/b7", "preview/b7")));
  await assert.rejects(checkR2({ r2, log: quiet, warn: quiet }), /stable: the stable\/latest\.json in R2 is not valid/);
});

test("seed copies nothing for a channel whose files don't match its latest.json", async () => {
  const site = oldSite([["stable", "/downloads/", 40]]);
  site.files.set("/downloads/OceanLive-Wear.apk", apk("something else"));
  const r2 = memoryR2();
  await assert.rejects(seed({ r2, fetchLive: site.fetchLive, log: quiet, warn: quiet }), /HASH MISMATCH for stable \/downloads\/OceanLive-Wear\.apk/);
  assert.ok(!r2.calls.some((c) => c[0] !== "get"));
  // A latest.json that points anywhere else is refused before any file is fetched.
  const moved = oldSite([["stable", "/downloads/", 40]]);
  const info = JSON.parse(moved.files.get("/downloads/latest.json"));
  info.files.android.path = "/elsewhere.apk";
  moved.files.set("/downloads/latest.json", Buffer.from(JSON.stringify(info)));
  await assert.rejects(seed({ r2, fetchLive: moved.fetchLive, log: quiet, warn: quiet }), /expected "\/downloads\/OceanLive-Android\.apk"/);
  assert.deepEqual(moved.fetched, ["/downloads/latest.json"]);
});

test("seed skips a channel the old site never had, and never overwrites one that appears meanwhile", async () => {
  const site = oldSite([["stable", "/downloads/", 40]]);
  const r2 = memoryR2();
  await seed({ r2, fetchLive: site.fetchLive, log: quiet, warn: quiet });
  assert.ok(r2.objects.has("stable/latest.json"));
  assert.ok(!r2.objects.has("preview/latest.json"));
  // A publish finishes while the copy is uploading: its latest.json stays.
  const late = oldSite([["stable", "/downloads/", 40]]);
  const raced = memoryR2();
  const put = raced.put;
  raced.put = async (key, ...rest) => {
    await put(key, ...rest);
    if (key === "stable/b40-abcdef01/OceanLive-Wear.apk") await publish({ ...build(41, "stable"), r2: { ...raced, put } });
  };
  const warnings = [];
  await seed({ r2: raced, fetchLive: late.fetchLive, log: quiet, warn: (m) => warnings.push(m) });
  assert.equal(latestOf(raced, "stable").build, 41);
  assert.match(warnings[0], /appeared in R2 meanwhile/);
});

test("a seed dry run fetches and verifies without touching R2", async () => {
  const site = oldSite([["stable", "/downloads/", 40], ["preview", "/downloads/preview/", 55]]);
  const refuse = async () => { throw new Error("R2 touched"); };
  await seed({ r2: { get: refuse, put: refuse, delete: refuse }, fetchLive: site.fetchLive, dryRun: true, log: quiet, warn: quiet });
  assert.equal(site.fetched.length, 6);
});
