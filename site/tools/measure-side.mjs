// ASCII side elevation of the near (+Z) side: crease edges of the body meshes, by material.
// Usage: node tools/measure-side.mjs [x0 x1 y0 y1 cols]
import { THREE, loadOcean } from "./three-node.mjs";
const [x0, x1, y0, y1, cols] = (process.argv.slice(2).length ? process.argv.slice(2).map(Number) : [-2.8, 2.8, 0, 1.9, 140]);
const rows = Math.round(((y1 - y0) / (x1 - x0)) * cols * 2.1);
const grid = Array.from({ length: rows }, () => Array(cols).fill(" "));
const meshes = await loadOcean();
const sym = { "Material.001": "#", "Material.002": "+", Material: "g", "Material.003": "c", "Material.004": "L", "Material.010": "m", "Material.005": "r", "Material.006": "r" };
for (const m of meshes) {
  const ch = sym[m.material] ?? ".";
  const e = new THREE.EdgesGeometry(m.geometry, 25).attributes.position;
  for (let i = 0; i < e.count; i += 2) {
    const a = new THREE.Vector3().fromBufferAttribute(e, i), b = new THREE.Vector3().fromBufferAttribute(e, i + 1);
    if (a.z < 0.45 || b.z < 0.45) continue;
    const n = Math.ceil(a.distanceTo(b) / ((x1 - x0) / cols / 2)) + 1;
    for (let k = 0; k <= n; k++) {
      const p = a.clone().lerp(b, k / n);
      const c = Math.floor(((p.x - x0) / (x1 - x0)) * cols), r = rows - 1 - Math.floor(((p.y - y0) / (y1 - y0)) * rows);
      if (c >= 0 && c < cols && r >= 0 && r < rows) grid[r][c] = ch;
    }
  }
}
const ruler = Array(cols).fill(" ");
for (let x = Math.ceil(x0 * 2) / 2; x <= x1; x += 0.5) { const c = Math.floor(((x - x0) / (x1 - x0)) * cols); const s = x.toFixed(1); for (let i = 0; i < s.length; i++) if (c + i < cols) ruler[c + i] = s[i]; }
grid.forEach((row, i) => console.log((y1 - ((i + 0.5) / rows) * (y1 - y0)).toFixed(2).padStart(5) + " |" + row.join("")));
console.log("      " + ruler.join(""));
