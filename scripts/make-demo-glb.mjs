/**
 * Builds public/demo.glb — the bundled sample asset shown before the first
 * generation. Run with: npm run make:demo
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

// GLTFExporter assembles binary output through FileReader, which Node lacks.
if (typeof globalThis.FileReader === "undefined") {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      });
    }
  };
}

const scene = new THREE.Scene();
scene.name = "TrellisForgeSample";

const rockMaterial = new THREE.MeshStandardMaterial({
  name: "stone",
  color: 0x18202b,
  roughness: 0.82,
  metalness: 0.18,
});

const base = new THREE.Mesh(new THREE.DodecahedronGeometry(0.86, 0), rockMaterial);
base.name = "StoneBase";
base.scale.set(1, 0.46, 1);
base.position.y = 0.22;
base.castShadow = true;
base.receiveShadow = true;
scene.add(base);

const crystalSpecs = [
  { y: 1.02, x: 0.0, z: 0.0, height: 1.25, radius: 0.3, tilt: [0.05, 0.2, 0.02], color: 0x67e8f9 },
  { y: 0.72, x: 0.34, z: 0.16, height: 0.78, radius: 0.2, tilt: [0.18, 0.5, -0.42], color: 0xa78bfa },
  { y: 0.62, x: -0.3, z: 0.24, height: 0.62, radius: 0.17, tilt: [-0.26, 0.9, 0.36], color: 0x9ae600 },
  { y: 0.56, x: 0.05, z: -0.34, height: 0.54, radius: 0.15, tilt: [0.34, 0.2, 0.28], color: 0x8be9fd },
  { y: 0.44, x: -0.36, z: -0.18, height: 0.4, radius: 0.12, tilt: [-0.4, 1.4, -0.2], color: 0xc4b5fd },
  { y: 0.38, x: 0.38, z: -0.26, height: 0.34, radius: 0.1, tilt: [0.5, 0.7, 0.4], color: 0xb6f24a },
];

crystalSpecs.forEach((spec, index) => {
  const material = new THREE.MeshStandardMaterial({
    name: `crystal_${index}`,
    color: spec.color,
    roughness: 0.16,
    metalness: 0.28,
    emissive: new THREE.Color(spec.color).multiplyScalar(0.18),
    emissiveIntensity: 0.9,
    flatShading: true,
  });
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 1), material);
  crystal.name = `Crystal_${index}`;
  crystal.scale.set(spec.radius, spec.height, spec.radius);
  crystal.position.set(spec.x, spec.y, spec.z);
  crystal.rotation.set(spec.tilt[0], spec.tilt[1], spec.tilt[2]);
  crystal.castShadow = true;
  crystal.receiveShadow = true;
  scene.add(crystal);
});

const shardMaterial = new THREE.MeshStandardMaterial({
  name: "shard",
  color: 0x2a3644,
  roughness: 0.6,
  metalness: 0.35,
  flatShading: true,
});

for (let index = 0; index < 9; index += 1) {
  const angle = (index / 9) * Math.PI * 2 + 0.4;
  const radius = 0.62 + (index % 3) * 0.12;
  const shard = new THREE.Mesh(new THREE.TetrahedronGeometry(0.11 + (index % 4) * 0.03, 0), shardMaterial);
  shard.name = `Shard_${index}`;
  shard.position.set(Math.cos(angle) * radius, 0.09, Math.sin(angle) * radius);
  shard.rotation.set(Math.random(), angle, Math.random());
  shard.castShadow = true;
  shard.receiveShadow = true;
  scene.add(shard);
}

const exporter = new GLTFExporter();
const arrayBuffer = await exporter.parseAsync(scene, { binary: true, onlyVisible: true });

const outputPath = resolve(process.cwd(), "public/demo.glb");
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, Buffer.from(arrayBuffer));

const magic = Buffer.from(arrayBuffer).subarray(0, 4).toString("ascii");
console.log(`Wrote ${outputPath} (${(arrayBuffer.byteLength / 1024).toFixed(1)} KB, magic="${magic}")`);
