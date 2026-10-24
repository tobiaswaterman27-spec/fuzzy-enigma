// People further than a stone's throw away are drawn as one skinned mesh instead of fifteen-odd
// (skin, each garment, shoe panels, hair, eyes, lashes...): the parts are merged once per outfit,
// each part's colour (its texture's average times its tint) baked into vertex colours, so a
// distant person costs one draw call (and one shadow draw) rather than a dozen.
import * as THREE from 'three';
import type { Rig } from './character';

const cache = new Map<string, THREE.BufferGeometry>();
const avg = new Map<string, THREE.Color>();
let material: THREE.MeshStandardMaterial | null = null;

/** the average colour of a texture (white when it cannot be read) */
function textureColour(t: THREE.Texture): THREE.Color {
  const hit = avg.get(t.uuid);
  if (hit) return hit;
  const c = new THREE.Color(1, 1, 1);
  try {
    const img = t.image as { width?: number; height?: number; data?: ArrayLike<number> } | undefined;
    if (img?.data && img.width && img.height) {
      const d = img.data, n = img.width * img.height, step = Math.max(1, Math.floor(n / 4096));
      let r = 0, g = 0, b = 0, k = 0;
      const ch = d.length / n;
      for (let i = 0; i < n; i += step) { r += d[i * ch]; g += d[i * ch + 1]; b += d[i * ch + 2]; k++; }
      const s = d instanceof Uint8Array || d instanceof Uint8ClampedArray ? 255 : 1;
      c.setRGB(r / k / s, g / k / s, b / k / s, THREE.SRGBColorSpace);
    } else if (img && img.width && img.height) {
      const cv = document.createElement('canvas');
      cv.width = 8; cv.height = 8;
      const x = cv.getContext('2d', { willReadFrequently: true })!;
      x.drawImage(img as CanvasImageSource, 0, 0, 8, 8);
      const px = x.getImageData(0, 0, 8, 8).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2]; }
      c.setRGB(r / 64 / 255, g / 64 / 255, b / 64 / 255, THREE.SRGBColorSpace);
    }
  } catch { /* unreadable: leave the tint as it is */ }
  avg.set(t.uuid, c);
  return c;
}

function partColour(m: THREE.Material): THREE.Color {
  const s = m as THREE.MeshStandardMaterial;
  const c = s.color ? s.color.clone() : new THREE.Color(1, 1, 1);
  if (s.map) c.multiply(textureColour(s.map));
  return c;
}

/** the merged body for a rig in its current outfit (built once per outfit and shared) */
function build(rig: Rig): THREE.BufferGeometry | null {
  const parts: { g: THREE.BufferGeometry; colour: THREE.Color; bone: number; m: THREE.Matrix4 | null }[] = [];
  // (parts merged by mergeParts carry their colours per vertex, times a white tint)
  const boneIndex = new Map(rig.skeleton.bones.map((b, i) => [b, i]));
  for (const top of rig.meshes) top.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (Array.isArray(mat) || mat.userData?.kind === 'shell' || mat.transparent && mat.opacity < 0.9 || mat.alphaTest > 0.3) return;
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
      parts.push({ g: mesh.geometry, colour: partColour(mat), bone: -1, m: null });
      return;
    }
    // rigid parts riding a bone (eyes, collars): skinned to that bone at its bind pose
    const bi = boneIndex.get(mesh.parent as THREE.Bone);
    if (bi === undefined) return;
    mesh.updateMatrix();
    const m = new THREE.Matrix4().copy(rig.skeleton.boneInverses[bi]).invert().multiply(mesh.matrix);
    parts.push({ g: mesh.geometry, colour: partColour(mat), bone: bi, m });
  });
  if (!parts.length) return null;
  let verts = 0, idx = 0;
  for (const p of parts) { verts += p.g.getAttribute('position').count; idx += p.g.index ? p.g.index.count : p.g.getAttribute('position').count; }
  const pos = new Float32Array(verts * 3), nrm = new Float32Array(verts * 3), col = new Float32Array(verts * 3);
  const si = new Uint16Array(verts * 4), sw = new Float32Array(verts * 4);
  const index = verts > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
  let vo = 0, io = 0;
  for (const p of parts) {
    const P = p.g.getAttribute('position'), N = p.g.getAttribute('normal');
    const SI = p.g.getAttribute('skinIndex'), SW = p.g.getAttribute('skinWeight');
    if (p.m) nm.getNormalMatrix(p.m);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i);
      if (N) n.fromBufferAttribute(N, i); else n.set(0, 1, 0);
      if (p.m) { v.applyMatrix4(p.m); n.applyMatrix3(nm).normalize(); }
      const o = vo + i;
      pos[o * 3] = v.x; pos[o * 3 + 1] = v.y; pos[o * 3 + 2] = v.z;
      nrm[o * 3] = n.x; nrm[o * 3 + 1] = n.y; nrm[o * 3 + 2] = n.z;
      const C = p.g.getAttribute('color');
      col[o * 3] = p.colour.r * (C ? C.getX(i) : 1); col[o * 3 + 1] = p.colour.g * (C ? C.getY(i) : 1); col[o * 3 + 2] = p.colour.b * (C ? C.getZ(i) : 1);
      if (p.bone >= 0 || !SI) { si[o * 4] = Math.max(0, p.bone); sw[o * 4] = 1; }
      else for (let k = 0; k < 4; k++) { si[o * 4 + k] = SI.getComponent(i, k); sw[o * 4 + k] = SW.getComponent(i, k); }
    }
    if (p.g.index) { const I = p.g.index; for (let i = 0; i < I.count; i++) index[io++] = I.getX(i) + vo; }
    else for (let i = 0; i < P.count; i++) index[io++] = vo + i;
    vo += P.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  return g;
}

/** one skinned mesh standing in for all of a rig's parts, bound to the same skeleton */
export function farBody(rig: Rig, key: string): THREE.SkinnedMesh | null {
  let g = cache.get(key);
  if (!g) {
    const built = build(rig);
    if (!built) return null;
    g = built;
    cache.set(key, g);
    if (cache.size > 160) { const k0 = cache.keys().next().value!; cache.get(k0)?.dispose(); cache.delete(k0); }
  }
  material ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide });
  const m = new THREE.SkinnedMesh(g, material);
  m.frustumCulled = false;
  m.castShadow = true;
  m.receiveShadow = true;
  m.bind(rig.skeleton, new THREE.Matrix4());
  return m;
}

// ---------------------------------------------------------------- near: fewer parts, same look
/** what makes two materials draw the same apart from their colour */
function signature(m: THREE.Material): string {
  const s = m as THREE.MeshPhysicalMaterial;
  return [m.type, s.map?.uuid, s.normalMap?.uuid, s.roughnessMap?.uuid, s.alphaMap?.uuid, s.roughness?.toFixed(3), s.metalness?.toFixed(3), m.side, m.transparent, m.opacity, m.alphaTest, m.depthWrite, m.userData?.kind, s.emissive?.getHexString(), s.sheen, s.clearcoat, s.transmission].join('|');
}
const mergedCache = new Map<string, { geos: THREE.BufferGeometry[]; mats: THREE.Material[] }>();

/** Skinned parts that differ only in colour (shoe panels, soles, laces; garments of one fabric) become
 *  one mesh with the colours in its vertices: about half the draw calls for a person close up, and
 *  exactly the same picture. Parts riding a bone and the hair shells are left as they are. */
export function mergeParts(objs: THREE.Object3D[], skeleton: THREE.Skeleton, key: string): THREE.Object3D[] {
  const skinned = objs.filter((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && !o.userData.attach && !Array.isArray((o as THREE.Mesh).material) && ((o as THREE.Mesh).material as THREE.Material).userData?.kind !== 'shell') as THREE.SkinnedMesh[];
  const rest = objs.filter((o) => !skinned.includes(o as THREE.SkinnedMesh));
  let hit = mergedCache.get(key);
  if (!hit) {
    const groups = new Map<string, THREE.SkinnedMesh[]>();
    for (const m of skinned) { const k = signature(m.material as THREE.Material); groups.set(k, [...(groups.get(k) ?? []), m]); }
    hit = { geos: [], mats: [] };
    for (const list of groups.values()) {
      const src = list[0].material as THREE.MeshStandardMaterial;
      if (list.length === 1) { hit.geos.push(list[0].geometry); hit.mats.push(src); continue; }
      let verts = 0, idx = 0;
      for (const m of list) { verts += m.geometry.getAttribute('position').count; idx += m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count; }
      const pos = new Float32Array(verts * 3), nrm = new Float32Array(verts * 3), uv = new Float32Array(verts * 2), col = new Float32Array(verts * 3);
      const si = new Uint16Array(verts * 4), sw = new Float32Array(verts * 4);
      const index = verts > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
      let vo = 0, io = 0;
      for (const m of list) {
        const g = m.geometry, c = (m.material as THREE.MeshStandardMaterial).color ?? new THREE.Color(1, 1, 1);
        const P = g.getAttribute('position'), N = g.getAttribute('normal'), U = g.getAttribute('uv'), SI = g.getAttribute('skinIndex'), SW = g.getAttribute('skinWeight'), C = g.getAttribute('color');
        for (let i = 0; i < P.count; i++) {
          const o = vo + i;
          pos[o * 3] = P.getX(i); pos[o * 3 + 1] = P.getY(i); pos[o * 3 + 2] = P.getZ(i);
          if (N) { nrm[o * 3] = N.getX(i); nrm[o * 3 + 1] = N.getY(i); nrm[o * 3 + 2] = N.getZ(i); }
          if (U) { uv[o * 2] = U.getX(i); uv[o * 2 + 1] = U.getY(i); }
          col[o * 3] = c.r * (C ? C.getX(i) : 1); col[o * 3 + 1] = c.g * (C ? C.getY(i) : 1); col[o * 3 + 2] = c.b * (C ? C.getZ(i) : 1);
          for (let k = 0; k < 4; k++) { si[o * 4 + k] = SI.getComponent(i, k); sw[o * 4 + k] = SW.getComponent(i, k); }
        }
        if (g.index) { const I = g.index; for (let i = 0; i < I.count; i++) index[io++] = I.getX(i) + vo; }
        else for (let i = 0; i < P.count; i++) index[io++] = vo + i;
        vo += P.count;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      g.setIndex(new THREE.BufferAttribute(index, 1));
      const mat = src.clone();
      mat.color = new THREE.Color(1, 1, 1);
      mat.vertexColors = true;
      hit.geos.push(g); hit.mats.push(mat);
    }
    mergedCache.set(key, hit);
    if (mergedCache.size > 200) { const k0 = mergedCache.keys().next().value!; mergedCache.delete(k0); }
  }
  const out: THREE.Object3D[] = hit.geos.map((g, i) => {
    const m = new THREE.SkinnedMesh(g, hit!.mats[i]);
    m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
    m.bind(skeleton, new THREE.Matrix4());
    return m;
  });
  return [...out, ...rest];
}
