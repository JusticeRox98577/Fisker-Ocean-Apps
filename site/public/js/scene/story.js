// The scroll story: one GSAP timeline with ScrollTrigger `scrub: 1` over the whole page.
// Each section with data-scene="…" (or an empty element with data-scene-mark="…") is a marker; between markers the timeline tweens the story
// state (camera rig, doors, materialise, x-ray, …) toward that section's keyframe. Marker positions
// are measured from the page, and the timeline is rebuilt when the layout changes.
import { gsap, ScrollTrigger } from "../lib/gsap.js";

const TAU = Math.PI * 2;

// Camera: az = degrees around the car from its near side (+Z) toward the nose (+X); el = degrees up;
// zoom = distance multiplier; frameX/frameY = where the car sits on screen (fraction of the
// viewport, + = right/up), ignored on narrow portrait screens where the car sits at the top;
// panel = the max width (px) of the section's text panel, which framing.js keeps the car beside
// on wide screens (frameX's sign says which side the panel is on).
export const START = {
  az: 52, el: 10, zoom: 1, tx: 0.1, ty: 0.78, tz: 0, frameX: 0.23, frameY: 0, panel: 560,
  doorFront: 0, doorRear: 0, roll: 0, materialise: 0, boot: 0, xray: 0, modules: 0, turn: 0,
  dims: 0, calloutLight: 1, calloutDoors: 0, rim: -1, env: 0, lightSweep: 0, dim: 0, focus12: 0,
};

// [scene, keyframe, per-property windows inside the transition (0 = previous marker, 1 = this one),
//  options: arrive = where the section top is (fraction of the viewport height) when the keyframe is reached]
const KEYS = [
  ["hero", {}],
  ["live", { az: 0, el: 3, zoom: 1, tx: 0, ty: 0.85, frameX: 0.23, panel: 560, calloutLight: 0, dims: 1, roll: 2.2 }, { dims: [0.75, 1], calloutLight: [0, 0.3] }],
  ["doors", { az: 34, el: 12, zoom: 1.12, tx: -0.1, ty: 0.85, frameX: -0.27, panel: 680, dims: 0, calloutDoors: 1, doorFront: 1, doorRear: 1, roll: 3.4 },
    { dims: [0, 0.25], doorFront: [0.45, 0.8], doorRear: [0.65, 1], calloutDoors: [0.7, 1] }],
  // "The real thing" (#real, 170vh): the camera settles while the section scrolls in, then the
  // sweep turns the drawing into the lit car while the camera is still and the section's empty
  // upper part is on screen (its text sits at the bottom of the section), so no text is over the
  // car at the reveal. The "lit" marker is an empty element 60vh down the section; the lit car
  // then holds until the battery move starts.
  ["materialise", { az: 40, el: 8, zoom: 1.02, tx: 0, ty: 0.7, frameX: 0.2, frameY: 0.1, panel: 360, calloutDoors: 0 },
    { az: [0.2, 1], el: [0.2, 1], zoom: [0.2, 1], tx: [0.2, 1], ty: [0.2, 1], frameX: [0.2, 1], frameY: [0.2, 1], panel: [0.2, 1], calloutDoors: [0, 0.2] },
    { arrive: 0.15 }],
  ["lit", { materialise: 1, boot: 1, rim: 0.2, env: 1.4 },
    { materialise: [0.05, 0.7], boot: [0.55, 1], rim: [0, 1], env: [0, 1] }],
  ["battery", { az: 14, el: 30, zoom: 1.1, tx: 0, ty: 0.45, frameX: 0.23, frameY: 0, panel: 560, xray: 1, rim: 1.2, env: 2.4, lightSweep: 1, focus12: 1 },
    { az: [0.4, 1], el: [0.4, 1], zoom: [0.4, 1], tx: [0.4, 1], ty: [0.4, 1], frameX: [0.4, 1], frameY: [0.4, 1], panel: [0.4, 1],
      env: [0.4, 1], xray: [0.55, 0.9], lightSweep: [0.4, 1], rim: [0.3, 1], focus12: [0.88, 1] }],
  ["faults", { az: -40, el: 18, zoom: 1.1, tx: 0, ty: 0.6, frameX: -0.21, panel: 560, modules: 1, rim: -0.8, roll: 4.6, lightSweep: 0 },
    { modules: [0.6, 1], lightSweep: [0, 0.2] }],
  ["platforms", { az: 38, el: 9, zoom: 1.35, tx: 0, ty: 0.8, frameX: 0.27, panel: 680, xray: 0, modules: 0, focus12: 0, turn: TAU, doorFront: 0, doorRear: 0, rim: 0.6, env: 3.4 },
    { modules: [0, 0.3], xray: [0.1, 0.5], doorFront: [0.2, 0.7], doorRear: [0.1, 0.6], turn: [0.3, 1] }],
  ["need", { az: 62, el: 13, zoom: 1.3, frameX: -0.19, panel: 560, env: 4 }],
  ["downloads", { az: 34, el: 6, zoom: 1.6, frameX: 0, frameY: 0.05, turn: TAU, dim: 0.25, roll: 6 }],
  ["privacy", { az: 30, el: 8, zoom: 1.65, dim: 0.3 }],
  ["sleep", { az: 24, el: 7, zoom: 1.6, dim: 0.7 }, { dim: [0.4, 1] }],
  ["faq", { az: 20, el: 9, zoom: 1.7, dim: 0.5 }],
  // Ending: back to the hero pose, lights up, one last sweep of the light bar.
  ["final", { az: 52, el: 10, zoom: 1.05, tx: 0.1, ty: 0.78, frameX: 0, frameY: 0.18, dim: 0, lightSweep: 1 },
    { dim: [0, 0.4], lightSweep: [0.5, 1] }, { arrive: 0.5 }],
];

export function createStory(state, onChange) {
  let tl = null;
  let built = false;
  let disposed = false;

  function build() {
    if (disposed) return;
    const scrollMax = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    const markers = KEYS.map(([name]) => document.querySelector(`[data-scene="${name}"], [data-scene-mark="${name}"]`));
    const at = markers.map((el, i) => {
      if (!el || i === 0) return 0;
      const top = el.getBoundingClientRect().top + scrollY;
      const arrive = KEYS[i][3]?.arrive ?? 0.12;
      return Math.min(1, Math.max(0, (top - innerHeight * arrive) / scrollMax));
    });
    // Keep markers strictly increasing.
    for (let i = 1; i < at.length; i++) if (at[i] <= at[i - 1]) at[i] = Math.min(1, at[i - 1] + 0.001);

    const progress = tl ? tl.progress() : 0;
    tl?.scrollTrigger?.kill();
    tl?.kill();
    Object.assign(state, START);
    tl = gsap.timeline({
      paused: true,
      defaults: { ease: "sine.inOut" },
      scrollTrigger: { start: 0, end: "max", scrub: 1, onUpdate: onChange, invalidateOnRefresh: false },
      onUpdate: onChange,
    });
    for (let i = 1; i < KEYS.length; i++) {
      const [, kf, windows = {}] = KEYS[i];
      const gap = at[i] - at[i - 1];
      if (gap <= 0) continue;
      const plain = {};
      for (const [k, v] of Object.entries(kf)) {
        if (windows[k]) {
          const [w0, w1] = windows[k];
          tl.to(state, { [k]: v, duration: gap * (w1 - w0), ease: k.startsWith("door") || k === "turn" ? "power2.inOut" : "sine.inOut" }, at[i - 1] + gap * w0);
        } else plain[k] = v;
      }
      if (Object.keys(plain).length) tl.to(state, { ...plain, duration: gap * 0.7 }, at[i - 1] + gap * 0.3);
    }
    // Pad the timeline to exactly 1 so progress maps to scroll.
    tl.to({}, { duration: Math.max(0.0001, 1 - tl.duration()) }, tl.duration());
    if (built) tl.progress(progress);
    built = true;
    ScrollTrigger.refresh();
    onChange();
  }

  // Rebuild only for real layout changes: a new width, or a height change bigger than a mobile
  // toolbar showing or hiding (those fire resize on every scroll direction change).
  let t = 0, lastW = innerWidth, lastH = innerHeight;
  const onResize = () => {
    if (innerWidth === lastW && Math.abs(innerHeight - lastH) < 150) return;
    lastW = innerWidth; lastH = innerHeight;
    clearTimeout(t);
    t = setTimeout(build, 200);
  };
  build();
  addEventListener("resize", onResize);
  document.fonts?.ready.then(() => build());
  addEventListener("load", build, { once: true });

  return {
    /** Draw the drawing in (1.6 s), or show it drawn straight away. */
    drawIn(instant) {
      if (instant) { state.draw = 1; onChange(); return null; }
      return gsap.fromTo(state, { draw: 0 }, { draw: 1, duration: 1.6, ease: "power2.out", onUpdate: onChange });
    },
    dispose() {
      disposed = true;
      clearTimeout(t);
      removeEventListener("resize", onResize);
      removeEventListener("load", build);
      tl?.scrollTrigger?.kill();
      tl?.kill();
    },
  };
}
