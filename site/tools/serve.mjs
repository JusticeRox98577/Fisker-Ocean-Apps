// Tiny static server for previewing public/ locally, with the headers from public/_headers
// (so the Content-Security-Policy is exercised too). Usage (from site/): node tools/serve.mjs [port]
// `npx wrangler dev` is the real thing; this is only a dependency-free stand-in.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../public/", import.meta.url));
const PORT = Number(process.argv[2] || 8787);
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".glb": "model/gltf-binary", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml", ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".webmanifest": "application/manifest+json" };

// Parse _headers: "path pattern" lines followed by indented "Name: value" lines.
const rules = [];
let cur = null;
for (const line of readFileSync(join(ROOT, "_headers"), "utf8").split(/\r?\n/)) {
  if (!line.trim() || line.trim().startsWith("#")) continue;
  if (!/^\s/.test(line)) { cur = { pattern: line.trim(), headers: [] }; rules.push(cur); continue; }
  const i = line.indexOf(":");
  if (cur && i > 0) cur.headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
}
const match = (pattern, path) => new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$").test(path);

createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = normalize(join(ROOT, path));
  if (!file.startsWith(normalize(ROOT))) { res.writeHead(403).end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  else if (!existsSync(file) && existsSync(file + ".html")) file += ".html";
  let status = 200;
  if (!existsSync(file)) { status = 404; console.log("404", path); file = join(ROOT, "404.html"); if (!existsSync(file)) { res.writeHead(404).end(); return; } }
  // Plain http on localhost: drop the https-only parts.
  for (const r of rules) if (match(r.pattern, path)) for (const [k, v] of r.headers) {
    if (k === "Strict-Transport-Security") continue;
    res.setHeader(k, k === "Content-Security-Policy" ? v.replace(/;\s*upgrade-insecure-requests/, "") : v);
  }
  res.setHeader("Content-Type", TYPES[extname(file)] || "application/octet-stream");
  res.setHeader("Cache-Control", "no-store");
  res.writeHead(status);
  res.end(readFileSync(file));
}).listen(PORT, () => console.log(`http://localhost:${PORT}/`));
