// Renders public/email/header.svg to header.png (1120x400) with the same settings as
// ask-proxy/scripts/build-email-header.mjs, for when only the SVG was edited here.
//   node tools/email-header-png.mjs   (from site/, needs tools/.cache from vendor.mjs)
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(new URL("./.cache/package.json", import.meta.url));
const sharp = require("sharp");
const dir = new URL("../public/email/", import.meta.url);
const svg = readFileSync(new URL("header.svg", dir));
const out = new URL("header.png", dir).pathname.replace(/^\/([A-Za-z]:)/, "$1");
await sharp(svg, { density: 72 }).png({ palette: true, colors: 160, dither: 0.8, effort: 10, compressionLevel: 9 }).toFile(out);
const kb = statSync(out).size / 1024;
console.log(`header.png ${kb.toFixed(1)} KB`);
if (kb > 120) process.exitCode = 1;
