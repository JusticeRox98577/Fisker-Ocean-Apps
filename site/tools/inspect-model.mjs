// Prints the node tree, meshes, materials and world-space bounds of a glTF/GLB.
// Usage: node tools/inspect-model.mjs <file.glb>
import { createRequire } from "node:module";
const require = createRequire(new URL("./.cache/package.json", import.meta.url));
const { NodeIO } = require("@gltf-transform/core");
const { ALL_EXTENSIONS } = require("@gltf-transform/extensions");
const { getBounds } = require("@gltf-transform/functions");
const { MeshoptDecoder } = require("meshoptimizer");
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const doc = await io.read(process.argv[2]);
const root = doc.getRoot();
const scene = root.getDefaultScene() || root.listScenes()[0];
const fmt = (a) => a.map((v) => v.toFixed(3)).join(", ");
function walk(node, depth) {
  const m = node.getMesh();
  let info = "";
  if (m) {
    const prims = m.listPrimitives().map((p) => `${p.getMaterial()?.getName()}:${p.getAttribute("POSITION").getCount()}v/${(p.getIndices()?.getCount() ?? 0) / 3}t`);
    const b = getBounds(node);
    info = ` mesh=${m.getName()} [${prims.join(" ")}] world min(${fmt(b.min)}) max(${fmt(b.max)})`;
  }
  console.log(`${"  ".repeat(depth)}${node.getName()} t=${fmt(node.getTranslation())} r=${fmt(node.getRotation())} s=${fmt(node.getScale())}${info}`);
  node.listChildren().forEach((c) => walk(c, depth + 1));
}
scene.listChildren().forEach((n) => walk(n, 0));
const b = getBounds(scene);
console.log("scene bounds", fmt(b.min), "|", fmt(b.max));
console.log("materials", root.listMaterials().map((m) => m.getName() + " " + JSON.stringify(m.getBaseColorFactor().map((v) => +v.toFixed(2)))).join("\n  "));
console.log("textures", root.listTextures().length);
