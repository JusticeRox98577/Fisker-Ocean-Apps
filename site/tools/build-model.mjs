// Builds public/models/ocean.glb from tools/source/ocean-source.glb.
// The page draws lines from the positions and shades the "real" car with its own materials,
// so only POSITION and NORMAL are kept; UVs, textures and material extensions go.
// The four tyres (64k of the 75k vertices) are simplified hard; everything is welded,
// deduplicated, quantized and meshopt-compressed.
// Usage (from site/): node tools/build-model.mjs
import { createRequire } from "node:module";
import { statSync } from "node:fs";
const require = createRequire(new URL("./.cache/package.json", import.meta.url));
const { NodeIO, PropertyType } = require("@gltf-transform/core");
const { ALL_EXTENSIONS, EXTMeshoptCompression } = require("@gltf-transform/extensions");
const { dedup, weld, prune, quantize, meshopt, simplifyPrimitive, reorder } = require("@gltf-transform/functions");
const { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } = require("meshoptimizer");

const SRC = new URL("./source/ocean-source.glb", import.meta.url);
const OUT = new URL("../public/models/ocean.glb", import.meta.url);

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "meshopt.encoder": MeshoptEncoder,
  "meshopt.decoder": MeshoptDecoder,
});
const doc = await io.read(SRC.pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const root = doc.getRoot();

// Drop material extensions (specular, emissive strength): the page draws its own lines.
for (const ext of root.listExtensionsUsed()) if (!(ext instanceof EXTMeshoptCompression)) ext.dispose();
for (const mat of root.listMaterials()) {
  for (const t of [mat.getBaseColorTexture(), mat.getEmissiveTexture(), mat.getNormalTexture()]) t?.dispose();
}

for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    for (const sem of prim.listSemantics()) if (sem !== "POSITION" && sem !== "NORMAL") prim.setAttribute(sem, null);
  }
}

await doc.transform(dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH] }), weld());

let before = 0, after = 0;
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    if (prim.getMaterial()?.getName() !== "MA_tire_003") continue;
    before += prim.getAttribute("POSITION").getCount();
    simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: 0.06, error: 0.05, lockBorder: false });
    after += prim.getAttribute("POSITION").getCount();
  }
}
console.log(`tyres: ${before} -> ${after} vertices`);

await doc.transform(
  prune(),
  reorder({ encoder: MeshoptEncoder }),
  quantize({ quantizePosition: 14, quantizeNormal: 8 }),
  meshopt({ encoder: MeshoptEncoder, level: "high" }),
);
const outPath = OUT.pathname.replace(/^\/([A-Za-z]:)/, "$1");
await io.write(outPath, doc);
console.log(`wrote ${outPath}: ${statSync(outPath).size} bytes`);
