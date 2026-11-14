// Measures where the battery boxes go: wheel centres, underbody height between the axles, the
// windshield base (cowl) and the bonnet height in front of it. Coordinates as in model.js
// (centred on X/Z, wheels on y = 0; Y up, nose +X, near/right side +Z).
// Usage (from site/): node tools/measure-batteries.mjs
import { THREE, loadOcean } from "./three-node.mjs";
const meshes = await loadOcean();
const all = new THREE.Box3();
for (const m of meshes) { m.geometry.computeBoundingBox(); all.union(m.geometry.boundingBox); }
const shift = new THREE.Vector3(-(all.min.x + all.max.x) / 2, -all.min.y, -(all.min.z + all.max.z) / 2);
for (const m of meshes) { m.geometry.translate(shift.x, shift.y, shift.z); m.geometry.computeBoundingBox(); }
all.translate(shift);
const f = (v) => v.toFixed(3);
console.log("box", all.min.toArray().map(f), all.max.toArray().map(f));
const tyres = meshes.filter((m) => m.material === "MA_tire_003");
for (const t of tyres) { const b = t.geometry.boundingBox; console.log("tyre centre", f((b.min.x + b.max.x) / 2), f((b.min.y + b.max.y) / 2), f((b.min.z + b.max.z) / 2), "r", f((b.max.y - b.min.y) / 2), "z", f(b.min.z), f(b.max.z)); }
// Body vertices (all non-wheel meshes).
const body = meshes.filter((m) => m.parent === "Plane_0");
const pts = [];
for (const m of body) { const p = m.geometry.attributes.position; for (let i = 0; i < p.count; i++) pts.push([p.getX(i), p.getY(i), p.getZ(i), m.material]); }
// Lowest body point in slices along X, near the centreline (|z| < 0.5).
for (let x = -2.0; x <= 2.0; x += 0.25) {
  const s = pts.filter((p) => Math.abs(p[0] - x) < 0.12 && Math.abs(p[2]) < 0.6);
  const lo = Math.min(...s.map((p) => p[1]));
  const top = Math.max(...s.map((p) => p[1]));
  const zs = pts.filter((p) => Math.abs(p[0] - x) < 0.12);
  console.log(`x ${f(x)}  under ${f(lo)}  top ${f(top)}  halfwidth ${f(Math.max(...zs.map((p) => Math.abs(p[2]))))}`);
}
// Windshield: glass vertices with x > 0, near the centre line; its lowest front point is the base.
const glass = pts.filter((p) => p[3] === "Material" && Math.abs(p[2]) < 0.4 && p[0] > 0.3);
const front = glass.reduce((a, p) => (p[0] > a[0] ? p : a), glass[0]);
const lowFront = glass.filter((p) => p[0] > front[0] - 0.25).reduce((a, p) => (p[1] < a[1] ? p : a));
console.log("windshield front-most", front.slice(0, 3).map(f), "low front", lowFront.slice(0, 3).map(f));
// Bonnet surface height just ahead of the windshield base, at z = 0.35 (passenger side).
for (const dx of [0.05, 0.2, 0.35, 0.5, 0.7]) {
  const x = front[0] + dx;
  const s = pts.filter((p) => Math.abs(p[0] - x) < 0.06 && Math.abs(p[2] - 0.35) < 0.15 && p[3] !== "Material");
  console.log(`bonnet at x ${f(x)} z .35: top ${f(Math.max(...s.map((p) => p[1])))}`);
}
