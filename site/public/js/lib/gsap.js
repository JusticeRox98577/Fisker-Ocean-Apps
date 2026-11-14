// GSAP and ScrollTrigger as ES module exports. The vendored files are GSAP's own minified UMD
// builds (unchanged). UMD can't run as a module (strict mode), so they load as classic scripts,
// once, on demand; they register window.gsap and window.ScrollTrigger, which this re-exports.
function load(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = false;
    s.onload = resolve;
    s.onerror = () => reject(new Error("could not load " + src));
    document.head.appendChild(s);
  });
}

// Both fetch in parallel; async = false still runs them in insertion order (GSAP, then the plugin).
await Promise.all([
  window.gsap ? null : load("/vendor/gsap/gsap.min.js"),
  window.ScrollTrigger ? null : load("/vendor/gsap/ScrollTrigger.min.js"),
]);

const { gsap, ScrollTrigger } = window;
gsap.registerPlugin(ScrollTrigger);
export { gsap, ScrollTrigger };
