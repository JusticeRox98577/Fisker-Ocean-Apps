# Ocean Live: home page overrides

These rules override MASTER.md for the home page (and set the shared look for the other pages).
Kept from MASTER: the **Immersive/Interactive Experience** pattern, Motion 8 / Density 3, plus skip, keyboard,
reduced-motion and non-3D fallback paths, pausing animation when off screen, and showing the finished state when
reduced motion is on.

## Concept: "The Ocean, on the drafting table"
A hand-drawn engineering blueprint of the Fisker Ocean that builds itself, then opens up as you scroll.
The rendered car is the 3D model `models/ocean.glb`, drawn as lines only (no shaded surfaces). The page
content scrolls over it in calm, readable panels.

## Colours (instead of MASTER's grey glass)
| Role | Hex | Use |
|---|---|---|
| Paper (background) | `#0B2545` | blueprint navy, whole page |
| Paper deep | `#071A33` | vignette, footer |
| Grid line | `rgba(173,216,255,0.08)` major / `0.04` minor | CSS grid on the paper |
| Ink (lines, primary text) | `#EAF4FF` | car lines, headings, body (≈14:1 on paper) |
| Ink muted | `#A9C4E0` | secondary text (≥ 7:1 on paper) |
| Cyan pencil (accent) | `#5CE1E6` | highlights, light bar, focus ring, CTA |
| On accent | `#04223A` | text on cyan buttons |
| Annotation red | `#FF8A7A` | dimension arrows/callouts only, never meaning-only |
| Panel | `rgba(7,26,51,0.72)` + 1px `rgba(234,244,255,0.14)` border, blur 8px | text panels over the car |

## Type
- Headings: **Space Grotesk** 500/600 (clean, technical, automotive).
- Body: **Inter** 400/500, 17–18px, line height 1.6, measure ≤ 68ch.
- Annotations and dimensions: **Architects Daughter** (handwritten draughtsman). Use only for drawing labels,
  never body text.
- Numbers: tabular figures.

## The 3D drawing
- Three.js (self-hosted ES module, pinned) + GSAP ScrollTrigger with `scrub: 1` for the camera rig and the door
  timeline (no OrbitControls: this is a scripted reveal).
- Lines only: `EdgesGeometry` (crease angle about 20–30°) per mesh, drawn with thick lines. Hand-drawn feel:
  each edge drawn 2× with a tiny random offset and slightly different opacity, a gentle wobble in the vertex
  shader, and line ends that overshoot a little like a draughtsman's construction lines.
- "Drawing in" on load: line dash progress goes from 0 to 1 over about 1.6 s (skipped with reduced motion).
- Doors: the body is one mesh, so the front and rear door panels on the near side are cut out of the body by
  triangle selection (centroid inside a door box), each put in its own group with a hinge pivot at the front
  edge, and swung open on scroll. The tyres and rims spin a little on scroll.
- Light bar: cyan, glowing (additive line plus a blurred sprite), with a sweep at the 12V/light section.
- Dimension lines and handwritten callouts (HTML or SVG overlays, projected from 3D points): "light bar",
  "front doors", "rear doors", wheelbase.
- Canvas: `position: fixed`, behind the content, `role="img"` with an aria-label. DPR capped at 1.75; render only
  while visible and while the page is scrolling or a tween is running.
- Fallbacks: no WebGL, or `prefers-reduced-motion` → a static SVG blueprint of the car (side elevation) in the
  same style; `Save-Data` / slow connection → do not download the model.
- Model credit (CC BY 4.0) in the footer and on credits.html: "Fisker Ocean (low-poly)" by LagzDesign,
  sketchfab.com/LagzDesign, CC BY 4.0, changed: converted to line drawing, compressed, doors separated.

## "The works": from blueprint to the real thing (added on the owner's request)
The blueprint isn't the whole show. Partway down the page the drawing **comes to life**:
- **Materialise**: a scanline or light sweep passes over the car. Behind it, the line drawing becomes a fully
  shaded, physically lit car (MeshPhysicalMaterial: clearcoat paint in deep Ocean blue-teal, dark tinted glass
  with transmission or high reflectivity, satin black trim, rubber tyres). The lines fade to a faint overlay on
  top. On the way back up it reverses into the blueprint.
- **Dynamic lighting**: a RoomEnvironment or PMREM environment for reflections. A key light and a moving rim
  light that sweep across the paint as you scroll (reflections slide over the body). The light bar is emissive
  and drives a real glow (UnrealBloomPass, or a cheaper selective glow on mobile). Headlights and the light bar
  "boot up" in a sequence, like the car waking. A soft contact shadow on a reflective studio floor that fades
  into the navy page. Subtle volumetric light shafts or a fog gradient behind the car.
- **3D animation**: the doors open and close with eased, weighted motion (slight overshoot and settle). Wheels
  roll when the camera moves along the side. A slow idle "breathing" camera drift when the user stops
  scrolling. The car turns on a turntable in the platforms section. Pointer parallax: the camera tilts a few
  degrees toward the cursor (gyroscope on phones only after a tap, never by default).
- **Page animations**: the hero headline reveals line by line. Panels slide and fade in with a 30–50 ms
  stagger. Numbers count up (39 modules, 90 days, 5 languages). The charge-ring mockup fills. The 12V graph
  draws itself. Buttons have magnetic or press feedback. The section progress shows as a thin light bar at the
  top of the page.
- **Performance tiers**: high (desktop GPU) gets bloom, the full environment, shadows and the physical
  material. Medium (most phones) gets cheaper glow and no transmission. Low is "lite-lit" (added on the owner's
  request, so everyone gets the materialise moment): MeshStandardMaterial paint/glass/trim, a hemisphere and one
  directional key light, the emissive light bar and headlights with additive glow sprites instead of bloom, no
  environment map, shadows, transmission or floor reflection, DPR 1. Software renderers (SwiftShader, Microsoft
  Basic Render Driver, llvmpipe) start on it without multisampling, and the automatic downgrade never goes below
  it: only reduced motion, Save-Data and no WebGL get the static drawing.
  Choose the tier from a quick timing probe plus `navigator.hardwareConcurrency` and `deviceMemory`, and drop a
  tier automatically if the frame time stays above 20 ms. Everything pauses when the canvas is off screen or the
  tab is hidden. Reduced motion means the static final states only.

## Scroll story (one pinned stage at most)
1. Hero: front three-quarter view, the drawing draws itself in, the light bar glows. Pitch + download CTA
   visible immediately (do not hide the CTA behind the animation).
2. Live data: the camera moves to the side elevation, with dimension lines.
3. Doors: the front and then the rear doors swing open (scrubbed), with callouts.
4. **Materialise**: the scan sweep turns the blueprint into the lit car, and the light bar and headlights boot
   up with bloom. This is the "wow" moment, so give it room (the section is 170vh). The sweep runs while the
   section's empty upper part is on screen (a `data-scene-mark="lit"` element 60vh down); the car is framed high
   and the caption sits low (beside the car on wide screens), so no text covers the car at the reveal.
5. Battery / 12V: the shaded car goes semi-transparent (x-ray) around two SOLID, softly glowing batteries (owner's
   request: solid, not sketched): the high-voltage pack (teal slab under the floor between the axles, module grid
   on top) and the 12V battery (amber box under the bonnet on the passenger side, just under the cowl). Handwritten
   labels "High-voltage battery" and "12V battery". The pack pulses as the x-ray opens, then the 12V battery.
6. Fault codes / modules: pulsing callout dots on module positions (x-ray view).
7. Platforms (phone, watch, car screens) and Downloads: the camera pulls back, doors close, the car rests.
- Provide a "Skip to downloads" link in the hero, and a header link to it.
