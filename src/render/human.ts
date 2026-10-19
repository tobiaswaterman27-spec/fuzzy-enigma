// Parametric human generator: smooth, skinned, anatomically proportioned
// bodies built procedurally on one shared skeleton. Clothing is generated as
// the outer surface of the body in the regions it covers, so garments can
// never clip through skin, and every animation works for every combination.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Appearance } from '../sim/types';

export const BONE_NAMES = ['hips', 'spine', 'chest', 'neck', 'head', 'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'] as const;
export type HBone = (typeof BONE_NAMES)[number];
const BI = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i])) as Record<HBone, number>;

/** rest-pose joint positions in body space (metres, feet at y=0, facing +z) */
export function jointLayout(frame: 'm' | 'f', build: number) {
  const f = frame === 'f';
  const sh = (f ? 0.168 : 0.19) * (0.94 + build * 0.06);
  return {
    hips: new THREE.Vector3(0, 0.95, 0),
    spine: new THREE.Vector3(0, 1.07, 0),
    chest: new THREE.Vector3(0, 1.27, 0),
    neck: new THREE.Vector3(0, 1.465, -0.005),
    head: new THREE.Vector3(0, 1.545, 0),
    armL: new THREE.Vector3(sh, 1.425, -0.01), foreL: new THREE.Vector3(sh + 0.012, 1.135, -0.015), handL: new THREE.Vector3(sh + 0.016, 0.88, 0.0),
    armR: new THREE.Vector3(-sh, 1.425, -0.01), foreR: new THREE.Vector3(-sh - 0.012, 1.135, -0.015), handR: new THREE.Vector3(-sh - 0.016, 0.88, 0.0),
    thighL: new THREE.Vector3(0.093, 0.92, 0), shinL: new THREE.Vector3(0.098, 0.485, 0.005), footL: new THREE.Vector3(0.1, 0.075, -0.01),
    thighR: new THREE.Vector3(-0.093, 0.92, 0), shinR: new THREE.Vector3(-0.098, 0.485, 0.005), footR: new THREE.Vector3(-0.1, 0.075, -0.01),
  } as Record<HBone, THREE.Vector3>;
}

const PARENT: Partial<Record<HBone, HBone>> = {
  spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck', armL: 'chest', foreL: 'armL', handL: 'foreL', armR: 'chest', foreR: 'armR', handR: 'foreR',
  thighL: 'hips', shinL: 'thighL', footL: 'shinL', thighR: 'hips', shinR: 'thighR', footR: 'shinR',
};

export function buildSkeleton(frame: 'm' | 'f', build: number) {
  const J = jointLayout(frame, build);
  const bones = {} as Record<HBone, THREE.Bone>;
  for (const n of BONE_NAMES) {
    const b = new THREE.Bone();
    b.name = n;
    bones[n] = b;
  }
  for (const n of BONE_NAMES) {
    const parent = PARENT[n];
    if (parent) { bones[parent].add(bones[n]); bones[n].position.copy(J[n]).sub(J[parent]); }
    else bones[n].position.copy(J[n]);
  }
  return { bones, J };
}

// ------------------------------------------------------------------ geometry builders
interface Ring {
  c: THREE.Vector3; // centre
  rx: number; // half-width
  rz: number; // half-depth
  zf?: number; // extra forward bulge (front half only)
  b: [HBone, HBone, number]; // bone a, bone b, weight of b
}

class Part {
  pos: number[] = []; uv: number[] = []; si: number[] = []; sw: number[] = []; idx: number[] = [];
  vert(p: THREE.Vector3, u: number, v: number, b0: number, b1: number, w1: number) {
    this.pos.push(p.x, p.y, p.z); this.uv.push(u, v); this.si.push(b0, b1, 0, 0); this.sw.push(1 - w1, w1, 0, 0);
    return this.pos.length / 3 - 1;
  }
  geo(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

/** vertical loft: rings lie in the XZ plane. arc limits the sweep (for open panels like aprons). */
function loftY(rings: Ring[], seg = 20, opts: { capStart?: boolean; capEnd?: boolean; arc?: [number, number]; squareness?: number } = {}): Part {
  const P = new Part();
  const [a0, a1] = opts.arc ?? [0, Math.PI * 2];
  const closed = !opts.arc;
  const cols = closed ? seg : seg + 1;
  const sq = opts.squareness ?? 0;
  rings.forEach((r, i) => {
    for (let j = 0; j < cols; j++) {
      const a = a0 + ((a1 - a0) * j) / seg;
      let cx = Math.sin(a), cz = Math.cos(a);
      // superellipse blend for broader shoulders/chest
      if (sq) { const k = 1 / Math.pow(Math.pow(Math.abs(cx), 4) + Math.pow(Math.abs(cz), 4), 0.25); cx = cx * (1 - sq) + cx * k * sq; cz = cz * (1 - sq) + cz * k * sq; }
      const fwd = cz > 0 ? (r.zf ?? 0) * cz * cz : 0;
      const p = new THREE.Vector3(r.c.x + cx * r.rx, r.c.y, r.c.z + cz * r.rz + fwd);
      P.vert(p, j / seg, i / (rings.length - 1), BI[r.b[0]], BI[r.b[1]], r.b[2]);
    }
  });
  // winding depends on whether rings run downwards (limbs) or upwards (torso)
  const asc = rings.length > 1 && rings[rings.length - 1].c.y > rings[0].c.y;
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * cols + j, b = i * cols + ((j + 1) % cols), c = (i + 1) * cols + j, d = (i + 1) * cols + ((j + 1) % cols);
    if (!closed && j === seg) continue;
    if (asc) P.idx.push(a, b, c, b, d, c);
    else P.idx.push(a, c, b, b, c, d);
  }
  const cap = (ri: number, flipIn: boolean) => {
    const flip = asc ? !flipIn : flipIn;
    const r = rings[ri];
    const ci = P.vert(r.c, 0.5, ri / (rings.length - 1), BI[r.b[0]], BI[r.b[1]], r.b[2]);
    for (let j = 0; j < seg; j++) {
      const a = ri * cols + j, b = ri * cols + ((j + 1) % cols);
      if (flip) P.idx.push(ci, b, a); else P.idx.push(ci, a, b);
    }
  };
  if (closed && opts.capStart) cap(0, false);
  if (closed && opts.capEnd) cap(rings.length - 1, true);
  return P;
}

/** a limb hanging along a straight segment, sampled with radii and bone blends */
function limb(a: THREE.Vector3, b: THREE.Vector3, samples: [number, number, number, HBone, HBone, number][], seg = 14, caps = { s: false, e: false }): Part {
  // samples: [t, rx, rz, bone0, bone1, w1]; rings are perpendicular to y because limbs hang vertically in rest pose
  const rings: Ring[] = samples.map(([t, rx, rz, b0, b1, w]) => ({ c: a.clone().lerp(b, t), rx, rz, b: [b0, b1, w] }));
  // rings must be ordered top to bottom for consistent winding
  return loftY(rings, seg, { capStart: caps.s, capEnd: caps.e });
}

/** parametric ellipsoid with optional cut-off (for hair caps) and per-vertex deformation */
function ellipsoid(c: THREE.Vector3, rx: number, ry: number, rz: number, bone: HBone, opts: { w?: number; h?: number; keep?: (theta: number, phi: number) => number; deform?: (p: THREE.Vector3, theta: number, phi: number) => void; bone2?: HBone; w2?: (p: THREE.Vector3) => number } = {}): Part {
  const P = new Part();
  const W = opts.w ?? 24, H = opts.h ?? 18;
  const map: number[][] = [];
  for (let i = 0; i <= H; i++) {
    const phi = (i / H) * Math.PI; // 0 = top
    map.push([]);
    for (let j = 0; j <= W; j++) {
      const theta = (j / W) * Math.PI * 2; // 0 = front (+z)
      const limit = opts.keep ? opts.keep(theta, phi) : Math.PI;
      const ph = Math.min(phi, limit);
      const p = new THREE.Vector3(Math.sin(ph) * Math.sin(theta) * rx, Math.cos(ph) * ry, Math.sin(ph) * Math.cos(theta) * rz);
      opts.deform?.(p, theta, ph);
      p.add(c);
      const w1 = opts.bone2 && opts.w2 ? opts.w2(p) : 0;
      map[i].push(P.vert(p, j / W, i / H, BI[bone], BI[opts.bone2 ?? bone], w1));
    }
  }
  for (let i = 0; i < H; i++) for (let j = 0; j < W; j++) {
    const a = map[i][j], b = map[i][j + 1], cc = map[i + 1][j], d = map[i + 1][j + 1];
    P.idx.push(a, cc, b, b, cc, d);
  }
  return P;
}

/** foot / shoe: loft along +z with rings in the XY plane */
function footShape(heel: THREE.Vector3, len: number, w: number, h: number, bone: HBone, inflate = 0): Part {
  const P = new Part();
  const seg = 14;
  const prof: [number, number, number][] = [[0, 0.75, 0.75], [0.12, 0.95, 1], [0.4, 1, 0.9], [0.7, 1.05, 0.6], [0.9, 0.85, 0.45], [1, 0.4, 0.25]];
  const cols = seg;
  prof.forEach(([t, sw, shh]) => {
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const x = Math.sin(a) * (w * sw + inflate);
      const yy = Math.cos(a) * (h * shh + inflate) * 0.5;
      const p = new THREE.Vector3(heel.x + x, heel.y + Math.max(yy, -h * 0.5 - inflate) + h * 0.5 * shh - 0.002, heel.z + t * len);
      P.vert(p, j / seg, t, BI[bone], BI[bone], 0);
    }
  });
  for (let i = 0; i < prof.length - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * cols + j, b = i * cols + ((j + 1) % cols), c = (i + 1) * cols + j, d = (i + 1) * cols + ((j + 1) % cols);
    P.idx.push(a, b, c, b, d, c);
  }
  // caps
  const capAt = (i: number, flip: boolean) => {
    const ctr = new THREE.Vector3(0, 0, 0);
    for (let j = 0; j < seg; j++) ctr.add(new THREE.Vector3(P.pos[(i * cols + j) * 3], P.pos[(i * cols + j) * 3 + 1], P.pos[(i * cols + j) * 3 + 2]));
    ctr.multiplyScalar(1 / seg);
    const ci = P.vert(ctr, 0.5, i / (prof.length - 1), BI[bone], BI[bone], 0);
    for (let j = 0; j < seg; j++) { const a = i * cols + j, b = i * cols + ((j + 1) % cols); if (flip) P.idx.push(ci, a, b); else P.idx.push(ci, b, a); }
  };
  capAt(0, false);
  capAt(prof.length - 1, true);
  return P;
}

// ------------------------------------------------------------------ textures
const texCache = new Map<string, THREE.Texture>();
function fabricTex(base: string, kind: 'knit' | 'denim' | 'twill' | 'hivis' | 'apron' | 'polo' | 'suit' | 'shirt', accent = '#ffffff'): THREE.Texture {
  const key = `${base}|${kind}|${accent}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  c.fillStyle = base;
  c.fillRect(0, 0, S, S);
  // weave noise
  const img = c.getImageData(0, 0, S, S);
  let seed = 1337;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    let n = (rnd() - 0.5) * 18;
    if (kind === 'denim') n += ((x + y) % 4 < 2 ? 10 : -6);
    if (kind === 'twill' || kind === 'suit') n += ((x + 2 * y) % 6 < 3 ? 5 : -3);
    if (kind === 'knit') n += (x % 3 === 0 ? -6 : 2);
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n * (kind === 'denim' ? 1.4 : 1)));
  }
  c.putImageData(img, 0, 0);
  if (kind === 'denim') { c.strokeStyle = 'rgba(214,170,90,.55)'; c.lineWidth = 2; c.beginPath(); c.moveTo(0.12 * S, 0); c.lineTo(0.12 * S, S); c.moveTo(0.62 * S, 0); c.lineTo(0.62 * S, S); c.stroke(); }
  if (kind === 'hivis') { c.fillStyle = '#d9dde0'; c.fillRect(0, S * 0.55, S, S * 0.07); c.fillRect(0, S * 0.75, S, S * 0.07); c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(S * 0.49, 0, S * 0.02, S); }
  if (kind === 'polo') { c.fillStyle = accent; c.fillRect(S * 0.05, S * 0.62, S * 0.07, S * 0.05); c.fillStyle = 'rgba(255,255,255,.85)'; c.fillRect(S * 0.03, S * 0.6, S * 0.11, S * 0.008); }
  if (kind === 'shirt') { c.fillStyle = 'rgba(0,0,0,.25)'; for (let i = 0; i < 5; i++) c.fillRect(S * 0.495, S * (0.2 + i * 0.15), S * 0.012, S * 0.012); }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  texCache.set(key, t);
  return t;
}

const matCache = new Map<string, THREE.Material>();
function material(key: string, make: () => THREE.Material) {
  let m = matCache.get(key);
  if (!m) { m = make(); matCache.set(key, m); }
  return m;
}

// ------------------------------------------------------------------ outfits
export interface Garment {
  top: { color: string; tex: Parameters<typeof fabricTex>[1]; sleeve: 'short' | 'long'; collar?: string; hem: number; accent?: string };
  bottom: { color: string; tex: Parameters<typeof fabricTex>[1]; length: 'long' | 'shorts' };
  shoes: string;
  over?: { kind: 'apron' | 'vest' | 'blazer'; color: string; accent?: string };
  tie?: string;
}

export const GARMENTS: Record<string, Garment> = {
  outfit_casual: { top: { color: '#3f6ea8', tex: 'knit', sleeve: 'short', hem: 0.97 }, bottom: { color: '#2d4366', tex: 'denim', length: 'long' }, shoes: '#ececec' },
  outfit_smart: { top: { color: '#f1efe9', tex: 'shirt', sleeve: 'long', collar: '#f1efe9', hem: 0.95 }, bottom: { color: '#2b2f38', tex: 'suit', length: 'long' }, shoes: '#2a1a12', over: { kind: 'blazer', color: '#2b2f38' }, tie: '#7a2b2b' },
  uniform_market: { top: { color: '#2e8b57', tex: 'polo', sleeve: 'short', collar: '#256f46', hem: 0.97, accent: '#ffffff' }, bottom: { color: '#24272b', tex: 'twill', length: 'long' }, shoes: '#18181a', over: { kind: 'apron', color: '#1d5c3a', accent: '#e9f2ec' } },
  uniform_site: { top: { color: '#5b5f63', tex: 'twill', sleeve: 'long', hem: 0.97 }, bottom: { color: '#3b3f2e', tex: 'twill', length: 'long' }, shoes: '#4a3520', over: { kind: 'vest', color: '#ff8c1a' } },
  uniform_wholesale: { top: { color: '#3a4652', tex: 'twill', sleeve: 'long', hem: 0.97 }, bottom: { color: '#2b3440', tex: 'twill', length: 'long' }, shoes: '#4a3520', over: { kind: 'vest', color: '#f2d000' } },
  uniform_cafe: { top: { color: '#f3f0ea', tex: 'shirt', sleeve: 'short', collar: '#f3f0ea', hem: 0.96 }, bottom: { color: '#222', tex: 'twill', length: 'long' }, shoes: '#181818', over: { kind: 'apron', color: '#7b2d26' } },
};

export interface HumanParams extends Appearance {
  frame?: 'm' | 'f';
}

/** Build all skinned meshes for an appearance on an existing skeleton. */
export function buildHumanMeshes(a: HumanParams, skeleton: THREE.Skeleton): THREE.SkinnedMesh[] {
  const frame = a.frame ?? 'm';
  const fem = frame === 'f';
  const bw = { slim: 0.88, average: 1, broad: 1.15 }[a.build];
  const J = jointLayout(frame, bw);
  const g = GARMENTS[a.outfit] ?? GARMENTS.outfit_casual;
  const parts = new Map<string, { parts: Part[]; mat: () => THREE.Material }>();
  const add = (key: string, mat: () => THREE.Material, p: Part) => {
    if (!parts.has(key)) parts.set(key, { parts: [], mat });
    parts.get(key)!.parts.push(p);
  };
  const skinM = () => material(`skin${a.skin}`, () => new THREE.MeshStandardMaterial({ color: a.skin, roughness: 0.62, side: THREE.DoubleSide }));
  const topM = () => material(`top${a.outfit}`, () => new THREE.MeshStandardMaterial({ color: '#ffffff', map: fabricTex(g.top.color, g.top.tex, g.top.accent), roughness: 0.85, side: THREE.DoubleSide }));
  const botM = () => material(`bot${a.outfit}`, () => new THREE.MeshStandardMaterial({ color: '#ffffff', map: fabricTex(g.bottom.color, g.bottom.tex), roughness: 0.9, side: THREE.DoubleSide }));
  const shoeM = () => material(`shoe${g.shoes}`, () => new THREE.MeshStandardMaterial({ color: g.shoes, roughness: 0.45, side: THREE.DoubleSide }));
  const hairM = () => material(`hair${a.hairColor}`, () => new THREE.MeshStandardMaterial({ color: a.hairColor, roughness: 0.75, side: THREE.DoubleSide }));
  const s = bw; // girth multiplier
  const hipW = (fem ? 0.172 : 0.158) * s, waistW = (fem ? 0.122 : 0.142) * s, chestW = (fem ? 0.15 : 0.172) * s, shW = J.armL.x * 0.98;
  const inf = 0.008; // cloth thickness

  // ---------------- torso (top + bottom garments form the surface)
  const torso = (lo: number, hi: number, extra: number): Ring[] => {
    const all: Ring[] = [
      { c: new THREE.Vector3(0, 0.845, -0.005), rx: 0.118 * s, rz: 0.095 * s, b: ['hips', 'hips', 0] },
      { c: new THREE.Vector3(0, 0.9, -0.01), rx: hipW * 0.98, rz: (fem ? 0.112 : 0.1) * s, zf: fem ? 0.0 : 0, b: ['hips', 'hips', 0] },
      { c: new THREE.Vector3(0, 0.97, -0.01), rx: hipW, rz: 0.1 * s, b: ['hips', 'spine', 0.2] },
      { c: new THREE.Vector3(0, 1.05, -0.005), rx: waistW * 1.02, rz: 0.095 * s, b: ['hips', 'spine', 0.6] },
      { c: new THREE.Vector3(0, 1.12, 0), rx: waistW, rz: 0.098 * s, zf: 0.006, b: ['spine', 'spine', 0] },
      { c: new THREE.Vector3(0, 1.2, 0), rx: chestW * 0.95, rz: 0.105 * s, zf: 0.01, b: ['spine', 'chest', 0.5] },
      { c: new THREE.Vector3(0, 1.28, 0), rx: chestW, rz: 0.11 * s, zf: fem ? 0.04 : 0.016, b: ['chest', 'chest', 0] },
      { c: new THREE.Vector3(0, 1.36, -0.008), rx: chestW * 1.03, rz: 0.106 * s, zf: fem ? 0.012 : 0.01, b: ['chest', 'chest', 0] },
      { c: new THREE.Vector3(0, 1.42, -0.014), rx: shW * 0.98, rz: 0.092 * s, b: ['chest', 'chest', 0] },
      { c: new THREE.Vector3(0, 1.455, -0.016), rx: shW * 0.62, rz: 0.075, b: ['chest', 'neck', 0.15] },
      { c: new THREE.Vector3(0, 1.475, -0.012), rx: 0.064, rz: 0.058, b: ['chest', 'neck', 0.4] },
    ];
    return all.filter((r) => r.c.y >= lo - 1e-6 && r.c.y <= hi + 1e-6).map((r) => ({ ...r, rx: r.rx + extra, rz: r.rz + extra }));
  };
  const topRings = torso(0.97, 1.475, inf);
  // flare the hem slightly over the waistband
  topRings.unshift({ ...topRings[0], c: new THREE.Vector3(0, g.top.hem, -0.01), rx: hipW + inf * 2.2, rz: 0.104 * s + inf * 2 });
  add('top', topM, loftY(topRings, 24, { squareness: 0.25 }));
  add('bot', botM, loftY(torso(0.845, 1.05, inf * 0.5), 24, { capStart: true }));

  // ---------------- legs
  for (const side of ['L', 'R'] as const) {
    const th = J[`thigh${side}`], sk = J[`shin${side}`], ft = J[`foot${side}`];
    const top = th.clone().add(new THREE.Vector3(0, 0.03, 0));
    const T = `thigh${side}` as HBone, S = `shin${side}` as HBone, F = `foot${side}` as HBone;
    const legR = (fem ? 0.088 : 0.082) * s;
    const long = g.bottom.length === 'long';
    const samples: [number, number, number, HBone, HBone, number][] = [
      [0, legR, legR * 1.02, 'hips', T, 0.6], [0.12, legR * 0.98, legR, T, T, 0], [0.5, legR * 0.82, legR * 0.85, T, T, 0],
      [0.88, 0.058 * s, 0.06 * s, T, S, 0.3], [1.0, 0.054 * s, 0.056 * s, T, S, 0.5],
    ];
    const legTop = top, knee = sk;
    const pants = limb(legTop, knee, samples.map(([t, rx, rz, b0, b1, w]) => [t, rx + inf, rz + inf, b0, b1, w]), 16);
    add('bot', botM, pants);
    const shinS: [number, number, number, HBone, HBone, number][] = [[0, 0.054 * s, 0.056 * s, T, S, 0.6], [0.08, 0.056 * s, 0.06 * s, S, S, 0], [0.35, 0.056 * s, 0.062 * s, S, S, 0], [0.8, 0.04 * s, 0.042 * s, S, S, 0], [1, 0.036, 0.038, S, F, 0.4]];
    if (long) add('bot', botM, limb(knee, ft.clone().add(new THREE.Vector3(0, 0.02, 0)), shinS.map(([t, rx, rz, b0, b1, w]) => [t, rx + inf * 1.5, rz + inf * 1.5, b0, b1, w]), 16));
    else add('skin', skinM, limb(knee, ft, shinS, 14));
    add('shoe', shoeM, footShape(new THREE.Vector3(ft.x, 0.0, ft.z - 0.07), 0.27, 0.047, 0.085, F, 0.004));
  }

  // ---------------- arms
  for (const side of ['L', 'R'] as const) {
    const A = `arm${side}` as HBone, Fo = `fore${side}` as HBone, H = `hand${side}` as HBone;
    const sh = J[A].clone().add(new THREE.Vector3(side === 'L' ? -0.02 : 0.02, 0.035, 0));
    const el = J[Fo], wr = J[H];
    const ar = (fem ? 0.043 : 0.05) * s;
    const upper: [number, number, number, HBone, HBone, number][] = [[0, ar * 0.98, ar * 1.05, 'chest', A, 0.55], [0.15, ar * 1.04, ar * 1.02, A, A, 0], [0.5, ar, ar * 0.98, A, A, 0], [0.9, ar * 0.82, ar * 0.85, A, Fo, 0.25], [1, ar * 0.8, ar * 0.82, A, Fo, 0.5]];
    const lower: [number, number, number, HBone, HBone, number][] = [[0, ar * 0.8, ar * 0.82, A, Fo, 0.6], [0.1, ar * 0.84, ar * 0.84, Fo, Fo, 0], [0.4, ar * 0.8, ar * 0.76, Fo, Fo, 0], [0.92, ar * 0.6, ar * 0.5, Fo, H, 0.2], [1, ar * 0.58, ar * 0.46, Fo, H, 0.5]];
    if (g.top.sleeve === 'short') {
      const cut = 0.45;
      const sleeve = upper.filter((x) => x[0] <= cut).concat([[cut, ar * 0.97, ar * 0.96, A, A, 0]]);
      add('top', topM, limb(sh, el, sleeve.map(([t, rx, rz, b0, b1, w]) => [t, rx + inf, rz + inf, b0, b1, w]), 16));
      add('skin', skinM, limb(sh, el, [[cut - 0.05, ar * 0.97, ar * 0.96, A, A, 0], ...upper.filter((x) => x[0] > cut)], 14));
      add('skin', skinM, limb(el, wr, lower, 14));
    } else {
      const blazer = g.over?.kind === 'blazer';
      const sleeveKey = blazer ? 'over' : 'top';
      const sleeveM = blazer ? () => material(`over${a.outfit}`, () => new THREE.MeshStandardMaterial({ color: '#ffffff', map: fabricTex(g.over!.color, 'suit'), roughness: 0.85, side: THREE.DoubleSide })) : topM;
      add(sleeveKey, sleeveM, limb(sh, el, upper.map(([t, rx, rz, b0, b1, w]) => [t, rx + inf * 1.4, rz + inf * 1.4, b0, b1, w]), 16));
      add(sleeveKey, sleeveM, limb(el, wr.clone().add(new THREE.Vector3(0, 0.02, 0)), lower.slice(0, 4).map(([t, rx, rz, b0, b1, w]) => [t, rx + inf * 1.6, rz + inf * 1.6, b0, b1, w]), 16, { s: false, e: false }));
      add('skin', skinM, limb(el.clone().lerp(wr, 0.8), wr, [[0, ar * 0.6, ar * 0.5, Fo, Fo, 0], [1, ar * 0.58, ar * 0.46, Fo, H, 0.5]], 12));
    }
    // hand: palm + fingers + thumb
    const hx = wr.x, sgn = side === 'L' ? 1 : -1;
    add('skin', skinM, limb(wr, wr.clone().add(new THREE.Vector3(0, -0.085, 0.005)), [[0, 0.025, 0.017, H, H, 0], [0.5, 0.039, 0.016, H, H, 0], [1, 0.037, 0.014, H, H, 0]], 12, { s: false, e: true }));
    for (let f = 0; f < 4; f++) {
      const fx = hx + sgn * (-0.025 + f * 0.016);
      const len = [0.068, 0.078, 0.074, 0.06][f];
      const base = new THREE.Vector3(fx, wr.y - 0.08, wr.z + 0.006);
      add('skin', skinM, limb(base, base.clone().add(new THREE.Vector3(0, -len, 0.012)), [[0, 0.0085, 0.009, H, H, 0], [0.6, 0.008, 0.0085, H, H, 0], [1, 0.006, 0.0065, H, H, 0]], 8, { s: false, e: true }));
    }
    const tb = new THREE.Vector3(hx + sgn * -0.035, wr.y - 0.03, wr.z + 0.018);
    add('skin', skinM, limb(tb, tb.clone().add(new THREE.Vector3(sgn * -0.012, -0.055, 0.02)), [[0, 0.011, 0.011, H, H, 0], [1, 0.0075, 0.0075, H, H, 0]], 8, { s: false, e: true }));
  }

  // ---------------- neck & head
  add('skin', skinM, loftY(([
    { c: new THREE.Vector3(0, 1.445, -0.014), rx: 0.054, rz: 0.054, b: ['chest', 'neck', 0.5] },
    { c: new THREE.Vector3(0, 1.52, -0.004), rx: 0.05, rz: 0.052, b: ['neck', 'neck', 0] },
    { c: new THREE.Vector3(0, 1.585, 0.0), rx: 0.05, rz: 0.054, b: ['neck', 'head', 0.8] },
  ] as Ring[]).reverse(), 16));
  const hc = new THREE.Vector3(0, 1.645, 0.012);
  const hr = { x: fem ? 0.088 : 0.092, y: 0.118, z: 0.104 };
  add('skin', skinM, ellipsoid(hc, hr.x, hr.y, hr.z, 'head', {
    w: 32, h: 24,
    deform: (p, theta, phi) => {
      const below = Math.cos(phi); // 1 top, -1 bottom
      if (below < 0) {
        // jaw: narrower and slightly forward towards the chin
        const k = -below;
        p.x *= 1 - k * (fem ? 0.38 : 0.3);
        p.z = p.z * (1 - k * 0.15) + (Math.cos(theta) > 0 ? k * 0.012 : -k * 0.01);
        p.y *= 1 + k * 0.05;
      }
      // flatten the face front and the sides a touch
      if (Math.cos(theta) > 0.6 && below > -0.4 && below < 0.5) p.z -= 0.006 * Math.cos(theta);
    },
  }));
  // nose
  add('skin', skinM, loftY([
    { c: new THREE.Vector3(0, 1.672, hc.z + 0.099), rx: 0.008, rz: 0.006, b: ['head', 'head', 0] },
    { c: new THREE.Vector3(0, 1.645, hc.z + 0.108), rx: 0.011, rz: 0.012, b: ['head', 'head', 0] },
    { c: new THREE.Vector3(0, 1.622, hc.z + 0.11), rx: 0.016, rz: 0.014, b: ['head', 'head', 0] },
    { c: new THREE.Vector3(0, 1.612, hc.z + 0.1), rx: 0.013, rz: 0.008, b: ['head', 'head', 0] },
  ], 10, { capStart: true, capEnd: true }));
  // ears
  for (const sx of [1, -1]) add('skin', skinM, ellipsoid(new THREE.Vector3(sx * (hr.x + 0.004), 1.648, hc.z - 0.008), 0.012, 0.03, 0.02, 'head', { w: 10, h: 8 }));
  // eyes, irises, brows, lips
  const eyeM = () => material('eyeW', () => new THREE.MeshStandardMaterial({ color: '#f4f2ee', roughness: 0.3 }));
  const irisM = () => material(`iris${a.hairColor}`, () => new THREE.MeshStandardMaterial({ color: '#2b2116', roughness: 0.2 }));
  const lipM = () => material(`lip${a.skin}`, () => new THREE.MeshStandardMaterial({ color: new THREE.Color(a.skin).lerp(new THREE.Color('#8a3a3a'), fem ? 0.45 : 0.3), roughness: 0.5 }));
  for (const sx of [1, -1]) {
    const ep = new THREE.Vector3(sx * 0.032, 1.666, hc.z + 0.086);
    add('eye', eyeM, ellipsoid(ep, 0.0135, 0.0105, 0.009, 'head', { w: 12, h: 8 }));
    add('iris', irisM, ellipsoid(ep.clone().add(new THREE.Vector3(0, 0, 0.0075)), 0.0065, 0.0065, 0.003, 'head', { w: 10, h: 6 }));
    add('hair', hairM, ellipsoid(new THREE.Vector3(sx * 0.033, 1.688, hc.z + 0.09), 0.019, 0.0042, 0.006, 'head', { w: 10, h: 6, deform: (q) => { q.y += -0.004 * (q.x * sx) / 0.019; } }));
  }
  add('lip', lipM, ellipsoid(new THREE.Vector3(0, 1.597, hc.z + 0.093), 0.022, 0.0065, 0.01, 'head', { w: 14, h: 8 }));

  // ---------------- hair
  const hairCap = (frontLimit: number, backLimit: number, scale = 1.055, noise = 0) => ellipsoid(hc.clone().add(new THREE.Vector3(0, 0.006, -0.004)), hr.x * scale, hr.y * scale * 0.98, hr.z * scale, 'head', {
    w: 32, h: 20,
    keep: (theta) => { const front = (Math.cos(theta) + 1) / 2; return backLimit + (frontLimit - backLimit) * Math.pow(front, 1.6); },
    deform: noise ? (p, theta, phi) => { const n = 1 + noise * Math.sin(theta * 9) * Math.sin(phi * 8); p.x *= n; p.y *= n; p.z *= n; } : undefined,
  });
  switch (a.hair) {
    case 'short': add('hair', hairM, hairCap(0.78, 1.72)); break;
    case 'curly': add('hair', hairM, hairCap(0.8, 1.75, 1.12, 0.05)); break;
    case 'bun':
      add('hair', hairM, hairCap(0.82, 1.8));
      add('hair', hairM, ellipsoid(new THREE.Vector3(0, 1.74, hc.z - 0.1), 0.045, 0.04, 0.045, 'head'));
      break;
    case 'long': {
      add('hair', hairM, hairCap(0.85, 1.9, 1.07));
      // hair falling down the back to the shoulders, open at the face
      add('hair', hairM, loftY([
        { c: new THREE.Vector3(0, 1.66, hc.z - 0.012), rx: hr.x * 1.08, rz: hr.z * 1.05, b: ['head', 'head', 0] },
        { c: new THREE.Vector3(0, 1.56, hc.z - 0.03), rx: hr.x * 1.06, rz: hr.z * 0.9, b: ['head', 'head', 0] },
        { c: new THREE.Vector3(0, 1.45, hc.z - 0.055), rx: hr.x * 1.15, rz: hr.z * 0.6, b: ['head', 'neck', 0.4] },
        { c: new THREE.Vector3(0, 1.38, hc.z - 0.08), rx: hr.x * 1.2, rz: hr.z * 0.35, b: ['neck', 'chest', 0.6] },
      ], 20, { arc: [Math.PI * 0.62, Math.PI * 1.38] }));
      break;
    }
    case 'bald': break;
  }

  // ---------------- garment details
  if (g.top.collar) {
    const colM = () => material(`col${g.top.collar}`, () => new THREE.MeshStandardMaterial({ color: g.top.collar!, roughness: 0.8, side: THREE.DoubleSide }));
    add('collar', colM, loftY([
      { c: new THREE.Vector3(0, 1.475, -0.012), rx: 0.074, rz: 0.068, b: ['chest', 'neck', 0.3] },
      { c: new THREE.Vector3(0, 1.505, -0.01), rx: 0.068, rz: 0.064, b: ['chest', 'neck', 0.6] },
    ], 18, { arc: [Math.PI * 0.12, Math.PI * 1.88] }));
  }
  if (g.tie) {
    const tieM = () => material(`tie${g.tie}`, () => new THREE.MeshStandardMaterial({ color: g.tie!, roughness: 0.5 }));
    add('tie', tieM, loftY([
      { c: new THREE.Vector3(0, 1.46, 0.07), rx: 0.016, rz: 0.006, b: ['chest', 'chest', 0] },
      { c: new THREE.Vector3(0, 1.3, 0.122 + (fem ? 0.03 : 0.01)), rx: 0.03, rz: 0.006, b: ['chest', 'chest', 0] },
      { c: new THREE.Vector3(0, 1.12, 0.112), rx: 0.034, rz: 0.006, b: ['spine', 'spine', 0] },
    ], 8, { capEnd: true }));
  }
  if (g.over) {
    const o = g.over;
    const overM = () => material(`over${a.outfit}`, () => new THREE.MeshStandardMaterial({ color: '#ffffff', map: fabricTex(o.color, o.kind === 'vest' ? 'hivis' : o.kind === 'blazer' ? 'suit' : 'twill', o.accent), roughness: o.kind === 'vest' ? 0.55 : 0.85, side: THREE.DoubleSide }));
    if (o.kind === 'apron') {
      const front = torso(0.97, 1.4, inf * 2.6).map((r) => ({ ...r }));
      front.unshift({ c: new THREE.Vector3(0, 0.72, 0.0), rx: hipW + 0.03, rz: 0.13 * s, b: ['hips', 'hips', 0] }, { c: new THREE.Vector3(0, 0.85, -0.005), rx: hipW + 0.02, rz: 0.115 * s, b: ['hips', 'hips', 0] });
      add('over', overM, loftY(front, 18, { arc: [-Math.PI * 0.32, Math.PI * 0.32] }));
    } else if (o.kind === 'vest') {
      add('over', overM, loftY(torso(0.97, 1.42, inf * 3), 24, { squareness: 0.25 }));
    } else if (o.kind === 'blazer') {
      const body = torso(0.97, 1.455, inf * 3);
      body.unshift({ c: new THREE.Vector3(0, 0.86, -0.01), rx: hipW + 0.03, rz: 0.115 * s, b: ['hips', 'hips', 0] });
      add('over', overM, loftY(body.map((r) => ({ ...r, rx: r.rx - 0.004, rz: r.rz - 0.004 })), 24, { arc: [Math.PI * 0.1, Math.PI * 1.9], squareness: 0.12 }));
    }
  }

  // ---------------- build meshes (one per material)
  const out: THREE.SkinnedMesh[] = [];
  for (const [, v] of parts) {
    const geo = mergeGeometries(v.parts.map((p) => p.geo()), false)!;
    geo.computeBoundingSphere();
    const m = new THREE.SkinnedMesh(geo, v.mat());
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.bind(skeleton, new THREE.Matrix4());
    out.push(m);
  }
  return out;
}
