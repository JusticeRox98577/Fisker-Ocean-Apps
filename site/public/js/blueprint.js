// Entry point of the 3D blueprint on the home page.
// Starts after the first paint, only with WebGL 2, and never with reduced motion or Save-Data
// (those visitors keep the static drawing, /img/ocean-blueprint.svg, already in the page).
const html = document.documentElement;
const motion = matchMedia("(prefers-reduced-motion: reduce)");

function saveData() {
  const c = navigator.connection;
  return !!c && (c.saveData === true || /(^|-)2g$/.test(c.effectiveType || ""));
}

let controller = null;
let starting = false;
let stopWhenStarted = false; // stop() arrived while the scene was still starting

async function start() {
  if (motion.matches || saveData() || !("WebGL2RenderingContext" in window)) return;
  if (starting) { stopWhenStarted = false; return; }
  if (controller) return;
  const canvas = document.getElementById("blueprint");
  if (!canvas) return;
  starting = true;
  stopWhenStarted = false;
  try {
    const { startScene } = await import("./scene/main.js");
    controller = await startScene(canvas);
  } catch (err) {
    console.warn("Ocean Live: 3D drawing unavailable, showing the static drawing.", err);
    html.classList.remove("is-3d");
    controller = null;
  } finally {
    starting = false;
  }
  if (stopWhenStarted) { stopWhenStarted = false; stop(); }
}

function stop() {
  if (starting) { stopWhenStarted = true; return; }
  if (!controller) return;
  controller.dispose();
  controller = null;
  html.classList.remove("is-3d");
  // A fresh canvas for a later restart (the old one's context stays with the old renderer).
  const old = document.getElementById("blueprint");
  if (old) old.replaceWith(old.cloneNode(false));
}

function afterFirstPaint(fn) {
  const go = () => requestAnimationFrame(() => {
    if ("requestIdleCallback" in window) requestIdleCallback(fn, { timeout: 1500 });
    else setTimeout(fn, 120);
  });
  if (document.readyState === "complete") go();
  else addEventListener("load", go, { once: true });
}

afterFirstPaint(start);
motion.addEventListener?.("change", () => (motion.matches ? stop() : start()));
addEventListener("pagehide", stop);
addEventListener("pageshow", (e) => { if (e.persisted) afterFirstPaint(start); });
