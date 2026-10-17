// Procedural canvas textures (no external image files). Each texture tiles
// at a known real-world size so surfaces keep consistent scale.
import * as THREE from 'three';

const cache = new Map<string, THREE.CanvasTexture>();
const normals = new WeakMap<THREE.Texture, THREE.Texture>();

/** The relief (normal map) generated alongside a colour texture, if it has one. */
export function normalOf(t: THREE.Texture): THREE.Texture | undefined { return normals.get(t); }

type Draw = (c: CanvasRenderingContext2D, s: number, rnd: () => number) => void;

function make(key: string, size: number, draw: Draw, height?: Draw, strength = 2): THREE.CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d')!;
  let seed = 0;
  for (const ch of key) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  seed = seed || 1;
  const seed0 = seed;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  draw(c, size, rnd);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (height) {
    // the height field replays the same random sequence so relief lines up with the colour
    seed = seed0;
    normals.set(t, normalMap(size, (hc) => height(hc, size, rnd), strength));
  }
  cache.set(key, t);
  return t;
}

/** Draw a greyscale height field (white = high) and convert it to a tangent-space normal map. */
function normalMap(size: number, draw: (c: CanvasRenderingContext2D) => void, strength: number): THREE.Texture {
  const hc = document.createElement('canvas');
  hc.width = hc.height = size;
  const c = hc.getContext('2d', { willReadFrequently: true })!;
  c.fillStyle = '#808080'; c.fillRect(0, 0, size, size);
  draw(c);
  const src = c.getImageData(0, 0, size, size).data;
  const out = new ImageData(size, size);
  const h = (x: number, y: number) => src[((((y + size) % size) * size + ((x + size) % size)) * 4)] / 255;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (h(x + 1, y - 1) + 2 * h(x + 1, y) + h(x + 1, y + 1) - h(x - 1, y - 1) - 2 * h(x - 1, y) - h(x - 1, y + 1)) * strength;
    const dy = (h(x - 1, y + 1) + 2 * h(x, y + 1) + h(x + 1, y + 1) - h(x - 1, y - 1) - 2 * h(x, y - 1) - h(x + 1, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * size + x) * 4;
    out.data[i] = ((-dx / l) * 0.5 + 0.5) * 255;
    out.data[i + 1] = ((dy / l) * 0.5 + 0.5) * 255; // canvas y runs down, texture v runs up
    out.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
    out.data[i + 3] = 255;
  }
  c.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(hc);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** random bumps for height fields */
function grit(c: CanvasRenderingContext2D, s: number, rnd: () => number, n: number, r: number, lo = 60, hi = 200) {
  for (let i = 0; i < n; i++) {
    const v = Math.floor(lo + rnd() * (hi - lo));
    c.fillStyle = `rgb(${v},${v},${v})`;
    c.globalAlpha = 0.35;
    c.fillRect(rnd() * s, rnd() * s, r * (0.5 + rnd()), r * (0.5 + rnd()));
  }
  c.globalAlpha = 1;
}
const grey = (v: number) => `rgb(${v},${v},${v})`;

function speckle(c: CanvasRenderingContext2D, s: number, rnd: () => number, n: number, colors: string[], r = 1.5) {
  for (let i = 0; i < n; i++) {
    c.fillStyle = colors[Math.floor(rnd() * colors.length)];
    c.globalAlpha = 0.25 + rnd() * 0.4;
    c.fillRect(rnd() * s, rnd() * s, r * (0.5 + rnd()), r * (0.5 + rnd()));
  }
  c.globalAlpha = 1;
}

const shade = (hex: string, f: number) => {
  const col = new THREE.Color(hex);
  col.multiplyScalar(f);
  return `#${col.getHexString()}`;
};

/** tile size in metres for each texture (used to compute UV repeats) */
export const TILE: Record<string, number> = {};

export const tex = {
  asphalt(): THREE.CanvasTexture {
    TILE.asphalt = 4;
    return make('asphalt', 512, (c, s, rnd) => {
      c.fillStyle = '#3f4347'; c.fillRect(0, 0, s, s);
      speckle(c, s, rnd, 9000, ['#2c2f33', '#55595e', '#4a4e52', '#303336'], 2);
      c.strokeStyle = 'rgba(20,20,20,.35)'; c.lineWidth = 1.5;
      for (let i = 0; i < 4; i++) { c.beginPath(); let x = rnd() * s, y = rnd() * s; c.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (rnd() - 0.5) * 60; y += (rnd() - 0.5) * 60; c.lineTo(x, y); } c.stroke(); }
    }, (c, s, rnd) => { grit(c, s, rnd, 14000, 2.2, 40, 220); }, 1.6);
  },
  paving(): THREE.CanvasTexture {
    TILE.paving = 1.8;
    return make('paving', 256, (c, s, rnd) => {
      c.fillStyle = '#b9b5ac'; c.fillRect(0, 0, s, s);
      const n = 3;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        c.fillStyle = shade('#bdb9b0', 0.92 + rnd() * 0.12);
        c.fillRect(i * (s / n) + 2, j * (s / n) + 2, s / n - 4, s / n - 4);
      }
      speckle(c, s, rnd, 1800, ['#9d998f', '#cfcbc2'], 1.5);
    }, (c, s, rnd) => {
      const n = 3;
      c.fillStyle = grey(40); c.fillRect(0, 0, s, s);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { c.fillStyle = grey(170 + Math.floor(rnd() * 30)); c.fillRect(i * (s / n) + 3, j * (s / n) + 3, s / n - 6, s / n - 6); }
      grit(c, s, rnd, 2500, 1.5, 120, 220);
    }, 2.5);
  },
  grass(): THREE.CanvasTexture {
    TILE.grass = 3;
    return make('grass', 256, (c, s, rnd) => {
      c.fillStyle = '#6c9a52'; c.fillRect(0, 0, s, s);
      speckle(c, s, rnd, 7000, ['#5a8a44', '#7aaa5c', '#86b468', '#4f7d3c'], 2.2);
    }, (c, s, rnd) => grit(c, s, rnd, 9000, 2, 30, 230), 1.4);
  },
  brick(base: string): THREE.CanvasTexture {
    TILE[`brick${base}`] = 1.2;
    return make(`brick${base}`, 256, (c, s, rnd) => {
      c.fillStyle = '#cfc6b8'; c.fillRect(0, 0, s, s);
      const rows = 16, bh = s / rows, bw = s / 4;
      for (let r = 0; r < rows; r++) for (let k = -1; k < 5; k++) {
        const x = k * bw + (r % 2 ? bw / 2 : 0);
        c.fillStyle = shade(base, 0.82 + rnd() * 0.3);
        c.fillRect(x + 1.5, r * bh + 1.5, bw - 3, bh - 3);
      }
      speckle(c, s, rnd, 2500, ['#000000', '#ffffff'], 1.2);
    }, (c, s, rnd) => {
      const rows = 16, bh = s / rows, bw = s / 4;
      c.fillStyle = grey(50); c.fillRect(0, 0, s, s);
      for (let r = 0; r < rows; r++) for (let k = -1; k < 5; k++) { c.fillStyle = grey(180 + Math.floor(rnd() * 40)); c.fillRect(k * bw + (r % 2 ? bw / 2 : 0) + 2, r * bh + 2, bw - 4, bh - 4); }
      grit(c, s, rnd, 3000, 1.3, 120, 240);
    }, 3);
  },
  render(base: string): THREE.CanvasTexture {
    TILE[`render${base}`] = 2;
    return make(`render${base}`, 256, (c, s, rnd) => {
      c.fillStyle = base; c.fillRect(0, 0, s, s);
      speckle(c, s, rnd, 4000, [shade(base, 0.9), shade(base, 1.07)], 2);
    }, (c, s, rnd) => grit(c, s, rnd, 7000, 2, 90, 170), 1.2);
  },
  cladding(base: string): THREE.CanvasTexture {
    TILE[`clad${base}`] = 1.6;
    return make(`clad${base}`, 256, (c, s, rnd) => {
      c.fillStyle = base; c.fillRect(0, 0, s, s);
      for (let x = 0; x < s; x += s / 8) { c.fillStyle = shade(base, 0.8); c.fillRect(x, 0, 3, s); c.fillStyle = shade(base, 1.1); c.fillRect(x + 3, 0, 2, s); }
      speckle(c, s, rnd, 1500, [shade(base, 0.9)], 1.5);
    }, (c, s) => {
      // ribbed metal cladding
      for (let x = 0; x < s; x++) { const ph = (x % (s / 8)) / (s / 8); c.fillStyle = grey(Math.floor(128 + 110 * Math.sin(ph * Math.PI * 2) * (ph < 0.25 ? 1 : 0.15))); c.fillRect(x, 0, 1, s); }
    }, 2);
  },
  plaster(base: string): THREE.CanvasTexture {
    TILE[`plaster${base}`] = 2;
    return make(`plaster${base}`, 128, (c, s, rnd) => {
      c.fillStyle = base; c.fillRect(0, 0, s, s);
      speckle(c, s, rnd, 900, [shade(base, 0.96), shade(base, 1.03)], 2);
    }, (c, s, rnd) => grit(c, s, rnd, 1500, 2, 110, 150), 0.6);
  },
  tiles(a: string, b: string, n = 4): THREE.CanvasTexture {
    TILE[`tiles${a}${b}`] = 1.2;
    return make(`tiles${a}${b}${n}`, 256, (c, s, rnd) => {
      const t = s / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        c.fillStyle = shade((i + j) % 2 ? a : b, 0.97 + rnd() * 0.05);
        c.fillRect(i * t, j * t, t, t);
      }
      c.strokeStyle = 'rgba(0,0,0,.12)'; c.lineWidth = 2;
      for (let i = 0; i <= n; i++) { c.beginPath(); c.moveTo(i * t, 0); c.lineTo(i * t, s); c.moveTo(0, i * t); c.lineTo(s, i * t); c.stroke(); }
    }, (c, s) => {
      const t = s / n;
      c.fillStyle = grey(200); c.fillRect(0, 0, s, s);
      c.strokeStyle = grey(40); c.lineWidth = 3;
      for (let i = 0; i <= n; i++) { c.beginPath(); c.moveTo(i * t, 0); c.lineTo(i * t, s); c.moveTo(0, i * t); c.lineTo(s, i * t); c.stroke(); }
    }, 1.6);
  },
  wood(base: string): THREE.CanvasTexture {
    TILE[`wood${base}`] = 1.5;
    return make(`wood${base}`, 256, (c, s, rnd) => {
      const planks = 6, h = s / planks;
      for (let i = 0; i < planks; i++) {
        c.fillStyle = shade(base, 0.85 + rnd() * 0.25);
        c.fillRect(0, i * h, s, h - 2);
        c.strokeStyle = shade(base, 0.7); c.globalAlpha = 0.35;
        for (let k = 0; k < 6; k++) { c.beginPath(); const y = i * h + rnd() * h; c.moveTo(0, y); c.bezierCurveTo(s * 0.3, y + 3, s * 0.6, y - 3, s, y + 1); c.stroke(); }
        c.globalAlpha = 1;
        c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(rnd() * s, i * h, 2, h);
      }
    }, (c, s, rnd) => {
      const planks = 6, h = s / planks;
      for (let i = 0; i < planks; i++) {
        c.fillStyle = grey(170); c.fillRect(0, i * h, s, h - 2);
        c.fillStyle = grey(30); c.fillRect(0, i * h + h - 2, s, 2);
        c.strokeStyle = grey(120); c.globalAlpha = 0.5;
        for (let k = 0; k < 6; k++) { c.beginPath(); const y = i * h + rnd() * h; c.moveTo(0, y); c.bezierCurveTo(s * 0.3, y + 3, s * 0.6, y - 3, s, y + 1); c.stroke(); }
        c.globalAlpha = 1;
        c.fillStyle = grey(40); c.fillRect(rnd() * s, i * h, 2, h);
      }
    }, 1.5);
  },
  carpet(base: string): THREE.CanvasTexture {
    TILE[`carpet${base}`] = 1;
    return make(`carpet${base}`, 128, (c, s, rnd) => { c.fillStyle = base; c.fillRect(0, 0, s, s); speckle(c, s, rnd, 4000, [shade(base, 0.85), shade(base, 1.15)], 1); }, (c, s, rnd) => grit(c, s, rnd, 5000, 1, 60, 200), 1.2);
  },
  roof(base: string): THREE.CanvasTexture {
    TILE[`roof${base}`] = 1.5;
    return make(`roof${base}`, 256, (c, s, rnd) => {
      c.fillStyle = base; c.fillRect(0, 0, s, s);
      const rows = 10, h = s / rows;
      for (let r = 0; r < rows; r++) for (let k = -1; k < 9; k++) {
        c.fillStyle = shade(base, 0.85 + rnd() * 0.25);
        c.fillRect(k * (s / 8) + (r % 2 ? s / 16 : 0) + 1, r * h + 1, s / 8 - 2, h - 2);
      }
    }, (c, s) => {
      // each row of tiles overlaps the one below: a ramp per row
      const rows = 10, h = s / rows;
      for (let r = 0; r < rows; r++) { const g = c.createLinearGradient(0, r * h, 0, r * h + h); g.addColorStop(0, grey(60)); g.addColorStop(1, grey(220)); c.fillStyle = g; c.fillRect(0, r * h, s, h); }
      c.fillStyle = grey(40);
      for (let r = 0; r < rows; r++) for (let k = -1; k < 9; k++) c.fillRect(k * (s / 8) + (r % 2 ? s / 16 : 0), r * h, 2, h);
    }, 2.5);
  },
  gravel(): THREE.CanvasTexture {
    TILE.gravel = 2;
    return make('gravel', 256, (c, s, rnd) => { c.fillStyle = '#6f7275'; c.fillRect(0, 0, s, s); speckle(c, s, rnd, 6000, ['#55585b', '#8a8d90', '#9c9890'], 2.5); }, (c, s, rnd) => grit(c, s, rnd, 8000, 2.5, 20, 240), 2.2);
  },
};

/** Scale a BoxGeometry's UVs so its texture tiles at `tile` metres on every face. */
export function worldUV(g: THREE.BoxGeometry, w: number, h: number, d: number, tile: number) {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // face order: +x, -x, +y, -y, +z, -z; 4 vertices each
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v;
    uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile, (uv.getY(i) * dims[f][1]) / tile);
  }
  uv.needsUpdate = true;
}

export function planeUV(g: THREE.PlaneGeometry, w: number, h: number, tile: number) {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * h) / tile);
  uv.needsUpdate = true;
}

export function signTexture(text: string, color: string, bg: string): { tex: THREE.CanvasTexture; aspect: number } {
  const cv = document.createElement('canvas');
  const c = cv.getContext('2d')!;
  c.font = '800 96px "Archivo Black", Arial Black, Arial, sans-serif';
  const w = Math.ceil(c.measureText(text).width + 120);
  cv.width = w; cv.height = 150;
  const g = c.createLinearGradient(0, 0, 0, 150);
  g.addColorStop(0, shade(bg, 1.15)); g.addColorStop(1, shade(bg, 0.85));
  c.fillStyle = g; c.fillRect(0, 0, w, 150);
  c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 6; c.strokeRect(6, 6, w - 12, 138);
  c.font = '800 96px "Archivo Black", Arial Black, Arial, sans-serif';
  c.fillStyle = color; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(text, w / 2, 80);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return { tex: t, aspect: w / 150 };
}
