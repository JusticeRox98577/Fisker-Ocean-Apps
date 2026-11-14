// One-off: builds the sign-in email's hero banner from the site's blueprint drawing.
//   node scripts/build-email-header.mjs
// Writes site/public/email/header.svg (source) and header.png (1120x400, 2x of the 560px email column).
// Uses sharp, which is already installed as a wrangler dependency. The PNG is served from
// https://oceanlive.org/email/header.png once the site is live.
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const site = resolve(here, "../../../site/site/public");
const outDir = resolve(site, "email");
const blueprint = readFileSync(resolve(site, "img/ocean-blueprint.svg"), "utf8");
const defs = /<defs>([\s\S]*?)<\/defs>/.exec(blueprint)?.[1];
if (!defs) throw new Error("no <defs> in ocean-blueprint.svg");

const W = 1120, H = 400;
// The drawing is 1526x633; place it on the right, scaled.
const S = 0.56, TX = 248, TY = 22;
const P = (x, y) => [(TX + x * S).toFixed(1), (TY + y * S).toFixed(1)];
const [lx, ly] = P(1300, 241); // front light bar

const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<!-- Ocean Live sign-in email banner. Car: side elevation drawn from "Fisker Ocean (low-poly)" by LagzDesign (CC BY 4.0), changed: projected to lines. -->
<defs>
  <linearGradient id="sea" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#06162C"/>
    <stop offset=".45" stop-color="#0B2545"/>
    <stop offset=".8" stop-color="#0C3B52"/>
    <stop offset="1" stop-color="#0E5361"/>
  </linearGradient>
  <radialGradient id="glow" cx="${lx}" cy="${ly}" r="420" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#5CE1E6" stop-opacity=".30"/>
    <stop offset=".35" stop-color="#2FB5C0" stop-opacity=".12"/>
    <stop offset="1" stop-color="#2FB5C0" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="vig" cx="560" cy="200" r="640" gradientUnits="userSpaceOnUse">
    <stop offset=".55" stop-color="#030E1E" stop-opacity="0"/>
    <stop offset="1" stop-color="#030E1E" stop-opacity=".55"/>
  </radialGradient>
  <linearGradient id="floor" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#5CE1E6" stop-opacity="0"/>
    <stop offset=".5" stop-color="#5CE1E6" stop-opacity=".55"/>
    <stop offset="1" stop-color="#7FE7C9" stop-opacity="0"/>
  </linearGradient>
  <pattern id="minor" width="16" height="16" patternUnits="userSpaceOnUse">
    <path d="M16 0H0V16" fill="none" stroke="#ADD8FF" stroke-opacity=".05" stroke-width="1"/>
  </pattern>
  <pattern id="major" width="80" height="80" patternUnits="userSpaceOnUse">
    <path d="M80 0H0V80" fill="none" stroke="#ADD8FF" stroke-opacity=".11" stroke-width="1"/>
  </pattern>
  <filter id="blur" x="-20%" y="-200%" width="140%" height="500%"><feGaussianBlur stdDeviation="5"/></filter>
  <filter id="soft" x="-20%" y="-200%" width="140%" height="500%"><feGaussianBlur stdDeviation="14"/></filter>
  ${defs}
</defs>
<rect width="${W}" height="${H}" fill="url(#sea)"/>
<rect width="${W}" height="${H}" fill="url(#minor)"/>
<rect width="${W}" height="${H}" fill="url(#major)"/>
<rect width="${W}" height="${H}" fill="url(#glow)"/>

<!-- floor reflection line -->
<rect x="200" y="${(TY + 503.4 * S + 1).toFixed(1)}" width="900" height="2" fill="url(#floor)"/>

<!-- the car -->
<g transform="translate(${TX} ${TY}) scale(${S})">
  <g stroke="#EAF4FF" stroke-width="2.4"><use href="#d" xlink:href="#d"/></g>
  <g stroke="#9FE9F0" stroke-width="1.6" opacity=".35" transform="translate(2.4 -1.6)"><use href="#d" xlink:href="#d"/></g>
  <path d="M30 503.4H1506" stroke="#A9C4E0" stroke-width="1.6" stroke-dasharray="14 6 2 6" fill="none" opacity=".6"/>
  <path d="M335.9 395h20M345.9 385v20M1110.7 395h20M1120.7 385v20" stroke="#5CE1E6" stroke-width="2" fill="none"/>
  <path d="M345.9 511.4V555.4M1120.7 511.4V555.4M331.9 543.4H1134.7M345.9 543.4l14 6M345.9 543.4l14 -6M1120.7 543.4l-14 -6M1120.7 543.4l-14 6" stroke="#FF8A7A" stroke-width="2.2" fill="none" stroke-linecap="round"/>
  <!-- light bar: soft halo, glow, core -->
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M1224.2 232.1L1256 235.5L1302.8 241.3L1340 243.3L1360.3 245.6L1366.7 251L1381.6 251" stroke="#5CE1E6" stroke-width="30" opacity=".55" filter="url(#soft)"/>
    <path d="M1224.2 232.1L1256 235.5L1302.8 241.3L1340 243.3L1360.3 245.6L1366.7 251L1381.6 251" stroke="#5CE1E6" stroke-width="10" opacity=".9" filter="url(#blur)"/>
    <path d="M1224.2 232.1L1256 235.5L1302.8 241.3L1340 243.3L1360.3 245.6L1366.7 251L1381.6 251" stroke="#E8FEFF" stroke-width="3.6"/>
  </g>
</g>

<!-- handwritten annotation -->
<g fill="none" stroke="#5CE1E6" stroke-width="1.8" stroke-linecap="round">
  <path d="M1000 72 C 1030 82, 1038 104, 1020 ${(+ly - 14).toFixed(0)}"/>
  <path d="M1020 ${(+ly - 14).toFixed(0)} l -9 -6 M1020 ${(+ly - 14).toFixed(0)} l 2 -11"/>
</g>
<text x="912" y="66" font-family="'Segoe Print','Architects Daughter',cursive" font-size="21" fill="#BFF6F8">light bar</text>

<!-- title block, bottom left -->
<g font-family="Bahnschrift,'Space Grotesk','DIN Alternate',sans-serif" fill="#A9C4E0">
  <text x="40" y="52" font-size="13" letter-spacing="3.2" fill="#5CE1E6">OCEAN LIVE</text>
  <text x="40" y="74" font-size="12" letter-spacing="2.4" opacity=".8">SIGN-IN · SHEET 01</text>
  <path d="M40 86H178" stroke="#5CE1E6" stroke-opacity=".5" stroke-width="1"/>
  <text x="40" y="372" font-size="11" letter-spacing="2" opacity=".7">FISKER OCEAN · SIDE ELEVATION · 1:40</text>
</g>
<!-- corner ticks -->
<g stroke="#5CE1E6" stroke-width="2" fill="none" opacity=".75">
  <path d="M16 36V16H36M${W - 36} 16H${W - 16}V36M16 ${H - 36}V${H - 16}H36M${W - 36} ${H - 16}H${W - 16}V${H - 36}"/>
</g>
<rect width="${W}" height="${H}" fill="url(#vig)"/>
</svg>
`;

mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "header.svg"), svg);
await sharp(Buffer.from(svg), { density: 72 })
  .png({ palette: true, colors: 160, dither: 0.8, effort: 10, compressionLevel: 9 })
  .toFile(resolve(outDir, "header.png"));
const kb = statSync(resolve(outDir, "header.png")).size / 1024;
console.log(`header.png ${W}x${H}, ${kb.toFixed(1)} KB`);
if (kb > 120) process.exitCode = 1;
