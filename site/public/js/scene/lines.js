// Hand-drawn line rendering: every edge is a screen-space quad (instanced), drawn twice with a
// tiny random offset and different opacity, a gentle wobble in the vertex shader, ends that
// overshoot like a draughtsman's construction lines, and a "drawing in" progress.
// Also carries the materialise scan band (lines fade to a faint overlay behind the sweep).
import * as THREE from "three";

// Uniforms shared by every line material (one object each, so one write updates all).
export const lineUniforms = {
  uRes: { value: new THREE.Vector2(1, 1) },
  uTime: { value: 0 },
  uDraw: { value: 0 },
  uWobble: { value: 0.0035 },
  uJitter: { value: 0.006 },
  uOver: { value: 0.06 },
  uSweepX: { value: 10 },
  uFaint: { value: 0.22 },
  uScan: { value: new THREE.Color("#5CE1E6") },
  uDim: { value: 1 },
};

const VERT = /* glsl */ `
attribute vec2 corner;
attribute vec3 iStart;
attribute vec3 iEnd;
attribute vec4 iData; // seed, draw order (0..1), alpha, overshoot (0/1)
uniform vec2 uRes;
uniform float uTime, uDraw, uWobble, uJitter, uOver, uWidth;
varying float vAlpha;
varying float vSide;
varying vec3 vWorld;
varying vec3 vLocal;

float hash(float n) { return fract(sin(n) * 43758.5453123); }
vec3 hash3(float n) { return vec3(hash(n), hash(n + 1.71), hash(n + 3.13)) - 0.5; }
vec3 wobble(vec3 p, float s) {
  return vec3(
    sin(uTime * 1.10 + s * 6.283 + p.x * 2.1 + p.y * 1.3),
    sin(uTime * 0.93 + s * 4.100 + p.y * 2.7 + p.z * 1.1),
    sin(uTime * 1.27 + s * 2.700 + p.z * 2.3 + p.x * 0.7)) * uWobble;
}

void main() {
  float seed = iData.x;
  float local = clamp((uDraw * 1.4 - iData.y) / 0.4, 0.0, 1.0);
  vec3 a = iStart;
  vec3 b = iEnd;
  vec3 d = b - a;
  float len = length(d);
  vec3 dir = d / max(len, 1e-5);
  float over = uOver * iData.w * (0.35 + hash(seed * 3.3)) * min(len, 0.5);
  a -= dir * over * hash(seed * 9.1);
  b += dir * over;
  b = mix(a, b, local);
  vec3 off = hash3(seed) * uJitter;
  a += off + wobble(a, seed);
  b += off + wobble(b, seed + 0.37);

  vec4 ca = projectionMatrix * modelViewMatrix * vec4(a, 1.0);
  vec4 cb = projectionMatrix * modelViewMatrix * vec4(b, 1.0);
  vec2 sa = ca.xy / ca.w;
  vec2 sb = cb.xy / cb.w;
  vec2 sd = (sb - sa) * 0.5 * uRes;
  float sl = length(sd);
  vec2 dirS = sl > 1e-4 ? sd / sl : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dirS.y, dirS.x);
  float w = uWidth * (0.8 + 0.4 * hash(seed * 7.7));
  vec4 c = mix(ca, cb, corner.y);
  vec2 offs = nrm * corner.x * w * 0.5 + dirS * (corner.y * 2.0 - 1.0) * w * 0.5;
  c.xy += offs * 2.0 / uRes * c.w;
  gl_Position = c;

  vec3 p = mix(a, b, corner.y);
  vLocal = p;
  vWorld = (modelMatrix * vec4(p, 1.0)).xyz;
  vAlpha = iData.z * step(0.0001, local) * step(1e-4, len);
  vSide = corner.x;
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uSweepX, uFaint, uDim, uBar, uBarSweep, uBarGlow;
uniform vec3 uScan;
varying float vAlpha;
varying float vSide;
varying vec3 vWorld;
varying vec3 vLocal;

void main() {
  float edge = 1.0 - smoothstep(0.45, 1.0, abs(vSide));
  float a = uOpacity * vAlpha * edge * uDim;
  // Materialise: behind the sweep (toward the nose) the lines become a faint overlay,
  // and a bright scan band rides on the sweep line itself.
  float ds = vWorld.x - uSweepX;
  float past = smoothstep(-0.03, 0.03, ds);
  float band = 1.0 - smoothstep(0.0, 0.22, abs(ds));
  vec3 col = uColor;
  a *= mix(1.0, uFaint, past);
  col = mix(col, uScan * 2.2, band);
  a = max(a, band * 0.9 * vAlpha * edge);
  // Light bar: glow level plus a travelling highlight across its width (local z).
  if (uBar > 0.5) {
    float s = 1.0 - smoothstep(0.0, 0.28, abs(vLocal.z - uBarSweep));
    col *= uBarGlow + s * 2.5;
  }
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

let quad = null;
function baseQuad() {
  if (quad) return quad;
  quad = new THREE.InstancedBufferGeometry();
  quad.setAttribute("corner", new THREE.Float32BufferAttribute([-1, 0, 1, 0, -1, 1, 1, 1], 2));
  quad.setIndex([0, 1, 2, 2, 1, 3]);
  return quad;
}

export function makeLineMaterial({ color = "#EAF4FF", opacity = 1, width = 1.6, additive = false, bar = false } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      ...lineUniforms,
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uWidth: { value: width },
      uBar: { value: bar ? 1 : 0 },
      uBarSweep: { value: -9 },
      uBarGlow: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide, // the quad's winding follows the line's screen direction
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

/**
 * Builds a line mesh from a flat list of segment endpoints [ax,ay,az,bx,by,bz, ...].
 * `orderOf(x, y, z)` gives each segment's place in the drawing-in sequence (0 first, 1 last).
 */
export function makeLines(segments, material, { doubled = true, orderOf = () => Math.random() } = {}) {
  const n = segments.length / 6;
  const copies = doubled ? 2 : 1;
  const start = new Float32Array(n * copies * 3);
  const end = new Float32Array(n * copies * 3);
  const data = new Float32Array(n * copies * 4);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    const mx = (segments[o] + segments[o + 3]) / 2, my = (segments[o + 1] + segments[o + 4]) / 2, mz = (segments[o + 2] + segments[o + 5]) / 2;
    const order = Math.min(1, Math.max(0, orderOf(mx, my, mz)));
    for (let c = 0; c < copies; c++) {
      start.set(segments.subarray ? segments.subarray(o, o + 3) : segments.slice(o, o + 3), k * 3);
      end.set(segments.subarray ? segments.subarray(o + 3, o + 6) : segments.slice(o + 3, o + 6), k * 3);
      data[k * 4] = Math.random() * 100;
      data[k * 4 + 1] = Math.min(1, order + c * 0.04);
      data[k * 4 + 2] = c === 0 ? 1 : 0.42;
      data[k * 4 + 3] = c === 0 ? 1 : 0;
      k++;
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  const q = baseQuad();
  g.setIndex(q.index);
  g.setAttribute("corner", q.attributes.corner);
  g.setAttribute("iStart", new THREE.InstancedBufferAttribute(start, 3));
  g.setAttribute("iEnd", new THREE.InstancedBufferAttribute(end, 3));
  g.setAttribute("iData", new THREE.InstancedBufferAttribute(data, 4));
  g.instanceCount = k;
  const mesh = new THREE.Mesh(g, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  return mesh;
}

/** Crease edges of a geometry (in its own space) as a segment list. */
export function edgeSegments(geometry, angle = 25) {
  const e = new THREE.EdgesGeometry(geometry, angle);
  const arr = Float32Array.from(e.attributes.position.array);
  e.dispose();
  return arr;
}

/** Circle in a plane perpendicular to Z (wheel faces), as segments. */
export function circleSegments(cx, cy, cz, r, n = 56) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    out.push(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, cz, cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, cz);
  }
  return out;
}

/** Edges of an axis-aligned box, as segments. */
export function boxSegments(x0, y0, z0, x1, y1, z1) {
  const p = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const e = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  const out = [];
  for (const [a, b] of e) out.push(...p[a], ...p[b]);
  return out;
}
