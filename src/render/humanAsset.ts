// Realistic human bodies from the MakeHuman-derived asset (tools/build_human.py).
// Each character gets its own blended body (gender, ethnicity, muscle, weight),
// a skeleton fitted to that body, clothing generated from the body surface
// (so it can never clip), eyes, and a skin shader with brows/lips/cheeks.
import * as THREE from 'three';
import type { Appearance } from '../sim/types';
import { GARMENTS } from './human';

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

/** body.bin, or a base64 text copy where the host does not serve binary files (artifact builds) */
async function loadBin(base: string): Promise<ArrayBuffer> {
  const r = await fetch(base + 'body.bin');
  if (r.ok && !(r.headers.get('content-type') ?? '').includes('text/html')) return r.arrayBuffer();
  const txt = await (await fetch(base + 'body.bin.txt')).text();
  const raw = atob(txt.trim());
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

export async function loadHumanAsset(base = 'assets/human/'): Promise<boolean> {
  try {
    const [meta, bin] = await Promise.all([fetch(base + 'body.json').then((r) => r.json()), loadBin(base)]);
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

/** triangle predicate -> index list */
function selectTris(pos: Float32Array, pred: (region: string, cy: number, cz: number, nz: number, cx: number) => boolean): number[] {
  const A = asset!;
  const out: number[] = [];
  const regs = A.meta.regions;
  for (let t = 0; t < A.index.length; t += 3) {
    const a = A.index[t], b = A.index[t + 1], c = A.index[t + 2];
    const cy = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3;
    const cz = (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2]) / 3;
    const cx = (pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3;
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    if (pred(regs[A.region[t / 3]], cy, cz, nz / nl, cx)) out.push(a, b, c);
  }
  return out;
}

export const hashTri = (a: number, b: number, c: number) => {
  const s = [a, b, c].sort((x, y) => x - y);
  return s[0] * 73856093 ^ s[1] * 19349663 ^ s[2] * 83492791;
};

/** relax a garment's surface so fabric spans hollows instead of following every muscle (boundary stays put) */
function drape(p: Float32Array, indices: number[], iterations: number) {
  const orig = asset!.origIndex;
  const nb = new Map<number, Set<number>>();
  const edgeCount = new Map<string, number>();
  const link = (a: number, b: number) => {
    const oa = orig[a], ob = orig[b];
    if (!nb.has(oa)) nb.set(oa, new Set());
    if (!nb.has(ob)) nb.set(ob, new Set());
    nb.get(oa)!.add(ob); nb.get(ob)!.add(oa);
    const k = oa < ob ? `${oa}_${ob}` : `${ob}_${oa}`;
    edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
  };
  for (let i = 0; i < indices.length; i += 3) { link(indices[i], indices[i + 1]); link(indices[i + 1], indices[i + 2]); link(indices[i + 2], indices[i]); }
  const boundary = new Set<number>();
  for (const [k, n] of edgeCount) if (n === 1) for (const v of k.split('_')) boundary.add(Number(v));
  // representative render vertex for every original vertex
  const rep = new Map<number, number[]>();
  for (const v of new Set(indices)) { const o = orig[v]; if (!rep.has(o)) rep.set(o, []); rep.get(o)!.push(v); }
  const cur = new Map<number, [number, number, number]>();
  for (const [o, vs] of rep) cur.set(o, [p[vs[0] * 3], p[vs[0] * 3 + 1], p[vs[0] * 3 + 2]]);
  for (let it = 0; it < iterations; it++) {
    const next = new Map<number, [number, number, number]>();
    for (const [o, c] of cur) {
      if (boundary.has(o)) { next.set(o, c); continue; }
      const n = nb.get(o)!;
      let x = 0, y = 0, z = 0, k = 0;
      for (const q of n) { const qc = cur.get(q); if (qc) { x += qc[0]; y += qc[1]; z += qc[2]; k++; } }
      if (!k) { next.set(o, c); continue; }
      // never shrink inward: only accept moves that do not go below the original surface much
      next.set(o, [c[0] * 0.5 + (x / k) * 0.5, c[1] * 0.5 + (y / k) * 0.5, c[2] * 0.5 + (z / k) * 0.5]);
    }
    for (const [o, c] of next) cur.set(o, c);
  }
  for (const [o, vs] of rep) { const c = cur.get(o)!; for (const v of vs) { p[v * 3] = c[0]; p[v * 3 + 1] = c[1]; p[v * 3 + 2] = c[2]; } }
}

function skinnedGeometry(pos: Float32Array, nrm: Float32Array, indices: number[], offset = 0, uvScale = 1, shape?: (p: Float32Array, idx: number[]) => void, smooth = 0): THREE.BufferGeometry {
  const A = asset!;
  const g = new THREE.BufferGeometry();
  let p = pos;
  if (offset || shape) {
    p = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i++) p[i] = pos[i];
    if (smooth) {
      const before = new Float32Array(p);
      drape(p, indices, smooth);
      // keep cloth outside the skin: push any vertex that sank back out along its normal
      for (let v = 0; v < p.length / 3; v++) {
        const dx = p[v * 3] - before[v * 3], dy = p[v * 3 + 1] - before[v * 3 + 1], dz = p[v * 3 + 2] - before[v * 3 + 2];
        const along = dx * nrm[v * 3] + dy * nrm[v * 3 + 1] + dz * nrm[v * 3 + 2];
        if (along < 0) { p[v * 3] -= along * nrm[v * 3]; p[v * 3 + 1] -= along * nrm[v * 3 + 1]; p[v * 3 + 2] -= along * nrm[v * 3 + 2]; }
      }
    }
    for (let i = 0; i < pos.length; i++) p[i] += nrm[i] * offset;
    shape?.(p, indices);
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  if (uvScale === 1) g.setAttribute('uv', new THREE.BufferAttribute(A.uv, 2));
  else { const u = new Float32Array(A.uv.length); for (let i = 0; i < u.length; i++) u[i] = A.uv[i] * uvScale; g.setAttribute('uv', new THREE.BufferAttribute(u, 2)); }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Uint16Array.from(A.skinIndex), 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Float32Array.from(A.skinWeight, (x) => x / 255), 4));
  g.setIndex(indices);
  g.computeBoundingSphere();
  return g;
}

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

function poolGeometry(pool: Pool, indices: number[], offset: number, uvScale: number, smooth: number): THREE.BufferGeometry {
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
  if (smooth) g.computeVertexNormals();
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
      fHair[v] = style === 'bald' ? 1 : Math.max((line - dy) * 10, (0.6 - headish), ear && style !== 'long' ? 0.3 : -1);
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
    const fNeck = Math.max(Math.min(y - yCut, (r - 0.083) * -1), (y - (neckBase + 0.06)), neck > 0.9 ? 0.1 : -1) * 10;
    const fWaist = (waist - 0.06 - y) * 10;
    const fSleeve = Math.min(arm - 0.5, (sleeveEnd - y) * 10);
    const fHand = hand - 0.5;
    const fLeg = leg - 0.5;
    fTop[v] = Math.max(fNeck, fWaist, fSleeve, fHand, fLeg);
    // trousers: below the waistband, legs down to the ankle (or above the knee for shorts), not feet/arms
    const fAbove = (y - (waist - 0.06)) * 10;
    const fHem = pantsShort ? Math.min(0.5 - leg, (kneeY + 0.08 - y) * 10) : (0.085 - y) * 10;
    fBot[v] = Math.max(fAbove, fHem, arm - 0.5);
    // shoes: the foot and the ankle below the trouser hem
    fShoe[v] = Math.min(0.5 - foot, (y - 0.085) * 10);
    if (leg < 0.3) fShoe[v] = Math.max(fShoe[v], 0.5);
  }
  // smooth the fields over the mesh (shared across UV seams) so cut lines are clean curves
  for (const F of [fTop, fBot, fShoe, fHair]) {
    let cur = new Float32Array(W.nOrig), next = new Float32Array(W.nOrig);
    for (let v = 0; v < n; v++) cur[W.orig[v]] = F[v];
    for (let it = 0; it < 5; it++) {
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
  const isArmR = ['arm_upper', 'arm_lower', 'forearm'];
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
    sk(poolGeometry(pool, topTris, 0.007, 6, 6), cloth(g.top.color, g.top.tex));
    sk(poolGeometry(pool, botTris, 0.008, 6, 8), cloth(g.bottom.color, g.bottom.tex, 0.9));
    sk(poolGeometry(pool, shoeTris, 0.011, 4, 10), cached(`shoe${g.shoes}`, () => new THREE.MeshStandardMaterial({ color: g.shoes, roughness: 0.4, metalness: 0.05 })));
    if (g.over) {
      const o = g.over;
      const overTris = selectTris(pos, (r, cy, _cz, nz, _cx) => {
        if (o.kind === 'apron') return (r === 'torso_upper' || r === 'torso_lower' || r === 'thigh') && cy < shoulderY - 0.08 && cy > kneeY + 0.12 && nz > 0.05;
        if (o.kind === 'vest') return (r === 'torso_upper' || r === 'torso_lower') && cy > waist - 0.08 && cy < shoulderY + 0.02;
        const vDepth = (neckBase - cy) / 0.26;
        const inV = nz > 0.4 && vDepth < 1 && Math.abs(_cx) < 0.075 * (1 - vDepth);
        return ((r === 'torso_upper' || r === 'torso_lower') && cy > hipsY - 0.14 && cy < neckBase + 0.005 && !inV) || (isArmR.includes(r) && cy > wristY + 0.05);
      });
      const thick = o.kind === 'apron' ? 0.02 : o.kind === 'vest' ? 0.017 : 0.016;
      sk(skinnedGeometry(pos, nrm, overTris, thick, 6, undefined, 10), cloth(o.color, o.kind === 'vest' ? 'hivis' : o.kind === 'blazer' ? 'suit' : 'twill', o.kind === 'vest' ? 0.5 : 0.85));
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
      sk(poolGeometry(pool, hairTris, thick, 9, 3), hairM);
      // the scalp under the hair keeps a hair-coloured skin so thin spots never show bare skin
      sk(poolGeometry(pool, hairTris, 0.001, 9, 0), hairM);
      if (style === 'bun') {
        const bun = new THREE.Mesh(new THREE.SphereGeometry(0.04, 18, 14), hairM);
        bun.userData.attach = 'head';
        bun.position.set(0, 0.135, -0.09);
        bun.scale.set(1, 0.9, 0.9);
        out.push(bun);
      }
      if (style === 'long') {
        // a fall of hair down the back to the shoulder blades
        const fall = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.095, 0.26, 18, 1, true, Math.PI * 0.6, Math.PI * 0.8), hairM);
        fall.userData.attach = 'head';
        fall.position.set(0, -0.05, -0.02);
        fall.rotation.y = Math.PI;
        out.push(fall);
      }
    }
    // eyes
    const eyeColor = ['#4a6b8a', '#5a4632', '#3b2a1c', '#4f6b3a'][Math.abs(hashStr(a.skin + a.hairColor)) % 4];
    for (const e of eyes) {
      const em = new THREE.Mesh(new THREE.SphereGeometry(e.r * 0.98, 20, 16), cached(`eye${eyeColor}`, () => new THREE.MeshPhysicalMaterial({ map: irisTexture(eyeColor), roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 })));
      em.rotation.y = -Math.PI / 2; // texture centre faces +z
      em.userData.attach = 'head';
      em.userData.worldPos = e.c.clone();
      out.push(em);
    }
    return out;
  };
  void A;
  return { joints, meshes };
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

function hashStr(s: string) { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return h; }
