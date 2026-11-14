// Handwritten callouts, dimension lines and pulsing module dots, projected from 3D points onto an
// HTML/SVG overlay above the canvas (aria-hidden: the drawing's meaning is in the page text).
import * as THREE from "three";

const SVGNS = "http://www.w3.org/2000/svg";

export function buildOverlays(host, { model, anchors }) {
  host.textContent = "";
  const svg = document.createElementNS(SVGNS, "svg");
  host.appendChild(svg);
  const items = [];
  const tmp = new THREE.Vector3();

  function label(text, { cls = "", obj, at, key, dx = 0, dy = 0, leader = true }) {
    const el = document.createElement("span");
    el.className = "callout-label " + cls;
    if (cls.includes("dot")) { const s = document.createElement("span"); s.textContent = text; el.appendChild(s); }
    else el.textContent = text;
    host.appendChild(el);
    let path = null;
    if (leader) {
      path = document.createElementNS(SVGNS, "path");
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", cls.includes("red") ? "#FF8A7A" : "#EAF4FF");
      path.setAttribute("stroke-width", "1.2");
      path.setAttribute("stroke-linecap", "round");
      svg.appendChild(path);
    }
    items.push({ type: "label", el, path, obj, at, key, dx, dy, shown: -1 });
  }

  function dimension(text, { obj, a, b, key, off = 34 }) {
    const g = document.createElementNS(SVGNS, "path");
    g.setAttribute("fill", "none");
    g.setAttribute("stroke", "#FF8A7A");
    g.setAttribute("stroke-width", "1.4");
    g.setAttribute("stroke-linecap", "round");
    svg.appendChild(g);
    const el = document.createElement("span");
    el.className = "callout-label red";
    el.textContent = text;
    host.appendChild(el);
    items.push({ type: "dim", path: g, el, obj, a, b, key, off, shown: -1 });
  }

  // Light bar (hero).
  label("light bar", { obj: model.body, at: anchors.lightbar, key: "calloutLight", dx: 70, dy: -70 });
  // Doors.
  label("front door", { obj: model.doors.front.inner, at: model.doors.front.center.clone().setZ(model.doors.front.box.max.z), key: "calloutDoors", dx: 40, dy: -110 });
  label("rear door", { obj: model.doors.rear.inner, at: model.doors.rear.center.clone().setZ(model.doors.rear.box.max.z), key: "calloutDoors", dx: -80, dy: -120 });
  // Wheelbase and length (side elevation), lettered in the drafting way rather than quoting specs:
  // the legend (A wheelbase, B overall length) is in the title block; narrow screens, which hide
  // the title block, get it in the label.
  const narrow = matchMedia("(max-width: 899px)").matches;
  const near = model.wheels.filter((w) => w.near).sort((p, q) => p.center.x - q.center.x);
  if (near.length >= 2) {
    const z = near[0].center.z + near[0].halfWidth;
    dimension(narrow ? "A · wheelbase" : "A", { obj: model.body, a: new THREE.Vector3(near[0].center.x, 0, z), b: new THREE.Vector3(near[1].center.x, 0, z), key: "dims", off: 30 });
  }
  const zL = model.box.max[2];
  dimension(narrow ? "B · length" : "B", { obj: model.body, a: new THREE.Vector3(model.box.min[0], 0, zL), b: new THREE.Vector3(model.box.max[0], 0, zL), key: "dims", off: 74 });
  // X-ray.
  label("High-voltage battery", { cls: "red", obj: model.body, at: anchors.pack, key: (s) => s.xray * (1 - s.modules), dx: -40, dy: 90 });
  label("12V battery", { cls: "red", obj: model.body, at: anchors.v12, key: (s) => s.xray * (1 - s.modules), dx: 60, dy: -80 });
  // Module dots (fault codes).
  anchors.modules.forEach(([name, p], i) => label(i < 6 ? name : "", { cls: "dot", obj: model.body, at: p, key: "modules", leader: false }));

  // Labels are drawn from (ly - 22); keep their tops clear of the fixed header (64px).
  const headerH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h")) || 64;
  const topMin = headerH + 30;
  let W = 1, H = 1;
  return {
    resize(w, h) { W = w; H = h; for (const it of items) it.w = undefined; svg.setAttribute("viewBox", `0 0 ${w} ${h}`); },
    /** Repositions everything for the current camera and story state (fit: framing.js result). */
    update(camera, s, fit) {
      for (const it of items) {
        const o = Math.max(0, Math.min(1, (typeof it.key === "function" ? it.key(s) : s[it.key]) ?? 0));
        if (o < 0.01) {
          if (it.shown !== 0) { it.el.style.opacity = "0"; if (it.path) it.path.setAttribute("d", ""); it.shown = 0; }
          continue;
        }
        it.shown = 1;
        if (it.w === undefined) { it.w = it.el.offsetWidth; it.h = it.el.offsetHeight; } // measured once: no layout reads per frame
        if (it.type === "label") {
          tmp.copy(it.at);
          it.obj.localToWorld(tmp);
          tmp.project(camera);
          if (tmp.z > 1) { it.el.style.opacity = "0"; continue; }
          const x = (tmp.x * 0.5 + 0.5) * W, y = (-tmp.y * 0.5 + 0.5) * H;
          // Keep the label on screen (narrow phones): slide it in, the leader line still points at
          // the part. Keep it below the fixed header, and on wide screens off the text panel: if
          // the label would sit over the panel, put it on the other side of its part.
          const ly = Math.max(topMin, y + it.dy * o);
          const place = (dx) => {
            let lx = x + dx * o;
            if (it.path) lx = dx < 0 ? Math.max(8 + it.w, lx) : Math.min(W - 8 - it.w, lx);
            return lx;
          };
          let dx = it.dx, lx = place(dx);
          const zone = fit?.m > 0.5 ? fit.zone : null;
          if (it.path && zone) {
            const over = (d, l) => (d < 0 ? l - it.w : l) < zone[1] && (d < 0 ? l : l + it.w) > zone[0];
            if (over(dx, lx)) { const l2 = place(-dx); if (!over(-dx, l2)) { dx = -dx; lx = l2; } }
          }
          it.el.style.opacity = o.toFixed(3);
          it.el.style.transform = it.path
            ? `translate3d(${(lx - (dx < 0 ? it.w : 0)).toFixed(1)}px, ${(ly - 22).toFixed(1)}px, 0)`
            : `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
          if (it.path) {
            const ex = lx + (dx < 0 ? -4 : 4);
            it.path.setAttribute("d", `M${ex.toFixed(1)} ${(ly - 4).toFixed(1)}L${x.toFixed(1)} ${y.toFixed(1)}M${(x - 3).toFixed(1)} ${y.toFixed(1)}a3 3 0 1 0 6 0a3 3 0 1 0 -6 0`);
            it.path.style.opacity = o.toFixed(3);
          }
        } else {
          const pa = it.a.clone(), pb = it.b.clone();
          it.obj.localToWorld(pa); it.obj.localToWorld(pb);
          pa.project(camera); pb.project(camera);
          const ax = (pa.x * 0.5 + 0.5) * W, ay = (-pa.y * 0.5 + 0.5) * H + it.off;
          const bx = (pb.x * 0.5 + 0.5) * W, by = (-pb.y * 0.5 + 0.5) * H + it.off;
          // Shorten from the middle while fading in, like a line being drawn.
          const mx = (ax + bx) / 2, my = (ay + by) / 2;
          const sx = mx + (ax - mx) * o, sy = my + (ay - my) * o, ex = mx + (bx - mx) * o, ey = my + (by - my) * o;
          const len = Math.hypot(ex - sx, ey - sy) || 1;
          const ux = (ex - sx) / len, uy = (ey - sy) / len;
          const f = (n) => n.toFixed(1);
          const head = (x, y, dx, dy) => `M${f(x)} ${f(y)}l${f(dx * 10 - dy * 4)} ${f(dy * 10 + dx * 4)}M${f(x)} ${f(y)}l${f(dx * 10 + dy * 4)} ${f(dy * 10 - dx * 4)}`;
          // Extension lines at the true end points, growing down from the part as the line draws in.
          const ext = (x, y) => `M${f(x)} ${f(y - it.off + 10)}L${f(x)} ${f(y - it.off + 10 + (it.off - 2) * o)}`;
          // The dimension line, broken around its letter.
          const g = it.w / 2 + 6;
          let d = len / 2 > g
            ? `M${f(sx)} ${f(sy)}L${f(mx - ux * g)} ${f(my - uy * g)}M${f(mx + ux * g)} ${f(my + uy * g)}L${f(ex)} ${f(ey)}`
            : "";
          d += head(sx, sy, ux, uy) + head(ex, ey, -ux, -uy) + ext(ax, ay) + ext(bx, by);
          it.path.setAttribute("d", d);
          it.path.style.opacity = o.toFixed(3);
          it.el.style.opacity = o.toFixed(3);
          it.el.style.transform = `translate3d(${(mx - it.w / 2).toFixed(1)}px, ${(my - it.h / 2).toFixed(1)}px, 0)`;
        }
      }
    },
    dispose() { host.textContent = ""; },
  };
}
