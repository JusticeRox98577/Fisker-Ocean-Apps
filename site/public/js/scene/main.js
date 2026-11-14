// Puts the blueprint together: renderer and tier, model, line drawing, shaded car, studio
// lighting, doors, overlays and the scroll story. Renders on demand only: while the page scrolls,
// a tween or spring is moving, the drawing draws in, or for a short idle drift after the last
// input. Nothing renders while the tab is hidden.
import * as THREE from "three";
import { createRenderer, guessTier, softwareRenderer, probe, FrameWatch, TIERS, DPR_CAP } from "./renderer.js";
import { loadModel, makeShadedMaterials, shadeUniforms } from "./model.js";
import { lineUniforms, makeLineMaterial, makeLines, edgeSegments, circleSegments } from "./lines.js";
import { DoorMotion } from "./doors.js";
import { buildStudio, XRAY_SHOW } from "./lighting.js";
import { createStory, START } from "./story.js";
import { buildOverlays } from "./overlays.js";
import { fitBesidePanel } from "./framing.js";
import { gsap } from "../lib/gsap.js";

const DEG = Math.PI / 180;
const IDLE_MS = { high: 20000, medium: 9000, low: 5000 };

export async function startScene(canvas) {
  const html = document.documentElement;
  const ac = new AbortController();
  const on = (target, type, fn, opts = {}) => target.addEventListener(type, fn, { ...opts, signal: ac.signal });

  // ?tier=low|medium|high pins a tier (for checking each look); otherwise guess, probe and watch.
  // A software renderer (WebGL on the CPU) starts on the lite-lit tier, without multisampling.
  const software = softwareRenderer();
  const renderer = createRenderer(canvas, { antialias: !software });
  const forced = new URLSearchParams(location.search).get("tier");
  let tier = TIERS.includes(forced) ? forced : guessTier(software);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 80);

  const model = await loadModel("/models/ocean.glb", ac.signal);
  scene.add(model.root);
  const L = model.box.max[0] - model.box.min[0];

  // ── Lines ──
  const lineMats = {
    ink: makeLineMaterial({ color: "#EAF4FF", width: 1.5 }),
    glass: makeLineMaterial({ color: "#A9C4E0", width: 1.2, opacity: 0.9 }),
    bar: makeLineMaterial({ color: "#5CE1E6", width: 2.8, additive: true, bar: true }),
    wheel: makeLineMaterial({ color: "#EAF4FF", width: 1.2, opacity: 0.85 }),
    ground: makeLineMaterial({ color: "#A9C4E0", width: 1, opacity: 0.4 }),
  };
  for (const m of Object.values(lineMats)) m.userData.width = m.uniforms.uWidth.value;
  const orderOf = (x) => 0.82 * (1 - (x - model.box.min[0]) / L) + 0.18 * Math.random();
  const buckets = new Map();
  const bucket = (slot, kind) => { const k = `${slot}|${kind}`; if (!buckets.has(k)) buckets.set(k, []); return buckets.get(k); };
  for (const p of model.parts) {
    if (p.role === "tyre") continue;
    const kind = p.role === "lightbar" ? "bar" : p.role === "glass" ? "glass" : ["rim", "hub", "disc"].includes(p.role) ? "wheel" : "ink";
    const segs = edgeSegments(p.geometry, 25);
    const list = bucket(p.slot, kind);
    for (let i = 0; i < segs.length; i++) list.push(segs[i]);
  }
  model.wheels.forEach((w, i) => {
    const out = w.near ? 1 : -1, c = w.center, R = w.radius;
    const zo = c.z + out * w.halfWidth * 0.92, zi = c.z - out * w.halfWidth * 0.92;
    const list = bucket(i, "wheel");
    list.push(...circleSegments(c.x, c.y, zo, R), ...circleSegments(c.x, c.y, zo, R * 0.84, 48), ...circleSegments(c.x, c.y, zi, R));
    for (let k = 0; k < 28; k++) {
      const a = (k / 28) * Math.PI * 2, x = c.x + Math.cos(a) * R, y = c.y + Math.sin(a) * R;
      list.push(x, y, zo, x, y, zi);
    }
  });
  {
    const g = bucket("body", "ground"), zN = model.box.max[2] + 0.05;
    g.push(-L * 0.62, 0, zN, L * 0.62, 0, zN, -L * 0.62, 0, -zN, L * 0.62, 0, -zN);
  }
  for (const [k, segs] of buckets) {
    const [slotKey, kind] = k.split("|");
    const slot = /^\d+$/.test(slotKey) ? Number(slotKey) : slotKey;
    model.slotOf(slot).add(makeLines(new Float32Array(segs), lineMats[kind], { orderOf: kind === "ground" ? () => 0 : orderOf }));
  }

  // ── Hidden-line depth meshes (the lines behind the body are hidden) ──
  const depthMat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
  const depthMeshes = model.parts.map((p) => {
    const m = new THREE.Mesh(p.geometry, depthMat);
    m.renderOrder = -1;
    model.slotOf(p.slot).add(m);
    return m;
  });

  // ── The studio (lights, glow, floor, x-ray pack, bloom) ──
  const studio = buildStudio({ scene, renderer, camera, model, tier });

  // ── Shaded car ("the real thing") and its mirror image in the floor ──
  let mats = null, matsX = null, shaded = [], mirror = null, mirrorPairs = [];
  function buildShaded() {
    disposeShaded();
    mats = makeShadedMaterials(tier);
    matsX = makeShadedMaterials(tier, true);
    shaded = model.parts.map((p) => {
      const m = new THREE.Mesh(p.geometry, mats[p.role]);
      m.userData.role = p.role;
      m.castShadow = tier === "high";
      m.visible = false;
      model.slotOf(p.slot).add(m);
      return m;
    });
    if (tier === "high") {
      // Mirror: a clone of the car's groups with only the shaded meshes, flipped under the floor.
      const src = [], dst = [];
      const copy = model.root.clone(true);
      model.root.traverse((o) => src.push(o));
      copy.traverse((o) => dst.push(o));
      mirrorPairs = src.map((o, i) => [o, dst[i]]).filter(([o]) => o.isGroup);
      // Keep only the shaded meshes: no lines, depth meshes, x-ray pack or glow sprites (the
      // floor fade draws before the sprites, so mirrored glows would show at full brightness).
      const drop = dst.filter((o) => (o.isMesh || o.isSprite || o.isLine || o.isPoints) && !o.userData.role);
      for (const o of drop) o.removeFromParent();
      copy.traverse((o) => { if (o.isMesh) { o.castShadow = false; shaded.push(o); } });
      mirror = new THREE.Group();
      mirror.scale.y = -1;
      mirror.add(copy);
      scene.add(mirror);
    }
  }
  function disposeShaded() {
    for (const m of shaded) m.removeFromParent();
    shaded = [];
    if (mirror) { mirror.removeFromParent(); mirror = null; mirrorPairs = []; }
    for (const set of [mats, matsX]) if (set) for (const m of Object.values(set)) m.dispose();
    mats = matsX = null;
  }
  buildShaded();

  // ── Doors, overlays, story ──
  const doorF = new DoorMotion(model.doors.front.pivot, 58, { stiffness: 36, damping: 0.42 });
  const doorR = new DoorMotion(model.doors.rear.pivot, 54, { stiffness: 30, damping: 0.45 });
  const overlays = buildOverlays(document.getElementById("callouts"), { model, anchors: studio.anchors });
  const state = { ...START, draw: 0 };

  // ── Input: pointer parallax (mouse), phone tilt only after a tap, idle drift ──
  const tilt = { x: 0, y: 0, tx: 0, ty: 0 };
  let lastInput = performance.now(), drift = 0;
  const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (fine) on(window, "pointermove", (e) => { tilt.tx = (e.clientX / innerWidth - 0.5) * 2; tilt.ty = (e.clientY / innerHeight - 0.5) * 2; lastInput = performance.now(); request(); }, { passive: true });
  on(window, "scroll", () => { lastInput = performance.now(); request(); }, { passive: true });
  const tiltBtn = document.getElementById("tilt-toggle");
  let gyroOn = false;
  const onOrient = (e) => {
    if (e.gamma == null || e.beta == null) return;
    tilt.tx = Math.max(-1, Math.min(1, e.gamma / 30));
    tilt.ty = Math.max(-1, Math.min(1, (e.beta - 50) / 30));
    lastInput = performance.now();
    request();
  };
  if (tiltBtn && !fine && "DeviceOrientationEvent" in window) {
    html.classList.add("has-tilt");
    on(tiltBtn, "click", async () => {
      if (gyroOn) {
        removeEventListener("deviceorientation", onOrient);
        gyroOn = false; tilt.tx = tilt.ty = 0;
      } else {
        try {
          if (typeof DeviceOrientationEvent.requestPermission === "function" && (await DeviceOrientationEvent.requestPermission()) !== "granted") return;
          addEventListener("deviceorientation", onOrient, { passive: true });
          gyroOn = true;
        } catch { return; }
      }
      tiltBtn.setAttribute("aria-pressed", String(gyroOn));
      request();
    });
  }

  // ── Camera rig ──
  // The car's outline for framing: its bounding box plus each door's box (which swings out with
  // the door), projected each frame to find how much room the car takes on screen.
  const corners = (b) => { const out = []; for (let i = 0; i < 8; i++) out.push(new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z)); return out; };
  const outline = [
    ...corners({ min: new THREE.Vector3(...model.box.min), max: new THREE.Vector3(...model.box.max) }).map((p) => [model.body, p]),
    ...corners(model.doors.front.box).map((p) => [model.doors.front.inner, p]),
    ...corners(model.doors.rear.box).map((p) => [model.doors.rear.inner, p]),
  ];
  const tmpV = new THREE.Vector3();
  const target = new THREE.Vector3();
  let W = 1, H = 1;
  let frameFit = { zone: null, m: 0 };
  function aim(dist, az, el) {
    camera.position.set(target.x + dist * Math.sin(az) * Math.cos(el), target.y + dist * Math.sin(el), target.z + dist * Math.cos(az) * Math.cos(el));
    camera.lookAt(target);
  }
  function placeCamera(t) {
    const aspect = W / H, portrait = aspect < 0.9;
    camera.aspect = aspect;
    const vf = camera.fov * DEG, hf = 2 * Math.atan(Math.tan(vf / 2) * aspect);
    let dist = 6.1 / ((portrait ? 1.0 : 0.5) * 2 * Math.tan(hf / 2));
    dist = Math.max(dist, 2.3 / ((portrait ? 0.4 : 0.52) * 2 * Math.tan(vf / 2)));
    dist *= state.zoom;
    const dAz = tilt.x * 4 + Math.sin(t * 0.23) * 2.2 * drift;
    const dEl = -tilt.y * 2.5 + Math.sin(t * 0.31 + 1) * 1.1 * drift;
    const az = (state.az + dAz) * DEG, el = Math.max(-2, state.el + dEl) * DEG;
    target.set(state.tx, state.ty, state.tz);
    const fy = portrait ? 0.3 : state.frameY;
    let shift = 0;
    frameFit = { zone: null, m: 0 };
    if (!portrait) {
      // Measure the car's on-screen extent unshifted, then slide (and if needed pull back) so it
      // sits beside the section's text panel rather than under it (framing.js).
      aim(dist, az, el);
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      model.root.updateMatrixWorld();
      let x0 = Infinity, x1 = -Infinity;
      for (const [obj, p] of outline) {
        tmpV.copy(p);
        obj.localToWorld(tmpV).project(camera);
        const x = (tmpV.x * 0.5 + 0.5) * W;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
      }
      frameFit = fitBesidePanel({ W, x0, x1, frameX: state.frameX, panel: state.panel });
      shift = frameFit.shift;
      dist *= frameFit.k;
    }
    studio.setFogRange(dist);
    aim(dist, az, el);
    camera.setViewOffset(W, H, -shift, fy * H, W, H);
    camera.updateProjectionMatrix();
  }

  // The stage is sized to the large viewport (100lvh), so mobile toolbars showing and hiding don't
  // change the canvas; only real size or pixel-ratio changes reallocate the buffers.
  let sized = "";
  function resize(force = false) {
    const w = Math.max(1, canvas.clientWidth || innerWidth);
    const h = Math.max(1, canvas.clientHeight || innerHeight);
    const dpr = Math.min(devicePixelRatio || 1, DPR_CAP[tier]);
    const key = `${w}x${h}@${dpr}`;
    if (!force && key === sized) return;
    sized = key;
    W = w; H = h;
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    lineUniforms.uRes.value.set(W * dpr, H * dpr);
    for (const m of Object.values(lineMats)) m.uniforms.uWidth.value = (m.userData.width ?? m.uniforms.uWidth.value) * dpr;
    studio.resize(W, H, dpr);
    overlays.resize(W, H);
    request();
  }

  // ── Apply the state to the scene ──
  let time = 0, xrayMats = false, pulse = 0;
  function apply(dt) {
    let busy = false;
    const k = Math.min(1, dt * 5);
    tilt.x += (tilt.tx - tilt.x) * k;
    tilt.y += (tilt.ty - tilt.y) * k;
    busy ||= Math.abs(tilt.tx - tilt.x) + Math.abs(tilt.ty - tilt.y) > 0.002;
    const idle = performance.now() - lastInput;
    const drifting = idle > 1200 && idle < IDLE_MS[tier];
    drift += ((drifting ? 1 : 0) - drift) * Math.min(1, dt * 0.8);
    busy ||= drifting || drift > 0.003;

    busy = doorF.step(state.doorFront, dt) || busy;
    busy = doorR.step(state.doorRear, dt) || busy;
    for (const w of model.wheels) w.pivot.rotation.z = -state.roll;
    model.root.rotation.y = state.turn;
    placeCamera(time);

    const sweepX = 4.2 - 8.4 * state.materialise;
    lineUniforms.uTime.value = time;
    lineUniforms.uDraw.value = state.draw;
    lineUniforms.uSweepX.value = sweepX;
    lineUniforms.uFaint.value = 0.18 + 0.5 * state.xray;
    lineUniforms.uDim.value = (1 - 0.3 * state.dim) * (1 - 0.35 * state.xray);
    shadeUniforms.uSweepX.value = sweepX;
    shadeUniforms.uXray.value = state.xray;

    const showShaded = state.materialise > 0.001;
    const wantX = state.xray > 0.002;
    if (mats && wantX !== xrayMats) {
      xrayMats = wantX;
      for (const m of shaded) m.material = (wantX ? matsX : mats)[m.userData.role];
    }
    for (const m of shaded) m.visible = showShaded;
    // Hidden off at the same x-ray value the batteries start fading in (lighting.js), so the
    // opaque depth meshes never hide the pack and 12V box while their halos already show.
    for (const m of depthMeshes) m.visible = state.xray < XRAY_SHOW;
    if (mirror) {
      mirror.visible = showShaded && state.xray < 0.5;
      for (const [a, b] of mirrorPairs) { b.position.copy(a.position); b.quaternion.copy(a.quaternion); }
    }

    // The batteries pulse in the x-ray view, but only for a while after the last input, so a
    // page left open on that section goes back to rendering nothing.
    const pulsing = state.xray > 0.01 && idle < IDLE_MS[tier];
    pulse += ((pulsing ? 1 : 0) - pulse) * Math.min(1, dt * 1.5);
    busy ||= pulsing || (state.xray > 0.01 && pulse > 0.003);
    const lights = studio.update(state, time, pulse);
    if (mats) {
      for (const set of [mats, matsX]) {
        set.lightbar.emissiveIntensity = lights.bar * (tier === "high" ? 6 : 2.5);
        set.tail.emissiveIntensity = lights.tailOn * (tier === "high" ? 4 : 2);
      }
    }
    const bar = lineMats.bar.uniforms;
    bar.uBarGlow.value = 1 + lights.bar * (tier === "high" ? 2.2 : 1);
    bar.uBarSweep.value = state.lightSweep > 0 || (state.boot > 0.15 && state.boot < 0.7) ? lights.sweepZ : -9;
    // Matrices for this frame (render() would only update them later), so labels don't trail.
    scene.updateMatrixWorld();
    camera.updateMatrixWorld();
    overlays.update(camera, state, frameFit);
    paperAndFallback();
    return busy;
  }

  // ── The static drawing fades out as the 3D one draws in; the blueprint grid fades for the lit car ──
  const fallback = document.querySelector(".stage-fallback");
  const paperEl = document.querySelector(".paper");
  let fbOpacity = "", paperOpacity = "";
  function paperAndFallback() {
    if (firstFrame) return; // not during the probe, nor before the first frame is on screen
    const fo = Math.max(0, 1 - state.draw * 1.6).toFixed(3);
    if (fallback && fo !== fbOpacity) {
      fbOpacity = fo;
      fallback.style.opacity = fo;
      fallback.style.visibility = fo === "0.000" ? "hidden" : "";
    }
    const po = (1 - 0.85 * state.materialise * (1 - 0.6 * state.xray)).toFixed(3);
    if (paperEl && po !== paperOpacity) { paperOpacity = po; paperEl.style.opacity = po; }
  }
  function resetPage() {
    for (const el of [fallback, paperEl]) if (el) { el.style.opacity = ""; el.style.visibility = ""; }
  }

  // ── Render loop (on demand) ──
  let raf = 0, last = performance.now(), running = true, firstFrame = true, chained = false;
  const watch = new FrameWatch(() => setTier(TIERS[Math.max(0, TIERS.indexOf(tier) - 1)]));
  function request() {
    if (!running || raf || document.hidden) return;
    raf = requestAnimationFrame(frame);
  }
  function frame(now) {
    raf = 0;
    const gap = now - last;
    const dt = Math.min(0.1, gap / 1000);
    last = now;
    time += dt;
    const wasChained = chained;
    chained = false;
    const busy = apply(dt);
    studio.render();
    if (firstFrame) { firstFrame = false; html.classList.add("is-3d"); }
    // Only frames that follow a frame count: the first one after an idle pause measures the pause.
    else if (!forced && wasChained) watch.sample(gap);
    if (busy || state.draw < 1 || gsap.isTweening(state)) { request(); chained = raf !== 0; }
  }

  function setTier(next) {
    if (next === tier) return;
    tier = next;
    studio.setTier(tier);
    buildShaded();
    xrayMats = false;
    resize(true);
  }

  // ── Probe: time a few heavy frames (lit car, bloom) and drop a tier if they are slow ──
  resize();
  Object.assign(state, { materialise: 1, boot: 1, draw: 1 });
  // Compile both material sets (normal and x-ray) for where they will render: the composer's
  // render target on high (no tone mapping, linear output), the screen otherwise.
  async function precompile() {
    if (!mats) return;
    renderer.setRenderTarget(studio.composer?.renderTarget1 ?? null);
    for (const m of shaded) { m.visible = true; m.material = matsX[m.userData.role]; }
    await renderer.compileAsync(scene, camera).catch(() => {});
    for (const m of shaded) m.material = mats[m.userData.role];
    await renderer.compileAsync(scene, camera).catch(() => {});
    renderer.setRenderTarget(null);
  }
  await precompile();
  apply(0);
  let ms = probe(renderer, () => studio.render());
  if (!forced && tier === "high" && ms > 14) {
    setTier("medium");
    await precompile();
    apply(0);
    ms = probe(renderer, () => studio.render()); // medium measured on its own, not from high's timing
  }
  if (!forced && tier === "medium" && ms > 24) setTier("low");
  Object.assign(state, START, { draw: 0 });

  // ── Story ──
  const story = createStory(state, request);
  story.drawIn(false);

  on(window, "resize", () => resize(), { passive: true });
  on(document, "visibilitychange", () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
    else { last = performance.now(); request(); }
  });
  request();
  html.dataset.tier = tier;
  if (/[?&]debug(=|&|$)/.test(location.search)) window.__oceanLive = { THREE, state, scene, camera, renderer, model, studio, lineMats, get tier() { return tier; }, setTier, probeMs: ms };

  return {
    get tier() { return tier; },
    dispose() {
      running = false;
      cancelAnimationFrame(raf);
      ac.abort();
      removeEventListener("deviceorientation", onOrient);
      story.dispose();
      gsap.killTweensOf(state);
      overlays.dispose();
      disposeShaded();
      studio.dispose();
      depthMat.dispose();
      scene.traverse((o) => { if (o.isMesh) { o.geometry?.dispose(); if (o.material !== depthMat) o.material?.dispose?.(); } });
      for (const m of Object.values(lineMats)) m.dispose();
      resetPage();
      renderer.dispose();
      renderer.forceContextLoss(); // release the GPU context now, not when the canvas is collected
    },
  };
}
