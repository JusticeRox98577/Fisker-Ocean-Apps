// Cuts the near-side (+Z) front and rear door panels out of the one-piece body by triangle
// selection. Pure functions on plain arrays, so tools/measure-doors.mjs can run them in Node.
//
// The model is Y-up, nose toward +X, near side +Z (after the glTF root transforms are baked).
// Door outlines are side-elevation polygons in proportions of the car's bounding box:
//   u = (x - min.x) / length  (0 = rear bumper, 1 = nose), v = (y - min.y) / height.
// They were measured from the model's crease edges (window frames, A-pillar, wheel arches);
// see tools/measure-doors.mjs. A triangle goes with a door when its centroid is inside the
// polygon, it sits on the near side (centroid z > Z_MIN of the half width) and it faces out
// (face normal z > NZ_MIN), so the roof, sills and the far side are never taken.

export const DOOR_SHAPES = {
  // The upper front edge follows the side window's front edge (A-pillar), so the whole pane opens.
  front: [[0.4352, 0.2227], [0.6951, 0.2227], [0.6951, 0.6637], [0.684, 0.6803], [0.6803, 0.7354], [0.6357, 0.8071], [0.606, 0.8539], [0.5615, 0.9063], [0.5262, 0.9394], [0.4352, 0.9394]],
  rear: [[0.3052, 0.2227], [0.4277, 0.2227], [0.4277, 0.9393], [0.2811, 0.9393], [0.2811, 0.5536], [0.3052, 0.5260]],
};
export const Z_MIN = 0.38; // of the half width
export const NZ_MIN = 0.3;

/** Turns the proportional outlines into model-space polygons for a bounding box {min:[x,y,z], max:[x,y,z]}. */
export function doorPolygons(box) {
  const L = box.max[0] - box.min[0], H = box.max[1] - box.min[1];
  const out = {};
  for (const [k, pts] of Object.entries(DOOR_SHAPES)) out[k] = pts.map(([u, v]) => [box.min[0] + u * L, box.min[1] + v * H]);
  return out;
}

function inside(poly, x, y) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * Splits one triangle list. `pos` is a flat xyz array in model space, `index` an index array
 * (or null for non-indexed). Returns { body, front, rear } index arrays into the same vertices.
 */
export function splitTriangles(pos, index, box) {
  const polys = doorPolygons(box);
  const zMin = Z_MIN * Math.max(Math.abs(box.max[2]), Math.abs(box.min[2]));
  const n = index ? index.length : pos.length / 3;
  const body = [], front = [], rear = [];
  for (let t = 0; t < n; t += 3) {
    const a = index ? index[t] : t, b = index ? index[t + 1] : t + 1, c = index ? index[t + 2] : t + 2;
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
    const cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
    const mx = (ax + bx + cx) / 3, my = (ay + by + cy) / 3, mz = (az + bz + cz) / 3;
    // Face normal z (unnormalised cross product, then normalised).
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    let target = body;
    if (mz > zMin && nz / len > NZ_MIN) {
      if (inside(polys.front, mx, my)) target = front;
      else if (inside(polys.rear, mx, my)) target = rear;
    }
    target.push(a, b, c);
  }
  return { body, front, rear };
}

/** Hinge line of a door: its front edge (largest x), on the outer skin. Returns [x, z]. */
export function hingeOf(pos, idx) {
  let maxX = -Infinity, maxZ = -Infinity;
  for (const i of idx) {
    if (pos[i * 3] > maxX) maxX = pos[i * 3];
    if (pos[i * 3 + 2] > maxZ) maxZ = pos[i * 3 + 2];
  }
  return [maxX, maxZ];
}
