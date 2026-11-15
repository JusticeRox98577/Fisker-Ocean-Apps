// Runs every page build tool in order: data from the owner guide, the document pages, the
// reference pages, releases, the extra pages, then the site index and sitemap (which read the rest).
// Usage (from site/): node tools/build-all.mjs
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

for (const tool of ["build-codes", "build-pages", "build-reference", "build-releases", "build-more", "build-index"]) {
  const out = execFileSync(process.execPath, [fileURLToPath(new URL(`${tool}.mjs`, import.meta.url))], { encoding: "utf8" });
  const lines = out.trim().split("\n");
  console.log(`${tool}: ${lines.length} line(s), last: ${lines[lines.length - 1]}`);
}
