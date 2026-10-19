// Face detail painted into a texture at load time: eyebrows drawn hair by hair, the lash line along
// the lid margins, the upper-lid crease and a soft shadow in the eye sockets. Each texel of the face
// is mapped back onto the base mesh, so the shapes are placed in 3D around the eyes rather than drawn
// by hand in UV space.
import * as THREE from 'three';

export interface FaceMask { tex: THREE.DataTexture; off: THREE.Vector2; scale: THREE.Vector2 }

const LASH_REGION = 11;
const PX_PER_UV = 4096;
const MAX_SIZE = 1024;

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const hash = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

/** distance from p to a polyline (points sorted along the lid) */
function polyDist(px: number, py: number, pz: number, line: number[][]): number {
  let best = 1e9;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    const l2 = abx * abx + aby * aby + abz * abz || 1e-12;
    const t = Math.min(1, Math.max(0, ((px - a[0]) * abx + (py - a[1]) * aby + (pz - a[2]) * abz) / l2));
    const dx = px - a[0] - abx * t, dy = py - a[1] - aby * t, dz = pz - a[2] - abz * t;
    best = Math.min(best, dx * dx + dy * dy + dz * dz);
  }
  return Math.sqrt(best);
}

export function buildFaceMask(pos: Float32Array, uv: Float32Array, index: Uint32Array, region: Uint8Array, eyes: [number[], number][]): FaceMask {
  // lid margins: the roots of the eyelash strips (lash vertices closest to each eyeball)
  const lids = eyes.map(([c, r]) => {
    const upper: number[][] = [], lower: number[][] = [];
    const seen = new Set<number>();
    for (let t = 0; t < region.length; t++) {
      if (region[t] !== LASH_REGION) continue;
      for (let k = 0; k < 3; k++) {
        const v = index[t * 3 + k];
        if (seen.has(v)) continue;
        seen.add(v);
        const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
        if (Math.sign(x) !== Math.sign(c[0])) continue;
        if (Math.hypot(x - c[0], y - c[1], z - c[2]) > r * 1.06) continue;
        (y > c[1] - 0.002 ? upper : lower).push([x, y, z]);
      }
    }
    upper.sort((a, b) => a[0] - b[0]);
    lower.sort((a, b) => a[0] - b[0]);
    return { c, r, upper, lower };
  });

  // the face's UV island: around the bridge of the nose (the eye sockets behind the eyeballs are separate islands)
  let anchor = -1, bestD = 1e9;
  const [ec] = eyes[0];
  for (let v = 0; v < pos.length / 3; v++) {
    const d = Math.hypot(pos[v * 3], pos[v * 3 + 1] - ec[1] - 0.005, pos[v * 3 + 2] - ec[2] - 0.03);
    if (d < bestD) { bestD = d; anchor = v; }
  }
  const au = uv[anchor * 2], av = uv[anchor * 2 + 1];
  // face triangles: head skin near the eyes
  const tris: number[] = [];
  let u0 = 1, v0 = 1, u1 = 0, v1 = 0;
  for (let t = 0; t < region.length; t++) {
    if (region[t] !== 0) continue;
    let ok = true;
    for (let k = 0; k < 3 && ok; k++) {
      const v = index[t * 3 + k];
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      ok = eyes.some(([c]) => Math.hypot(x - c[0], y - c[1]) < 0.06 && z > c[2] - 0.035) && Math.abs(uv[v * 2] - au) < 0.15 && Math.abs(uv[v * 2 + 1] - av) < 0.15;
    }
    if (!ok) continue;
    tris.push(t);
    for (let k = 0; k < 3; k++) {
      const v = index[t * 3 + k];
      u0 = Math.min(u0, uv[v * 2]); u1 = Math.max(u1, uv[v * 2]);
      v0 = Math.min(v0, uv[v * 2 + 1]); v1 = Math.max(v1, uv[v * 2 + 1]);
    }
  }
  const pad = 0.004;
  u0 -= pad; v0 -= pad; u1 += pad; v1 += pad;
  const ppu = Math.min(PX_PER_UV, MAX_SIZE / Math.max(u1 - u0, v1 - v0));
  const W = Math.max(4, Math.ceil((u1 - u0) * ppu)), H = Math.max(4, Math.ceil((v1 - v0) * ppu));
  const data = new Uint8Array(W * H * 4);

  const shade = (px: number, py: number, pz: number, out: number[]) => {
    let brow = 0, liner = 0, crease = 0, socket = 0;
    for (const L of lids) {
      const [cx, cy, cz] = L.c;
      if (Math.sign(px) !== Math.sign(cx) && Math.abs(px) > 0.004) continue;
      const lat = (px - cx) * Math.sign(cx); // + towards the temple
      const up = py - cy;
      if (pz < cz - 0.02) continue;
      // eyebrow: an arch over the eye, thick at the inner end, tapering to the tail
      const t = (lat + 0.017) / 0.045;
      if (t > -0.1 && t < 1.1) {
        const yc = 0.0150 + 0.005 * Math.sin(Math.PI * 0.5 * Math.min(1, Math.max(0, t) / 0.65)) - (t > 0.65 ? 0.0065 * Math.pow((t - 0.65) / 0.35, 1.5) : 0);
        const w = 0.0040 - 0.0027 * Math.pow(Math.min(1, Math.max(0, t)), 1.2);
        const across = Math.abs(up - yc);
        const body = smooth(w, w * 0.45, across) * smooth(-0.06, 0.1, t) * smooth(1.04, 0.88, t);
        if (body > 0) {
          // individual hairs: steep at the inner end, lying along the brow towards the tail
          const ang = 1.2 - 1.0 * Math.min(1, Math.max(0, t));
          const q = (lat * Math.sin(ang) - up * Math.cos(ang)) / 0.00055;
          const k = Math.floor(q);
          const off = hash(k) * 0.4;
          const line = smooth(0.32, 0.08, Math.abs(q - k - 0.5 - off * 0.3)) * (0.55 + 0.45 * hash(k + 17));
          const density = 0.6 + 0.4 * smooth(0, 0.3, t);
          brow = Math.max(brow, Math.min(1, body * density * (0.7 + 0.45 * line)));
        }
      }
      // lash line along the lid margins (heavier on the upper lid) and the upper-lid crease
      const du = L.upper.length > 1 ? polyDist(px, py, pz, L.upper) : 1;
      const dl = L.lower.length > 1 ? polyDist(px, py, pz, L.lower) : 1;
      liner = Math.max(liner, smooth(0.0017, 0.0005, du), 0.45 * smooth(0.0009, 0.0003, dl));
      const above = L.upper.length ? py - L.upper[L.upper.length >> 1][1] : 0;
      crease = Math.max(crease, smooth(0.0005, 0.003, above) * smooth(0.003, 0.0055, du) * smooth(0.0105, 0.0072, du));
      // soft shadow in the socket, strongest at the inner corner and under the eye
      const dEye = Math.hypot(px - cx, py - cy);
      socket = Math.max(socket, smooth(0.03, 0.017, dEye) * (0.6 + 0.4 * smooth(0.01, -0.01, lat)) * (0.7 + 0.3 * smooth(0.004, -0.004, up)));
    }
    out[0] = brow; out[1] = liner; out[2] = crease; out[3] = socket;
  };

  const out = [0, 0, 0, 0];
  for (const t of tris) {
    const a = index[t * 3], b = index[t * 3 + 1], c = index[t * 3 + 2];
    const ax = (uv[a * 2] - u0) * ppu, ay = (uv[a * 2 + 1] - v0) * ppu;
    const bx = (uv[b * 2] - u0) * ppu, by = (uv[b * 2 + 1] - v0) * ppu;
    const cx = (uv[c * 2] - u0) * ppu, cy = (uv[c * 2 + 1] - v0) * ppu;
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(den) < 1e-9) continue;
    const xs = Math.max(0, Math.floor(Math.min(ax, bx, cx)) - 1), xe = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)) + 1);
    const ys = Math.max(0, Math.floor(Math.min(ay, by, cy)) - 1), ye = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)) + 1);
    for (let y = ys; y <= ye; y++) for (let x = xs; x <= xe; x++) {
      const sx = x + 0.5, sy = y + 0.5;
      const w0 = ((by - cy) * (sx - cx) + (cx - bx) * (sy - cy)) / den;
      const w1 = ((cy - ay) * (sx - cx) + (ax - cx) * (sy - cy)) / den;
      const w2 = 1 - w0 - w1;
      // a little outside the triangle too, so edges and UV seams are covered
      if (w0 < -0.08 || w1 < -0.08 || w2 < -0.08) continue;
      const px = w0 * pos[a * 3] + w1 * pos[b * 3] + w2 * pos[c * 3];
      const py = w0 * pos[a * 3 + 1] + w1 * pos[b * 3 + 1] + w2 * pos[c * 3 + 1];
      const pz = w0 * pos[a * 3 + 2] + w1 * pos[b * 3 + 2] + w2 * pos[c * 3 + 2];
      shade(px, py, pz, out);
      const i = (y * W + x) * 4;
      for (let k = 0; k < 4; k++) data[i + k] = Math.max(data[i + k], Math.round(out[k] * 255));
    }
  }
  const tex = new THREE.DataTexture(data, W, H);
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return { tex, off: new THREE.Vector2(u0, v0), scale: new THREE.Vector2(W / ppu, H / ppu) };
}
