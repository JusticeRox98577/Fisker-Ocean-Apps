// Checks the door cut against the real geometry: runs public/js/scene/doorcut.js on the body
// meshes of public/models/ocean.glb and prints the box values, triangle counts per material and
// an ASCII side view of the near side (F = front door, R = rear door, . = body facing out).
// Usage (from site/): node tools/measure-doors.mjs
import { THREE, loadOcean } from "./three-node.mjs";
import { splitTriangles, doorPolygons, hingeOf, Z_MIN, NZ_MIN } from "../public/js/scene/doorcut.js";

const meshes = await loadOcean();
const bb = new THREE.Box3();
for (const m of meshes) { m.geometry.computeBoundingBox(); bb.union(m.geometry.boundingBox); }
const box = { min: bb.min.toArray(), max: bb.max.toArray() };
console.log("bbox min", box.min.map((v) => v.toFixed(3)).join(", "), "max", box.max.map((v) => v.toFixed(3)).join(", "));
const polys = doorPolygons(box);
for (const [k, p] of Object.entries(polys)) console.log(k, "polygon (x, y) m:", p.map(([x, y]) => `(${x.toFixed(3)}, ${y.toFixed(3)})`).join(" "));
console.log(`z > ${(Z_MIN * Math.max(-box.min[2], box.max[2])).toFixed(3)} m, face normal z > ${NZ_MIN}`);

const [x0, x1, y0, y1, cols] = [-2.8, 2.8, 0, 1.9, 140];
const rows = Math.round(((y1 - y0) / (x1 - x0)) * cols * 2.1);
const grid = Array.from({ length: rows }, () => Array(cols).fill(" "));
const plot = (x, y, ch) => {
  const c = Math.floor(((x - x0) / (x1 - x0)) * cols), r = rows - 1 - Math.floor(((y - y0) / (y1 - y0)) * rows);
  if (c >= 0 && c < cols && r >= 0 && r < rows && (grid[r][c] === " " || grid[r][c] === ".")) grid[r][c] = ch;
};
const all = { front: [], rear: [] };
for (const m of meshes.filter((m) => m.parent === "Plane_0")) {
  const pos = m.geometry.attributes.position.array, idx = m.geometry.index ? Array.from(m.geometry.index.array) : null;
  const s = splitTriangles(pos, idx, box);
  console.log(`${m.material.padEnd(13)} body ${String(s.body.length / 3).padStart(5)}  front ${String(s.front.length / 3).padStart(4)}  rear ${String(s.rear.length / 3).padStart(4)}`);
  for (const [k, list, ch] of [["body", s.body, "."], ["front", s.front, "F"], ["rear", s.rear, "R"]]) {
    for (let t = 0; t < list.length; t += 3) {
      let mx = 0, my = 0, mz = 0;
      for (let j = 0; j < 3; j++) { mx += pos[list[t + j] * 3]; my += pos[list[t + j] * 3 + 1]; mz += pos[list[t + j] * 3 + 2]; }
      if (mz / 3 < 0.3) continue;
      // Rasterise the triangle roughly: centroid plus the three vertices.
      plot(mx / 3, my / 3, ch);
      for (let j = 0; j < 3; j++) plot(pos[list[t + j] * 3], pos[list[t + j] * 3 + 1], ch === "." ? "." : ch.toLowerCase());
    }
    if (k !== "body") for (const i of list) all[k].push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  }
}
for (const k of ["front", "rear"]) {
  const p = all[k], ix = [...Array(p.length / 3).keys()];
  const [hx, hz] = hingeOf(p, ix);
  let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
  for (let i = 0; i < p.length; i += 3) { mnx = Math.min(mnx, p[i]); mxx = Math.max(mxx, p[i]); mny = Math.min(mny, p[i + 1]); mxy = Math.max(mxy, p[i + 1]); }
  console.log(`${k} door: x ${mnx.toFixed(3)}..${mxx.toFixed(3)}  y ${mny.toFixed(3)}..${mxy.toFixed(3)}  hinge x ${hx.toFixed(3)} z ${hz.toFixed(3)}`);
}
grid.forEach((row, i) => console.log((y1 - ((i + 0.5) / rows) * (y1 - y0)).toFixed(2).padStart(5) + " |" + row.join("")));
