// Draws public/img/ocean-blueprint.svg: a side elevation of the near (+Z) side of
// public/models/ocean.glb, for visitors who get no 3D (reduced motion, Save-Data, no WebGL).
// Crease edges (the same 25 degree EdgesGeometry the page uses) are projected orthographically;
// an edge is kept only where a ray toward the viewer leaves the car (hidden-line removal).
// The tyres are drawn as circles. Prints the label positions (in % of the drawing) for the HTML.
// Usage (from site/): node tools/make-blueprint-svg.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { THREE, loadOcean } from "./three-node.mjs";

const meshes = await loadOcean();
const box = new THREE.Box3();
for (const m of meshes) { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox); }

const S = 250;             // px per metre
const PAD = { l: 60, r: 120, t: 50, b: 130 };
const W = Math.round((box.max.x - box.min.x) * S + PAD.l + PAD.r);
const H = Math.round((box.max.y - box.min.y) * S + PAD.t + PAD.b);
const X = (x) => PAD.l + (x - box.min.x) * S;
const Y = (y) => PAD.t + (box.max.y - y) * S;

// Ray-cast visibility toward +Z (the viewer).
const scene = new THREE.Scene();
for (const m of meshes) {
  const mesh = new THREE.Mesh(m.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  scene.add(mesh);
}
scene.updateMatrixWorld(true);
const ray = new THREE.Raycaster();
ray.firstHitOnly = false;
const dir = new THREE.Vector3(0, 0, 1);
const visible = (p) => {
  ray.set(new THREE.Vector3(p.x, p.y, p.z + 0.004), dir);
  return ray.intersectObjects(scene.children, false).length === 0;
};

const segs = [];
const isTyre = (m) => m.material === "MA_tire_003";
for (const m of meshes) {
  if (isTyre(m)) continue;
  const e = new THREE.EdgesGeometry(m.geometry, 25).attributes.position;
  for (let i = 0; i < e.count; i += 2) {
    const a = new THREE.Vector3().fromBufferAttribute(e, i), b = new THREE.Vector3().fromBufferAttribute(e, i + 1);
    if (a.z < -0.05 && b.z < -0.05) continue; // far side: never visible
    const n = Math.max(2, Math.ceil(a.distanceTo(b) / 0.04));
    // Split the edge into visible runs.
    let run = null;
    for (let k = 0; k <= n; k++) {
      const p = a.clone().lerp(b, k / n);
      if (visible(p)) { if (!run) run = [p, p]; else run[1] = p; }
      else if (run) { segs.push(run); run = null; }
    }
    if (run) segs.push(run);
  }
}

// Tyres: the near tyres as circles (outer edge and sidewall), from their bounds.
const wheels = [];
for (const m of meshes.filter((m) => isTyre(m) && m.geometry.boundingBox.max.z > 0)) {
  const bb = m.geometry.boundingBox, c = bb.getCenter(new THREE.Vector3());
  wheels.push({ x: c.x, y: c.y, r: (bb.max.x - bb.min.x) / 2 });
}
wheels.sort((a, b) => a.x - b.x);

// Chain segments into polylines.
const key = (p) => `${Math.round(X(p.x) * 2)},${Math.round(Y(p.y) * 2)}`;
const pts = segs.map(([a, b]) => [[+X(a.x).toFixed(1), +Y(a.y).toFixed(1)], [+X(b.x).toFixed(1), +Y(b.y).toFixed(1)]])
  .filter(([a, b]) => Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.6);
const ends = new Map();
const add = (k, i) => { if (!ends.has(k)) ends.set(k, []); ends.get(k).push(i); };
const kk = (p) => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;
pts.forEach(([a, b], i) => { add(kk(a), i); add(kk(b), i); });
const used = new Uint8Array(pts.length);
const lines = [];
for (let i = 0; i < pts.length; i++) {
  if (used[i]) continue;
  used[i] = 1;
  const line = [pts[i][0], pts[i][1]];
  for (const forward of [true, false]) {
    for (;;) {
      const tip = forward ? line[line.length - 1] : line[0];
      const next = (ends.get(kk(tip)) || []).find((j) => !used[j]);
      if (next === undefined) break;
      used[next] = 1;
      const [a, b] = pts[next];
      const other = kk(a) === kk(tip) ? b : a;
      if (forward) line.push(other); else line.unshift(other);
    }
  }
  lines.push(line);
}
const f = (v) => (Math.round(v * 10) / 10).toString();
let d = "";
for (const l of lines) d += "M" + l.map((p) => `${f(p[0])} ${f(p[1])}`).join("L");

// Dimension lines.
const red = "#FF8A7A";
const groundY = Y(box.min.y);
const dimY1 = groundY + 40, dimY2 = groundY + 86;
const wb = wheels.length >= 2 ? [X(wheels[0].x), X(wheels[wheels.length - 1].x)] : [0, 0];
const xR = X(box.max.x) + 46;
const arrow = (x, y, dx, dy) => `M${f(x)} ${f(y)}l${f(dx * 12 - dy * 5)} ${f(dy * 12 + dx * 5)}M${f(x)} ${f(y)}l${f(dx * 12 + dy * 5)} ${f(dy * 12 - dx * 5)}`;
const dims = [
  // wheelbase
  `M${f(wb[0])} ${f(groundY + 8)}V${f(dimY1 + 12)}M${f(wb[1])} ${f(groundY + 8)}V${f(dimY1 + 12)}`,
  `M${f(wb[0] - 14)} ${f(dimY1)}H${f(wb[1] + 14)}`, arrow(wb[0], dimY1, 1, 0), arrow(wb[1], dimY1, -1, 0),
  // length
  `M${f(X(box.min.x))} ${f(groundY - 30)}V${f(dimY2 + 12)}M${f(X(box.max.x))} ${f(groundY - 30)}V${f(dimY2 + 12)}`,
  `M${f(X(box.min.x) - 14)} ${f(dimY2)}H${f(X(box.max.x) + 14)}`, arrow(X(box.min.x), dimY2, 1, 0), arrow(X(box.max.x), dimY2, -1, 0),
  // height
  `M${f(X(box.max.x) - 120)} ${f(Y(box.max.y))}H${f(xR + 12)}M${f(X(box.max.x) + 6)} ${f(groundY)}H${f(xR + 12)}`,
  `M${f(xR)} ${f(Y(box.max.y) - 14)}V${f(groundY + 14)}`, arrow(xR, Y(box.max.y), 0, 1), arrow(xR, groundY, 0, -1),
].join("");
// Ground line and centre marks.
const ground = `M${f(PAD.l - 30)} ${f(groundY)}H${f(W - 20)}`;
const centres = wheels.map((w) => `M${f(X(w.x) - 10)} ${f(Y(w.y))}h20M${f(X(w.x))} ${f(Y(w.y) - 10)}v20`).join("");
const circles = wheels.map((w) => `<circle cx="${f(X(w.x))}" cy="${f(Y(w.y))}" r="${f(w.r * S)}"/><circle cx="${f(X(w.x))}" cy="${f(Y(w.y))}" r="${f(w.r * S * 0.93)}" opacity=".6"/>`).join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<!-- Side elevation drawn from "Fisker Ocean (low-poly)" by LagzDesign (CC BY 4.0), changed: projected to lines. See /credits -->
<defs><g id="d" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/>${circles}</g></defs>
<g stroke="#EAF4FF" stroke-width="1.6"><use href="#d" xlink:href="#d"/></g>
<g stroke="#EAF4FF" stroke-width="1" opacity=".38" transform="translate(1.6 -1.1)"><use href="#d" xlink:href="#d"/></g>
<path d="${ground}" stroke="#A9C4E0" stroke-width="1" stroke-dasharray="14 6 2 6" fill="none" opacity=".7"/>
<path d="${centres}" stroke="#5CE1E6" stroke-width="1.2" fill="none"/>
<path d="${dims}" stroke="${red}" stroke-width="1.4" fill="none" stroke-linecap="round"/>
</svg>
`;
mkdirSync(new URL("../public/img/", import.meta.url), { recursive: true });
const out = new URL("../public/img/ocean-blueprint.svg", import.meta.url);
writeFileSync(out, svg);
const pct = (x, y) => `left:${((x / W) * 100).toFixed(1)}%;top:${((y / H) * 100).toFixed(1)}%`;
console.log(`wrote ocean-blueprint.svg ${W}x${H}, ${lines.length} polylines, ${svg.length} bytes`);
console.log("label wheelbase", pct((wb[0] + wb[1]) / 2, dimY1 - 16));
console.log("label length", pct((X(box.min.x) + X(box.max.x)) / 2, dimY2 + 22));
console.log("label height", pct(xR + 30, (Y(box.max.y) + groundY) / 2));
console.log("label light bar", pct(X(box.max.x) - 70, Y(1.25)));
console.log("aspect", (W / H).toFixed(4));
