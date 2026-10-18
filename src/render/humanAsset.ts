// Realistic human bodies from the MakeHuman-derived asset (tools/build_human.py).
// Each character gets its own blended body (gender, ethnicity, muscle, weight),
// a skeleton fitted to that body, clothing generated from the body surface
// (so it can never clip), eyes, and a skin shader with brows/lips/cheeks.
import * as THREE from 'three';
import type { Appearance } from '../sim/types';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GARMENTS } from './human';
import { fetchBinary } from './binary';
import { hasModel, modelInstance } from './models';

/** which Blender shoe each outfit wears */
const SHOE_STYLE: Record<string, string> = { outfit_casual: 'shoe_trainer', outfit_smart: 'shoe_oxford', uniform_market: 'shoe_trainer', uniform_wholesale: 'shoe_boot', uniform_cafe: 'shoe_oxford' };

/** A shoe model fitted to each foot in the bind pose and skinned rigidly to the foot bone. */
function shoeGeometries(style: string, pos: Float32Array, footW: Float32Array, footX: [number, number], bones: [number, number]): { geo: THREE.BufferGeometry; paint: boolean; color: THREE.Color }[] {
  const tpl = modelInstance(style);
  if (!tpl) return [];
  const parts: { geo: THREE.BufferGeometry; name: string; color: THREE.Color }[] = [];
  tpl.updateMatrixWorld(true);
  tpl.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) parts.push({ geo: m.geometry, name: (m.material as THREE.MeshStandardMaterial).name, color: (m.material as THREE.MeshStandardMaterial).color.clone() }); });
  const tb = new THREE.Box3();
  for (const p of parts) { p.geo.computeBoundingBox(); tb.union(p.geo.boundingBox!); }
  const out: { geo: THREE.BufferGeometry; paint: boolean; color: THREE.Color }[] = [];
  for (let side = 0; side < 2; side++) {
    // the foot's extent in the bind pose
    const fb = new THREE.Box3();
    const n = pos.length / 3;
    for (let v = 0; v < n; v++) {
      if (footW[v] < 0.5 || pos[v * 3 + 1] > 0.13) continue;
      const x = pos[v * 3];
      if (Math.abs(x - footX[side]) > Math.abs(x - footX[1 - side])) continue;
      fb.expandByPoint(new THREE.Vector3(x, pos[v * 3 + 1], pos[v * 3 + 2]));
    }
    if (fb.isEmpty()) continue;
    const fl = fb.max.z - fb.min.z, fw = fb.max.x - fb.min.x;
    const sx = (fw * 1.18) / (tb.max.x - tb.min.x), sz = (fl * 1.07) / (tb.max.z - tb.min.z);
    const m = new THREE.Matrix4().makeTranslation((fb.min.x + fb.max.x) / 2, Math.min(0, fb.min.y), (fb.min.z + fb.max.z) / 2 + fl * 0.01)
      .multiply(new THREE.Matrix4().makeScale(sx, sz, sz))
      .multiply(new THREE.Matrix4().makeTranslation(-(tb.min.x + tb.max.x) / 2, -tb.min.y, -(tb.min.z + tb.max.z) / 2));
    for (const p of parts) {
      const g = p.geo.clone().applyMatrix4(m);
      const cnt = g.getAttribute('position').count;
      const si = new Uint16Array(cnt * 4), sw = new Float32Array(cnt * 4);
      for (let i = 0; i < cnt; i++) { si[i * 4] = bones[side]; sw[i * 4] = 1; }
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
      out.push({ geo: g, paint: p.name === 'paint', color: p.color });
    }
  }
  return out;
}

export interface HumanAsset {
  meta: any;
  position: Float32Array;
  uv: Float32Array;
  index: Uint32Array;
  region: Uint8Array;
  skinIndex: Uint8Array;
  skinWeight: Uint8Array;
  origIndex: Uint32Array;
  morphs: Record<string, Int16Array>;
  masks: THREE.Texture | null;
}

let asset: HumanAsset | null = null;
export const humanAsset = () => asset;

export async function loadHumanAsset(base = 'assets/human/'): Promise<boolean> {
  try {
    const [meta, bin] = await Promise.all([fetch(base + 'body.json').then((r) => r.json()), fetchBinary(base + 'body.bin')]);
    const get = (name: string) => meta.layout.find((l: any) => l.name === name);
    const view = (name: string): any => {
      const l = get(name);
      const C = ({ float32: Float32Array, uint32: Uint32Array, uint8: Uint8Array, int16: Int16Array } as any)[l.dtype];
      return new C(bin, l.offset, l.count);
    };
    const morphs: Record<string, Int16Array> = {};
    for (const m of meta.morphs) morphs[m] = view('morph:' + m);
    const masks = await new Promise<THREE.Texture | null>((res) => new THREE.TextureLoader().load(base + 'skin_masks.png', (t) => res(t), undefined, () => res(null)));
    if (masks) { masks.flipY = true; masks.colorSpace = THREE.NoColorSpace; }
    asset = { meta, position: view('position'), uv: view('uv'), index: view('index'), region: view('region'), skinIndex: view('skinIndex'), skinWeight: view('skinWeight'), origIndex: view('origIndex'), morphs, masks };
    return true;
  } catch (e) {
    console.warn('Human asset unavailable, using procedural bodies', e);
    return false;
  }
}

// ------------------------------------------------------------------ appearance -> morph weights
const SKIN_ETHNIC: Record<string, [number, number, number]> = {
  // [african, asian, caucasian]
  '#f1d3b6': [0.0, 0.25, 0.75], '#e3b48f': [0.05, 0.45, 0.5], '#c98e66': [0.2, 0.45, 0.35],
  '#a86b45': [0.5, 0.25, 0.25], '#7a4a2e': [0.8, 0.05, 0.15], '#4e2f1e': [0.95, 0.0, 0.05],
};

export function morphWeights(a: Appearance): Record<string, number> {
  const f = (a.frame ?? 'm') === 'f';
  const g = f ? 'female' : 'male';
  const eth = SKIN_ETHNIC[a.skin] ?? [0.33, 0.33, 0.34];
  const w: Record<string, number> = {};
  ['african', 'asian', 'caucasian'].forEach((e, i) => { w[`${e}-${g}-young`] = eth[i]; });
  if (a.build === 'slim') { w[`universal-${g}-young-averagemuscle-minweight`] = 0.7; w[`universal-${g}-young-minmuscle-averageweight`] = 0.3; }
  if (a.build === 'broad') { w[`universal-${g}-young-maxmuscle-averageweight`] = 0.55; w[`universal-${g}-young-averagemuscle-maxweight`] = 0.45; }
  w[`prop-${g}`] = 0.6;
  return w;
}

// ------------------------------------------------------------------ geometry

interface Built {
  pos: Float32Array;
  nrm: Float32Array;
  joints: Record<string, THREE.Vector3>;
  eyes: { c: THREE.Vector3; r: number }[];
}

function blend(a: Appearance): Built {
  const A = asset!;
  const n = A.meta.vertexCount;
  const pos = new Float32Array(A.position);
  const w = morphWeights(a);
  const q = A.meta.morphScale;
  for (const [name, wt] of Object.entries(w)) {
    if (!wt) continue;
    const d = A.morphs[name];
    const k = wt * q;
    for (let i = 0; i < n * 3; i++) pos[i] += d[i] * k;
  }
  // smooth normals shared across UV seams
  const orig = A.origIndex;
  const acc = new Map<number, THREE.Vector3>();
  const idx = A.index;
  const p = (i: number) => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  for (let t = 0; t < idx.length; t += 3) {
    const a0 = idx[t], b0 = idx[t + 1], c0 = idx[t + 2];
    const fn = p(b0).sub(p(a0)).cross(p(c0).sub(p(a0)));
    for (const v of [a0, b0, c0]) {
      const o = orig[v];
      const s = acc.get(o) ?? new THREE.Vector3();
      s.add(fn);
      acc.set(o, s);
    }
  }
  const nrm = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const s = (acc.get(orig[i]) ?? new THREE.Vector3(0, 1, 0)).clone().normalize();
    nrm[i * 3] = s.x; nrm[i * 3 + 1] = s.y; nrm[i * 3 + 2] = s.z;
  }
  const joints: Record<string, THREE.Vector3> = {};
  A.meta.bones.forEach((b: string) => {
    const v = new THREE.Vector3(...(A.meta.joints[b] as [number, number, number]));
    A.meta.morphs.forEach((m: string, mi: number) => { const wt = w[m]; if (wt) v.add(new THREE.Vector3(...(A.meta.jointDeltas[mi][b] as [number, number, number])).multiplyScalar(wt)); });
    joints[b] = v;
  });
  const eyes = A.meta.eyes.map(([c, r]: [number[], number], k: number) => {
    const v = new THREE.Vector3(c[0], c[1], c[2]);
    A.meta.morphs.forEach((m: string, mi: number) => { const wt = w[m]; if (wt) v.add(new THREE.Vector3(...(A.meta.eyeDeltas[mi][k] as [number, number, number])).multiplyScalar(wt)); });
    return { c: v, r };
  });
  return { pos, nrm, joints, eyes };
}


export const hashTri = (a: number, b: number, c: number) => {
  const s = [a, b, c].sort((x, y) => x - y);
  return s[0] * 73856093 ^ s[1] * 19349663 ^ s[2] * 83492791;
};



// ------------------------------------------------------------------ materials
const matCache = new Map<string, THREE.Material>();
function cached<T extends THREE.Material>(key: string, make: () => T): T {
  let m = matCache.get(key) as T | undefined;
  if (!m) { m = make(); matCache.set(key, m); }
  return m;
}

function skinMaterial(skin: string, hair: string, fem: boolean): THREE.Material {
  return cached(`hskin${skin}${hair}${fem}`, () => {
    // a faint warm emissive term stands in for light scattering under the skin
    const m = new THREE.MeshPhysicalMaterial({ color: skin, roughness: 0.55, sheen: 0.25, sheenRoughness: 0.7, sheenColor: new THREE.Color(skin).lerp(new THREE.Color('#ff8a6a'), 0.5), emissive: new THREE.Color(skin).lerp(new THREE.Color('#c0503a'), 0.5), emissiveIntensity: 0.07, specularIntensity: 0.6 });
    const masks = asset!.masks;
    if (masks) {
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uMasks = { value: masks };
        sh.uniforms.uBrow = { value: new THREE.Color(hair).multiplyScalar(0.75) };
        sh.uniforms.uLip = { value: new THREE.Color(skin).lerp(new THREE.Color(fem ? '#b04a52' : '#9c5450'), fem ? 0.55 : 0.4) };
        sh.uniforms.uBlush = { value: new THREE.Color(skin).lerp(new THREE.Color('#d86a5a'), 0.3) };
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform sampler2D uMasks; uniform vec3 uBrow; uniform vec3 uLip; uniform vec3 uBlush;')
          .replace('#include <color_fragment>', `#include <color_fragment>
            vec4 mk = texture2D(uMasks, vMapUv);
            diffuseColor.rgb = mix(diffuseColor.rgb, uBlush, mk.a * 0.35);
            diffuseColor.rgb = mix(diffuseColor.rgb, uLip, smoothstep(0.1, 0.6, mk.g) * 0.85);
            diffuseColor.rgb = mix(diffuseColor.rgb, uBrow, smoothstep(0.45, 0.95, mk.r) * 0.75);
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.18 + 0.05, mk.b * 0.6);`);
        // make sure the uv varying is available
        sh.vertexShader = sh.vertexShader;
      };
      // a white map switches on the UV varying that the mask lookup uses
      m.map = whiteTex();
      m.customProgramCacheKey = () => `skin${skin}${hair}${fem}`;
    }
    return m;
  });
}

let white: THREE.DataTexture | null = null;
function whiteTex() {
  if (!white) { white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); white.needsUpdate = true; }
  return white;
}

function fabricTexture(base: string, kind: string): THREE.Texture {
  const key = `fab${base}${kind}`;
  const hit = matCache.get(key) as any;
  if (hit) return hit;
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d')!;
  // fill a fresh ImageData directly: reading back an accelerated canvas stalls the GPU for seconds
  const img = new ImageData(S, S);
  const hex = new THREE.Color(base).getHex();
  const br = (hex >> 16) & 255, bg = (hex >> 8) & 255, bb = hex & 255;
  for (let i = 0; i < img.data.length; i += 4) { img.data[i] = br; img.data[i + 1] = bg; img.data[i + 2] = bb; img.data[i + 3] = 255; }
  let seed = 9;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    let v = (rnd() - 0.5) * 14;
    if (kind === 'denim') v += ((x + y) % 4 < 2 ? 9 : -7) + Math.sin(y * 0.05) * 3;
    else if (kind === 'knit') v += (x % 4 < 2 ? 4 : -3) + (y % 6 < 3 ? 2 : -2);
    else if (kind === 'suit' || kind === 'twill') v += ((x + 2 * y) % 6 < 3 ? 4 : -3);
    else v += (x % 3 === 0 ? -3 : 1);
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + v));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + v));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + v * (kind === 'denim' ? 1.3 : 1)));
  }
  c.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  matCache.set(key, t as any);
  return t;
}

const cloth = (color: string, kind: string, rough = 0.85) => cached(`hcloth${color}${kind}`, () => new THREE.MeshStandardMaterial({ color: '#ffffff', map: fabricTexture(color, kind), roughness: rough, side: THREE.DoubleSide }));

function irisTexture(color: string): THREE.Texture {
  const key = `iris${color}`;
  const hit = matCache.get(key) as any;
  if (hit) return hit;
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#f2efe9'; c.fillRect(0, 0, S, S);
  // texture is mapped onto the front hemisphere: centre = pupil
  const cx = S / 2, cy = S / 2;
  const g = c.createRadialGradient(cx, cy, 6, cx, cy, 44);
  g.addColorStop(0, '#0a0a0a'); g.addColorStop(0.28, '#0a0a0a'); g.addColorStop(0.32, new THREE.Color(color).multiplyScalar(0.6).getStyle()); g.addColorStop(0.8, color); g.addColorStop(1, '#2a1c12');
  c.fillStyle = g; c.beginPath(); c.arc(cx, cy, 44, 0, Math.PI * 2); c.fill();
  c.strokeStyle = 'rgba(255,255,255,.15)';
  for (let i = 0; i < 60; i++) { const a = (i / 60) * Math.PI * 2; c.beginPath(); c.moveTo(cx + Math.cos(a) * 15, cy + Math.sin(a) * 15); c.lineTo(cx + Math.cos(a) * 42, cy + Math.sin(a) * 42); c.stroke(); }
  c.fillStyle = 'rgba(255,255,255,.9)'; c.beginPath(); c.arc(cx - 12, cy - 12, 6, 0, Math.PI * 2); c.fill();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  matCache.set(key, t as any);
  return t;
}

// ------------------------------------------------------------------ exact mesh cutting along a scalar field
interface Pool { p: number[]; n: number[]; uv: number[]; si: number[]; sw: number[]; f: number[][] }

/** Split the body along fields: returns index lists for the part where field `which` < 0 (or where all fields >= 0 for which = -1). */
function cutBody(pos: Float32Array, nrm: Float32Array, fields: Float32Array[], tris: Uint32Array) {
  const A = asset!;
  const n0 = pos.length / 3;
  const pool: Pool = { p: Array.from(pos), n: Array.from(nrm), uv: Array.from(A.uv), si: Array.from(A.skinIndex), sw: Array.from(A.skinWeight, (x) => x / 255), f: fields.map((f) => Array.from(f)) };
  const edgeCache = new Map<string, number>();
  const cut = (a: number, b: number, k: number): number => {
    const key = `${Math.min(a, b)}_${Math.max(a, b)}_${k}`;
    const hit = edgeCache.get(key);
    if (hit !== undefined) return hit;
    const fa = pool.f[k][a], fb = pool.f[k][b];
    const t = fa / (fa - fb);
    const lerp = (arr: number[], dim: number) => { for (let d = 0; d < dim; d++) arr.push(arr[a * dim + d] + (arr[b * dim + d] - arr[a * dim + d]) * t); };
    lerp(pool.p, 3); lerp(pool.n, 3); lerp(pool.uv, 2);
    // skin influences: take the influences of the nearer endpoint (keeps four distinct bones)
    const src = t < 0.5 ? a : b;
    for (let d = 0; d < 4; d++) { pool.si.push(pool.si[src * 4 + d]); pool.sw.push(pool.sw[src * 4 + d]); }
    for (let j = 0; j < pool.f.length; j++) pool.f[j].push(j === k ? 0 : pool.f[j][a] + (pool.f[j][b] - pool.f[j][a]) * t);
    const id = pool.p.length / 3 - 1;
    edgeCache.set(key, id);
    return id;
  };
  // recursively clip a polygon by each field; output buckets: field index for the first field it is inside, or -1
  const buckets: number[][] = fields.map(() => []);
  const rest: number[] = [];
  const emit = (poly: number[], bucket: number[]) => { for (let i = 1; i < poly.length - 1; i++) bucket.push(poly[0], poly[i], poly[i + 1]); };
  const split = (poly: number[], k: number): [number[], number[]] => {
    const inside: number[] = [], outside: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const fa = pool.f[k][a], fb = pool.f[k][b];
      if (fa < 0) inside.push(a); else outside.push(a);
      if ((fa < 0) !== (fb < 0)) { const m = cut(a, b, k); inside.push(m); outside.push(m); }
    }
    return [inside, outside];
  };
  for (let t = 0; t < tris.length; t += 3) {
    let polys = [[tris[t], tris[t + 1], tris[t + 2]]];
    for (let k = 0; k < fields.length && polys.length; k++) {
      const next: number[][] = [];
      for (const poly of polys) {
        const [inn, out] = split(poly, k);
        if (inn.length >= 3) emit(inn, buckets[k]);
        if (out.length >= 3) next.push(out);
      }
      polys = next;
    }
    for (const poly of polys) emit(poly, rest);
  }
  void n0;
  return { pool, buckets, rest };
}

interface Bridge { y0: number; y1: number; zc: number }

/** Loose fit: cloth hangs from the widest part above instead of hugging every contour.
 * `groups` pick vertices by dominant bone; each group's cross-section, per height band and angle,
 * may only shrink by `taper` per metre going down. */
interface Hang { bones: number[][]; y0: number; y1: number; taper: number; ease: number }

function hangCloth(P: Float32Array, n: number, SI: Uint16Array, SW: Float32Array, h: Hang) {
  const bins = 40, ab = 24, dy = (h.y1 - h.y0) / bins;
  for (const group of h.bones) {
    const members: number[] = [];
    for (let i = 0; i < n; i++) {
      const y = P[i * 3 + 1]; if (y < h.y0 || y > h.y1) continue;
      let best = 0, bw = -1;
      for (let d = 0; d < 4; d++) if (SW[i * 4 + d] > bw) { bw = SW[i * 4 + d]; best = SI[i * 4 + d]; }
      if (group.includes(best)) members.push(i);
    }
    if (members.length < 20) continue;
    // axis per band: bounding-box centre, smoothed down the column
    const cx = new Float32Array(bins), cz = new Float32Array(bins), cnt = new Float32Array(bins);
    const mnx = new Float32Array(bins).fill(Infinity), mxx = new Float32Array(bins).fill(-Infinity), mnz = new Float32Array(bins).fill(Infinity), mxz = new Float32Array(bins).fill(-Infinity);
    const band = (y: number) => Math.max(0, Math.min(bins - 1, Math.floor((h.y1 - y) / dy))); // 0 = top
    for (const i of members) { const k = band(P[i * 3 + 1]); mnx[k] = Math.min(mnx[k], P[i * 3]); mxx[k] = Math.max(mxx[k], P[i * 3]); mnz[k] = Math.min(mnz[k], P[i * 3 + 2]); mxz[k] = Math.max(mxz[k], P[i * 3 + 2]); cnt[k]++; }
    for (let k = 0; k < bins; k++) if (cnt[k]) { cx[k] = (mnx[k] + mxx[k]) / 2; cz[k] = (mnz[k] + mxz[k]) / 2; }
    for (let k = 0; k < bins; k++) if (!cnt[k]) { const j = k > 0 ? k - 1 : k + 1; cx[k] = cx[j]; cz[k] = cz[j]; }
    // body radius per band and angle
    const R = Array.from({ length: bins }, () => new Float32Array(ab));
    const ang = (i: number, k: number) => Math.floor(((Math.atan2(P[i * 3] - cx[k], P[i * 3 + 2] - cz[k]) + Math.PI) / (2 * Math.PI)) * ab) % ab;
    for (const i of members) { const k = band(P[i * 3 + 1]); const a = ang(i, k); R[k][a] = Math.max(R[k][a], Math.hypot(P[i * 3] - cx[k], P[i * 3 + 2] - cz[k])); }
    for (let k = 0; k < bins; k++) for (let a = 0; a < ab; a++) if (!R[k][a]) R[k][a] = Math.max(R[k][(a + ab - 1) % ab], R[k][(a + 1) % ab]);
    // hang: going down, the radius may only shrink slowly
    for (let k = 1; k < bins; k++) for (let a = 0; a < ab; a++) R[k][a] = Math.max(R[k][a], R[k - 1][a] - h.taper * dy);
    // soften around the ring
    for (let k = 0; k < bins; k++) { const r = R[k], q = new Float32Array(ab); for (let a = 0; a < ab; a++) q[a] = Math.max(r[a], (r[(a + ab - 1) % ab] + 2 * r[a] + r[(a + 1) % ab]) / 4); R[k] = q; }
    // also smooth down the column so the leg reads as one straight tube
    for (let it = 0; it < 2; it++) for (let k = 1; k < bins - 1; k++) for (let a = 0; a < ab; a++) R[k][a] = Math.max(R[k][a], (R[k - 1][a] + R[k][a] * 2 + R[k + 1][a]) / 4);
    for (const i of members) {
      const y = P[i * 3 + 1];
      // continuous band/angle coordinates, bilinear lookup
      const fk = Math.max(0, Math.min(bins - 1.001, (h.y1 - y) / dy - 0.5)), k0 = Math.floor(fk), tk = fk - k0;
      const ax = cx[k0] * (1 - tk) + cx[k0 + 1] * tk, az = cz[k0] * (1 - tk) + cz[k0 + 1] * tk;
      const ex = P[i * 3] - ax, ez = P[i * 3 + 2] - az, d = Math.hypot(ex, ez);
      if (d < 1e-5) continue;
      const fa = (((Math.atan2(ex, ez) + Math.PI) / (2 * Math.PI)) * ab - 0.5 + ab) % ab, a0 = Math.floor(fa), ta = fa - a0, a1 = (a0 + 1) % ab;
      const r = (R[k0][a0] * (1 - ta) + R[k0][a1] * ta) * (1 - tk) + (R[k0 + 1][a0] * (1 - ta) + R[k0 + 1][a1] * ta) * tk;
      const fade = Math.min(1, (h.y1 - y) / (dy * 6));
      const target = r + h.ease;
      if (target > d) { const f = 1 + ((target - d) / d) * fade; P[i * 3] = ax + ex * f; P[i * 3 + 2] = az + ez * f; }
    }
  }
}

/** Long hair: a sheet that starts on the back of the head, just outside the skull's real cross-section,
 * and falls to the shoulder blades, flaring slightly. Geometry is relative to the head joint. */
function hairFall(pos: Float32Array, head: THREE.Vector3): THREE.BufferGeometry {
  const W = topology();
  const bins = 32, cz = head.z + 0.01;
  const yRing = head.y + 0.12;
  const ring = new Float32Array(bins);
  for (let v = 0; v < pos.length / 3; v++) {
    if (W.headNeck[v] < 0.9 || Math.abs(pos[v * 3 + 1] - yRing) > 0.015) continue;
    const dx = pos[v * 3] - head.x, dz = pos[v * 3 + 2] - cz;
    const k = Math.floor(((Math.atan2(dx, dz) + Math.PI) / (2 * Math.PI)) * bins) % bins;
    ring[k] = Math.max(ring[k], Math.hypot(dx, dz));
  }
  for (let k = 0; k < bins; k++) if (!ring[k]) ring[k] = 0.085;
  const radiusAt = (a: number) => {
    const f = (((a + Math.PI) / (2 * Math.PI)) * bins - 0.5 + bins) % bins, k0 = Math.floor(f), t = f - k0;
    return ring[k0] * (1 - t) + ring[(k0 + 1) % bins] * t;
  };
  const cols = 22, rows = 12, a0 = Math.PI * 0.5, a1 = Math.PI * 1.5, len = 0.4;
  const P: number[] = [], U: number[] = [], I: number[] = [];
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
    const t = r / rows, a = a0 + ((a1 - a0) * c) / cols;
    const edge = Math.abs(c / cols - 0.5) * 2;
    // sides tuck in towards the bottom so the ends look like hair, not a cut tube
    const rad = radiusAt(a) + 0.012 + 0.045 * Math.min(1, t * 1.6) - 0.02 * t * Math.pow(edge, 3);
    const y = yRing - 0.05 * Math.pow(edge, 2) - len * t * (1 - 0.25 * Math.pow(edge, 2));
    P.push(Math.sin(a) * rad, y - head.y, cz + Math.cos(a) * rad - head.z);
    U.push((c / cols) * 3, t * 4);
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const a = r * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1;
    I.push(a, b, d, b, e, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setIndex(I);
  g.computeVertexNormals();
  return g;
}

/** Neck strap and waist ties for the apron, as tubes around the body (attached rigidly to the chest/spine). */
function apronStraps(pos: Float32Array, panel: THREE.BufferGeometry, joints: Record<string, THREE.Vector3>, waist: number): THREE.Mesh[] {
  const P = panel.getAttribute('position') as THREE.BufferAttribute;
  const cols = 18;
  const tl = new THREE.Vector3().fromBufferAttribute(P, 0), tr = new THREE.Vector3().fromBufferAttribute(P, cols);
  const nk = joints.neck;
  // body radius around the vertical axis at a height, per angle (for the waist ties)
  const ring = (y: number, bins = 48) => {
    const r = new Float32Array(bins);
    const cz = joints.thighL.z;
    for (let v = 0; v < pos.length / 3; v++) {
      if (Math.abs(pos[v * 3 + 1] - y) > 0.012) continue;
      const x = pos[v * 3], z = pos[v * 3 + 2] - cz;
      if (Math.abs(x) > 0.25) continue; // ignore hands hanging at the sides
      const k = Math.floor(((Math.atan2(x, z) + Math.PI) / (2 * Math.PI)) * bins) % bins;
      r[k] = Math.max(r[k], Math.hypot(x, z));
    }
    for (let k = 0; k < bins; k++) if (!r[k]) r[k] = (r[(k + bins - 1) % bins] + r[(k + 1) % bins]) / 2 || 0.15;
    return { r, cz, bins };
  };
  const tubeGeo = (pts: THREE.Vector3[], radius: number) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 6, radius, 5, false);
  const tube = (geo: THREE.BufferGeometry, attach: string) => {
    const m = new THREE.Mesh(geo);
    m.castShadow = true;
    m.userData.attach = attach;
    m.userData.worldPos = new THREE.Vector3(0, 0, 0);
    return m;
  };
  // neck loop: from the bib corners up the sides of the neck and round the back
  const neck = [tl.clone(), new THREE.Vector3(-0.072, nk.y - 0.03, nk.z + 0.01), new THREE.Vector3(-0.05, nk.y - 0.005, nk.z - 0.055), new THREE.Vector3(0, nk.y, nk.z - 0.07),
    new THREE.Vector3(0.05, nk.y - 0.005, nk.z - 0.055), new THREE.Vector3(0.072, nk.y - 0.03, nk.z + 0.01), tr.clone()];
  // waist ties: round the back at the waist, ending in a small bow
  const y = waist - 0.01;
  const { r, cz, bins } = ring(y);
  const back: THREE.Vector3[] = [];
  for (let i = 0; i <= 16; i++) {
    const a = Math.PI * 0.42 + (i / 16) * Math.PI * 1.16; // from the left side round the back to the right side
    const k = Math.floor(((Math.atan2(Math.sin(a), Math.cos(a)) + Math.PI) / (2 * Math.PI)) * bins) % bins;
    const rr = r[k] + 0.012;
    back.push(new THREE.Vector3(Math.sin(a) * rr, y, cz + Math.cos(a) * rr));
  }
  const bowZ = cz - r[Math.floor(bins / 2) % bins] - 0.018;
  const bow = [new THREE.Vector3(0, y, bowZ), new THREE.Vector3(-0.03, y + 0.02, bowZ - 0.005), new THREE.Vector3(-0.045, y, bowZ - 0.004), new THREE.Vector3(-0.03, y - 0.018, bowZ - 0.004), new THREE.Vector3(0, y, bowZ),
    new THREE.Vector3(0.03, y + 0.02, bowZ - 0.005), new THREE.Vector3(0.045, y, bowZ - 0.004), new THREE.Vector3(0.03, y - 0.018, bowZ - 0.004), new THREE.Vector3(0, y, bowZ), new THREE.Vector3(0.012, y - 0.08, bowZ - 0.004)];
  return [tube(tubeGeo(neck, 0.006), 'chest'), tube(mergeGeometries([tubeGeo(back, 0.006), tubeGeo(bow, 0.005)])!, 'spine')];
}

/** A real apron: a cloth panel that follows the front of the chest and hangs straight from the belly
 * over the legs, instead of a body-tight cut-out. Skinned rigidly to the torso bones. */
function apronPanel(pos: Float32Array, joints: Record<string, THREE.Vector3>, top: number, bottom: number, waist: number): THREE.BufferGeometry {
  const A = asset!;
  const rows = 34, cols = 18, xb = 40, xr = 0.22;
  const n = pos.length / 3;
  const ys: number[] = [], zs: number[][] = [], ws: number[] = [];
  for (let r = 0; r <= rows; r++) {
    const y = top + ((bottom - top) * r) / rows;
    ys.push(y);
    // bib narrows above the waist, skirt widens a little at the hem
    const w = y > waist ? 0.11 + 0.05 * Math.max(0, Math.min(1, (waist + 0.12 - y) / 0.12)) : 0.16 + 0.025 * ((waist - y) / (waist - bottom));
    ws.push(w);
    // front envelope of the body at this height
    const env = new Float32Array(xb).fill(-Infinity);
    for (let v = 0; v < n; v++) {
      if (Math.abs(pos[v * 3 + 1] - y) > 0.015) continue;
      const x = pos[v * 3]; if (Math.abs(x) >= xr) continue;
      const k = Math.floor(((x + xr) / (2 * xr)) * xb);
      env[k] = Math.max(env[k], pos[v * 3 + 2]);
    }
    // upper hull across x: the cloth spans hollows between the legs or under the chest
    const pts: [number, number][] = [];
    for (let k = 0; k < xb; k++) if (isFinite(env[k])) pts.push([-xr + ((k + 0.5) / xb) * 2 * xr, env[k]]);
    const hull: [number, number][] = [];
    for (const pt of pts) {
      while (hull.length >= 2) { const [a, b] = [hull[hull.length - 2], hull[hull.length - 1]]; if ((b[0] - a[0]) * (pt[1] - a[1]) - (b[1] - a[1]) * (pt[0] - a[0]) >= 0) hull.pop(); else break; }
      hull.push(pt);
    }
    const at = (x: number) => {
      if (!hull.length) return joints.chest.z + 0.1;
      if (x <= hull[0][0]) return hull[0][1];
      for (let i = 1; i < hull.length; i++) if (x <= hull[i][0]) { const [a, b] = [hull[i - 1], hull[i]]; return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]); }
      return hull[hull.length - 1][1];
    };
    zs.push(Array.from({ length: cols + 1 }, (_, c) => at(-w + (2 * w * c) / cols)));
  }
  // below the belly the cloth falls almost straight down instead of following the thighs inward
  for (let r = 1; r <= rows; r++) if (ys[r] < waist) for (let c = 0; c <= cols; c++) zs[r][c] = Math.max(zs[r][c], zs[r - 1][c] - 0.12 * (ys[r - 1] - ys[r]));
  const P: number[] = [], U: number[] = [], SI: number[] = [], SW: number[] = [], I: number[] = [];
  const bi = (nm: string) => A.meta.bones.indexOf(nm);
  const chest = bi('chest'), spine = bi('spine'), hips = bi('hips');
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
    const y = ys[r], x = -ws[r] + (2 * ws[r] * c) / cols;
    // a slight curl back at the side edges reads as thick fabric
    const edge = Math.abs(c / cols - 0.5) * 2;
    P.push(x, y, zs[r][c] + 0.022 - 0.01 * Math.pow(edge, 6));
    U.push(x * 6, y * 6);
    // rigid-ish weights: chest above the sternum, spine at the belly, hips below
    const tc = Math.max(0, Math.min(1, (y - joints.spine.y) / (joints.chest.y - joints.spine.y)));
    const th = Math.max(0, Math.min(1, (joints.spine.y - y) / (joints.spine.y - joints.hips.y)));
    if (y >= joints.spine.y) { SI.push(chest, spine, 0, 0); SW.push(tc, 1 - tc, 0, 0); } else { SI.push(hips, spine, 0, 0); SW.push(th, 1 - th, 0, 0); }
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const a = r * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1;
    I.push(a, d, b, b, d, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4));
  g.setIndex(I);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Cloth does not follow concave dips between two bulges (buttocks, crotch): per height band, raise the
 * surface between the outermost point on each side to the straight line joining them. */
function bridgeHollows(P: Float32Array, n: number, b: Bridge) {
  const bins = 24, h = (b.y1 - b.y0) / bins;
  for (const side of [-1, 1]) {
    // side -1 = back (z < zc), +1 = front
    const peak = Array.from({ length: bins }, () => ({ l: [0, -Infinity], r: [0, -Infinity] }));
    for (let i = 0; i < n; i++) {
      const y = P[i * 3 + 1]; if (y < b.y0 || y >= b.y1) continue;
      const out = (P[i * 3 + 2] - b.zc) * side; if (out <= 0) continue;
      const k = Math.min(bins - 1, Math.floor((y - b.y0) / h)), x = P[i * 3];
      const pk = x < 0 ? peak[k].l : peak[k].r;
      if (out > pk[1]) { pk[0] = x; pk[1] = out; }
    }
    for (let i = 0; i < n; i++) {
      const y = P[i * 3 + 1]; if (y < b.y0 || y >= b.y1) continue;
      const out = (P[i * 3 + 2] - b.zc) * side; if (out <= 0) continue;
      const t = (y - b.y0) / h - 0.5, k0 = Math.max(0, Math.min(bins - 1, Math.floor(t))), k1 = Math.min(bins - 1, k0 + 1), f = Math.max(0, Math.min(1, t - k0));
      const line = (pk: { l: number[]; r: number[] }) => {
        const [xl, zl] = pk.l, [xr, zr] = pk.r, x = P[i * 3];
        if (!isFinite(zl) || !isFinite(zr) || x <= xl || x >= xr) return -Infinity;
        return zl + ((zr - zl) * (x - xl)) / (xr - xl);
      };
      const a0 = line(peak[k0]), a1 = line(peak[k1]);
      const target = !isFinite(a0) ? a1 : !isFinite(a1) ? a0 : a0 * (1 - f) + a1 * f;
      // fade in over the band ends so the bridged area blends into the untouched cloth
      const edge = Math.min(1, (y - b.y0) / (h * 3), (b.y1 - y) / (h * 3));
      if (isFinite(target) && target > out) P[i * 3 + 2] += (target - out) * side * edge;
    }
  }
}

function poolGeometry(pool: Pool, indices: number[], offset: number, uvScale: number, smooth: number, bridge?: Bridge, hang?: Hang): THREE.BufferGeometry {
  const used = Array.from(new Set(indices)).sort((a, b) => a - b);
  const remap = new Map<number, number>();
  used.forEach((v, i) => remap.set(v, i));
  const n = used.length;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2), SI = new Uint16Array(n * 4), SW = new Float32Array(n * 4);
  used.forEach((v, i) => {
    for (let d = 0; d < 3; d++) { P[i * 3 + d] = pool.p[v * 3 + d]; N[i * 3 + d] = pool.n[v * 3 + d]; }
    U[i * 2] = pool.uv[v * 2] * uvScale; U[i * 2 + 1] = pool.uv[v * 2 + 1] * uvScale;
    for (let d = 0; d < 4; d++) { SI[i * 4 + d] = pool.si[v * 4 + d]; SW[i * 4 + d] = pool.sw[v * 4 + d]; }
  });
  const idx = indices.map((v) => remap.get(v)!);
  // bridge first so the drape smoothing below blends the bridged area into the rest of the cloth
  if (bridge) bridgeHollows(P, n, bridge);
  if (hang) hangCloth(P, n, SI, SW, hang);
  if (smooth) {
    // relax interior vertices so the fabric bridges hollows; boundary vertices stay on the cut line
    const nb: Set<number>[] = Array.from({ length: n }, () => new Set());
    const ec = new Map<string, number>();
    const pkey = (i: number) => `${P[i * 3].toFixed(5)},${P[i * 3 + 1].toFixed(5)},${P[i * 3 + 2].toFixed(5)}`;
    const weld = new Map<string, number>();
    const rep = new Int32Array(n);
    for (let i = 0; i < n; i++) { const k = pkey(i); if (!weld.has(k)) weld.set(k, i); rep[i] = weld.get(k)!; }
    for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) {
      const a = rep[idx[t + e]], b = rep[idx[t + (e + 1) % 3]];
      nb[a].add(b); nb[b].add(a);
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      ec.set(k, (ec.get(k) ?? 0) + 1);
    }
    const boundary = new Uint8Array(n);
    for (const [k, c] of ec) if (c === 1) for (const v of k.split('_')) boundary[Number(v)] = 1;
    const base = new Float32Array(P);
    for (let it = 0; it < smooth; it++) {
      const Q = new Float32Array(P);
      for (let i = 0; i < n; i++) {
        if (rep[i] !== i || boundary[i] || !nb[i].size) continue;
        let x = 0, y = 0, z = 0;
        for (const j of nb[i]) { x += P[j * 3]; y += P[j * 3 + 1]; z += P[j * 3 + 2]; }
        const k = nb[i].size;
        Q[i * 3] = P[i * 3] * 0.5 + (x / k) * 0.5; Q[i * 3 + 1] = P[i * 3 + 1] * 0.5 + (y / k) * 0.5; Q[i * 3 + 2] = P[i * 3 + 2] * 0.5 + (z / k) * 0.5;
      }
      P.set(Q);
    }
    for (let i = 0; i < n; i++) {
      const r = rep[i];
      for (let d = 0; d < 3; d++) P[i * 3 + d] = P[r * 3 + d];
      // never let fabric sink into the body
      const dx = P[i * 3] - base[i * 3], dy = P[i * 3 + 1] - base[i * 3 + 1], dz = P[i * 3 + 2] - base[i * 3 + 2];
      const along = dx * N[i * 3] + dy * N[i * 3 + 1] + dz * N[i * 3 + 2];
      if (along < 0) for (let d = 0; d < 3; d++) P[i * 3 + d] -= along * N[i * 3 + d];
    }
  }
  if (offset) for (let i = 0; i < n * 3; i++) P[i] += N[i] * offset;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
  g.setIndex(idx);
  if (smooth || bridge) g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------------ public: build a character's meshes and skeleton layout
export interface HumanBuild {
  joints: Record<string, THREE.Vector3>;
  meshes: (skeleton: THREE.Skeleton) => THREE.Object3D[];
}

/** appearance-independent data, computed once: bone-group weights and the vertex adjacency across UV seams */
interface Topology { headNeck: Float32Array; arm: Float32Array; hand: Float32Array; leg: Float32Array; foot: Float32Array; orig: Uint32Array; nOrig: number; adjStart: Uint32Array; adj: Uint32Array }
let topo: Topology | null = null;
function topology(): Topology {
  if (topo) return topo;
  const A = asset!;
  const n = A.position.length / 3;
  const group = (names: string[]) => {
    const ids = new Set(names.map((nm) => A.meta.bones.indexOf(nm)));
    const out = new Float32Array(n);
    for (let v = 0; v < n; v++) for (let d = 0; d < 4; d++) if (ids.has(A.skinIndex[v * 4 + d])) out[v] += A.skinWeight[v * 4 + d] / 255;
    return out;
  };
  const orig = A.origIndex;
  let nOrig = 0;
  for (let v = 0; v < n; v++) nOrig = Math.max(nOrig, orig[v] + 1);
  const sets: Set<number>[] = Array.from({ length: nOrig }, () => new Set());
  for (let t = 0; t < A.index.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = orig[A.index[t + e]], b = orig[A.index[t + (e + 1) % 3]];
    sets[a].add(b); sets[b].add(a);
  }
  const adjStart = new Uint32Array(nOrig + 1);
  for (let o = 0; o < nOrig; o++) adjStart[o + 1] = adjStart[o] + sets[o].size;
  const adj = new Uint32Array(adjStart[nOrig]);
  for (let o = 0; o < nOrig; o++) { let k = adjStart[o]; for (const q of sets[o]) adj[k++] = q; }
  topo = {
    headNeck: group(['head', 'neck']), arm: group(['armL', 'foreL', 'handL', 'armR', 'foreR', 'handR']), hand: group(['handL', 'handR']),
    leg: group(['thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR']), foot: group(['footL', 'footR']), orig, nOrig, adjStart, adj,
  };
  return topo;
}

const buildCache = new Map<string, HumanBuild>();

/** Cached per appearance: the body blend and garment cuts run once, later rigs share the geometry. */
export function buildRealHuman(a: Appearance): HumanBuild {
  const key = JSON.stringify(a);
  const hit = buildCache.get(key);
  if (hit) return hit;
  const raw = buildRealHumanUncached(a);
  let templates: THREE.Object3D[] | null = null;
  const hb: HumanBuild = {
    joints: raw.joints,
    meshes: (skeleton) => {
      if (!templates) { templates = raw.meshes(skeleton); return templates; }
      return templates.map((t) => {
        let o: THREE.Object3D;
        if ((t as THREE.SkinnedMesh).isSkinnedMesh) {
          const src = t as THREE.SkinnedMesh;
          const m = new THREE.SkinnedMesh(src.geometry, src.material);
          m.castShadow = m.receiveShadow = true;
          m.frustumCulled = false;
          m.bind(skeleton, new THREE.Matrix4());
          o = m;
        } else {
          const src = t as THREE.Mesh;
          o = new THREE.Mesh(src.geometry, src.material);
          o.position.copy(src.position); o.rotation.copy(src.rotation); o.scale.copy(src.scale);
        }
        o.userData = { ...t.userData };
        return o;
      });
    },
  };
  if (buildCache.size > 96) buildCache.delete(buildCache.keys().next().value!);
  buildCache.set(key, hb);
  return hb;
}

function buildRealHumanUncached(a: Appearance): HumanBuild {
  const A = asset!;
  const { pos, nrm, joints, eyes } = blend(a);
  const fem = (a.frame ?? 'm') === 'f';
  const g = GARMENTS[a.outfit] ?? GARMENTS.outfit_casual;
  const hipsY = joints.hips.y;
  const waist = joints.spine.y - 0.02;
  const shoulderY = joints.armL.y;
  const elbowY = joints.foreL.y;
  const wristY = joints.handL.y;
  const longSleeve = g.top.sleeve === 'long';
  const sleeveEnd = longSleeve ? wristY + 0.035 : shoulderY - (shoulderY - elbowY) * 0.45;
  const pantsShort = g.bottom.length === 'shorts';
  const kneeY = joints.shinL.y;
  const neckBase = joints.neck.y - 0.015;

  // ---- smooth fields over the body (negative = covered by that garment)
  const n = pos.length / 3;
  const W = topology();
  const fTop = new Float32Array(n), fBot = new Float32Array(n), fShoe = new Float32Array(n), fHair = new Float32Array(n);
  const fOver = new Float32Array(n), fTopLong = new Float32Array(n);
  const ov = g.over;
  const hz = joints.thighL.z; // the body's front/back mid-plane (the hip joint sits towards the back)
  const nk = joints.neck, hd = joints.head;
  const style = a.hair;
  for (let v = 0; v < n; v++) {
    const y = pos[v * 3 + 1];
    const x = pos[v * 3], z = pos[v * 3 + 2];
    // hair: everything above a hairline that runs from the forehead over the temples to the nape
    {
      const dx = x - hd.x, dz = z - (hd.z + 0.01), dy = y - hd.y;
      const front = (dz / Math.max(1e-6, Math.hypot(dx, dz)) + 1) / 2; // 1 = forehead, 0 = back of head
      const back = style === 'long' ? -0.1 : style === 'bun' ? 0.0 : style === 'curly' ? 0.02 : 0.03;
      const top = style === 'curly' ? 0.1 : 0.115;
      const line = back + (top - back) * Math.pow(front, 2.2);
      const headish = W.headNeck[v];
      // keep the ears clear of hair
      const ear = Math.abs(dx) > 0.068 && dy < 0.055 && dy > -0.05 && Math.abs(dz) < 0.05;
      fHair[v] = style === 'bald' ? 1 : Math.max((line - dy) * 10, (0.6 - headish), ear ? 0.3 : -1);
    }
    const neck = W.headNeck[v];
    const arm = W.arm[v];
    const hand = W.hand[v];
    const leg = W.leg[v];
    const foot = W.foot[v];
    // top: torso above the waistband, not the neck, sleeves down to the sleeve line, never the hands
    // crew neckline: a ring around the neck that dips at the front
    const ndx = x - nk.x, ndz = z - nk.z, r = Math.hypot(ndx, ndz);
    const frontness = Math.max(0, ndz / Math.max(1e-6, r));
    const yCut = neckBase - 0.008 - 0.022 * frontness * frontness;
    const fNeck = Math.max(smin(y - yCut, 0.083 - r, 0.012), (y - (neckBase + 0.06)), (neck - 0.97) * 0.5) * 10;
    const fWaist = (waist - 0.06 - y) * 10;
    const fSleeve = Math.min(arm - 0.5, (sleeveEnd - y) * 10);
    const fHand = hand - 0.5;
    const fLeg = leg - 0.5;
    fTop[v] = Math.max(fNeck, fWaist, fSleeve, fHand, fLeg);
    // the shirt itself hangs a little lower so it overlaps the waistband (no gap line at the seam)
    fTopLong[v] = Math.max(fNeck, (waist - 0.095 - y) * 10, fSleeve, fHand);
    // trousers: below the waistband, legs down to the ankle (or above the knee for shorts), not feet/arms
    const fAbove = (y - (waist - 0.06)) * 10;
    const fHem = pantsShort ? Math.min(0.5 - leg, (kneeY + 0.08 - y) * 10) : (0.085 - y) * 10;
    fBot[v] = Math.max(fAbove, fHem, arm - 0.5);
    // shoes: the foot and the ankle below the trouser hem
    if (ov) {
      // over-garments are their own smooth fields so their edges are clean curves too
      const front = z - hz; // + is the front of the body
      if (ov.kind === 'apron') {
        fOver[v] = Math.max((y - (shoulderY - 0.1)) * 10, (kneeY + 0.1 - y) * 10, (Math.abs(x) - 0.165) * 12, (0.005 - front) * 14, arm - 0.4, fNeck);
      } else if (ov.kind === 'vest') {
        fOver[v] = Math.max((waist - 0.1 - y) * 10, fNeck, arm - 0.35, (y - (shoulderY + 0.02)) * 10);
      } else {
        // blazer: torso to below the hips, long sleeves to the wrist, a V opening at the front
        const vDepth = (neckBase - y) / 0.27;
        const fV = front > 0.02 && vDepth > 0 && vDepth < 1 ? (0.075 * (1 - vDepth) - Math.abs(x)) * 14 : -1;
        fOver[v] = Math.max(fNeck, (hipsY - 0.08 - y) * 10, Math.min(arm - 0.5, (wristY + 0.05 - y) * 10), fHand, fV);
      }
    }
    fShoe[v] = Math.min(0.5 - foot, (y - 0.085) * 10);
    if (leg < 0.3) fShoe[v] = Math.max(fShoe[v], 0.5);
  }
  // smooth the fields over the mesh (shared across UV seams) so cut lines are clean curves
  for (const F of ov ? [fTop, fBot, fShoe, fHair, fTopLong, fOver] : [fTop, fBot, fShoe, fHair, fTopLong]) {
    let cur = new Float32Array(W.nOrig), next = new Float32Array(W.nOrig);
    for (let v = 0; v < n; v++) cur[W.orig[v]] = F[v];
    const iters = F === fTop || F === fTopLong || F === fOver ? 9 : 5;
    for (let it = 0; it < iters; it++) {
      for (let o = 0; o < W.nOrig; o++) {
        const s0 = W.adjStart[o], s1 = W.adjStart[o + 1];
        if (s1 === s0) { next[o] = cur[o]; continue; }
        let sum = 0;
        for (let k = s0; k < s1; k++) sum += cur[W.adj[k]];
        next[o] = cur[o] * 0.4 + (sum / (s1 - s0)) * 0.6;
      }
      [cur, next] = [next, cur];
    }
    for (let v = 0; v < n; v++) F[v] = cur[W.orig[v]];
  }
  const { pool, buckets, rest } = cutBody(pos, nrm, [fHair, fTop, fBot, fShoe], A.index);
  const [hairTris, topTris, botTris, shoeTris] = buckets;
  const visibleSkin = rest;
  void hipsY; void neckBase;
  // fabric spans the cleft between the buttocks and the hollow at the front of the crotch
  const bi = (nm: string) => A.meta.bones.indexOf(nm);
  const crotch = joints.thighL.y - 0.11;
  // trouser legs fall fairly straight from the thigh instead of hugging knees and calves
  const legHang: Hang = { bones: [[bi('thighL'), bi('shinL'), bi('footL')], [bi('thighR'), bi('shinR'), bi('footR')]], y0: 0.0, y1: crotch, taper: fem ? 0.22 : 0.16, ease: 0.002 };
  const bridge: Bridge = { y0: joints.thighL.y - 0.11, y1: hipsY + 0.1, zc: joints.thighL.z };
  const meshes = (skeleton: THREE.Skeleton): THREE.Object3D[] => {
    const out: THREE.Object3D[] = [];
    const sk = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
      const m = new THREE.SkinnedMesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.bind(skeleton, new THREE.Matrix4());
      out.push(m);
      return m;
    };
    sk(poolGeometry(pool, visibleSkin, 0, 1, 0), skinMaterial(a.skin, a.hairColor, fem));
    const shirt = cutBody(pos, nrm, [fTopLong], A.index);
    sk(poolGeometry(shirt.pool, shirt.buckets[0], 0.011, 6, 6, bridge), cloth(g.top.color, g.top.tex));
    void topTris;
    sk(poolGeometry(pool, botTris, 0.008, 6, 8, bridge, legHang), cloth(g.bottom.color, g.bottom.tex, 0.9));
    const style = SHOE_STYLE[a.outfit] ?? 'shoe_trainer';
    const shoes = hasModel(style) ? shoeGeometries(style, pos, W.foot, [joints.footL.x, joints.footR.x], [bi('footL'), bi('footR')]) : [];
    if (shoes.length) {
      // real shoes replace the feet
      for (const sh of shoes) sk(sh.geo, sh.paint ? cached(`shoe${g.shoes}`, () => new THREE.MeshStandardMaterial({ color: g.shoes, roughness: 0.45, metalness: 0.05 })) : cached(`shoepart${sh.color.getHexString()}`, () => new THREE.MeshStandardMaterial({ color: sh.color, roughness: 0.6 })));
    } else sk(poolGeometry(pool, shoeTris, 0.011, 4, 10), cached(`shoe${g.shoes}`, () => new THREE.MeshStandardMaterial({ color: g.shoes, roughness: 0.4, metalness: 0.05 })));
    if (ov?.kind === 'apron') {
      const apronM = cloth(ov.color, 'twill', 0.85);
      const panel = apronPanel(pos, joints, shoulderY - 0.1, kneeY + 0.1, waist);
      sk(panel, apronM);
      for (const strap of apronStraps(pos, panel, joints, waist)) { strap.material = apronM; out.push(strap); }
    } else if (ov) {
      const over = cutBody(pos, nrm, [fOver], A.index);
      const thick = ov.kind === 'vest' ? 0.018 : 0.017;
      sk(poolGeometry(over.pool, over.buckets[0], thick, 6, 10, bridge), cloth(ov.color, ov.kind === 'vest' ? 'hivis' : 'suit', ov.kind === 'vest' ? 0.5 : 0.85));
    }
    if (g.tie) {
      const tieM = cached(`tie${g.tie}`, () => new THREE.MeshStandardMaterial({ color: g.tie!, roughness: 0.45, side: THREE.DoubleSide }));
      const shape = new THREE.Shape();
      shape.moveTo(-0.018, 0); shape.lineTo(0.018, 0); shape.lineTo(0.034, -0.36); shape.lineTo(0, -0.4); shape.lineTo(-0.034, -0.36); shape.lineTo(-0.018, 0);
      const tie = new THREE.Mesh(new THREE.ShapeGeometry(shape), tieM);
      // find the front of the chest just below the collar
      let front = -1;
      for (let v = 0; v < pos.length / 3; v++) if (Math.abs(pos[v * 3]) < 0.01 && Math.abs(pos[v * 3 + 1] - (neckBase - 0.03)) < 0.02 && (front < 0 || pos[v * 3 + 2] > pos[front * 3 + 2])) front = v;
      const fz = front >= 0 ? pos[front * 3 + 2] : joints.chest.z + 0.1;
      tie.userData.attach = 'chest';
      tie.userData.worldPos = new THREE.Vector3(0, neckBase - 0.025, fz + 0.012);
      tie.rotation.x = -0.12;
      out.push(tie);
    }
    // hair: the scalp region cut along the hairline, lifted off the head per style
    if (style !== 'bald' && hairTris.length) {
      const thick = style === 'curly' ? 0.022 : style === 'long' ? 0.014 : style === 'bun' ? 0.008 : 0.007;
      const hairM = cached(`hhair${a.hairColor}${style}`, () => new THREE.MeshStandardMaterial({ color: '#ffffff', map: hairTexture(a.hairColor, style === 'curly'), roughness: 0.5, side: THREE.DoubleSide }));
      // the hair layer plus a hair-coloured scalp under it (so thin spots never show bare skin), as one mesh
      sk(mergeGeometries([poolGeometry(pool, hairTris, thick, 9, 3), poolGeometry(pool, hairTris, 0.001, 9, 0)])!, hairM);
      // strand shells: progressively sparser layers of loose strands above the hair, for a soft, fuzzy outline
      const shells = style === 'curly' ? 4 : 3;
      const step = style === 'curly' ? 0.006 : 0.0035;
      for (let k = 1; k <= shells; k++) {
        const shellM = cached(`hshell${a.hairColor}${style}${k}`, () => new THREE.MeshStandardMaterial({ color: '#ffffff', map: strandTexture(a.hairColor, style === 'curly', k), roughness: 0.55, alphaTest: 0.35 + k * 0.1, side: THREE.DoubleSide }));
        const shell = sk(poolGeometry(pool, hairTris, thick + k * step, 9, 3), shellM);
        shell.castShadow = false;
      }
      if (style === 'bun') {
        const bun = new THREE.Mesh(new THREE.SphereGeometry(0.04, 18, 14), hairM);
        bun.userData.attach = 'head';
        bun.position.set(0, 0.135, -0.09);
        bun.scale.set(1, 0.9, 0.9);
        out.push(bun);
      }
      if (style === 'long') {
        // a fall of hair down the back to the shoulder blades
        const fall = new THREE.Mesh(hairFall(pos, joints.head), hairM);
        fall.userData.attach = 'head';
        fall.userData.worldPos = joints.head.clone();
        fall.castShadow = true;
        out.push(fall);
      }
    }
    // eyes
    const eyeColor = ['#4a6b8a', '#5a4632', '#3b2a1c', '#4f6b3a'][Math.abs(hashStr(a.skin + a.hairColor)) % 4];
    // both eyeballs in one mesh on the head bone; texture centre faces +z
    const eyeGeo = mergeGeometries(eyes.map((e) => new THREE.SphereGeometry(e.r * 0.98, 20, 16).rotateY(-Math.PI / 2).translate(e.c.x - joints.head.x, e.c.y - joints.head.y, e.c.z - joints.head.z)))!;
    const em = new THREE.Mesh(eyeGeo, cached(`eye${eyeColor}`, () => new THREE.MeshPhysicalMaterial({ map: irisTexture(eyeColor), roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 })));
    em.userData.attach = 'head';
    em.userData.worldPos = joints.head.clone();
    out.push(em);
    return out;
  };
  void A;
  return { joints, meshes };
}

/** loose strands on a transparent background for the hair shells (sparser on the outer shells) */
function strandTexture(color: string, curly: boolean, layer: number): THREE.Texture {
  const key = `strandtex${color}${curly}${layer}`;
  const hit = matCache.get(key) as any;
  if (hit) return hit;
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d')!;
  const base = new THREE.Color(color);
  let seed = layer * 977 + (curly ? 13 : 0);
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const count = Math.round((curly ? 1600 : 2200) / layer);
  for (let i = 0; i < count; i++) {
    const x = rnd() * S, y = rnd() * S;
    c.strokeStyle = base.clone().multiplyScalar(0.7 + rnd() * 0.7).getStyle();
    c.lineWidth = 1.2;
    c.beginPath();
    if (curly) c.arc(x, y, 2 + rnd() * 3, rnd() * 6, rnd() * 6 + 3.5);
    else { c.moveTo(x, y); c.quadraticCurveTo(x + (rnd() - 0.5) * 6, y + 10, x + (rnd() - 0.5) * 8, y + 18 + rnd() * 24); }
    c.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  matCache.set(key, t as any);
  return t;
}

function hairTexture(color: string, curly: boolean): THREE.Texture {
  const key = `hairtex${color}${curly}`;
  const hit = matCache.get(key) as any;
  if (hit) return hit;
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d')!;
  c.fillStyle = color; c.fillRect(0, 0, S, S);
  const base = new THREE.Color(color);
  for (let i = 0; i < 1400; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    const l = curly ? 6 : 30 + Math.random() * 40;
    c.strokeStyle = base.clone().multiplyScalar(0.6 + Math.random() * 0.8).getStyle();
    c.globalAlpha = 0.5;
    c.lineWidth = 1;
    c.beginPath();
    if (curly) c.arc(x, y, 3 + Math.random() * 3, 0, Math.PI * 2);
    else { c.moveTo(x, y); c.lineTo(x + (Math.random() - 0.5) * 4, y + l); }
    c.stroke();
  }
  c.globalAlpha = 1;
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  matCache.set(key, t as any);
  return t;
}

/** smooth minimum: no crease where the two cut surfaces meet (a hard min makes zigzag cut lines) */
function smin(a: number, b: number, k: number) { const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k)); return b + (a - b) * h - k * h * (1 - h); }

function hashStr(s: string) { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return h; }
