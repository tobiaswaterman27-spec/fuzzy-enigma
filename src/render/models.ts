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

const sizes = new Map<string, THREE.Vector3>();
/** Native size of a model (metres): x = width, y = height, z = depth (front faces +z). */
export function modelSize(name: string): THREE.Vector3 | null {
  const t = templates.get(name);
  if (!t) return null;
  let v = sizes.get(name);
  if (!v) { v = new THREE.Box3().setFromObject(t).getSize(new THREE.Vector3()); sizes.set(name, v); }
  return v;
}

/** Instance a model rotated by `rot` about Y and scaled to fill the footprint x0..x1 × z0..z1 (height kept unless given). */
export function fitModel(name: string, r: { x0: number; z0: number; x1: number; z1: number }, rot: number, paint?: string, height?: number): THREE.Group | null {
  const m = modelInstance(name, paint);
  const size = modelSize(name);
  if (!m || !size) return null;
  const swap = Math.abs(Math.sin(rot)) > 0.5;
  const W = r.x1 - r.x0, D = r.z1 - r.z0;
  m.scale.set((swap ? D : W) / size.x, height ? height / size.y : 1, (swap ? W : D) / size.z);
  m.rotation.y = rot;
  m.position.set((r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2);
  return m;
}

/** A new instance sharing geometry; the material named `paint` is swapped for one in `paint` colour. */
export function modelInstance(name: string, paint?: string): THREE.Group | null {
  const t = templates.get(name);
  if (!t) return null;
  const g = t.clone();
  g.userData.model = name;
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

/** Replace the meshes under `root` with one mesh per material (positions, normals and UVs kept). For
 * groups that are rebuilt now and then but never move, such as building sites. */
export function mergeChildren(root: THREE.Group) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const by = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; shadow: boolean }>();
  const victims: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material) || (m as THREE.SkinnedMesh).isSkinnedMesh) return;
    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    for (const a of Object.keys(g.attributes)) if (a !== 'position' && a !== 'normal' && a !== 'uv') g.deleteAttribute(a);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    g = g.index ? g.toNonIndexed() : g;
    const e = by.get(m.material as THREE.Material) ?? { geos: [], shadow: false };
    e.geos.push(g);
    e.shadow ||= m.castShadow;
    by.set(m.material as THREE.Material, e);
    victims.push(m);
  });
  for (const v of victims) v.parent?.remove(v);
  for (const [mat, e] of by) {
    const merged = mergeGeometries(e.geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = e.shadow;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
}

/** plain-array copy of a model (geometry plus material name and colour), to send to a worker */
export function templateData(name: string): { name: string; parts: { position: Float32Array; normal: Float32Array | null; index: Uint32Array | null; mat: string; color: string }[] } | null {
  const t = templates.get(name);
  if (!t) return null;
  const parts: { position: Float32Array; normal: Float32Array | null; index: Uint32Array | null; mat: string; color: string }[] = [];
  t.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mm = m.material as THREE.MeshStandardMaterial;
    const g = m.geometry;
    parts.push({
      position: new Float32Array(g.getAttribute('position').array as ArrayLike<number>), normal: g.getAttribute('normal') ? new Float32Array(g.getAttribute('normal').array as ArrayLike<number>) : null,
      index: g.index ? new Uint32Array(g.index.array as ArrayLike<number>) : null, mat: mm.name, color: `#${mm.color.getHexString()}`,
    });
  });
  return { name, parts };
}

/** (worker) install a model sent by templateData */
export function registerTemplate(d: NonNullable<ReturnType<typeof templateData>>) {
  const g = new THREE.Group();
  for (const p of d.parts) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(p.position, 3));
    if (p.normal) geo.setAttribute('normal', new THREE.BufferAttribute(p.normal, 3));
    if (p.index) geo.setIndex(new THREE.BufferAttribute(p.index, 1));
    const m = new THREE.MeshStandardMaterial({ color: p.color });
    m.name = p.mat;
    g.add(new THREE.Mesh(geo, m));
  }
  templates.set(d.name, g);
}
