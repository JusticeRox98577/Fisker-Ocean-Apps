// Loads models/ocean.glb, bakes the Sketchfab root transforms into world-space geometry
// (Y up, nose toward +X, near side +Z, centred on X/Z, wheels on y = 0), cuts the near-side
// doors out of the body, and builds the scene graph the other modules hang things on:
//   root ─ body
//        ├ door pivots (hinge on the door's front edge) ─ inner (model space)
//        └ wheel pivots (at the axle) ─ inner (model space)
// Every "slot" (body, door inner, wheel inner) is in model space, so lines, shaded meshes and
// the hidden-line depth meshes share coordinates.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { splitTriangles, hingeOf } from "./doorcut.js";

export const ROLE = {
  "Material.001": "paint",
  "Material.002": "trim",
  Material: "glass",
  "Material.003": "lower",
  "Material.004": "lightbar",
  "Material.005": "tail",
  "Material.006": "tail",
  "Material.010": "mirror",
  "Material.007": "rim",
  "Material.008": "hub",
  "Material.009": "disc",
  MA_tire_003: "tyre",
};

function toFloat(attr) {
  if (!attr) return null;
  if (attr.array instanceof Float32Array && !attr.normalized && !attr.isInterleavedBufferAttribute) return attr.clone();
  const out = new Float32Array(attr.count * attr.itemSize);
  for (let i = 0; i < attr.count; i++) for (let j = 0; j < attr.itemSize; j++) out[i * attr.itemSize + j] = attr.getComponent(i, j);
  return new THREE.BufferAttribute(out, attr.itemSize);
}

export async function loadModel(url, signal) {
  const res = await fetch(url, { signal, credentials: "same-origin" });
  if (!res.ok) throw new Error("model " + res.status);
  const buf = await res.arrayBuffer();
  await MeshoptDecoder.ready;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(buf, "");
  gltf.scene.updateMatrixWorld(true);

  // Bake every mesh into world space.
  const raw = [];
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", toFloat(o.geometry.attributes.position));
    if (o.geometry.attributes.normal) g.setAttribute("normal", toFloat(o.geometry.attributes.normal));
    if (o.geometry.index) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(o.geometry.index.array), 1));
    g.applyMatrix4(o.matrixWorld);
    if (!g.attributes.normal) g.computeVertexNormals();
    raw.push({ role: ROLE[o.material?.name] || "trim", body: o.parent?.name === "Plane_0", geometry: g });
  });
  gltf.scene.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose?.(); } });

  // Centre on X/Z and stand the wheels on y = 0.
  const all = new THREE.Box3();
  for (const r of raw) { r.geometry.computeBoundingBox(); all.union(r.geometry.boundingBox); }
  const shift = new THREE.Vector3(-(all.min.x + all.max.x) / 2, -all.min.y, -(all.min.z + all.max.z) / 2);
  for (const r of raw) { r.geometry.translate(shift.x, shift.y, shift.z); r.geometry.computeBoundingBox(); r.geometry.computeBoundingSphere(); }
  all.translate(shift);
  const box = { min: all.min.toArray(), max: all.max.toArray() };

  const root = new THREE.Group();
  root.name = "ocean";
  const body = new THREE.Group();
  root.add(body);

  // Doors: split each body primitive into body / front door / rear door triangles.
  const parts = []; // { role, geometry, slot }
  const doorTris = { front: [], rear: [] };
  for (const r of raw.filter((r) => r.body)) {
    const pos = r.geometry.attributes.position.array;
    const idx = r.geometry.index ? r.geometry.index.array : null;
    const s = splitTriangles(pos, idx, box);
    for (const key of ["body", "front", "rear"]) {
      if (!s[key].length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", r.geometry.attributes.position);
      if (r.geometry.attributes.normal) g.setAttribute("normal", r.geometry.attributes.normal);
      g.setIndex(s[key]);
      g.computeBoundingSphere();
      parts.push({ role: r.role, geometry: g, slot: key });
      if (key !== "body") for (const i of s[key]) doorTris[key].push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    }
  }

  const doors = {};
  for (const key of ["front", "rear"]) {
    const p = doorTris[key];
    const [hx, hz] = hingeOf(p, [...Array(p.length / 3).keys()]);
    const pivot = new THREE.Group();
    pivot.position.set(hx, 0, hz - 0.03);
    const inner = new THREE.Group();
    inner.position.set(-hx, 0, -(hz - 0.03));
    pivot.add(inner);
    root.add(pivot);
    const bb = new THREE.Box3();
    for (let i = 0; i < p.length; i += 3) bb.expandByPoint(new THREE.Vector3(p[i], p[i + 1], p[i + 2]));
    doors[key] = { pivot, inner, center: bb.getCenter(new THREE.Vector3()), box: bb };
  }

  // Wheels: tyres give the centres; rims and hubs join the nearest tyre.
  const tyres = raw.filter((r) => !r.body && r.role === "tyre");
  const wheels = tyres.map((t) => {
    const bb = t.geometry.boundingBox;
    const center = bb.getCenter(new THREE.Vector3());
    const pivot = new THREE.Group();
    pivot.position.copy(center);
    const inner = new THREE.Group();
    inner.position.copy(center).negate();
    pivot.add(inner);
    root.add(pivot);
    return { pivot, inner, center, radius: (bb.max.y - bb.min.y) / 2, halfWidth: (bb.max.z - bb.min.z) / 2, near: center.z > 0 };
  });
  for (const r of raw.filter((r) => !r.body)) {
    const c = r.geometry.boundingSphere.center;
    let best = 0, bd = Infinity;
    wheels.forEach((w, i) => { const d = w.center.distanceToSquared(c); if (d < bd) { bd = d; best = i; } });
    parts.push({ role: r.role, geometry: r.geometry, slot: best });
  }

  const slotOf = (slot) => (slot === "body" ? body : slot === "front" || slot === "rear" ? doors[slot].inner : wheels[slot].inner);
  return { root, body, parts, doors, wheels, box, slotOf };
}

// ── Shaded ("the real thing") materials ─────────────────────────
// Every physical material gets the materialise sweep (fragments on the tail side of the sweep
// are discarded, with a cyan scan band on the edge) and the x-ray look (fresnel rim, see-through).
export const shadeUniforms = {
  uSweepX: { value: 10 },
  uXray: { value: 0 },
  uScan: { value: new THREE.Color("#5CE1E6") },
};

function inject(mat) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shadeUniforms);
    shader.vertexShader = "varying vec3 vSweepWorld;\n" + shader.vertexShader.replace(
      "#include <project_vertex>",
      "#include <project_vertex>\n  vSweepWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = "uniform float uSweepX;\nuniform float uXray;\nuniform vec3 uScan;\nvarying vec3 vSweepWorld;\n" +
      shader.fragmentShader.replace("#include <opaque_fragment>", `#include <opaque_fragment>
  {
    if (!gl_FrontFacing) gl_FragColor.rgb *= 0.12; // inside of a door opening: dark, not lit paint
    float dSweep = vSweepWorld.x - uSweepX;
    if (dSweep < 0.0) discard;
    float band = 1.0 - smoothstep(0.0, 0.16, dSweep);
    gl_FragColor.rgb += uScan * band * 2.5;
    float fres = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.0);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, uScan * (0.15 + 1.4 * fres), uXray * 0.85);
    gl_FragColor.a *= mix(1.0, 0.04 + 0.5 * fres, uXray);
  }`);
  };
  mat.customProgramCacheKey = () => "ol-shade";
  return mat;
}

const PHYSICAL_ONLY = ["clearcoat", "clearcoatRoughness", "transmission", "thickness", "ior", "sheen", "iridescence"];

/**
 * One material per role. `xray` makes the see-through variant (transparent, no depth writes).
 * The lite-lit tier ("low") gets MeshStandardMaterial with no environment map to reflect, so
 * metals are toned down (a metal with nothing to reflect renders black) and the paint is a
 * little lighter and rougher to catch the key and hemisphere lights.
 */
export function makeShadedMaterials(tier, xray = false) {
  const high = tier === "high", lite = tier === "low";
  const P = (o) => {
    let m;
    if (lite) {
      const s = { ...o };
      for (const k of PHYSICAL_ONLY) delete s[k];
      delete s.envMapIntensity;
      if (s.metalness) s.metalness *= 0.35;
      if (s.roughness != null) s.roughness = Math.min(0.85, s.roughness + 0.12);
      m = new THREE.MeshStandardMaterial(s);
    } else m = new THREE.MeshPhysicalMaterial(o);
    m.polygonOffset = true; m.polygonOffsetFactor = 1; m.polygonOffsetUnits = 1;
    if (xray) { m.transparent = true; m.depthWrite = false; m.side = THREE.DoubleSide; }
    return inject(m);
  };
  const mats = {
    paint: P({ color: lite ? "#1d6476" : "#144a59", metalness: 0.55, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.1 }),
    trim: P({ color: "#0d1116", metalness: 0.35, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.12 }),
    lower: P({ color: "#14191e", metalness: 0.1, roughness: 0.75 }),
    glass: P(high && !xray
      ? { color: "#0a1f2c", metalness: 0, roughness: 0.04, transmission: 0.35, thickness: 0.02, ior: 1.5, clearcoat: 1, envMapIntensity: 1.6 }
      : { color: "#06141e", metalness: 0.2, roughness: 0.04, clearcoat: 1, envMapIntensity: 1.6, transparent: true, opacity: xray ? 1 : 0.9 }),
    mirror: P({ color: "#0d1116", metalness: 0.35, roughness: 0.4, clearcoat: 0.6 }),
    lightbar: P({ color: "#0b1820", emissive: "#bff8ff", emissiveIntensity: 0, roughness: 0.2 }),
    tail: P({ color: "#2a0606", emissive: "#ff2a2a", emissiveIntensity: 0, roughness: 0.25 }),
    rim: P({ color: "#2b3138", metalness: 0.9, roughness: 0.3 }),
    hub: P({ color: "#0e1114", metalness: 0.6, roughness: 0.45 }),
    disc: P({ color: "#5b6168", metalness: 0.85, roughness: 0.38 }),
    tyre: P({ color: "#0b0c0e", metalness: 0, roughness: 0.92 }),
  };
  for (const m of Object.values(mats)) m.side = xray ? THREE.DoubleSide : THREE.FrontSide;
  // The cut-out door openings would show the far side's backfaces; keep body paint double-sided.
  if (!xray) mats.paint.side = mats.trim.side = mats.lower.side = THREE.DoubleSide;
  return mats;
}
