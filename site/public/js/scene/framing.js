// Keeps the car clear of the section's text panel on wide screens.
// The keyframes give a preferred horizontal position (frameX, a fraction of the viewport, + = the
// car sits right of centre because the panel is on the left) and the panel's width. Between about
// 900 and 1300px wide a fixed fraction puts the car under the panel, so this works out, from the
// car's projected extent, how far to slide it (and, when the free space is narrower than the car,
// how much to pull the camera back) so the car sits in the space beside the panel.
// Pure maths, no DOM or three.js: shared by main.js and tools/review-final/frame-fit.mjs.

// Layout constants, matching styles.css (--wrap, .wrap padding at >= 768px, the 900px breakpoint).
export const WRAP = 1200, WRAP_PAD = 32, SIDE_BY_SIDE_MIN = 900, NARROW_PANEL = 560;
const GAP = 24, EDGE = 16, MAX_PULL_BACK = 1.8;

/** The panel's horizontal extent in px for a panel on `side` (1 = left, -1 = right). */
export function panelZone(W, panel, side) {
  const wrapW = Math.min(W, WRAP);
  const inL = (W - wrapW) / 2 + WRAP_PAD, inR = W - inL;
  // Below the full wrap width the wide (680px) panels are capped at 560px (styles.css).
  const pw = Math.min(W < WRAP ? Math.min(panel, NARROW_PANEL) : panel, inR - inL);
  return side > 0 ? [inL, inL + pw] : [inR - pw, inR];
}

/**
 * x0/x1: the car's projected left/right edge in px with no shift and no pull-back.
 * Returns { shift (px, + = right), k (camera distance multiplier, >= 1), zone ([l, r] px or null), m (0..1) }.
 */
export function fitBesidePanel({ W, x0, x1, frameX, panel }) {
  const desired = frameX * W;
  const m = Math.min(1, Math.abs(frameX) / 0.15);
  if (W < SIDE_BY_SIDE_MIN || m <= 0 || !panel) return { shift: desired, k: 1, zone: null, m: 0 };
  const side = Math.sign(frameX);
  const zone = panelZone(W, panel, side);
  const freeL = side > 0 ? zone[1] + GAP : EDGE;
  const freeR = side > 0 ? W - EDGE : zone[0] - GAP;
  const freeW = Math.max(1, freeR - freeL);
  let k = Math.min(MAX_PULL_BACK, Math.max(1, (x1 - x0) / freeW));
  // Pulling the camera back shrinks the car about the screen centre (close enough for a fit).
  const c = W / 2, a = c + (x0 - c) / k, b = c + (x1 - c) / k;
  let shift = desired;
  if (b - a <= freeW) shift = Math.min(Math.max(desired, freeL - a), freeR - b);
  else shift = side > 0 ? freeL - a : freeR - b; // capped pull-back: keep the panel side clear
  return { shift: desired + m * (shift - desired), k: 1 + m * (k - 1), zone, m };
}
