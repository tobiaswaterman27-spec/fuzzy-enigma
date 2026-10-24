// Draws the city round Harbourside. Buildings are boxes wrapped in facade textures (a storey and a bay
// of windows per tile, with lit windows on an emissive map for the night), merged per 260 m chunk and
// per material so the whole city is a few hundred draw calls; chunks far from the camera are hidden.
// Trees, lamps and street furniture are instanced. Roads get kerbs, centre lines and zebra crossings.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { City, CityBuilding, CityProp, Ground, Style } from '../sim/world/city';
import { AVENUES, CITY, ESPLANADE_Z, STREETS } from '../sim/world/city';
import { tex, signTexture } from './textures';
import { wettable } from './wet';
import { lampFor } from './signals';
import { boat } from './harbour';

const CHUNK = 520;
const VIEW = 820;

// ---------------------------------------------------------------- facade textures
interface Facade { wall: string; win: string; frame: string; kind: 'sash' | 'ribbon' | 'curtain' | 'shed' | 'tall' | 'balcony' | 'arch'; bay: number; storey: number; brick?: boolean }
const FACADES: Record<Style, Facade> = {
  brick: { wall: '#9c5a44', win: '#2a3540', frame: '#efe9dd', kind: 'sash', bay: 3.2, storey: 3.2, brick: true },
  brick_dark: { wall: '#6e3d2e', win: '#262f38', frame: '#d9d2c4', kind: 'sash', bay: 3.2, storey: 3.2, brick: true },
  terrace: { wall: '#a8634a', win: '#29343f', frame: '#f4efe6', kind: 'sash', bay: 2.8, storey: 3.0, brick: true },
  render: { wall: '#e4dccb', win: '#2c3742', frame: '#ffffff', kind: 'sash', bay: 3.2, storey: 3.2 },
  shop: { wall: '#d9cfbd', win: '#2b3a46', frame: '#3b4a56', kind: 'ribbon', bay: 3.6, storey: 3.4 },
  office: { wall: '#b9bcbe', win: '#3a5566', frame: '#8e9396', kind: 'ribbon', bay: 3.6, storey: 3.6 },
  glass: { wall: '#41606f', win: '#5d8aa0', frame: '#a9b6bd', kind: 'curtain', bay: 1.6, storey: 3.6 },
  tower: { wall: '#25323c', win: '#3f6476', frame: '#7c8a93', kind: 'curtain', bay: 1.8, storey: 3.6 },
  flats: { wall: '#cfc9bd', win: '#2d3944', frame: '#e9e5dc', kind: 'balcony', bay: 3.6, storey: 3.0 },
  warehouse: { wall: '#8f989e', win: '#33424c', frame: '#6c757b', kind: 'shed', bay: 6, storey: 6 },
  house: { wall: '#e9e1d1', win: '#2a3440', frame: '#ffffff', kind: 'sash', bay: 3.0, storey: 2.9 },
  civic: { wall: '#d8d0bf', win: '#2b3540', frame: '#bfb6a3', kind: 'tall', bay: 4, storey: 4.8 },
  hospital: { wall: '#eef0f1', win: '#3b5a6b', frame: '#2f6fb0', kind: 'ribbon', bay: 3.6, storey: 3.6 },
  station: { wall: '#9c5a44', win: '#33414c', frame: '#e7dcc6', kind: 'arch', bay: 5, storey: 8, brick: true },
  stadium: { wall: '#c4c7ca', win: '#5b6670', frame: '#e6e8ea', kind: 'shed', bay: 4, storey: 5 },
  church: { wall: '#b8ae9a', win: '#3a4a5a', frame: '#8f866f', kind: 'arch', bay: 4, storey: 7 },
  mall: { wall: '#dadcdd', win: '#4c7183', frame: '#9aa1a6', kind: 'curtain', bay: 2.4, storey: 4.5 },
  school: { wall: '#a8634a', win: '#2f4250', frame: '#f1ede4', kind: 'ribbon', bay: 3.4, storey: 3.4, brick: true },
  kiosk: { wall: '#2e7d4f', win: '#2a3440', frame: '#f2f2f2', kind: 'ribbon', bay: 3, storey: 3 },
};

function facadeTextures(style: Style): { map: THREE.CanvasTexture; glow: THREE.CanvasTexture; tileU: number; tileV: number } {
  const f = FACADES[style];
  const bays = 4, floors = 4, S = 512;
  const bw = S / bays, fh = S / floors;
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return c; };
  const cv = mk(), g = cv.getContext('2d')!;
  const gl = mk(), e = gl.getContext('2d')!;
  let seed = style.length * 977;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  g.fillStyle = f.wall; g.fillRect(0, 0, S, S);
  e.fillStyle = '#000'; e.fillRect(0, 0, S, S);
  if (f.brick) {
    // courses of brick
    for (let y = 0; y < S; y += 6) for (let x = (y / 6) % 2 ? -7 : 0; x < S; x += 14) { const k = 0.85 + rnd() * 0.25; g.fillStyle = shade(f.wall, k); g.fillRect(x + 0.5, y + 0.5, 13, 5); }
  } else for (let i = 0; i < 2500; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)'; g.fillRect(rnd() * S, rnd() * S, 2, 2); }
  for (let fy = 0; fy < floors; fy++) for (let bx = 0; bx < bays; bx++) {
    const x0 = bx * bw, y0 = fy * fh;
    const lit = rnd() < 0.42;
    const warm = rnd() < 0.7 ? '#ffd9a0' : '#cfe3ff';
    const win = (x: number, y: number, w: number, h: number) => {
      g.fillStyle = f.frame; g.fillRect(x - 3, y - 3, w + 6, h + 6);
      const grd = g.createLinearGradient(x, y, x + w, y + h); grd.addColorStop(0, shade(f.win, 1.25)); grd.addColorStop(1, shade(f.win, 0.8));
      g.fillStyle = grd; g.fillRect(x, y, w, h);
      if (lit) { e.fillStyle = warm; e.fillRect(x, y, w, h); e.fillStyle = 'rgba(0,0,0,0.35)'; e.fillRect(x, y + h * 0.6, w, h * 0.4); }
    };
    if (f.kind === 'sash') {
      const w = bw * 0.42, h = fh * 0.5; win(x0 + (bw - w) / 2, y0 + fh * 0.22, w, h);
      g.fillStyle = f.frame; g.fillRect(x0 + bw / 2 - 1.5, y0 + fh * 0.22, 3, h); g.fillRect(x0 + (bw - w) / 2, y0 + fh * 0.22 + h / 2 - 1.5, w, 3);
      g.fillStyle = shade(f.wall, 0.75); g.fillRect(x0 + (bw - w) / 2 - 6, y0 + fh * 0.22 + h + 3, w + 12, 5);
    } else if (f.kind === 'ribbon') {
      win(x0 + 4, y0 + fh * 0.28, bw - 8, fh * 0.46);
      g.fillStyle = f.frame; g.fillRect(x0 + bw / 2 - 2, y0 + fh * 0.28, 4, fh * 0.46);
    } else if (f.kind === 'curtain') {
      win(x0 + 3, y0 + 4, bw - 6, fh - 8);
      g.fillStyle = f.frame; g.fillRect(x0, y0, bw, 3); g.fillRect(x0, y0, 3, fh);
    } else if (f.kind === 'tall') {
      win(x0 + bw * 0.3, y0 + fh * 0.15, bw * 0.4, fh * 0.68);
    } else if (f.kind === 'arch') {
      const w = bw * 0.46, h = fh * 0.62, x = x0 + (bw - w) / 2, y = y0 + fh * 0.2;
      g.fillStyle = f.frame; g.beginPath(); g.arc(x + w / 2, y + w / 2, w / 2 + 4, Math.PI, 0); g.lineTo(x + w + 4, y + h + 4); g.lineTo(x - 4, y + h + 4); g.fill();
      g.fillStyle = f.win; g.beginPath(); g.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0); g.lineTo(x + w, y + h); g.lineTo(x, y + h); g.fill();
      if (lit) { e.fillStyle = warm; e.fillRect(x, y + w / 2, w, h - w / 2); }
    } else if (f.kind === 'balcony') {
      win(x0 + bw * 0.15, y0 + fh * 0.18, bw * 0.4, fh * 0.62);
      win(x0 + bw * 0.62, y0 + fh * 0.3, bw * 0.26, fh * 0.34);
      g.fillStyle = 'rgba(200,215,225,0.55)'; g.fillRect(x0 + bw * 0.08, y0 + fh * 0.55, bw * 0.54, fh * 0.28);
      g.fillStyle = '#5a6168'; g.fillRect(x0 + bw * 0.08, y0 + fh * 0.55, bw * 0.54, 3); g.fillRect(x0 + bw * 0.06, y0 + fh * 0.83, bw * 0.58, 6);
    } else if (f.kind === 'shed') {
      for (let x = x0; x < x0 + bw; x += 8) { g.fillStyle = shade(f.wall, 0.82); g.fillRect(x, y0, 2, fh); }
      if (fy % 2 === 0) win(x0 + bw * 0.1, y0 + fh * 0.12, bw * 0.8, fh * 0.12);
    }
    // a band between storeys
    g.fillStyle = shade(f.wall, 0.86); g.fillRect(x0, y0 + fh - 4, bw, 4);
  }
  const map = new THREE.CanvasTexture(cv), glow = new THREE.CanvasTexture(gl);
  for (const t of [map, glow]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; }
  map.colorSpace = THREE.SRGBColorSpace; glow.colorSpace = THREE.SRGBColorSpace;
  return { map, glow, tileU: f.bay * bays, tileV: f.storey * floors };
}

function shade(hex: string, k: number) {
  const c = new THREE.Color(hex);
  c.r = Math.min(1, c.r * k); c.g = Math.min(1, c.g * k); c.b = Math.min(1, c.b * k);
  return `#${c.getHexString()}`;
}

const TINTS = ['#ffffff', '#f2ece6', '#e8eef2', '#f5efe0', '#e6e6e6', '#f6e7e0', '#e3ebe4', '#efe6f0'];

// ---------------------------------------------------------------- geometry
class Builder {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; col: number[] = [];
  quad(a: number[], b: number[], c: number[], d: number[], n: number[], uvs: number[][], color: THREE.Color) {
    const base = this.pos.length / 3;
    for (const [p, t] of [[a, uvs[0]], [b, uvs[1]], [c, uvs[2]], [d, uvs[3]]] as const) { this.pos.push(...p); this.nor.push(...n); this.uv.push(...t); this.col.push(color.r, color.g, color.b); }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  idx: number[] = [];
  tri(a: number[], b: number[], c: number[], n: number[], uvs: number[][], color: THREE.Color) {
    const base = this.pos.length / 3;
    for (const [p, t] of [[a, uvs[0]], [b, uvs[1]], [c, uvs[2]]] as const) { this.pos.push(...p); this.nor.push(...n); this.uv.push(...t); this.col.push(color.r, color.g, color.b); }
    this.idx.push(base, base + 1, base + 2);
  }
  geometry(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** the four walls of a box, uv in tiles of the facade (so windows line up storey by storey) */
function walls(b: Builder, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, tu: number, tv: number, color: THREE.Color) {
  const v0 = y0 / tv, v1 = y1 / tv;
  const W = x1 - x0, D = z1 - z0;
  const u = (a: number) => a / tu;
  b.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [[0, v0], [u(W), v0], [u(W), v1], [0, v1]], color);
  b.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [[0, v0], [u(W), v0], [u(W), v1], [0, v1]], color);
  b.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [[0, v0], [u(D), v0], [u(D), v1], [0, v1]], color);
  b.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [[0, v0], [u(D), v0], [u(D), v1], [0, v1]], color);
}
function topFace(b: Builder, x0: number, z0: number, x1: number, z1: number, y: number, color: THREE.Color, tile = 4) {
  b.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], [[x0 / tile, z1 / tile], [x1 / tile, z1 / tile], [x1 / tile, z0 / tile], [x0 / tile, z0 / tile]], color);
}
function solidBox(b: Builder, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, color: THREE.Color, tile = 2) {
  walls(b, x0, z0, x1, z1, y0, y1, tile, tile, color);
  topFace(b, x0, z0, x1, z1, y1, color, tile);
}
/** a pitched roof along the longer side, gables at the ends */
function pitched(b: Builder, gable: Builder, r: { x0: number; z0: number; x1: number; z1: number }, y: number, color: THREE.Color, wallColor: THREE.Color, tu: number, tv: number) {
  const W = r.x1 - r.x0, D = r.z1 - r.z0;
  const h = Math.min(W, D) * 0.38;
  const o = 0.35;
  if (W >= D) {
    const zm = (r.z0 + r.z1) / 2;
    const sl = Math.hypot(D / 2 + o, h) / 2;
    b.quad([r.x0 - o, y - 0.2, r.z1 + o], [r.x1 + o, y - 0.2, r.z1 + o], [r.x1 + o, y + h, zm], [r.x0 - o, y + h, zm], [0, 0.8, 0.6], [[0, 0], [W / 2, 0], [W / 2, sl], [0, sl]], color);
    b.quad([r.x1 + o, y - 0.2, r.z0 - o], [r.x0 - o, y - 0.2, r.z0 - o], [r.x0 - o, y + h, zm], [r.x1 + o, y + h, zm], [0, 0.8, -0.6], [[0, 0], [W / 2, 0], [W / 2, sl], [0, sl]], color);
    gable.tri([r.x0, y, r.z1], [r.x0, y, r.z0], [r.x0, y + h, zm], [-1, 0, 0], [[0, y / tv], [D / tu, y / tv], [D / tu / 2, (y + h) / tv]], wallColor);
    gable.tri([r.x1, y, r.z0], [r.x1, y, r.z1], [r.x1, y + h, zm], [1, 0, 0], [[0, y / tv], [D / tu, y / tv], [D / tu / 2, (y + h) / tv]], wallColor);
  } else {
    const xm = (r.x0 + r.x1) / 2;
    const sl = Math.hypot(W / 2 + o, h) / 2;
    b.quad([r.x1 + o, y - 0.2, r.z1 + o], [r.x1 + o, y - 0.2, r.z0 - o], [xm, y + h, r.z0 - o], [xm, y + h, r.z1 + o], [0.6, 0.8, 0], [[0, 0], [D / 2, 0], [D / 2, sl], [0, sl]], color);
    b.quad([r.x0 - o, y - 0.2, r.z0 - o], [r.x0 - o, y - 0.2, r.z1 + o], [xm, y + h, r.z1 + o], [xm, y + h, r.z0 - o], [-0.6, 0.8, 0], [[0, 0], [D / 2, 0], [D / 2, sl], [0, sl]], color);
    gable.tri([r.x0, y, r.z0], [r.x1, y, r.z0], [xm, y + h, r.z0], [0, 0, -1], [[0, y / tv], [W / tu, y / tv], [W / tu / 2, (y + h) / tv]], wallColor);
    gable.tri([r.x1, y, r.z1], [r.x0, y, r.z1], [xm, y + h, r.z1], [0, 0, 1], [[0, y / tv], [W / tu, y / tv], [W / tu / 2, (y + h) / tv]], wallColor);
  }
}

// ---------------------------------------------------------------- the view
/** opened buildings: the detailed version within this distance (world view), the plain block beyond */
export const VENUE_LOD = 150;

export class CityView {
  group = new THREE.Group();
  private chunks: { g: THREE.Group; cx: number; cz: number }[] = [];
  private lods: { g: THREE.Group; cx: number; cz: number }[] = [];
  private glowMats: THREE.MeshStandardMaterial[] = [];
  private bulbs: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene, city: City) {
    this.bulbs = new THREE.MeshStandardMaterial({ color: '#fff3c4', roughness: 0.4, emissive: new THREE.Color('#ffcf70'), emissiveIntensity: 0 });
    scene.add(this.group);
    const facades = new Map<Style, { mat: THREE.MeshStandardMaterial; tu: number; tv: number }>();
    const facade = (s: Style) => {
      let f = facades.get(s);
      if (!f) {
        const t = facadeTextures(s);
        const glass = s === 'glass' || s === 'tower' || s === 'mall';
        const mat = new THREE.MeshStandardMaterial({ map: t.map, emissiveMap: t.glow, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0, roughness: glass ? 0.25 : 0.85, metalness: glass ? 0.45 : 0, vertexColors: true });
        this.glowMats.push(mat);
        f = { mat, tu: t.tileU, tv: t.tileV };
        facades.set(s, f);
      }
      return f;
    };
    const roofMat = new THREE.MeshStandardMaterial({ map: tex.gravel(), roughness: 0.95, vertexColors: true });
    const tileMat = new THREE.MeshStandardMaterial({ map: tex.roof('#7a4a3a'), roughness: 0.85, vertexColors: true });
    const trimMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, vertexColors: true });
    const groundMats: Record<Ground['kind'], THREE.MeshStandardMaterial> = {
      paving: new THREE.MeshStandardMaterial({ map: tex.paving(), roughness: 0.9 }),
      grass: new THREE.MeshStandardMaterial({ map: tex.grass(), roughness: 1 }),
      garden: new THREE.MeshStandardMaterial({ map: tex.grass(), color: '#9fd18a', roughness: 1 }),
      concrete: new THREE.MeshStandardMaterial({ map: tex.paving(), color: '#b5b5b0', roughness: 0.95 }),
      sand: new THREE.MeshStandardMaterial({ color: '#e3d3a6', roughness: 1 }),
      water: new THREE.MeshStandardMaterial({ color: '#3d6f80', roughness: 0.15, metalness: 0.3 }),
      gravel: new THREE.MeshStandardMaterial({ map: tex.gravel(), color: '#d8cfbf', roughness: 1 }),
      pitch: new THREE.MeshStandardMaterial({ color: '#4f9a45', roughness: 1 }),
      car_park: new THREE.MeshStandardMaterial({ map: tex.asphalt(), color: '#9a9a9a', roughness: 0.95 }),
    };
    for (const m of Object.values(groundMats)) if (m.map) { m.map.wrapS = m.map.wrapT = THREE.RepeatWrapping; }
    const asphalt = wettable(new THREE.MeshStandardMaterial({ map: tex.asphalt(), roughness: 0.95 }));
    wettable(groundMats.paving); wettable(groundMats.concrete);
    asphalt.map!.wrapS = asphalt.map!.wrapT = THREE.RepeatWrapping;
    const pave = groundMats.paving;

    // per chunk, per material
    type Bucket = Map<THREE.Material, Builder>;
    const chunkOf = new Map<string, Bucket>();
    const bucket = (x: number, z: number, m: THREE.Material) => {
      const k = `${Math.floor((x - CITY.x0) / CHUNK)},${Math.floor((z - CITY.z0) / CHUNK)}`;
      let c = chunkOf.get(k);
      if (!c) { c = new Map(); chunkOf.set(k, c); }
      let b = c.get(m);
      if (!b) { b = new Builder(); c.set(m, b); }
      return b;
    };
    const white = new THREE.Color('#ffffff');

    // the land, then the ground of each block
    const land = new THREE.Mesh(new THREE.PlaneGeometry(CITY.x1 - CITY.x0, CITY.z1 - CITY.z0), new THREE.MeshStandardMaterial({ map: tex.grass(), color: '#b9c7a5', roughness: 1 }));
    (land.material as THREE.MeshStandardMaterial).map!.wrapS = (land.material as THREE.MeshStandardMaterial).map!.wrapT = THREE.RepeatWrapping;
    (land.material as THREE.MeshStandardMaterial).map!.repeat.set((CITY.x1 - CITY.x0) / 6, (CITY.z1 - CITY.z0) / 6);
    land.rotation.x = -Math.PI / 2;
    land.position.set((CITY.x0 + CITY.x1) / 2, -0.06, (CITY.z0 + CITY.z1) / 2);
    land.receiveShadow = true;
    this.group.add(land);
    // the sea wall all along the shore (the old quay has its own)
    const wallM = new THREE.MeshStandardMaterial({ map: tex.paving(), color: '#8f8a80', roughness: 0.95 });
    for (const [x0, x1] of [[CITY.x0, -140], [140, CITY.x1]]) { const sw = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 1.4, 1.2), wallM); sw.position.set((x0 + x1) / 2, -0.62, CITY.z1 + 0.5); sw.receiveShadow = true; this.group.add(sw); }
    for (const gr of city.ground) {
      const r = gr.rect, y = gr.kind === 'water' ? 0.02 : gr.kind === 'pitch' || gr.kind === 'gravel' ? 0.025 : 0.015;
      const tile = gr.kind === 'paving' || gr.kind === 'concrete' ? 1.8 : 3;
      topFace(bucket((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, groundMats[gr.kind]), r.x0, r.z0, r.x1, r.z1, y, white, tile);
    }
    // roads and pavements, with kerbs
    for (const rd of city.roads) {
      const r = rd.rect, cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
      if (rd.kind === 'road') topFace(bucket(cx, cz, asphalt), r.x0, r.z0, r.x1, r.z1, 0.03, white, 4);
      else {
        // long strips are split into chunk-sized pieces so culling works
        const along = r.x1 - r.x0 > r.z1 - r.z0;
        const len = along ? r.x1 - r.x0 : r.z1 - r.z0;
        for (let t = 0; t < len; t += CHUNK / 2) {
          const s = Math.min(len, t + CHUNK / 2);
          const pr = along ? { x0: r.x0 + t, x1: r.x0 + s, z0: r.z0, z1: r.z1 } : { x0: r.x0, x1: r.x1, z0: r.z0 + t, z1: r.z0 + s };
          solidBox(bucket((pr.x0 + pr.x1) / 2, (pr.z0 + pr.z1) / 2, pave), pr.x0, pr.z0, pr.x1, pr.z1, -0.03, 0.12, white, 1.8);
        }
      }
    }
    // buildings
    for (const cb of city.buildings) this.building(cb, facade, roofMat, tileMat, trimMat, bucket);
    // the opened ones as plain blocks, each on its own so it can give way to the detailed one close up
    for (const cb of city.opened ?? []) {
      const own = new Map<THREE.Material, Builder>();
      this.building(cb, facade, roofMat, tileMat, trimMat, (_x, _z, m) => { let b = own.get(m); if (!b) { b = new Builder(); own.set(m, b); } return b; });
      const g = new THREE.Group();
      for (const [mat, b] of own) { const geo = b.geometry(); if (!geo) continue; const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false; g.add(m); }
      this.group.add(g);
      this.lods.push({ g, cx: (cb.rect.x0 + cb.rect.x1) / 2, cz: (cb.rect.z0 + cb.rect.z1) / 2 });
    }

    // assemble the chunks
    for (const [k, c] of chunkOf) {
      const [i, j] = k.split(',').map(Number);
      const g = new THREE.Group();
      for (const [mat, b] of c) {
        const geo = b.geometry();
        if (!geo) continue;
        const m = new THREE.Mesh(geo, mat);
        const isGround = Object.values(groundMats).includes(mat as THREE.MeshStandardMaterial) && mat !== pave || mat === asphalt;
        m.castShadow = !isGround; m.receiveShadow = true;
        m.matrixAutoUpdate = false;
        g.add(m);
      }
      this.group.add(g);
      this.chunks.push({ g, cx: CITY.x0 + (i + 0.5) * CHUNK, cz: CITY.z0 + (j + 0.5) * CHUNK });
    }
    // long roads are drawn as one piece per chunk-length too
    this.markings(city);
    this.props(city.props);
    this.signals(city);
    this.signs(city.buildings);
  }

  private building(cb: CityBuilding, facade: (s: Style) => { mat: THREE.MeshStandardMaterial; tu: number; tv: number }, roofMat: THREE.Material, tileMat: THREE.Material, trimMat: THREE.Material, bucket: (x: number, z: number, m: THREE.Material) => Builder) {
    const r = cb.rect, cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    const f = facade(cb.style);
    const tint = new THREE.Color(TINTS[cb.tint % TINTS.length]);
    const wb = bucket(cx, cz, f.mat);
    const h = cb.height;
    if (cb.style === 'tower' && h > 40) {
      // a podium, then the tower stepping back
      walls(wb, r.x0, r.z0, r.x1, r.z1, 0, h * 0.35, f.tu, f.tv, tint);
      const inset = Math.min(r.x1 - r.x0, r.z1 - r.z0) * 0.15;
      walls(wb, r.x0 + inset, r.z0 + inset, r.x1 - inset, r.z1 - inset, h * 0.35, h, f.tu, f.tv, tint);
      topFace(bucket(cx, cz, roofMat), r.x0, r.z0, r.x1, r.z1, h * 0.35, new THREE.Color('#888'));
      topFace(bucket(cx, cz, roofMat), r.x0 + inset, r.z0 + inset, r.x1 - inset, r.z1 - inset, h, new THREE.Color('#777'));
      solidBox(bucket(cx, cz, trimMat), cx - 2, cz - 2, cx + 2, cz + 2, h, h + 6, new THREE.Color('#9aa3a8'));
      return;
    }
    walls(wb, r.x0, r.z0, r.x1, r.z1, 0, h, f.tu, f.tv, tint);
    if (cb.pitched || cb.style === 'church' || cb.style === 'house' || cb.style === 'terrace') {
      const roofCol = new THREE.Color(cb.tint % 3 === 0 ? '#5d6066' : cb.tint % 3 === 1 ? '#8a5040' : '#6e4a3c');
      pitched(bucket(cx, cz, tileMat), wb, r, h, roofCol, tint, f.tu, f.tv);
      topFace(bucket(cx, cz, roofMat), r.x0, r.z0, r.x1, r.z1, h - 0.05, new THREE.Color('#555'));
      if (cb.style === 'house' || cb.style === 'terrace') solidBox(bucket(cx, cz, trimMat), r.x1 - 1.6, cz - 0.4, r.x1 - 0.9, cz + 0.4, h, h + Math.min(r.x1 - r.x0, r.z1 - r.z0) * 0.38 + 0.6, new THREE.Color('#8a5a48'));
      if (cb.style === 'church' && r.x1 - r.x0 < 12) solidBox(bucket(cx, cz, tileMat), cx - 1.2, cz - 1.2, cx + 1.2, cz + 1.2, h, h + 14, new THREE.Color('#4f5358'));
    } else {
      topFace(bucket(cx, cz, roofMat), r.x0, r.z0, r.x1, r.z1, h, new THREE.Color('#9a9a96'));
      // parapet and a plant room on the roof
      const pc = new THREE.Color('#d9d4c9');
      const tb = bucket(cx, cz, trimMat);
      for (const [a, b2, c, d] of [[r.x0, r.z0, r.x1, r.z0 + 0.3], [r.x0, r.z1 - 0.3, r.x1, r.z1], [r.x0, r.z0, r.x0 + 0.3, r.z1], [r.x1 - 0.3, r.z0, r.x1, r.z1]]) solidBox(tb, a, b2, c, d, h, h + 0.7, pc);
      if (h > 9 && r.x1 - r.x0 > 10) solidBox(tb, cx - 2.5, cz - 1.8, cx + 1.5, cz + 1.8, h, h + 2.4, new THREE.Color('#a8adb1'));
    }
    // a shopfront fascia along the bottom of shops
    if (cb.style === 'shop') {
      const fc = new THREE.Color(['#7b2d26', '#1f4e79', '#2e7d4f', '#5b2a6a', '#c0392b', '#2c3e50'][cb.tint % 6]);
      walls(bucket(cx, cz, trimMat), r.x0 - 0.05, r.z0 - 0.05, r.x1 + 0.05, r.z1 + 0.05, 3.0, 3.7, 4, 4, fc);
    }
  }

  private markings(city: City) {
    // dashed centre lines and zebra crossings, all in one instanced mesh
    const dash = new THREE.BoxGeometry(1, 0.02, 1);
    const paint = new THREE.MeshStandardMaterial({ color: '#ecebdf', roughness: 0.6 });
    const mats: THREE.Matrix4[] = [];
    const m4 = (x: number, z: number, sx: number, sz: number) => new THREE.Matrix4().compose(new THREE.Vector3(x, 0.045, z), new THREE.Quaternion(), new THREE.Vector3(sx, 1, sz));
    const nearJ = (x: number, z: number) => city.junctions.some((j) => Math.abs(j.x - x) < 9 && Math.abs(j.z - z) < 9);
    const inOld = (x: number, z: number) => Math.abs(x) < 99 && z > -50;
    for (const l of city.lanes) {
      if (l.from.x > l.to.x || l.from.z > l.to.z) continue; // one line per road
      const cxl = l.axis === 'x' ? 0 : (l.from.x + 2.5), czl = l.axis === 'x' ? l.from.z - 2 : 0;
      const a = l.axis === 'x' ? l.from.x : l.from.z, b = l.axis === 'x' ? l.to.x : l.to.z;
      for (let t = a + 2; t < b - 2; t += 6) {
        const x = l.axis === 'x' ? t : cxl, z = l.axis === 'x' ? czl : t;
        if (nearJ(x, z) || inOld(x, z)) continue;
        mats.push(l.axis === 'x' ? m4(x, z, 3, 0.14) : m4(x, z, 0.14, 3));
      }
    }
    for (const j of city.junctions) {
      if (inOld(j.x, j.z)) continue;
      for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) for (let i = -4; i <= 4; i++) {
        const x = j.x + dx * 7.6 + (dz ? i * 1.05 : 0), z = j.z + dz * 7.6 + (dx ? i * 1.05 : 0);
        if (j.z === ESPLANADE_Z && dz > 0) continue;
        mats.push(dz ? m4(x, z, 0.55, 2.6) : m4(x, z, 2.6, 0.55));
      }
    }
    const im = new THREE.InstancedMesh(dash, paint, mats.length);
    mats.forEach((m, i) => im.setMatrixAt(i, m));
    im.receiveShadow = true;
    this.group.add(im);
  }

  /** the traffic lights at every junction: poles at the corners, lamps lit from the shared cycle */
  private lampMats: Record<string, THREE.MeshStandardMaterial> = {};
  private signals(city: City) {
    const corners: { x: number; z: number }[] = [];
    for (const j of city.junctions) for (const [sx, sz] of [[-1, -1], [1, 1]]) corners.push({ x: j.x + sx * 6.0, z: j.z + sz * 6.0 });
    const put = (geo: THREE.BufferGeometry, mat: THREE.Material, dx: number, dy: number, dz: number) => {
      const im = new THREE.InstancedMesh(geo, mat, corners.length);
      const m = new THREE.Matrix4();
      corners.forEach((c, i) => { m.makeTranslation(c.x + dx, dy, c.z + dz); im.setMatrixAt(i, m); });
      im.frustumCulled = false;
      this.group.add(im);
      return im;
    };
    const dark = new THREE.MeshStandardMaterial({ color: '#23272b', roughness: 0.6, metalness: 0.3 });
    put(new THREE.CylinderGeometry(0.07, 0.08, 3.4, 8), dark, 0, 1.7, 0).castShadow = true;
    put(new THREE.BoxGeometry(0.3, 0.9, 0.3), dark, 0.22, 3.0, 0);
    put(new THREE.BoxGeometry(0.3, 0.9, 0.3), dark, -0.22, 3.0, 0);
    const ball = new THREE.OctahedronGeometry(0.11);
    for (const [axis, dx] of [['x', 0.22], ['z', -0.22]] as const) for (const [lamp, y, col] of [['r', 3.28, '#ff2a1a'], ['a', 3.0, '#ffb300'], ['g', 2.72, '#25e05a']] as const) {
      const mat = new THREE.MeshStandardMaterial({ color: '#202020', emissive: new THREE.Color(col), emissiveIntensity: 0, roughness: 0.4 });
      this.lampMats[`${axis}${lamp}`] = mat;
      for (const s of [-1, 1]) put(ball, mat, dx, y, s * 0.16);
    }
  }
  /** light the lamps for this moment of the cycle */
  setSignals(t: number) {
    for (const axis of ['x', 'z'] as const) {
      const on = lampFor(axis, t);
      for (const l of ['r', 'a', 'g'] as const) { const m = this.lampMats[`${axis}${l}`]; if (m) m.emissiveIntensity = l === on ? 2.6 : 0; }
    }
  }

  private props(props: CityProp[]) {
    const of = (k: CityProp['kind']) => props.filter((p) => p.kind === k);
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, list: CityProp[], at: (p: CityProp, m: THREE.Matrix4) => void, shadow = true) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      const m = new THREE.Matrix4();
      list.forEach((p, i) => { at(p, m); im.setMatrixAt(i, m); });
      im.castShadow = shadow; im.receiveShadow = true;
      this.group.add(im);
      return im;
    };
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const place = (p: CityProp, m: THREE.Matrix4, y: number, s = 1, sy = s) => m.compose(new THREE.Vector3(p.x, y, p.z), q.setFromAxisAngle(up, p.rot), new THREE.Vector3(s, sy, s));
    // trees: a trunk and two lumps of crown
    const trees = of('tree');
    const trunk = new THREE.CylinderGeometry(0.16, 0.24, 3, 6); trunk.translate(0, 1.5, 0);
    inst(trunk, new THREE.MeshStandardMaterial({ color: '#5a4030', roughness: 1 }), trees, (p, m) => place(p, m, 0, p.s ?? 1));
    const crown = treeCrown();
    const leafMat = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.92 });
    leafMat.name = 'leaves';
    const leaves = inst(crown, leafMat, trees, (p, m) => place(p, m, 0, p.s ?? 1));
    // each tree its own shade: a little yellower, bluer, lighter or darker than the next
    if (leaves) { const c = new THREE.Color(); trees.forEach((t, i) => leaves.setColorAt(i, c.setHSL(0.25 + Math.sin(t.x * 3.1) * 0.05, 0.25, 0.82 + Math.sin(t.z * 1.7) * 0.1))); if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true; }
    if (leaves) leaves.name = 'leaves';
    // street lamps: pole, arm and lamp head (the head lights up at night)
    const lamps = of('lamp');
    const pole = new THREE.CylinderGeometry(0.07, 0.1, 5.2, 8); pole.translate(0, 2.6, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: '#2f3438', roughness: 0.5, metalness: 0.5 });
    inst(pole, poleMat, lamps, (p, m) => place(p, m, 0));
    const arm = new THREE.BoxGeometry(0.08, 0.08, 1.1); arm.translate(0, 5.15, 0.55);
    inst(arm, poleMat, lamps, (p, m) => place(p, m, 0), false);
    const head = new THREE.BoxGeometry(0.3, 0.1, 0.5); head.translate(0, 5.05, 1.05);
    inst(head, this.bulbs, lamps, (p, m) => place(p, m, 0), false);
    // after dark each lamp throws a warm pool of light on the pavement and the road beneath it
    const pool = new THREE.PlaneGeometry(11, 11); pool.rotateX(-Math.PI / 2); pool.translate(0, 0.05, 1.3);
    const pools = inst(pool, this.poolMat, lamps, (p, m) => place(p, m, 0), false);
    if (pools) { pools.receiveShadow = false; pools.renderOrder = 2; pools.name = 'lamp_pools'; this.pools = pools; }
    // benches and bins
    // the red pillar box: a cylinder with a domed cap and a black plinth
    const pbody = mergeGeometries([new THREE.CylinderGeometry(0.27, 0.27, 1.25, 14).translate(0, 0.78, 0), new THREE.CylinderGeometry(0.31, 0.31, 0.1, 14).translate(0, 1.45, 0), new THREE.SphereGeometry(0.29, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.5, 0)])!;
    inst(pbody, new THREE.MeshStandardMaterial({ color: '#c8102e', roughness: 0.4, metalness: 0.1 }), of('postbox'), (p, m) => place(p, m, 0));
    inst(new THREE.CylinderGeometry(0.31, 0.33, 0.16, 14).translate(0, 0.08, 0), new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.6 }), of('postbox'), (p, m) => place(p, m, 0));
    inst(new THREE.BoxGeometry(0.22, 0.03, 0.06).translate(0, 1.1, 0.27), new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.6 }), of('postbox'), (p, m) => place(p, m, 0), false);
    // a park bench: slatted seat and back on cast-iron ends (the seat faces +z)
    const part = (w: number, h: number, d: number, x: number, y: number, z: number, rx = 0) => { const g = new THREE.BoxGeometry(w, h, d); g.rotateX(rx); g.translate(x, y, z); return g; };
    const slats = mergeGeometries([0, 1, 2].map((k) => part(1.8, 0.04, 0.12, 0, 0.45, 0.16 - k * 0.15)).concat([0, 1].map((k) => part(1.8, 0.1, 0.03, 0, 0.62 + k * 0.15, -0.24 - k * 0.03, -0.25))))!;
    const ends = mergeGeometries([-0.82, 0.82].flatMap((x) => [part(0.06, 0.45, 0.06, x, 0.225, 0.17), part(0.06, 0.85, 0.06, x, 0.42, -0.2, -0.12), part(0.06, 0.05, 0.45, x, 0.43, -0.02)]))!;
    inst(slats, new THREE.MeshStandardMaterial({ color: '#8a6440', roughness: 0.9 }), of('bench'), (p, m) => place(p, m, 0));
    inst(ends, new THREE.MeshStandardMaterial({ color: '#2b2f33', roughness: 0.6, metalness: 0.4 }), of('bench'), (p, m) => place(p, m, 0));
    // shipping containers in their colours
    const cont = new THREE.BoxGeometry(6, 2.6, 2.4); cont.translate(0, 1.3, 0);
    const containers = of('container');
    const ci = inst(cont, new THREE.MeshStandardMaterial({ map: tex.cladding('#cccccc'), roughness: 0.7 }), containers, (p, m) => place(p, m, 0));
    if (ci) { const c = new THREE.Color(); containers.forEach((p, i) => ci.setColorAt(i, c.set(p.color ?? '#b03a2e'))); if (ci.instanceColor) ci.instanceColor.needsUpdate = true; }
    // beach huts and parasols
    const huts = of('hut');
    const hut = new THREE.BoxGeometry(2.6, 2.4, 2.2); hut.translate(0, 1.2, 0);
    const hi = inst(hut, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 }), huts, (p, m) => place(p, m, 0));
    if (hi) { const c = new THREE.Color(); huts.forEach((p, i) => hi.setColorAt(i, c.set(p.color ?? '#ffffff'))); if (hi.instanceColor) hi.instanceColor.needsUpdate = true; }
    const hutRoof = new THREE.ConeGeometry(1.9, 1.0, 4); hutRoof.rotateY(Math.PI / 4); hutRoof.translate(0, 2.9, 0);
    inst(hutRoof, new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.8 }), huts, (p, m) => place(p, m, 0));
    const paras = of('parasol');
    const shade1 = new THREE.ConeGeometry(1.4, 0.5, 12); shade1.translate(0, 2.2, 0);
    const pi = inst(shade1, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, side: THREE.DoubleSide }), paras, (p, m) => place(p, m, 0));
    if (pi) { const c = new THREE.Color(); paras.forEach((p, i) => pi.setColorAt(i, c.set(p.color ?? '#e74c3c'))); if (pi.instanceColor) pi.instanceColor.needsUpdate = true; }
    const stick = new THREE.CylinderGeometry(0.03, 0.03, 2.2, 5); stick.translate(0, 1.1, 0);
    inst(stick, poleMat, paras, (p, m) => place(p, m, 0), false);
    // the one-offs: dock cranes, moored ships, fountains, goals, bus shelters
    for (const p of props) {
      if (p.kind === 'crane') this.group.add(crane(p.x, p.z));
      else if (p.kind === 'boat') { const b = boat('#2b3a4a', '#c0392b'); b.scale.setScalar(2.4); b.position.set(p.x, -1.0, p.z); b.rotation.y = p.rot; this.group.add(b); }
      else if (p.kind === 'fountain') this.group.add(fountain(p.x, p.z));
      else if (p.kind === 'goal') this.group.add(goal(p.x, p.z, p.rot));
      else if (p.kind === 'bus_stop') this.group.add(shelter(p.x, p.z, p.rot));
    }
  }

  private signs(list: CityBuilding[]) {
    // landmarks carry their names over the door
    for (const b of list) {
      if (!b.name) continue;
      const t = signTexture(b.name.toUpperCase(), '#ffffff', b.style === 'hospital' ? '#2f6fb0' : b.style === 'station' ? '#7b2d26' : '#2c3e50');
      const w = Math.min(b.rect.x1 - b.rect.x0 - 2, t.aspect * 1.2);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / t.aspect), new THREE.MeshStandardMaterial({ map: t.tex, roughness: 0.6, emissive: new THREE.Color('#ffffff'), emissiveMap: t.tex, emissiveIntensity: 0.15 }));
      m.position.set((b.rect.x0 + b.rect.x1) / 2, Math.min(b.height - 1.2, 7), b.rect.z1 + 0.06);
      this.group.add(m);
    }
  }

  /** each frame: far chunks hidden, windows lit after dark */
  private pools: THREE.InstancedMesh | null = null;
  private poolMat = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,214,150,1)'); grad.addColorStop(0.35, 'rgba(255,190,120,.55)'); grad.addColorStop(1, 'rgba(255,170,90,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, fog: true });
  })();
  update(camera: THREE.Camera, night: number) {
    this.poolMat.opacity = Math.max(0, night - 0.25) * 0.6;
    if (this.pools) this.pools.visible = night > 0.3;
    const p = camera.position;
    for (const c of this.chunks) c.g.visible = Math.hypot(c.cx - p.x, c.cz - p.z) < VIEW + CHUNK * 0.7;
    for (const c of this.lods) { const d = Math.hypot(c.cx - p.x, c.cz - p.z); c.g.visible = d >= VENUE_LOD && d < VIEW + CHUNK; }
    for (const m of this.glowMats) m.emissiveIntensity = night * 1.2;
    this.bulbs.emissiveIntensity = night > 0.3 ? 1.6 : 0;
  }
}

function crane(x: number, z: number) {
  const g = new THREE.Group();
  const y = new THREE.MeshStandardMaterial({ color: '#d68910', roughness: 0.6, metalness: 0.3 });
  for (const [dx, dz] of [[-4, -3], [4, -3], [-4, 3], [4, 3]]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, 22, 0.8), y); leg.position.set(dx, 11, dz); g.add(leg); }
  const deck = new THREE.Mesh(new THREE.BoxGeometry(10, 2, 8), y); deck.position.set(0, 22, 0); g.add(deck);
  const boom = new THREE.Mesh(new THREE.BoxGeometry(2, 1.6, 46), y); boom.position.set(0, 25, 10); g.add(boom);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), new THREE.MeshStandardMaterial({ color: '#ecf0f1' })); cab.position.set(0, 20, 4); g.add(cab);
  g.position.set(x, 0, z);
  g.traverse((o) => { o.castShadow = true; });
  return g;
}
function fountain(x: number, z: number) {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: '#c9c2b4', roughness: 0.8 });
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.3, 0.7, 28), stone); basin.position.y = 0.35; g.add(basin);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 0.1, 28), new THREE.MeshStandardMaterial({ color: '#5a9ab0', roughness: 0.1, metalness: 0.3 })); water.position.y = 0.62; g.add(water);
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 2.4, 12), stone); col.position.y = 1.4; g.add(col);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.2, 0.3, 16), stone); top.position.y = 2.6; g.add(top);
  g.position.set(x, 0, z);
  return g;
}
function goal(x: number, z: number, rot: number) {
  const g = new THREE.Group();
  const w = new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.5 });
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 8), w); p.position.set(s * 3.6, 1.2, 0); g.add(p); }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 7.3, 8), w); bar.rotation.z = Math.PI / 2; bar.position.y = 2.4; g.add(bar);
  g.position.set(x, 0, z); g.rotation.y = rot;
  return g;
}
function shelter(x: number, z: number, rot: number) {
  const g = new THREE.Group();
  const frame = new THREE.MeshStandardMaterial({ color: '#2c3e50', roughness: 0.5, metalness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ color: '#a9c2cf', transparent: true, opacity: 0.35, roughness: 0.1 });
  const roof = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.1, 1.5), frame); roof.position.y = 2.5; g.add(roof);
  const back = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.2, 0.04), glass); back.position.set(0, 1.3, -0.7); g.add(back);
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.5, 0.08), frame); p.position.set(s * 1.75, 1.25, -0.7); g.add(p); }
  const seat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 0.35), frame); seat.position.set(0, 0.5, -0.5); g.add(seat);
  g.position.set(x, 0, z); g.rotation.y = rot;
  return g;
}

void mergeGeometries; void AVENUES; void STREETS;

/** a leafy crown: a cluster of lumpy lobes (welded, so the surface never cracks), shaded darker
 * underneath and inside, lighter where the sun catches the top, mottled all over */
function treeCrown(): THREE.BufferGeometry {
  const lobes: [number, number, number, number][] = [[0, 4.5, 0, 1.75], [1.05, 4.15, 0.35, 1.25], [-0.95, 4.2, -0.4, 1.3], [0.25, 5.35, -0.2, 1.25], [-0.35, 4.0, 1.0, 1.15], [0.55, 4.35, -1.05, 1.15], [-0.7, 5.0, 0.6, 1.0]];
  const noise = (x: number, y: number, z: number) => Math.sin(x * 2.3 + Math.sin(z * 1.9)) * Math.cos(y * 2.1 + Math.sin(x * 1.3)) * 0.5 + Math.sin((x + y + z) * 4.7) * 0.25;
  const dark = new THREE.Color('#2f5a26'), light = new THREE.Color('#7fae4e'), c = new THREE.Color();
  const geos = lobes.map(([cx, cy, cz, r]) => {
    const g = new THREE.IcosahedronGeometry(r, 3);
    g.deleteAttribute('uv');
    const pos = g.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const k = 1 + noise(x + cx, y + cy, z + cz) * 0.16;
      const wx = x * k + cx, wy = y * k + cy, wz = z * k + cz;
      pos.setXYZ(i, wx, wy, wz);
      const up = Math.max(0, Math.min(1, (wy - 3.2) / 3)) * 0.75 + Math.max(0, y / r) * 0.25;
      c.copy(dark).lerp(light, up).multiplyScalar(0.85 + (noise(wx * 3, wy * 3, wz * 3) + 0.75) * 0.15);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  });
  const out = mergeGeometries(geos)!;
  // normals pointing out from the crown as a whole read as one soft mass rather than seven balls
  const pos = out.getAttribute('position'), nrm = out.getAttribute('normal');
  for (let i = 0; i < pos.count; i++) {
    const n = new THREE.Vector3(pos.getX(i), (pos.getY(i) - 4.6) * 1.2, pos.getZ(i)).normalize();
    const m = new THREE.Vector3(nrm.getX(i), nrm.getY(i), nrm.getZ(i)).lerp(n, 0.55).normalize();
    nrm.setXYZ(i, m.x, m.y, m.z);
  }
  return out;
}
