// "The real thing": environment reflections, moving key and rim lights, the emissive light bar and
// headlights with their glow, a reflective studio floor with a contact shadow, light shafts and fog,
// the x-ray batteries (solid, glowing high-voltage pack and 12V battery), and bloom (high tier)
// through the post-processing chain. The lite-lit tier ("low") keeps the hemisphere and key light,
// the emissive lights with their glow sprites and the contact shadow, and skips the environment
// map, rim spot, light shafts, floor fade, shadows and bloom.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

export const PAPER = "#0B2545";
// X-ray value where the batteries start fading in; main.js hides the depth meshes from here too.
export const XRAY_SHOW = 0.35;

/**
 * The paper colour to put into the scene for a tier. On high, the composer's OutputPass tone-maps
 * the whole frame, and NeutralToneMapping's toe subtracts (x - 6.25x²) from every channel, x being
 * the smallest channel. Feeding it the colour that comes out as the paper again keeps the canvas
 * equal to the CSS --paper (x = sqrt(min / 6.25), valid while x < 0.08). Other tiers: as is.
 */
function paperFor(tier) {
  const c = new THREE.Color(PAPER); // linear values
  if (tier !== "high") return c;
  const m = Math.min(c.r, c.g, c.b);
  const off = Math.sqrt(m / 6.25) - m;
  return c.setRGB(c.r + off, c.g + off, c.b + off, THREE.LinearSRGBColorSpace);
}

function radialTexture(stops, size = 128) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function shaftTexture() {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 256;
  const g = c.getContext("2d");
  const v = g.createLinearGradient(0, 0, 0, 256);
  v.addColorStop(0, "rgba(255,255,255,0.9)"); v.addColorStop(0.7, "rgba(255,255,255,0.25)"); v.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = v; g.fillRect(0, 0, 64, 256);
  g.globalCompositeOperation = "destination-in";
  const h = g.createLinearGradient(0, 0, 64, 0);
  h.addColorStop(0, "rgba(0,0,0,0)"); h.addColorStop(0.5, "rgba(0,0,0,1)"); h.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = h; g.fillRect(0, 0, 64, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildStudio({ scene, renderer, camera, model, tier }) {
  const disposables = [];
  const keep = (x) => (disposables.push(x), x);
  const { box } = model;
  const L = box.max[0] - box.min[0];

  // Environment reflections (PMREM of three's RoomEnvironment), rotated as you scroll. Made only
  // for the medium and high tiers, the first time one of them is used.
  let env = null;
  function ensureEnv() {
    if (env) return env;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    env = keep(pmrem.fromScene(room, 0.04).texture);
    room.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
    pmrem.dispose();
    return env;
  }
  scene.environmentIntensity = 0;
  // Fog range follows the camera distance (main.js calls setFogRange), so the car never fogs out.
  scene.fog = new THREE.Fog(PAPER, 16, 38);
  // A colour background (not just the clear colour): RenderPass clears with autoClear off, and
  // only a scene background is drawn into the linear render target. setTier sets its colour (and
  // the fog's and the floor fade's) per tier, pre-compensated for tone mapping on high.
  scene.background = new THREE.Color(PAPER);

  // Lights.
  const hemi = new THREE.HemisphereLight("#9fc4ff", "#071a33", 0);
  const key = new THREE.DirectionalLight("#ffffff", 0);
  key.position.set(4, 7, 6);
  const rim = new THREE.SpotLight("#bdf6ff", 0, 18, Math.PI / 7, 0.6, 1.2);
  rim.position.set(0, 3.2, -4.5);
  rim.target.position.set(0, 0.6, 0);
  scene.add(hemi, key, rim, rim.target);

  // Floor: contact shadow, the mirrored car (high tier, added by main.js) and a paper-coloured
  // fade that hides the reflection's edge in the navy page.
  const floorGroup = new THREE.Group();
  scene.add(floorGroup);
  const fadeTex = keep(radialTexture([[0, "rgba(11,37,69,0.62)"], [0.45, "rgba(11,37,69,0.9)"], [0.72, "rgba(11,37,69,1)"], [1, "rgba(11,37,69,0)"]]));
  const fade = new THREE.Mesh(keep(new THREE.PlaneGeometry(L * 2.4, L * 1.6)), keep(new THREE.MeshBasicMaterial({ map: fadeTex, transparent: true, depthWrite: false, toneMapped: false, fog: false, opacity: 0 })));
  fade.rotation.x = -Math.PI / 2;
  fade.renderOrder = 1;
  const shadowTex = keep(radialTexture([[0, "rgba(0,0,0,0.85)"], [0.55, "rgba(0,0,0,0.45)"], [1, "rgba(0,0,0,0)"]]));
  const contact = new THREE.Mesh(keep(new THREE.PlaneGeometry(L * 1.08, 2.9)), keep(new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, toneMapped: false, fog: false, opacity: 0 })));
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.003;
  contact.renderOrder = 2;
  floorGroup.add(fade, contact);
  let shadowFloor = null;

  // Light shafts behind the car.
  const shaftTex = keep(shaftTexture());
  const shaftMat = keep(new THREE.MeshBasicMaterial({ map: shaftTex, color: "#9feef2", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, fog: false, toneMapped: false }));
  const shafts = new THREE.Group();
  for (const [x, w, rz] of [[-2.2, 1.1, 0.18], [0.2, 1.5, 0.05], [2.4, 0.9, -0.15]]) {
    const m = new THREE.Mesh(keep(new THREE.PlaneGeometry(w, 7)), shaftMat);
    m.position.set(x, 2.8, -2.6);
    m.rotation.z = rz;
    m.renderOrder = 0;
    shafts.add(m);
  }
  scene.add(shafts);

  // Glows: headlights at the light bar's ends, a centre glow and a sweeping highlight.
  const glowTex = keep(radialTexture([[0, "rgba(255,255,255,1)"], [0.2, "rgba(190,250,255,0.6)"], [0.5, "rgba(92,225,230,0.15)"], [1, "rgba(92,225,230,0)"]]));
  const lb = model.parts.filter((p) => p.role === "lightbar").map((p) => p.geometry);
  const lbBox = new THREE.Box3();
  for (const g of lb) { g.computeBoundingBox(); lbBox.union(g.boundingBox); }
  const lbY = (lbBox.min.y + lbBox.max.y) / 2, lbX = lbBox.max.x - 0.06, lbZ = lbBox.max.z;
  const sprite = (s) => { const m = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: glowTex, color: "#cffbff", transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, opacity: 0, toneMapped: false, fog: false }))); m.scale.set(s, s, 1); m.renderOrder = 20; return m; };
  const head = [sprite(0.5), sprite(0.5)];
  head[0].position.set(lbX - 0.08, lbY - 0.02, lbZ - 0.08);
  head[1].position.set(lbX - 0.08, lbY - 0.02, -lbZ + 0.08);
  const sweep = sprite(0.55);
  sweep.position.set(lbX, lbY, 0);
  const tailGlow = [sprite(0.4), sprite(0.4)];
  for (const s of tailGlow) s.material.color.set("#ff6a5a");
  const tl = model.parts.filter((p) => p.role === "tail").map((p) => p.geometry);
  const tlBox = new THREE.Box3();
  for (const g of tl) { g.computeBoundingBox(); tlBox.union(g.boundingBox); }
  tailGlow[0].position.set(tlBox.min.x + 0.05, tlBox.min.y + 0.01, tlBox.max.z - 0.15);
  tailGlow[1].position.set(tlBox.min.x + 0.05, tlBox.min.y + 0.01, -tlBox.max.z + 0.15);
  model.body.add(...head, sweep, ...tailGlow);

  // X-ray: the two batteries as solid, softly glowing boxes, seen through the see-through car.
  // Model space: Y up, nose +X, near side +Z, which is the car's right, so the passenger side on a
  // US car (tools/measure-batteries.mjs measured the places):
  //  - high-voltage pack: a flat slab under the floor between the axles (wheel centres x = ±1.55,
  //    underbody y = 0.25, tyres from |z| = 0.75), with a module grid on top;
  //  - 12V battery: under the bonnet on the passenger side, just under the cowl (windshield base
  //    x ≈ 1.44, bonnet skin y ≈ 1.24 there), high up at the back of the front compartment.
  const pack = { x0: -1.38, x1: 1.38, y0: 0.262, y1: 0.392, z: 0.7 };
  const v12 = { x0: 1.5, x1: 1.7, y0: 0.93, y1: 1.11, z0: 0.28, z1: 0.58 };
  const gridTex = keep((() => {
    const c = document.createElement("canvas");
    c.width = 512; c.height = 128;
    const g = c.getContext("2d");
    g.fillStyle = "#d9d9d9"; g.fillRect(0, 0, 512, 128);
    g.strokeStyle = "#5c5c5c"; g.lineWidth = 3;
    for (let i = 1; i < 10; i++) { const x = (i / 10) * 512; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 128); g.stroke(); }
    g.beginPath(); g.moveTo(0, 64); g.lineTo(512, 64); g.stroke();
    g.strokeStyle = "#ffffff"; g.lineWidth = 6; g.strokeRect(3, 3, 506, 122);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  })());
  const batteryMat = (color, emissive, map = null) => keep(new THREE.MeshStandardMaterial({
    color, emissive, emissiveIntensity: 0.6, roughness: 0.45, metalness: 0.15, map, emissiveMap: map,
    transparent: true, opacity: 0, fog: false,
  }));
  const packSide = batteryMat("#0f4d55", "#5CE1E6");
  const packTop = batteryMat("#1a6b74", "#5CE1E6", gridTex);
  // BoxGeometry face order: +x, -x, +y (top), -y, +z, -z.
  const packMesh = new THREE.Mesh(keep(new THREE.BoxGeometry(pack.x1 - pack.x0, pack.y1 - pack.y0, pack.z * 2)), [packSide, packSide, packTop, packSide, packSide, packSide]);
  packMesh.position.set((pack.x0 + pack.x1) / 2, (pack.y0 + pack.y1) / 2, 0);
  const v12Mat = batteryMat("#6b4410", "#FFB44D");
  const v12Mesh = new THREE.Mesh(keep(new THREE.BoxGeometry(v12.x1 - v12.x0, v12.y1 - v12.y0, v12.z1 - v12.z0)), v12Mat);
  v12Mesh.position.set((v12.x0 + v12.x1) / 2, (v12.y0 + v12.y1) / 2, (v12.z0 + v12.z1) / 2);
  // Drawn before the see-through car (which then tints them), after the opaque pass.
  packMesh.renderOrder = v12Mesh.renderOrder = -2;
  // Soft halos: additive sprites, drawn over everything (the x-ray car writes no depth).
  const haloTex = keep(radialTexture([[0, "rgba(255,255,255,0.85)"], [0.35, "rgba(255,255,255,0.35)"], [0.7, "rgba(255,255,255,0.08)"], [1, "rgba(255,255,255,0)"]]));
  const halo = (color, sx, sy) => {
    const m = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: haloTex, color, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, opacity: 0, toneMapped: false, fog: false })));
    m.scale.set(sx, sy, 1);
    m.renderOrder = 19;
    return m;
  };
  const packHalo = halo("#5CE1E6", (pack.x1 - pack.x0) * 1.25, 1.1);
  packHalo.position.copy(packMesh.position);
  const v12Halo = halo("#FFB44D", 0.75, 0.75);
  v12Halo.position.copy(v12Mesh.position);
  model.body.add(packMesh, v12Mesh, packHalo, v12Halo);

  const anchors = {
    lightbar: new THREE.Vector3(lbX, lbBox.max.y + 0.02, lbZ * 0.55),
    pack: new THREE.Vector3(-0.35, pack.y1, pack.z),
    v12: new THREE.Vector3((v12.x0 + v12.x1) / 2, v12.y1, v12.z1),
    modules: [
      ["BMS", new THREE.Vector3(-0.2, pack.y1, 0.2)],
      ["Gateway", new THREE.Vector3(0.95, 0.82, 0.05)],
      ["Body", new THREE.Vector3(0.62, 1.02, -0.38)],
      ["Climate", new THREE.Vector3(1.08, 1.06, 0.1)],
      ["Brakes", new THREE.Vector3(1.86, 0.72, 0.5)],
      ["Steering", new THREE.Vector3(1.3, 0.66, 0.32)],
      ["Front motor", new THREE.Vector3(1.6, 0.46, 0)],
      ["Rear motor", new THREE.Vector3(-1.48, 0.46, 0)],
      ["Airbags", new THREE.Vector3(0.42, 0.88, 0.3)],
    ],
  };

  // Post-processing (high tier): bloom on what is brighter than white (light bar, headlights,
  // clearcoat highlights). The ink lines stay below the threshold.
  let composer = null, bloom = null;
  const paper = new THREE.Color(PAPER);
  function disposeComposer() {
    if (!composer) return;
    // EffectComposer.dispose() frees only its own targets and copy pass, not the added passes.
    for (const p of composer.passes) p.dispose?.();
    composer.dispose();
    composer = null; bloom = null;
  }
  function setTier(t) {
    tier = t;
    disposeComposer();
    const lite = t === "low";
    scene.environment = lite ? null : ensureEnv();
    rim.visible = !lite;
    const pc = paperFor(t);
    scene.background.copy(pc);
    scene.fog.color.copy(pc);
    fade.material.color.setRGB(pc.r / paper.r, pc.g / paper.g, pc.b / paper.b, THREE.LinearSRGBColorSpace);
    renderer.shadowMap.enabled = t === "high";
    key.castShadow = t === "high";
    if (t === "high") {
      key.shadow.mapSize.set(1024, 1024);
      Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 20 });
      key.shadow.camera.updateProjectionMatrix();
      key.shadow.bias = -0.0005;
      key.shadow.radius = 4;
      if (!shadowFloor) {
        shadowFloor = new THREE.Mesh(keep(new THREE.PlaneGeometry(L * 2, L * 1.2)), keep(new THREE.ShadowMaterial({ opacity: 0, transparent: true })));
        shadowFloor.rotation.x = -Math.PI / 2;
        shadowFloor.position.y = 0.004;
        shadowFloor.receiveShadow = true;
        shadowFloor.renderOrder = 3;
        floorGroup.add(shadowFloor);
      }
      shadowFloor.visible = true;
      const size = renderer.getSize(new THREE.Vector2());
      const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
      composer = new EffectComposer(renderer, rt);
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(size.x, size.y);
      composer.addPass(new RenderPass(scene, camera));
      bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.6, 0.4, 1.6);
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
    } else if (shadowFloor) shadowFloor.visible = false;
    shafts.visible = fade.visible = !lite;
  }
  setTier(tier);

  return {
    anchors,
    get composer() { return composer; },
    resize(w, h, dpr) {
      if (composer) { composer.setPixelRatio(dpr); composer.setSize(w, h); bloom?.resolution.set(w / 2, h / 2); }
    },
    setTier,
    /** Fog starts just behind the car and ends well past it, whatever the camera distance. */
    setFogRange(dist) { scene.fog.near = dist + 3; scene.fog.far = dist + 22; },
    /** Applies the story state. `t` is time in seconds; `pulse` (0..1) scales the battery pulse. */
    update(s, t, pulse = 0) {
      const mat = s.materialise, boot = s.boot;
      const lit = mat, lite = tier === "low";
      scene.environmentIntensity = lit * 0.7;
      scene.environmentRotation.y = s.env + Math.sin(t * 0.07) * 0.04;
      // Without the environment map the lite-lit tier needs more fill and key light.
      hemi.intensity = lit * (lite ? 1.5 : 0.5);
      key.intensity = lit * (lite ? 2.6 : 1.9);
      key.position.set(4 * Math.cos(s.env * 0.6), 7, 6 * Math.sin(0.9 + s.env * 0.6));
      rim.intensity = lit * (10 + 8 * Math.abs(Math.sin(s.rim * 1.4)));
      rim.position.set(s.rim * 3.2, 3.2, -4.5);
      rim.target.position.set(s.rim * 1.6, 0.4, 0);
      fade.material.opacity = lit;
      contact.material.opacity = lit * 0.7;
      if (shadowFloor) shadowFloor.material.opacity = lit * 0.35;
      shaftMat.opacity = lit * 0.07 * (1 + 0.15 * Math.sin(t * 0.8));
      // Boot-up: centre glow first, then a sweep outward, then the headlights and tail lights.
      const on = (a, b) => Math.min(1, Math.max(0, (boot - a) / (b - a)));
      const sleepy = 1 - s.dim * 0.7;
      const bar = on(0, 0.5) * sleepy;
      const headOn = on(0.45, 0.8) * sleepy;
      const tailOn = on(0.7, 1) * sleepy;
      const sweepZ = s.lightSweep > 0 ? Math.sin(s.lightSweep * Math.PI * 2 - Math.PI / 2) * lbZ : (on(0.2, 0.6) * 2 - 1) * lbZ;
      sweep.position.z = sweepZ;
      sweep.material.opacity = (s.lightSweep > 0 ? 0.9 * Math.sin(Math.min(1, s.lightSweep) * Math.PI) : on(0.15, 0.3) * (1 - on(0.55, 0.7))) ;
      head[0].material.opacity = head[1].material.opacity = headOn * (0.55 + 0.45 * lit) * (1 - 0.6 * s.xray);
      tailGlow[0].material.opacity = tailGlow[1].material.opacity = tailOn * 0.7 * lit;
      // Batteries: fade in with the x-ray. The pack pulses as the x-ray opens, then (focus12) the
      // 12V battery takes over the pulse while the pack keeps a steady glow.
      const xr = Math.min(1, Math.max(0, (s.xray - XRAY_SHOW) / 0.5));
      const show = xr > 0.001;
      packMesh.visible = v12Mesh.visible = packHalo.visible = v12Halo.visible = show;
      if (show) {
        const f = s.focus12 ?? 0;
        const wave = 0.5 + 0.5 * Math.sin(t * 2.6);
        const pPack = (1 - f) * pulse * wave, p12 = f * pulse * wave;
        const glowK = tier === "high" ? 1.6 : 1;
        for (const m of [packSide, packTop]) { m.opacity = xr; m.emissiveIntensity = (0.55 + 0.75 * pPack) * glowK; }
        v12Mat.opacity = xr;
        v12Mat.emissiveIntensity = (0.75 + 1.1 * p12) * glowK;
        packHalo.material.opacity = xr * (0.16 + 0.22 * pPack);
        v12Halo.material.opacity = xr * (0.3 + 0.45 * p12);
      }
      if (bloom) bloom.strength = 0.2 + 0.45 * Math.max(bar * lit, headOn * lit);
      return { bar, headOn, tailOn, sweepZ };
    },
    render() {
      if (composer) composer.render();
      else renderer.render(scene, camera);
    },
    dispose() {
      disposeComposer();
      scene.environment = null;
      for (const d of disposables) d.dispose?.();
    },
  };
}
