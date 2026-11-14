// Ocean Live website: page behaviour shared by every page. No trackers, no cookies, no storage.
// The 3D drawing lives in /js/blueprint.js (home page only) and is independent of this file.
(function () {
  "use strict";
  var doc = document.documentElement;
  doc.classList.remove("no-js");
  doc.classList.add("js");

  var REPO = "JusticeRox98577/Fisker-Ocean-Apps";
  var LATEST = "https://github.com/" + REPO + "/releases/latest";
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var finePointer = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  // Header background once scrolled, and the scroll progress light bar.
  var header = document.querySelector(".site-header");
  var bar = document.querySelector(".progress i");
  // Home page: the header's Downloads button stays a ghost while the hero's own primary button is
  // on screen, and becomes the primary once the hero has scrolled away.
  var navCta = doc.classList.contains("home") ? document.querySelector(".nav-cta") : null;
  var ticking = false;
  function onScroll() {
    ticking = false;
    var y = window.scrollY;
    if (header) header.classList.toggle("scrolled", y > 8);
    if (navCta) {
      var past = y > window.innerHeight * 0.8;
      navCta.classList.toggle("btn-primary", past);
      navCta.classList.toggle("btn-ghost", !past);
    }
    if (bar) {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.setProperty("--p", max > 0 ? Math.min(1, Math.max(0, y / max)).toFixed(4) : "0");
    }
  }
  onScroll();
  window.addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });

  // Section menu below 1000px: a disclosure button; closes on a link, Escape or a tap outside.
  var nav = document.querySelector(".nav");
  var toggle = document.querySelector(".nav-toggle");
  if (nav && toggle) {
    var setOpen = function (open) {
      nav.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", String(open));
    };
    toggle.addEventListener("click", function () { setOpen(toggle.getAttribute("aria-expanded") !== "true"); });
    nav.addEventListener("click", function (e) { if (e.target.closest && e.target.closest(".nav-links a")) setOpen(false); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && nav.classList.contains("open")) { setOpen(false); toggle.focus(); }
    });
    document.addEventListener("click", function (e) { if (nav.classList.contains("open") && !nav.contains(e.target)) setOpen(false); });
  }

  // Count-ups: the final number is already in the HTML; this only animates up to it. Screen
  // readers get the final number from a hidden copy, never the numbers in between.
  function countUp(el) {
    var target = parseInt(el.getAttribute("data-count"), 10);
    if (!isFinite(target) || reduce) return;
    var start = performance.now(), dur = 1400;
    var copy = document.createElement("span");
    copy.className = "visually-hidden";
    copy.textContent = el.textContent;
    el.parentNode.insertBefore(copy, el);
    el.setAttribute("aria-hidden", "true");
    el.textContent = "0";
    (function step(now) {
      var t = Math.min(1, (now - start) / dur);
      var e = 1 - Math.pow(1 - t, 3);
      el.textContent = String(Math.round(target * e));
      if (t < 1) requestAnimationFrame(step);
    })(start);
  }

  // Reveal panels with a stagger, fill the charge rings, draw the 12V graph, count up numbers.
  var targets = document.querySelectorAll(".reveal, [data-ring], [data-graph], [data-count]");
  function show(el) {
    if (el.hasAttribute("data-count")) countUp(el);
    else el.classList.add(el.classList.contains("reveal") ? "in" : "on");
  }
  if (!("IntersectionObserver" in window) || reduce) {
    targets.forEach(function (el) { if (!el.hasAttribute("data-count")) show(el); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        show(e.target);
        io.unobserve(e.target);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.15 });
    targets.forEach(function (el) { io.observe(el); });
  }

  // Magnetic buttons (mouse only): the button leans a few pixels toward the pointer.
  if (finePointer && !reduce) {
    document.querySelectorAll(".btn").forEach(function (btn) {
      btn.addEventListener("pointermove", function (ev) {
        var r = btn.getBoundingClientRect();
        var dx = (ev.clientX - (r.left + r.width / 2)) / r.width;
        var dy = (ev.clientY - (r.top + r.height / 2)) / r.height;
        btn.style.setProperty("--mx", (dx * 6).toFixed(1) + "px");
        btn.style.setProperty("--my", (dy * 5).toFixed(1) + "px");
      });
      btn.addEventListener("pointerleave", function () {
        btn.style.setProperty("--mx", "0px");
        btn.style.setProperty("--my", "0px");
      });
    });
  }

  // Title block (home, desktop): the view and sheet of the section in the middle of the screen.
  var tbView = document.getElementById("tb-view");
  var tbSheet = document.getElementById("tb-sheet");
  if (tbView && tbSheet && "IntersectionObserver" in window) {
    var VIEWS = {
      hero: "Front 3/4", live: "Side elev.", doors: "Doors open", materialise: "Render", battery: "X-ray",
      faults: "Modules", platforms: "Turntable", need: "Detail", downloads: "Front 3/4", privacy: "Front 3/4",
      sleep: "Asleep", faq: "Front 3/4", final: "Front 3/4"
    };
    var scenes = Array.prototype.slice.call(document.querySelectorAll("[data-scene]"));
    var sheetIo = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var name = e.target.getAttribute("data-scene");
        // The static drawing (no 3D) is always the side elevation.
        tbView.textContent = doc.classList.contains("is-3d") ? (VIEWS[name] || "Elevation") : "Side elev.";
        tbSheet.textContent = (scenes.indexOf(e.target) + 1) + " / " + scenes.length;
      });
    }, { rootMargin: "-49% 0px -50% 0px" });
    scenes.forEach(function (el) { sheetIo.observe(el); });
  }

  // Latest release, from oceanlive.org itself: /downloads/latest.json is written at deploy time
  // (tools/deploy.mjs) with the version, file sizes and SHA-256 of the APKs next to it. Only the
  // stable channel is ever used here. Without it the buttons keep pointing at GitHub Releases.
  var android = document.getElementById("dl-android");
  if (!android || !window.fetch) return;

  function mb(bytes) { return (bytes / 1048576).toFixed(1) + " MB"; }
  function date(iso) {
    try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
    catch (e) { return ""; }
  }
  function set(id, text) { var el = document.getElementById(id); if (el) el.textContent = text; }
  function wire(linkId, metaId, labelId, label, file, fileName, version) {
    var a = document.getElementById(linkId);
    var meta = document.getElementById(metaId);
    // Only the fixed same-origin paths, with a real SHA-256.
    if (!a || !file || file.path !== "/downloads/" + fileName || !/^[0-9a-f]{64}$/.test(file.sha256) || !(file.size > 0)) return false;
    var name = typeof file.name === "string" && /^[\w.-]+\.apk$/.test(file.name) ? file.name : fileName;
    a.href = file.path;
    a.setAttribute("download", name);
    a.removeAttribute("rel");
    set(labelId, "Download " + label + (version ? " " + version : ""));
    if (meta) {
      meta.textContent = name + " · " + mb(file.size) + " · from oceanlive.org";
      // Short hash on the card; the full one for people who verify the file.
      var d = document.createElement("details");
      d.className = "file-hash";
      var s = document.createElement("summary");
      s.textContent = "SHA-256 " + file.sha256.slice(0, 12) + "…";
      s.title = file.sha256;
      var code = document.createElement("code");
      code.textContent = file.sha256;
      d.appendChild(s);
      d.appendChild(code);
      meta.insertAdjacentElement("afterend", d);
    }
    return true;
  }
  function fallback(phone, watch) {
    // Those links still point at the latest release page on GitHub.
    if (phone) set("dl-android-meta", "Opens the latest release on GitHub");
    if (watch) set("dl-wear-meta", "Opens the latest release on GitHub");
  }

  var ctrl = "AbortController" in window ? new AbortController() : null;
  var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 8000);

  fetch("/downloads/latest.json", {
    cache: "no-cache",
    credentials: "omit",
    signal: ctrl ? ctrl.signal : undefined
  })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (rel) {
      clearTimeout(timer);
      var files = rel && rel.files || {};
      var version = typeof rel.short === "string" && /^\d+(\.\d+)+$/.test(rel.short) ? rel.short : "";
      var build = typeof rel.build === "number" && rel.build > 0 ? rel.build : 0;
      var okPhone = wire("dl-android", "dl-android-meta", "dl-android-label", "Android APK", files.android, "OceanLive-Android.apk", version);
      var okWear = wire("dl-wear", "dl-wear-meta", "dl-wear-label", "Wear OS APK", files.wear, "OceanLive-Wear.apk", version);
      fallback(!okPhone, !okWear);
      if (!version || !okPhone) return;
      set("tb-rev", version);
      var line = document.getElementById("release-line");
      if (line) line.classList.add("ok");
      var text = document.getElementById("release-text");
      if (text) {
        text.textContent = "";
        text.appendChild(document.createTextNode("Latest: "));
        var b = document.createElement("b");
        b.textContent = "Ocean Live " + version;
        text.appendChild(b);
        var when = typeof rel.date === "string" ? date(rel.date) : "";
        text.appendChild(document.createTextNode((build ? " (build " + build + ")" : "") + (when ? " · " + when : "") + " · "));
        var notes = document.createElement("a");
        notes.href = LATEST;
        notes.rel = "noopener";
        notes.textContent = "Release notes";
        text.appendChild(notes);
      }
    })
    .catch(function () {
      clearTimeout(timer);
      fallback(true, true);
    });
})();
