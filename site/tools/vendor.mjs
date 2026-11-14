// Copies the pinned three.js and GSAP files the site uses into public/vendor/.
// three: the core is bundled and minified into one ES module; each addon the site imports (and
// the addons those import) is minified on its own, keeping its relative path and its
// `import ... from "three"`, which the page's import map resolves.
// GSAP: the published minified UMD files, unchanged.
// Usage (from site/): node tools/vendor.mjs    (packages come from tools/.cache, see package.json there)
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, ".cache/package.json"));
const esbuild = require("esbuild");
const NM = join(here, ".cache/node_modules");
const OUT = resolve(here, "../public/vendor");
const threePkg = JSON.parse(readFileSync(join(NM, "three/package.json"), "utf8"));
const gsapPkg = JSON.parse(readFileSync(join(NM, "gsap/package.json"), "utf8"));
if (threePkg.version !== "0.186.1") throw new Error("expected three 0.186.1, got " + threePkg.version);
if (gsapPkg.version !== "3.15.0") throw new Error("expected gsap 3.15.0, got " + gsapPkg.version);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "three/addons"), { recursive: true });
mkdirSync(join(OUT, "gsap"), { recursive: true });

// three core: one minified ES module.
await esbuild.build({
  entryPoints: [join(NM, "three/build/three.module.js")],
  bundle: true, minify: true, format: "esm", target: "es2020", legalComments: "inline",
  outfile: join(OUT, "three/three.module.min.js"),
  banner: { js: `/* three.js r${threePkg.version.split(".")[1]} (${threePkg.version}), MIT licence, https://threejs.org */` },
});
copyFileSync(join(NM, "three/LICENSE"), join(OUT, "three/LICENSE"));

// Addons the site imports, plus whatever they import.
const ADDONS = [
  "loaders/GLTFLoader.js",
  "libs/meshopt_decoder.module.js",
  "environments/RoomEnvironment.js",
  "postprocessing/EffectComposer.js",
  "postprocessing/RenderPass.js",
  "postprocessing/UnrealBloomPass.js",
  "postprocessing/OutputPass.js",
];
const JSM = join(NM, "three/examples/jsm");
const seen = new Set();
const queue = [...ADDONS];
while (queue.length) {
  const rel = queue.shift();
  if (seen.has(rel)) continue;
  seen.add(rel);
  const src = readFileSync(join(JSM, rel), "utf8");
  for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    queue.push(relative(JSM, resolve(dirname(join(JSM, rel)), m[1])).split("\\").join("/"));
  }
  const { code } = await esbuild.transform(src, { minify: true, format: "esm", target: "es2020", legalComments: "inline", loader: "js" });
  const out = join(OUT, "three/addons", rel);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, code);
}
console.log("three addons:", [...seen].sort().join(", "));

// GSAP: published minified files and the licence notice.
for (const f of ["gsap.min.js", "ScrollTrigger.min.js"]) copyFileSync(join(NM, "gsap/dist", f), join(OUT, "gsap", f));
writeFileSync(join(OUT, "gsap/LICENSE.txt"),
`GSAP ${gsapPkg.version} and ScrollTrigger ${gsapPkg.version}
Copyright GreenSock (gsap.com). All rights reserved.

Used here unmodified (gsap.min.js and ScrollTrigger.min.js from the npm package "gsap" ${gsapPkg.version}).
Licence: GSAP's Standard "No Charge" License, as published at https://gsap.com/standard-license
(the npm package names it: "${gsapPkg.license}")
`);
writeFileSync(join(OUT, "VERSIONS.txt"), `three ${threePkg.version} (npm)\ngsap ${gsapPkg.version} (npm)\nMade by tools/vendor.mjs\n`);
console.log("vendored three", threePkg.version, "gsap", gsapPkg.version);
