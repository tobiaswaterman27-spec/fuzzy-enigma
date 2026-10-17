// Vehicle and prop models made in Blender (tools/blender/*.py) and exported as GLB.
// Each model's parts are merged per material on load, so an instance costs one draw call per material.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fetchBinary } from './binary';

const templates = new Map<string, THREE.Group>();
const paints = new Map<string, THREE.Material>();

export async function loadModels(names: string[], base = 'assets/models/'): Promise<void> {
  const loader = new GLTFLoader();
  await Promise.all(names.map(async (name) => {
    try {
      const gltf = await loader.parseAsync(await fetchBinary(`${base}${name}.glb`), '');
      templates.set(name, mergeByMaterial(gltf.scene));
    } catch (e) {
      console.warn(`model ${name} unavailable, using the built-in fallback`, e);
    }
  }));
}

function mergeByMaterial(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true);
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    for (const a of Object.keys(g.attributes)) if (a !== 'position' && a !== 'normal') g.deleteAttribute(a);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    g = g.index ? g.toNonIndexed() : g;
    const mat = m.material as THREE.Material;
    byMat.set(mat, [...(byMat.get(mat) ?? []), g]);
  });
  const out = new THREE.Group();
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = !/glass/.test(mat.name);
    mesh.receiveShadow = true;
    out.add(mesh);
  }
  return out;
}

export function hasModel(name: string): boolean { return templates.has(name); }

/** A new instance sharing geometry; the material named `paint` is swapped for one in `paint` colour. */
export function modelInstance(name: string, paint?: string): THREE.Group | null {
  const t = templates.get(name);
  if (!t) return null;
  const g = t.clone();
  if (paint) g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m.material as THREE.Material).name !== 'paint') return;
    const key = `${name}|${paint}`;
    let pm = paints.get(key);
    if (!pm) { pm = (m.material as THREE.MeshStandardMaterial).clone(); (pm as THREE.MeshStandardMaterial).color.set(paint); paints.set(key, pm); }
    m.material = pm;
  });
  return g;
}
