// Renderer, performance tiers and the frame-time watchdog.
//   high:   bloom, shadows, full environment, physical materials with transmission glass
//   medium: physical materials, environment, sprite glow instead of bloom, no transmission or shadows
//   low:    "lite-lit": the same materialise moment with standard materials, a hemisphere and one
//           directional light, glow sprites instead of bloom; no environment map, shadows,
//           transmission or floor reflection, and 1 device pixel per CSS pixel. It is the floor:
//           the watchdog never goes below it. Only reduced motion, Save-Data and no WebGL keep the
//           static drawing.
import * as THREE from "three";

export const TIERS = ["low", "medium", "high"];
export const DPR_CAP = { high: 1.75, medium: 1.5, low: 1 };

const SOFTWARE = /SwiftShader|Basic Render|llvmpipe|softpipe|Software/i;

/**
 * True when WebGL runs on the CPU (SwiftShader, Microsoft Basic Render Driver, llvmpipe, ...).
 * Asked of a throwaway context before the real one, so the real one can skip multisampling.
 */
export function softwareRenderer() {
  let gl = null;
  try {
    gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return false;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String((info && gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || "");
    return SOFTWARE.test(name);
  } catch { return false; }
  finally { gl?.getExtension("WEBGL_lose_context")?.loseContext(); }
}

export function createRenderer(canvas, { antialias = true } = {}) {
  const gl = canvas.getContext("webgl2", { antialias, alpha: false, depth: true, stencil: false, powerPreference: "high-performance", preserveDrawingBuffer: false });
  if (!gl) throw new Error("WebGL 2 is not available");
  const renderer = new THREE.WebGLRenderer({ canvas, context: gl });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Neutral tone mapping rolls off highlights, but its toe also darkens dark colours. Straight to
  // the screen (medium tier) the paper is the clear colour, which isn't tone-mapped; through the
  // composer (high tier) everything is, so lighting.js pre-compensates the paper there.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.type = THREE.PCFShadowMap; // softness from key.shadow.radius
  renderer.setClearColor("#0B2545", 1);
  return renderer;
}

/** First guess from the device, refined by a timing probe once the scene exists. */
export function guessTier(software = false) {
  if (software) return "low";
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4; // Chrome only; others report nothing
  const coarse = matchMedia("(pointer: coarse)").matches;
  const small = Math.min(screen.width, screen.height) < 700;
  if (cores <= 2 || mem <= 2) return "low";
  if (coarse || small || cores < 6 || mem < 4) return "medium";
  return "high";
}

/**
 * Times a few real frames (forcing the GPU to finish with a 1-pixel read) and returns how many
 * milliseconds one takes. `draw` renders one frame.
 */
export function probe(renderer, draw, frames = 4) {
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  draw(); // warm up: shader compiles and uploads
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const t0 = performance.now();
  for (let i = 0; i < frames; i++) draw();
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return (performance.now() - t0) / frames;
}

/**
 * Drops a tier when frames stay slow: an exponential average of the frame interval above 20 ms
 * for about two seconds of continuous rendering. A steady ~30 Hz cadence with little jitter is a
 * refresh-rate cap (iOS Low Power Mode, battery savers), not GPU load, so it never counts as slow.
 * The caller skips the first frame after an idle pause (that gap is not a frame).
 */
export class FrameWatch {
  constructor(onSlow) { this.onSlow = onSlow; this.reset(); }
  reset() { this.avg = 16.7; this.jit = 0; this.slow = 0; this.frames = 0; }
  sample(ms) {
    if (ms > 120) return; // a gap (idle, tab switch), not a slow frame
    this.frames++;
    this.avg += (ms - this.avg) * 0.08;
    this.jit += (Math.abs(ms - this.avg) - this.jit) * 0.08;
    const capped30 = this.avg > 28 && this.avg < 38 && this.jit < 4;
    if (this.frames > 30 && this.avg > 20 && !capped30) this.slow += ms; else this.slow = 0;
    if (this.slow > 2000) { this.reset(); this.onSlow(); }
  }
}
