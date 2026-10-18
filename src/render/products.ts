// Retail product models with printed packaging. Every product's parts map into one shared
// label atlas (printed artwork for labels, flat swatches for plain parts), so each shelf
// section stays a single instanced draw call. One instance = one unit of stock (a facing).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------- label atlas
// top half: 4 x 2 label cells of 256 px; bottom half: a palette of flat swatches
const ATLAS = 1024;
const CELL = 256;
const LABELS = ['milk', 'soup', 'pasta', 'coffee', 'snacks', 'soap', 'bread', 'apples'] as const;
const SWATCHES = ['#f4f6f8', '#c8ccd0', '#2f6fd6', '#c8352e', '#a8261f', '#c98b4a', '#e9d9b6', '#5a3a22', '#d8b46a', '#ffffff', '#2c2c2c', '#7fae4a', '#e8e2d0', '#d9762b'];
type Rect = [number, number, number, number]; // u0, v0, u1, v1

let atlasTex: THREE.CanvasTexture | null = null;
function labelRect(name: string): Rect {
  const i = LABELS.indexOf(name as (typeof LABELS)[number]);
  const cx = i % 4, cy = Math.floor(i / 4);
  const inset = 2 / ATLAS;
  // canvas y runs down, texture v runs up
  return [cx * 0.25 + inset, 1 - (cy + 1) * 0.25 + inset, (cx + 1) * 0.25 - inset, 1 - cy * 0.25 - inset];
}
function swatchRect(color: string): Rect {
  const i = Math.max(0, SWATCHES.indexOf(color));
  const s = 32 / ATLAS;
  const u = (i % 16) * s + s / 2, v = 0.5 - (Math.floor(i / 16) + 0.5) * s;
  return [u, v, u, v];
}

function drawAtlas(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = ATLAS;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, ATLAS, ATLAS);
  SWATCHES.forEach((col, i) => { c.fillStyle = col; c.fillRect((i % 16) * 32, 512 + Math.floor(i / 16) * 32, 32, 32); });
  const brand = (x: number, y: number, size: number, color: string) => {
    c.font = `800 ${size}px Arial Black, Arial, sans-serif`; c.fillStyle = color; c.textAlign = 'center'; c.fillText('HARBOUR', x, y);
  };
  const text = (t: string, x: number, y: number, size: number, color: string, weight = 700) => {
    c.font = `${weight} ${size}px Arial, sans-serif`; c.fillStyle = color; c.textAlign = 'center'; c.fillText(t, x, y);
  };
  const barcode = (x: number, y: number) => {
    c.fillStyle = '#fff'; c.fillRect(x - 4, y - 4, 58, 30);
    for (let k = 0; k < 24; k++) { c.fillStyle = '#111'; c.fillRect(x + k * 2.1, y, (k * 7) % 3 === 0 ? 2 : 1, 22); }
  };
  LABELS.forEach((name, i) => {
    const x0 = (i % 4) * CELL, y0 = Math.floor(i / 4) * CELL, mx = x0 + CELL / 2;
    c.save();
    c.beginPath(); c.rect(x0, y0, CELL, CELL); c.clip();
    switch (name) {
      case 'milk': {
        c.fillStyle = '#f7f9fb'; c.fillRect(x0, y0, CELL, CELL);
        c.fillStyle = '#2f6fd6'; c.fillRect(x0, y0 + 150, CELL, 106);
        // rolling green hills and a sky band
        c.fillStyle = '#8cc7f0'; c.fillRect(x0, y0 + 70, CELL, 80);
        c.fillStyle = '#6fae4a'; c.beginPath(); c.ellipse(mx - 40, y0 + 160, 120, 40, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#82c25a'; c.beginPath(); c.ellipse(mx + 70, y0 + 165, 110, 35, 0, 0, Math.PI * 2); c.fill();
        brand(mx, y0 + 50, 34, '#2f6fd6');
        text('FRESH MILK', mx, y0 + 200, 34, '#ffffff', 800);
        text('Semi-skimmed  1 litre', mx, y0 + 232, 20, '#dbe9ff');
        break;
      }
      case 'soup': {
        c.fillStyle = '#d9762b'; c.fillRect(x0, y0, CELL, CELL);
        c.fillStyle = '#f3e6d0'; c.fillRect(x0, y0 + 70, CELL, 120);
        c.fillStyle = '#c0392b'; c.beginPath(); c.arc(mx, y0 + 130, 42, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#e8573f'; c.beginPath(); c.arc(mx - 10, y0 + 120, 18, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#3c8d2f'; c.fillRect(mx - 6, y0 + 82, 12, 10);
        brand(mx, y0 + 50, 34, '#ffffff');
        text('TOMATO SOUP', mx, y0 + 222, 30, '#ffffff', 800);
        text('400g', mx, y0 + 248, 18, '#ffe7cf');
        break;
      }
      case 'pasta': {
        c.fillStyle = '#1f4fa0'; c.fillRect(x0, y0, CELL, CELL);
        c.fillStyle = '#f2d06b'; c.beginPath(); c.roundRect(x0 + 40, y0 + 80, CELL - 80, 100, 16); c.fill();
        c.strokeStyle = '#d9a93a'; c.lineWidth = 6;
        for (let k = 0; k < 7; k++) { c.beginPath(); c.moveTo(x0 + 55 + k * 24, y0 + 95); c.lineTo(x0 + 45 + k * 24, y0 + 165); c.stroke(); }
        brand(mx, y0 + 50, 34, '#ffffff');
        text('PENNE', mx, y0 + 222, 36, '#f2d06b', 800);
        text('Durum wheat  500g', mx, y0 + 248, 18, '#cfe0ff');
        break;
      }
      case 'coffee': {
        const g = c.createLinearGradient(x0, y0, x0, y0 + CELL); g.addColorStop(0, '#3a2414'); g.addColorStop(1, '#5a3a22');
        c.fillStyle = g; c.fillRect(x0, y0, CELL, CELL);
        c.fillStyle = '#d8b46a'; c.fillRect(x0, y0 + 64, CELL, 6); c.fillRect(x0, y0 + 190, CELL, 6);
        for (let k = 0; k < 3; k++) { c.fillStyle = '#7a4a26'; c.beginPath(); c.ellipse(mx - 40 + k * 40, y0 + 130, 14, 20, 0.5, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#3a2414'; c.lineWidth = 3; c.beginPath(); c.moveTo(mx - 44 + k * 40, y0 + 114); c.lineTo(mx - 36 + k * 40, y0 + 146); c.stroke(); }
        brand(mx, y0 + 46, 30, '#d8b46a');
        text('ROAST COFFEE', mx, y0 + 228, 28, '#f3e3c3', 800);
        break;
      }
      case 'snacks': {
        c.fillStyle = '#3b7dd8'; c.fillRect(x0, y0, CELL, CELL);
        c.fillStyle = '#ffffff'; c.beginPath(); c.moveTo(x0, y0 + 60); c.lineTo(x0 + CELL, y0 + 30); c.lineTo(x0 + CELL, y0 + 90); c.lineTo(x0, y0 + 120); c.fill();
        for (let k = 0; k < 5; k++) { c.fillStyle = k % 2 ? '#f2c230' : '#e9b522'; c.beginPath(); c.ellipse(mx - 60 + k * 30, y0 + 165 + (k % 2) * 10, 26, 18, k, 0, Math.PI * 2); c.fill(); }
        brand(mx, y0 + 98, 30, '#3b7dd8');
        text('CRISPS', mx, y0 + 230, 40, '#ffffff', 800);
        break;
      }
      case 'soap': {
        c.fillStyle = '#9ad0c2'; c.fillRect(x0, y0, CELL, CELL);
        c.fillStyle = '#ffffff';
        for (let k = 0; k < 6; k++) { c.globalAlpha = 0.6; c.beginPath(); c.arc(x0 + 40 + k * 35, y0 + 150 + (k % 2) * 20, 14 + (k % 3) * 6, 0, Math.PI * 2); c.fill(); }
        c.globalAlpha = 1;
        brand(mx, y0 + 70, 34, '#2b7a6a');
        text('PURE SOAP', mx, y0 + 120, 30, '#1d5a4e', 800);
        text('Sea minerals', mx, y0 + 230, 20, '#1d5a4e');
        break;
      }
      case 'bread': {
        c.fillStyle = '#f6efe2'; c.fillRect(x0, y0, CELL, CELL);
        c.fillStyle = '#c0392b'; c.fillRect(x0, y0 + 90, CELL, 70);
        brand(mx, y0 + 60, 32, '#c0392b');
        text('WHITE BLOOMER', mx, y0 + 136, 26, '#ffffff', 800);
        text('Baked today', mx, y0 + 200, 20, '#8a5a2a');
        break;
      }
      case 'apples': {
        // mesh bag print
        c.fillStyle = 'rgba(0,0,0,0)'; c.clearRect(x0, y0, CELL, CELL);
        c.fillStyle = '#c8352e'; c.fillRect(x0, y0, CELL, CELL);
        c.strokeStyle = '#7a1d18'; c.lineWidth = 3;
        for (let k = -CELL; k < CELL * 2; k += 18) { c.beginPath(); c.moveTo(x0 + k, y0); c.lineTo(x0 + k + CELL, y0 + CELL); c.stroke(); c.beginPath(); c.moveTo(x0 + k, y0 + CELL); c.lineTo(x0 + k + CELL, y0); c.stroke(); }
        c.fillStyle = '#ffffff'; c.fillRect(x0 + 30, y0 + 95, CELL - 60, 66);
        text('APPLES  6 pack', mx, y0 + 138, 26, '#a8261f', 800);
        break;
      }
    }
    barcode(x0 + CELL - 70, y0 + CELL - 34);
    c.restore();
  });
  return cv;
}

function atlas(): THREE.CanvasTexture {
  if (!atlasTex) {
    atlasTex = new THREE.CanvasTexture(drawAtlas());
    atlasTex.colorSpace = THREE.SRGBColorSpace;
    atlasTex.anisotropy = 8;
  }
  return atlasTex;
}

// ---------------------------------------------------------------- geometry helpers
/** place a geometry and squeeze its UVs into an atlas rectangle */
function part(g: THREE.BufferGeometry, r: Rect, x = 0, y = 0, z = 0, rotX = 0, rotZ = 0, rotY = 0): THREE.BufferGeometry {
  let geo = g.index ? g.toNonIndexed() : g;
  if (rotX) geo.rotateX(rotX);
  if (rotZ) geo.rotateZ(rotZ);
  if (rotY) geo.rotateY(rotY);
  geo.translate(x, y, z);
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, r[0] + uv.getX(i) * (r[2] - r[0]), r[1] + uv.getY(i) * (r[3] - r[1]));
  for (const a of Object.keys(geo.attributes)) if (a !== 'position' && a !== 'normal' && a !== 'uv') geo.deleteAttribute(a);
  geo = geo.clone();
  return geo;
}
const L = (n: string) => labelRect(n);
const S = (c: string) => swatchRect(c);
/** a can/jar: label wrapped round the side, plain lids */
function can(r: number, h: number, label: string, lid: string, y0 = 0): THREE.BufferGeometry[] {
  return [
    part(new THREE.CylinderGeometry(r, r, h, 18, 1, true), L(label), 0, y0 + h / 2, 0, 0, 0, Math.PI / 2), // label centre faces +x
    part(new THREE.CylinderGeometry(r * 1.01, r * 1.01, 0.008, 18), S(lid), 0, y0 + h - 0.002, 0),
    part(new THREE.CylinderGeometry(r * 1.01, r * 1.01, 0.006, 18), S(lid), 0, y0 + 0.003, 0),
  ];
}
/** a box with the label on its front and back (±x, width d along z); a strip of it on the sides; plain top */
function carton(w: number, h: number, d: number, label: string, side: string): THREE.BufferGeometry[] {
  const g = new THREE.BoxGeometry(w, h, d);
  // faces: +x, -x, +y, -y, +z, -z (4 verts each)
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const lr = L(label), sr = S(side);
  for (let f = 0; f < 6; f++) {
    // shoppers look along x at a gondola, so the printed front is on +x / -x
    const r = f < 2 ? lr : f >= 4 ? [lr[0], lr[1], lr[0] + (lr[2] - lr[0]) * 0.35, lr[3]] as Rect : sr;
    for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, r[0] + uv.getX(i) * (r[2] - r[0]), r[1] + uv.getY(i) * (r[3] - r[1])); }
  }
  return [part(g, [0, 0, 1, 1], 0, h / 2, 0)];
}

type Maker = () => THREE.BufferGeometry[];
const ITEM: Record<string, Maker> = {
  // gable-top milk carton
  milk: () => {
    const body = carton(0.072, 0.19, 0.072, 'milk', '#f4f6f8');
    const roof = new THREE.CylinderGeometry(0, 0.051, 0.035, 4, 1);
    roof.rotateY(Math.PI / 4);
    roof.scale(1, 1, 0.35);
    return [...body, part(roof, S('#f4f6f8'), 0, 0.2075, 0), part(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 10), S('#2f6fd6'), 0.018, 0.212, 0)];
  },
  soup: () => can(0.037, 0.11, 'soup', '#c8ccd0'),
  pasta: () => carton(0.05, 0.19, 0.11, 'pasta', '#2f6fd6'),
  coffee: () => [...can(0.045, 0.13, 'coffee', '#2c2c2c'), part(new THREE.CylinderGeometry(0.047, 0.047, 0.02, 18), S('#d8b46a'), 0, 0.14, 0)],
  // pillow-shaped crisp packet: a box whose middle bulges
  snacks: () => {
    const g = new THREE.BoxGeometry(0.13, 0.18, 0.05, 6, 8, 2);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) / 0.065, y = p.getY(i) / 0.09;
      const bulge = Math.max(0, 1 - x * x) * Math.max(0, 1 - y * y);
      p.setZ(i, p.getZ(i) * (0.25 + 1.1 * bulge));
    }
    g.computeVertexNormals();
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const lr = L('snacks');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, lr[0] + uv.getX(i) * (lr[2] - lr[0]), lr[1] + uv.getY(i) * (lr[3] - lr[1]));
    return [part(g, [0, 0, 1, 1], 0, 0.09, 0, 0, 0, Math.PI / 2), part(new THREE.BoxGeometry(0.016, 0.012, 0.132), S('#c8ccd0'), 0, 0.18, 0), part(new THREE.BoxGeometry(0.016, 0.012, 0.132), S('#c8ccd0'), 0, 0.004, 0)];
  },
  soap: () => carton(0.06, 0.045, 0.09, 'soap', '#ffffff'),
  // loaf in a printed bag with a twist at the end
  bread: () => {
    // a golden loaf with a domed top in a clear bag, a printed band round the middle, twisted end
    const loaf = new THREE.CapsuleGeometry(0.05, 0.05, 4, 14);
    loaf.rotateX(Math.PI / 2);
    loaf.scale(1.05, 1.15, 1);
    const band = new THREE.CylinderGeometry(0.0545, 0.0545, 0.05, 16, 1, true);
    band.rotateX(Math.PI / 2);
    band.scale(1.05, 1.15, 1);
    return [part(loaf, S('#c98b4a'), 0, 0.058, 0), part(band, L('bread'), 0, 0.058, 0), part(new THREE.CylinderGeometry(0.006, 0.016, 0.022, 8), S('#e8e2d0'), 0, 0.058, -0.083, Math.PI / 2)];
  },
  // a net bag of six apples
  apples: () => {
    const out: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) out.push(part(new THREE.SphereGeometry(0.036, 12, 10), S(i % 2 ? '#c8352e' : '#a8261f'), (i % 2) * 0.064 - 0.032, 0.038 + Math.floor(i / 4) * 0.06, (Math.floor(i / 2) % 2) * 0.06 - 0.03));
    out.push(part(new THREE.BoxGeometry(0.004, 0.05, 0.11), L('apples'), 0.068, 0.06, 0), part(new THREE.BoxGeometry(0.004, 0.05, 0.11), L('apples'), -0.068, 0.06, 0));
    return out;
  },
};

const cache = new Map<string, THREE.BufferGeometry>();
const unitCache = new Map<string, THREE.BufferGeometry>();

/** a single unit of a product (for baskets, bags and hands) */
export function productUnitGeometry(product: string): THREE.BufferGeometry {
  const hit = unitCache.get(product);
  if (hit) return hit;
  const make = ITEM[product] ?? (() => carton(0.1, 0.15, 0.1, 'soap', '#c8ccd0'));
  const g = mergeGeometries(make(), false)!;
  unitCache.set(product, g);
  return g;
}

/** a shelf facing for one unit of stock: three of the item side by side, two deep */
export function productGeometry(product: string): THREE.BufferGeometry {
  const hit = cache.get(product);
  if (hit) return hit;
  const make = ITEM[product] ?? (() => carton(0.1, 0.15, 0.1, 'soap', '#c8ccd0'));
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) for (const g of make()) parts.push(g.clone().translate(j * 0.13 - 0.065, 0, i * 0.165 - 0.165));
  const merged = mergeGeometries(parts, false)!;
  cache.set(product, merged);
  return merged;
}

export const productMaterial = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.0, map: typeof document !== 'undefined' ? atlas() : null });
