// Loads public/models/ocean.glb in Node with three's own GLTFLoader and meshopt decoder,
// and returns every mesh with its geometry baked into world space (Y up, car pointing +X).

import { readFileSync } from "node:fs";


const base = new URL("./.cache/node_modules/three/", import.meta.url).href;
const THREE = await import(base + "build/three.module.js");
const { GLTFLoader } = await import(base + "examples/jsm/loaders/GLTFLoader.js");
const { MeshoptDecoder } = await import(base + "examples/jsm/libs/meshopt_decoder.module.js");

export { THREE };
export async function loadOcean(file = new URL("../public/models/ocean.glb", import.meta.url)) {
  const buf = readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await new Promise((res, rej) => loader.parse(ab, "", res, rej));
  gltf.scene.updateMatrixWorld(true);
  const meshes = [];
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    if (g.attributes.position.normalized || g.attributes.position.array.constructor !== Float32Array) {
      const p = g.attributes.position;
      const arr = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) { arr[i * 3] = p.getX(i); arr[i * 3 + 1] = p.getY(i); arr[i * 3 + 2] = p.getZ(i); }
      g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    }
    g.applyMatrix4(o.matrixWorld);
    meshes.push({ name: o.name, parent: o.parent?.name, material: o.material.name, geometry: g });
  });
  return meshes;
}
