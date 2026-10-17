// Static world presentation built from the shared layout data: textured
// ground and roads, facades with framed windows, working doors, roofs,
// street furniture and detailed interiors.
import * as THREE from 'three';
import { getWorld, wallsFor, WALL_T, type BuildingDef, type Obstacle, type Rect } from '../sim/world/layout';
import { tex, TILE, worldUV, planeUV, signTexture } from './textures';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GameState } from '../sim/types';

let occ: THREE.Object3D[] = [];
const matCache = new Map<string, THREE.MeshStandardMaterial>();
const M = (color: string, rough = 0.9, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
  const k = `${color}|${rough}|${JSON.stringify(extra, (_k, v) => (v instanceof THREE.Color ? `#${v.getHexString()}` : v))}`;
  let m = matCache.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra }); matCache.set(k, m); }
  return m;
};
let glassShared: THREE.MeshStandardMaterial | null = null;
const metal = (color: string, rough = 0.35) => M(color, rough, { metalness: 0.6 });
const glassM = () => (glassShared ??= new THREE.MeshStandardMaterial({ color: '#9fc2d3', roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.32, depthWrite: false }));
const texMat = (t: THREE.Texture, rough = 0.9, color = '#ffffff') => new THREE.MeshStandardMaterial({ map: t, color, roughness: rough });

function box(w: number, h: number, d: number, m: THREE.Material | THREE.Material[], x: number, y: number, z: number, shadow = true, tile = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (tile) worldUV(g, w, h, d, tile);
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = shadow;
  o.receiveShadow = true;
  return o;
}
const rbox = (r: Rect, h: number, m: THREE.Material | THREE.Material[], y0 = 0, shadow = true, tile = 0) => box(r.x1 - r.x0, h, r.z1 - r.z0, m, (r.x0 + r.x1) / 2, y0 + h / 2, (r.z0 + r.z1) / 2, shadow, tile);
function cyl(rt: number, rb: number, h: number, m: THREE.Material, x: number, y: number, z: number, seg = 16) {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

// ------------------------------------------------------------------ doors
interface AnimDoor {
  kind: 'slide' | 'swing';
  center: THREE.Vector3;
  parts: { obj: THREE.Object3D; closed: THREE.Vector3; open: THREE.Vector3 | number }[];
  t: number;
}

export interface WorldView {
  group: THREE.Group;
  cutaway: Map<string, { roof: THREE.Object3D[]; walls: THREE.Mesh[]; fullH: number }>;
  windowsMat: THREE.MeshStandardMaterial[];
  lampBulbs: THREE.MeshStandardMaterial;
  lampLights: THREE.PointLight[];
  occluders: THREE.Object3D[];
  doors: AnimDoor[];
  update: (state: GameState, dt: number) => void;
}

function facadeFor(b: BuildingDef): { mat: THREE.MeshStandardMaterial; tile: number } {
  const id = b.id;
  let t: THREE.CanvasTexture;
  let key: string;
  if (id === 'flat' || id === 'terrace_w' || id === 'oldbank') { t = tex.brick(b.color); key = `brick${b.color}`; }
  else if (id === 'jobcentre' || id === 'chambers' || id === 'unit4' || id === 'wholesale' || id === 'warehouse_e' || id === 'garage_e') { t = tex.cladding(b.color); key = `clad${b.color}`; }
  else if (id.startsWith('house_')) { const hn = Number(id.slice(6)); if (hn % 2) { t = tex.brick(b.color); key = `brick${b.color}`; } else { t = tex.render(b.color); key = `render${b.color}`; } }
  else { t = tex.render(b.color); key = `render${b.color}`; }
  return { mat: texMat(t, 0.88), tile: TILE[key] };
}

const FLOOR: Record<string, () => { t: THREE.CanvasTexture; tile: number }> = {
  market: () => ({ t: tex.tiles('#e8e4dc', '#d4cfc4'), tile: TILE['tiles#e8e4dc#d4cfc4'] }),
  unit4: () => ({ t: tex.tiles('#d9dadb', '#c9cacb'), tile: TILE['tiles#d9dadb#c9cacb'] }),
  cafe: () => ({ t: tex.tiles('#c79a6b', '#e9dcc4', 6), tile: TILE['tiles#c79a6b#e9dcc4'] }),
  flat: () => ({ t: tex.wood('#a0784e'), tile: TILE['wood#a0784e'] }),
  jobcentre: () => ({ t: tex.carpet('#5c6f86'), tile: TILE['carpet#5c6f86'] }),
};

export function buildWorld(scene: THREE.Scene): WorldView {
  const w = getWorld();
  const g = new THREE.Group();
  scene.add(g);
  const cutaway: WorldView['cutaway'] = new Map();
  const windowsMat: THREE.MeshStandardMaterial[] = [];
  const doors: AnimDoor[] = [];
  occ = [];

  // ---------------- ground
  const grassT = tex.grass();
  const gg = new THREE.PlaneGeometry(260, 200);
  planeUV(gg, 260, 200, TILE.grass);
  const grass = new THREE.Mesh(gg, texMat(grassT, 1));
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(0, -0.02, 13);
  grass.receiveShadow = true;
  g.add(grass);
  const asphalt = texMat(tex.asphalt(), 0.95);
  const paving = texMat(tex.paving(), 0.9);
  const lane = texMat(tex.asphalt(), 0.95, '#d6d6d6');
  const yard = texMat(tex.gravel(), 0.95, '#cfcfcf');
  const kerbM = M('#a8a59e', 0.8);
  for (const r of w.roads) {
    const W = r.rect.x1 - r.rect.x0, D = r.rect.z1 - r.rect.z0, cx = (r.rect.x0 + r.rect.x1) / 2, cz = (r.rect.z0 + r.rect.z1) / 2;
    if (r.kind === 'grass') continue;
    const h = r.kind === 'sidewalk' || r.kind === 'plaza' ? 0.12 : 0.06;
    const tile = r.kind === 'road' || r.kind === 'lane' ? TILE.asphalt : r.kind === 'forecourt' ? TILE.gravel : TILE.paving;
    const mat = r.kind === 'road' ? asphalt : r.kind === 'lane' ? lane : r.kind === 'forecourt' ? yard : paving;
    g.add(box(W, h, D, mat, cx, h / 2 - 0.03, cz, false, tile));
    if (r.kind === 'sidewalk') {
      const along = W > D;
      if (along) { g.add(box(W, 0.16, 0.18, kerbM, cx, 0.05, r.rect.z0 + 0.09, false)); g.add(box(W, 0.16, 0.18, kerbM, cx, 0.05, r.rect.z1 - 0.09, false)); }
      else { g.add(box(0.18, 0.16, D, kerbM, r.rect.x0 + 0.09, 0.05, cz, false)); g.add(box(0.18, 0.16, D, kerbM, r.rect.x1 - 0.09, 0.05, cz, false)); }
    }
  }
  // road markings
  const paint = M('#ecebdf', 0.6);
  const yellow = M('#e5c33a', 0.6);
  for (let x = -94; x < 94; x += 6) if (Math.abs(x) > 9) g.add(box(3, 0.02, 0.14, paint, x, 0.04, 0, false));
  for (let z = -46; z < 74; z += 6) if (Math.abs(z) > 9) g.add(box(0.14, 0.02, 3, paint, 0, 0.04, z, false));
  for (const z of [-4.6, 4.6]) { g.add(box(85, 0.02, 0.1, yellow, -52, 0.035, z, false)); g.add(box(85, 0.02, 0.1, yellow, 52, 0.035, z, false)); }
  for (const [cx, cz, rot] of [[-12, 0, 0], [12, 0, 0], [0, -11, 1], [0, 11, 1], [-24, 0, 0], [17, 0, 0], [-70, 0, 0], [57, 0, 0]] as const) for (let i = -4; i <= 4; i++) {
    g.add(rot ? box(0.55, 0.02, 2.6, paint, i * 1.05, 0.042, cz, false) : box(2.6, 0.02, 0.55, paint, cx, 0.042, i * 1.05, false));
  }

  // ---------------- buildings
  for (const b of w.buildings) buildBuilding(g, b, cutaway, windowsMat, doors);

  // ---------------- furniture / props
  for (const o of w.obstacles) g.add(buildObstacle(o));

  // ---------------- street lamps
  const lampBulbs = M('#fff3c4', 0.4, { emissive: new THREE.Color('#ffcf70'), emissiveIntensity: 0 });
  const pole = metal('#2f3438', 0.5);
  for (const l of w.lamps) {
    g.add(cyl(0.07, 0.1, 5.2, pole, l.x, 2.6, l.z, 10));
    g.add(cyl(0.16, 0.16, 0.3, pole, l.x, 0.15, l.z, 10));
    const sideways = Math.abs(l.x) < 9 && Math.abs(l.z) > 9;
    const dir = sideways ? new THREE.Vector3(-Math.sign(l.x), 0, 0) : new THREE.Vector3(0, 0, -Math.sign(l.z || 1));
    g.add(box(Math.abs(dir.x) * 1.1 + 0.08, 0.08, Math.abs(dir.z) * 1.1 + 0.08, pole, l.x + dir.x * 0.55, 5.15, l.z + dir.z * 0.55));
    g.add(box(0.5, 0.12, 0.3, pole, l.x + dir.x * 1.05, 5.08, l.z + dir.z * 1.05));
    g.add(box(0.42, 0.04, 0.24, lampBulbs, l.x + dir.x * 1.05, 5.0, l.z + dir.z * 1.05, false));
  }
  const lampLights: THREE.PointLight[] = [];
  for (let i = 0; i < 6; i++) { const pl = new THREE.PointLight('#ffcf80', 0, 18, 1.6); pl.position.y = 4.6; g.add(pl); lampLights.push(pl); }

  // ---------------- parked cars
  for (const p of w.parked) g.add(buildCar(p.color, p.pos.x, p.pos.z, p.rot));

  // ---------------- hedges and paths in front of houses
  const hedge = M('#3f6b37', 1);
  for (const b of w.buildings) if (b.id.startsWith('house_')) {
    const east = b.rect.x0 > 0;
    const fx = east ? b.rect.x0 - 1.2 : b.rect.x1 + 1.2;
    const zc = (b.rect.z0 + b.rect.z1) / 2;
    g.add(box(0.6, 0.9, 3.0, hedge, fx, 0.45, zc - 3.0));
    g.add(box(0.6, 0.9, 3.0, hedge, fx, 0.45, zc + 3.0));
    g.add(box(Math.abs(fx - (east ? b.rect.x0 : b.rect.x1)) + 0.6, 0.04, 1.3, paving, (fx + (east ? b.rect.x0 : b.rect.x1)) / 2, 0.02, zc, false, TILE.paving));
  }

  bakeStatic(g, cutaway);

  const update = (state: GameState, dt: number) => {
    for (const d of doors) {
      let near = false;
      for (const p of Object.values(state.people)) {
        if (!p.visible) continue;
        if (Math.hypot(p.pos.x - d.center.x, p.pos.z - d.center.z) < 2.6) { near = true; break; }
      }
      d.t = Math.max(0, Math.min(1, d.t + (near ? 1 : -1) * dt * 2.2));
      const e = d.t * d.t * (3 - 2 * d.t);
      for (const part of d.parts) {
        if (typeof part.open === 'number') part.obj.rotation.y = part.open * e;
        else part.obj.position.lerpVectors(part.closed, part.open, e);
      }
    }
  };
  return { group: g, cutaway, windowsMat, lampBulbs, lampLights, occluders: occ, doors, update };
}

/** merge every static mesh that shares a material into one draw call */
function bakeStatic(g: THREE.Group, cutaway: WorldView['cutaway']) {
  const keep = new Set<THREE.Object3D>(occ);
  for (const c of cutaway.values()) { c.roof.forEach((o) => o.traverse((x) => keep.add(x))); c.walls.forEach((o) => keep.add(o)); }
  g.updateMatrixWorld(true);
  const buckets = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; shadow: boolean }[]>();
  const victims: THREE.Mesh[] = [];
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || keep.has(m) || m.userData.dynamic || Array.isArray(m.material)) return;
    let geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    geo.applyMatrix4(m.matrixWorld);
    for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
    if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((geo.getAttribute('position').count) * 2), 2));
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    geo = geo.index ? geo.toNonIndexed() : geo;
    const list = buckets.get(m.material as THREE.Material) ?? [];
    let bucket = list.find((b) => b.shadow === m.castShadow);
    if (!bucket) { bucket = { geos: [], shadow: m.castShadow }; list.push(bucket); }
    bucket.geos.push(geo);
    buckets.set(m.material as THREE.Material, list);
    victims.push(m);
  });
  for (const v of victims) v.parent?.remove(v);
  for (const [mat, list] of buckets) for (const b of list) {
    const merged = mergeGeometries(b.geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = b.shadow;
    mesh.receiveShadow = true;
    g.add(mesh);
  }
}

// ------------------------------------------------------------------ buildings
function wallOutwardFace(r: Rect, b: BuildingDef): number {
  const cx = (b.rect.x0 + b.rect.x1) / 2, cz = (b.rect.z0 + b.rect.z1) / 2;
  const horiz = r.x1 - r.x0 > r.z1 - r.z0;
  if (horiz) return (r.z0 + r.z1) / 2 < cz ? 5 : 4;
  return (r.x0 + r.x1) / 2 < cx ? 1 : 0;
}

function windowMesh(w: number, h: number, frameCol: string, lit: THREE.MeshStandardMaterial, inner = false) {
  const grp = new THREE.Group();
  const fm = M(frameCol, 0.5);
  const glass = inner ? M('#d9ecf5', 0.1, { emissive: new THREE.Color('#bfe0f0'), emissiveIntensity: 0.35 }) : lit;
  grp.add(box(w, h, 0.03, glass, 0, 0, 0, false));
  grp.add(box(w + 0.12, 0.08, 0.1, fm, 0, h / 2, 0, false));
  grp.add(box(w + 0.12, 0.08, 0.1, fm, 0, -h / 2, 0, false));
  grp.add(box(0.08, h, 0.1, fm, -w / 2, 0, 0, false));
  grp.add(box(0.08, h, 0.1, fm, w / 2, 0, 0, false));
  grp.add(box(0.05, h, 0.06, fm, 0, 0, 0, false));
  if (!inner) grp.add(box(w + 0.25, 0.06, 0.22, M('#d8d4cc', 0.7), 0, -h / 2 - 0.05, 0.06, false));
  return grp;
}

function buildBuilding(g: THREE.Group, b: BuildingDef, cutaway: WorldView['cutaway'], windowsMat: THREE.MeshStandardMaterial[], doors: AnimDoor[]) {
  const { x0, z0, x1, z1 } = b.rect;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, W = x1 - x0, D = z1 - z0;
  const roofs: THREE.Object3D[] = [];
  const wallsOut: THREE.Mesh[] = [];
  const facade = facadeFor(b);
  const litGlass = M('#2a3a46', 0.08, { metalness: 0.4, emissive: new THREE.Color('#000000') });
  if (!windowsMat.includes(litGlass)) windowsMat.push(litGlass);
  const trimM = M(b.trim, 0.6);
  if (b.interior) {
    const innerT = tex.plaster(b.id === 'flat' ? '#e8dfcf' : b.id === 'cafe' ? '#efe2c8' : b.id === 'jobcentre' ? '#e4e8ec' : '#eceae4');
    const innerM = texMat(innerT, 0.95);
    for (const r of wallsFor(b)) {
      const isInternal = b.internalWalls?.includes(r);
      const mats = [innerM, innerM, M(b.trim, 0.8), innerM, innerM, innerM];
      if (!isInternal) mats[wallOutwardFace(r, b)] = facade.mat;
      const m = rbox(r, 3.2, mats, 0, true, facade.tile);
      g.add(m);
      wallsOut.push(m);
      occ.push(m);
      if (!isInternal) {
        const horiz = r.x1 - r.x0 > r.z1 - r.z0;
        const inwardOff = horiz ? ((r.z0 + r.z1) / 2 < cz ? 0.17 : -0.17) : ((r.x0 + r.x1) / 2 < cx ? 0.17 : -0.17);
        const sk = horiz ? box(r.x1 - r.x0, 0.12, 0.03, M('#f6f3ee', 0.6), (r.x0 + r.x1) / 2, 0.1, (r.z0 + r.z1) / 2 + inwardOff, false) : box(0.03, 0.12, r.z1 - r.z0, M('#f6f3ee', 0.6), (r.x0 + r.x1) / 2 + inwardOff, 0.1, (r.z0 + r.z1) / 2, false);
        g.add(sk);
      }
    }
    const fl = FLOOR[b.id]?.() ?? { t: tex.tiles('#cccccc', '#bbbbbb'), tile: 1.2 };
    g.add(box(W, 0.08, D, texMat(fl.t, 0.75), cx, 0.04, cz, false, fl.tile));
    // framed windows on both faces of the exterior walls, avoiding doors
    for (const ws of [{ side: 'zmin', len: W }, { side: 'zmax', len: W }, { side: 'xmin', len: D }, { side: 'xmax', len: D }] as const) {
      const shopFront = (b.id === 'market' && ws.side === 'zmax') || (b.id === 'unit4' && ws.side === 'zmin') || (b.id === 'cafe' && ws.side === 'zmin');
      const spacing = shopFront ? 3.4 : 3.2;
      const n = Math.floor((ws.len - 2) / spacing);
      for (let i = 0; i < n; i++) {
        const along = (ws.side === 'zmin' || ws.side === 'zmax' ? x0 : z0) + 1 + spacing * (i + 0.5) + ((ws.len - 2) - n * spacing) / 2;
        if (b.doors.some((d) => d.side === ws.side && along > d.a - 1.7 && along < d.b + 1.7)) continue;
        if ((ws.side === 'zmin' || ws.side === 'zmax') && b.internalWalls?.some((r) => along > r.x0 - 1 && along < r.x1 + 1 && r.x1 - r.x0 < 1)) continue;
        if ((ws.side === 'xmin' || ws.side === 'xmax') && b.internalWalls?.some((r) => along > r.z0 - 1 && along < r.z1 + 1 && r.z1 - r.z0 < 1)) continue;
        const ww = shopFront ? 2.6 : 1.5, wh = shopFront ? 2.0 : 1.3, wy = shopFront ? 1.35 : 1.65;
        for (const inner of [false, true]) {
          const win = windowMesh(ww, wh, b.trim, litGlass, inner);
          const off = (WALL_T / 2 + 0.02) * (inner ? -1 : 1);
          if (ws.side === 'zmin') { win.position.set(along, wy, z0 - off); win.rotation.y = Math.PI; }
          if (ws.side === 'zmax') win.position.set(along, wy, z1 + off);
          if (ws.side === 'xmin') { win.position.set(x0 - off, wy, along); win.rotation.y = -Math.PI / 2; }
          if (ws.side === 'xmax') { win.position.set(x1 + off, wy, along); win.rotation.y = Math.PI / 2; }
          if (inner) win.rotation.y += Math.PI;
          g.add(win);
        }
      }
    }
    if (b.height > 3.3) {
      const upH = b.height - 3.2;
      const upper = box(W + WALL_T, upH, D + WALL_T, [facade.mat, facade.mat, M(b.roof), M(b.roof), facade.mat, facade.mat], cx, 3.2 + upH / 2, cz, true, facade.tile);
      roofs.push(upper);
      occ.push(upper);
      g.add(upper);
      for (const [bx, bz, bw, bd] of [[cx, z0 - 0.12, W + 0.6, 0.18], [cx, z1 + 0.12, W + 0.6, 0.18], [x0 - 0.12, cz, 0.18, D + 0.6], [x1 + 0.12, cz, 0.18, D + 0.6]]) {
        const band = box(bw, 0.18, bd, trimM, bx, 3.28, bz);
        roofs.push(band);
        g.add(band);
      }
      if (b.floors > 1) {
        for (const s of ['zmin', 'zmax'] as const) {
          const n = Math.floor((W - 2) / 3.2);
          for (let i = 0; i < n; i++) {
            const along = x0 + 1 + 3.2 * (i + 0.5) + ((W - 2) - n * 3.2) / 2;
            const win = windowMesh(1.4, 1.4, b.trim, litGlass);
            win.position.set(along, 3.2 + upH / 2, s === 'zmin' ? z0 - WALL_T / 2 - 0.03 : z1 + WALL_T / 2 + 0.03);
            if (s === 'zmin') win.rotation.y = Math.PI;
            roofs.push(win);
            g.add(win);
          }
        }
      }
    }
    const roofTop = b.height;
    const roof = box(W + 0.6, 0.25, D + 0.6, texMat(tex.gravel(), 0.95), cx, roofTop + 0.12, cz, true, TILE.gravel);
    roofs.push(roof);
    g.add(roof);
    for (const [px, pz, pw, pd] of [[cx, z0 - 0.2, W + 0.6, 0.2], [cx, z1 + 0.2, W + 0.6, 0.2], [x0 - 0.2, cz, 0.2, D + 0.6], [x1 + 0.2, cz, 0.2, D + 0.6]]) {
      const par = box(pw, 0.5, pd, trimM, px, roofTop + 0.45, pz);
      roofs.push(par);
      g.add(par);
    }
    if (b.id !== 'flat') { const hv = box(1.6, 0.9, 1.1, metal('#9aa3a8'), x1 - 3, roofTop + 0.7, z0 + 3); roofs.push(hv); g.add(hv); }
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), M('#f3f1ec', 0.95));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(cx, 3.19, cz);
    roofs.push(ceil);
    g.add(ceil);
    const panel = M('#ffffff', 0.3, { emissive: new THREE.Color('#fff6e0'), emissiveIntensity: 0.6 });
    for (let x = x0 + 3; x < x1 - 1.5; x += 5) for (let z = z0 + 3; z < z1 - 1.5; z += 5) { const p = box(1.4, 0.04, 0.5, panel, x, 3.16, z, false); roofs.push(p); g.add(p); }
    const nL = Math.max(1, Math.round((W * D) / 220));
    for (let i = 0; i < nL; i++) {
      const pl = new THREE.PointLight('#fff1dc', 7, Math.max(W, D) * 1.0, 1.6);
      pl.position.set(x0 + (W * (i + 0.5)) / nL, 2.9, cz);
      g.add(pl);
    }
    for (const d of b.doors) addDoor(g, b, d.side, d.a, d.b, d.open, doors);
    cutaway.set(b.id, { roof: roofs, walls: wallsOut, fullH: 3.2 });
  } else {
    const isHouse = b.id.startsWith('house_');
    const shell = box(W, b.height, D, facade.mat, cx, b.height / 2, cz, true, facade.tile);
    g.add(shell);
    occ.push(shell);
    g.add(box(W + 0.1, 0.4, D + 0.1, M('#7d7a73', 0.9), cx, 0.2, cz));
    const storeyH = b.height / Math.max(1, b.floors);
    for (const side of ['zmin', 'zmax', 'xmin', 'xmax'] as const) {
      const len = side === 'zmin' || side === 'zmax' ? W : D;
      const n = Math.max(1, Math.floor((len - 1.5) / (isHouse ? 3 : 3.4)));
      for (let f = 0; f < b.floors; f++) for (let i = 0; i < n; i++) {
        const along = (side === 'zmin' || side === 'zmax' ? x0 : z0) + (len / n) * (i + 0.5);
        if (f === 0 && b.doors.some((d) => d.side === side && along > d.a - 1.2 && along < d.b + 1.2)) continue;
        const win = windowMesh(isHouse ? 1.2 : 1.5, isHouse ? 1.25 : 1.5, b.trim, litGlass);
        const y = f * storeyH + storeyH * 0.55;
        if (side === 'zmin') { win.position.set(along, y, z0 - 0.04); win.rotation.y = Math.PI; }
        if (side === 'zmax') win.position.set(along, y, z1 + 0.04);
        if (side === 'xmin') { win.position.set(x0 - 0.04, y, along); win.rotation.y = -Math.PI / 2; }
        if (side === 'xmax') { win.position.set(x1 + 0.04, y, along); win.rotation.y = Math.PI / 2; }
        g.add(win);
      }
    }
    if (isHouse) {
      const rh = 2.4;
      const shape = new THREE.Shape();
      shape.moveTo(-W / 2 - 0.4, 0); shape.lineTo(W / 2 + 0.4, 0); shape.lineTo(0, rh); shape.lineTo(-W / 2 - 0.4, 0);
      const rg = new THREE.ExtrudeGeometry(shape, { depth: D + 0.6, bevelEnabled: false });
      rg.translate(0, 0, -(D + 0.6) / 2);
      const uv = rg.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 1.5, uv.getY(i) / 1.5);
      const roof = new THREE.Mesh(rg, texMat(tex.roof(b.roof), 0.85));
      roof.position.set(cx, b.height, cz);
      roof.castShadow = true;
      g.add(roof);
      g.add(box(0.6, 1.6, 0.6, texMat(tex.brick('#8a4b3a'), 0.9), cx + W * 0.25, b.height + 1.6, cz + D * 0.2, true, 1.2));
    } else {
      g.add(box(W + 0.3, 0.3, D + 0.3, texMat(tex.gravel(), 0.95), cx, b.height + 0.15, cz, true, TILE.gravel));
      for (const [px, pz, pw, pd] of [[cx, z0, W + 0.3, 0.25], [cx, z1, W + 0.3, 0.25], [x0, cz, 0.25, D + 0.3], [x1, cz, 0.25, D + 0.3]]) g.add(box(pw, 0.5, pd, trimM, px, b.height + 0.45, pz));
    }
    for (const d of b.doors) addDoor(g, b, d.side, d.a, d.b, false, doors);
  }
  if (b.sign) {
    const { tex: st, aspect } = signTexture(b.sign.text, b.sign.color, b.sign.bg);
    const h = 0.75;
    const sw = Math.min(h * aspect, W * 0.7);
    const bgM = M(b.sign.bg, 0.6);
    const sm = new THREE.Mesh(new THREE.BoxGeometry(sw, sw / aspect, 0.08), [bgM, bgM, bgM, bgM, new THREE.MeshStandardMaterial({ map: st, roughness: 0.5, emissive: new THREE.Color('#ffffff'), emissiveMap: st, emissiveIntensity: 0.25 }), bgM]);
    const y = b.interior ? 2.85 : Math.min(b.height - 0.7, 3.4);
    if (b.sign.side === 'zmax') sm.position.set(cx, y, z1 + 0.22);
    if (b.sign.side === 'zmin') { sm.position.set(cx, y, z0 - 0.22); sm.rotation.y = Math.PI; }
    sm.castShadow = true;
    g.add(sm);
  }
}

function addDoor(g: THREE.Group, b: BuildingDef, side: string, a: number, c: number, open: boolean, doors: AnimDoor[]) {
  const { x0, z0, x1, z1 } = b.rect;
  const w = c - a, mid = (a + c) / 2, h = 2.4;
  const along = side === 'zmin' || side === 'zmax';
  const px = side === 'xmin' ? x0 : side === 'xmax' ? x1 : mid;
  const pz = side === 'zmin' ? z0 : side === 'zmax' ? z1 : mid;
  const outward = side === 'zmin' || side === 'xmin' ? -1 : 1;
  const grp = new THREE.Group();
  grp.position.set(px, 0, pz);
  if (!along) grp.rotation.y = Math.PI / 2;
  // local space: door spans x in [-w/2, w/2]; the wall plane is z = 0
  const out = along ? outward : -outward;
  const frameM = M(b.trim, 0.5);
  grp.add(box(w + 0.3, 0.22, WALL_T + 0.1, frameM, 0, h + 0.11, 0));
  grp.add(box(0.12, h, WALL_T + 0.1, frameM, -w / 2 - 0.06, h / 2, 0));
  grp.add(box(0.12, h, WALL_T + 0.1, frameM, w / 2 + 0.06, h / 2, 0));
  grp.add(box(w + 0.6, 0.06, 0.8, M('#8d8a83', 0.8), 0, 0.03, out * 0.45, false));
  const shop = b.id === 'market' || b.id === 'unit4' || b.id === 'cafe' || b.id === 'jobcentre';
  const center = new THREE.Vector3(px, 0, pz);
  if (open && shop) {
    // automatic sliding glass doors
    const leafW = w / 2;
    const parts: AnimDoor['parts'] = [];
    for (const s of [-1, 1]) {
      const leaf = new THREE.Group();
      leaf.add(box(leafW, h - 0.05, 0.04, glassM(), 0, (h - 0.05) / 2, 0, false));
      leaf.add(box(leafW, 0.08, 0.06, metal('#c9ccd0'), 0, h - 0.08, 0, false));
      leaf.add(box(leafW, 0.08, 0.06, metal('#c9ccd0'), 0, 0.06, 0, false));
      leaf.add(box(0.05, h - 0.05, 0.06, metal('#c9ccd0'), -s * leafW / 2, (h - 0.05) / 2, 0, false));
      const closed = new THREE.Vector3(s * leafW / 2, 0, 0);
      leaf.position.copy(closed);
      grp.add(leaf);
      parts.push({ obj: leaf, closed, open: new THREE.Vector3(s * (leafW / 2 + leafW * 0.95), 0, 0) });
    }
    doors.push({ kind: 'slide', center, parts, t: 0 });
    grp.add(box(w + 1.2, 0.12, 1.2, M(b.trim, 0.6), 0, h + 0.5, out * 0.6));
  } else if (open) {
    // hinged wooden door that swings inward when someone approaches
    const pivot = new THREE.Group();
    pivot.position.set(-w / 2, 0, 0);
    const leaf = panelDoor(w, h);
    leaf.position.set(w / 2, 0, 0);
    pivot.add(leaf);
    grp.add(pivot);
    doors.push({ kind: 'swing', center, parts: [{ obj: pivot, closed: new THREE.Vector3(0, 0, 0), open: -out * 1.4 }], t: 0 });
    grp.add(box(w + 0.8, 0.1, 0.9, M(b.trim, 0.6), 0, h + 0.35, out * 0.45));
  } else if (b.id === 'wholesale' && w > 4) {
    const rm = M('#9aa0a6', 0.6, { metalness: 0.4 });
    for (let y = 0.1; y < h + 1.4; y += 0.18) grp.add(box(w, 0.15, 0.06, rm, 0, y, out * 0.02, false));
  } else {
    const leaf = panelDoor(w, h);
    leaf.position.z = out * 0.02;
    grp.add(leaf);
    grp.add(box(w + 0.8, 0.1, 0.9, M(b.trim, 0.6), 0, h + 0.35, out * 0.45));
    grp.add(box(0.15, 0.25, 0.12, M('#fff3c4', 0.4, { emissive: new THREE.Color('#ffcf70'), emissiveIntensity: 0.6 }), w / 2 + 0.35, h - 0.2, out * 0.12, false));
  }
  grp.traverse((o) => (o.userData.dynamic = true));
  g.add(grp);
}

function panelDoor(w: number, h: number) {
  const leaf = new THREE.Group();
  leaf.add(box(w, h - 0.02, 0.05, M('#5b3a26', 0.55), 0, h / 2, 0));
  const inset = M('#4e3121', 0.6);
  for (const [y, hh] of [[0.6, 0.8], [1.6, 0.8]]) for (const xo of [-w / 4, w / 4]) {
    if (w < 1.4 && xo > 0) continue;
    leaf.add(box(w < 1.4 ? w * 0.6 : w * 0.38, hh, 0.07, inset, w < 1.4 ? 0 : xo, y, 0, false));
  }
  const knob = cyl(0.025, 0.025, 0.14, metal('#d6c16b', 0.3), w * 0.38, 1.05, 0.06, 8);
  knob.rotation.x = Math.PI / 2;
  leaf.add(knob);
  return leaf;
}

// ------------------------------------------------------------------ furniture & props
function buildObstacle(o: Obstacle): THREE.Object3D {
  const r = o.rect;
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, W = r.x1 - r.x0, D = r.z1 - r.z0;
  const grp = new THREE.Group();
  switch (o.kind) {
    case 'gondola': {
      const frame = metal('#dfe2e6', 0.4);
      grp.add(box(0.06, o.height, D, M('#c9ced4', 0.6), cx, o.height / 2, cz));
      grp.add(box(W, 0.12, D, M('#9aa1a8', 0.6), cx, 0.06, cz));
      for (const y of [0.17, 0.62, 1.07, 1.52]) {
        grp.add(box(W, 0.035, D, frame, cx, y, cz, false));
        grp.add(box(0.02, 0.05, D, M('#f4f4f0', 0.5), r.x0 - 0.005, y - 0.03, cz, false));
        grp.add(box(0.02, 0.05, D, M('#f4f4f0', 0.5), r.x1 + 0.005, y - 0.03, cz, false));
      }
      for (const z of [r.z0, r.z1]) grp.add(box(W, o.height, 0.05, frame, cx, o.height / 2, z));
      grp.add(box(0.05, 0.3, D * 0.7, M('#2e8b57', 0.5), cx, o.height + 0.3, cz));
      break;
    }
    case 'counter': {
      grp.add(box(W, o.height - 0.05, D, M(o.color ?? '#8b6f4e', 0.6), cx, (o.height - 0.05) / 2, cz));
      grp.add(box(W + 0.05, 0.05, D + 0.05, M('#2b2b2b', 0.35), cx, o.height, cz));
      if (!o.color) {
        grp.add(box(W * 0.55, 0.03, D * 0.6, M('#1a1a1a', 0.9), cx - W * 0.18, o.height + 0.03, cz));
        grp.add(box(0.4, 0.3, 0.04, M('#111', 0.3, { emissive: new THREE.Color('#2a6fbf'), emissiveIntensity: 0.5 }), cx + W * 0.3, o.height + 0.32, cz - D * 0.2));
        grp.add(box(0.05, 0.25, 0.05, metal('#444'), cx + W * 0.3, o.height + 0.13, cz - D * 0.2));
        grp.add(box(0.1, 0.04, 0.16, M('#222', 0.4), cx + W * 0.12, o.height + 0.04, cz + D * 0.25));
        grp.add(box(0.5, 0.35, 0.02, M('#e6e6e6', 0.8), cx + W * 0.42, o.height + 0.2, cz + D * 0.3));
      } else {
        grp.add(box(0.6, 0.45, 0.4, metal('#b9bcc0'), cx - W * 0.3, o.height + 0.23, cz));
        grp.add(box(1.2, 0.35, 0.5, glassM(), cx + W * 0.15, o.height + 0.18, cz));
        for (let i = 0; i < 4; i++) grp.add(cyl(0.1, 0.1, 0.08, M(['#a0522d', '#f3e3c3', '#7b3f2a', '#e8c39e'][i]), cx + W * 0.15 - 0.45 + i * 0.3, o.height + 0.06, cz, 12));
      }
      break;
    }
    case 'pallet': {
      const wood = M('#a5814f', 0.9);
      for (const dz of [-0.45, 0, 0.45]) grp.add(box(W, 0.1, 0.12, wood, cx, 0.05, cz + (dz * D) / 1.2));
      grp.add(box(W, 0.04, D, wood, cx, 0.12, cz));
      break;
    }
    case 'kiosk': grp.add(box(W, o.height, D, M('#2d3b49', 0.4), cx, o.height / 2, cz)); grp.add(box(0.05, 0.42, 0.6, M('#0e2230', 0.2, { emissive: new THREE.Color('#3a9bd8'), emissiveIntensity: 0.7 }), cx + W / 2, 1.2, cz)); grp.add(box(W + 0.1, 0.05, D + 0.2, metal('#c0c4c8'), cx, 0.95, cz)); break;
    case 'terminal': grp.add(box(W, 0.55, D, M('#2b2f33', 0.4), cx, 1.3, cz)); grp.add(box(W * 0.8, 0.38, 0.02, M('#0a1a0a', 0.2, { emissive: new THREE.Color('#3fbf5f'), emissiveIntensity: 0.6 }), cx, 1.32, r.z0 - 0.01)); break;
    case 'cupboard': grp.add(box(W, o.height, D, M('#7d8a96', 0.5), cx, o.height / 2, cz)); break;
    case 'bed': {
      const frame = M('#6b4f3a', 0.7);
      grp.add(box(W, 0.35, D, frame, cx, 0.18, cz));
      grp.add(box(0.12, 1.0, D, frame, r.x1 - 0.06, 0.5, cz));
      grp.add(box(W - 0.2, 0.2, D - 0.1, M('#f2efe8', 0.9), cx - 0.04, 0.45, cz));
      grp.add(box(W * 0.62, 0.1, D - 0.04, M('#4e6e9e', 0.95), r.x0 + W * 0.33, 0.58, cz));
      for (const dz of [-0.55, 0.55]) grp.add(box(0.45, 0.14, 0.75, M('#ffffff', 0.9), r.x1 - 0.42, 0.62, cz + dz * (D / 2.4)));
      grp.add(box(0.5, 0.5, 0.45, M('#8a6a4a', 0.7), r.x1 - 0.3, 0.25, r.z0 - 0.35));
      break;
    }
    case 'kitchen': {
      const carcass = M('#e9e5dc', 0.6);
      grp.add(box(W, o.height - 0.05, D, carcass, cx, (o.height - 0.05) / 2, cz));
      grp.add(box(W, 0.05, D + 0.02, M('#3d3d3d', 0.3), cx, o.height, cz));
      for (let x = r.x0 + 1.1; x < r.x1 - 0.3; x += 0.6) { grp.add(box(0.56, 0.7, 0.02, M('#d9d3c6', 0.5), x, 0.45, r.z0 - 0.01, false)); grp.add(box(0.2, 0.02, 0.03, metal('#999'), x, 0.75, r.z0 - 0.025, false)); }
      grp.add(box(0.6, 0.05, 0.45, metal('#c6c9cc', 0.25), cx + 0.8, o.height + 0.01, cz));
      grp.add(box(0.75, 1.95, D, M('#f0f2f3', 0.3), r.x0 + 0.38, 0.98, cz));
      grp.add(box(0.03, 0.6, 0.03, metal('#aaa'), r.x0 + 0.7, 1.3, r.z0 - 0.02, false));
      grp.add(box(W - 1, 0.6, 0.35, carcass, cx + 0.5, 1.75, r.z1 - 0.18));
      break;
    }
    case 'stove': {
      grp.add(box(W, o.height - 0.05, D, M('#2f3236', 0.4), cx, (o.height - 0.05) / 2, cz));
      grp.add(box(W, 0.04, D, M('#151515', 0.2), cx, o.height, cz));
      for (const [dx, dz] of [[-0.3, -0.2], [0.3, -0.2], [-0.3, 0.2], [0.3, 0.2]]) grp.add(cyl(0.11, 0.11, 0.015, M('#444', 0.4), cx + dx, o.height + 0.025, cz + dz, 16));
      grp.add(box(W * 0.8, 0.3, 0.02, M('#111', 0.15), cx, 0.45, r.z0 - 0.01, false));
      break;
    }
    case 'table': {
      grp.add(box(W, 0.05, D, M('#8b6a48', 0.55), cx, o.height, cz));
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) grp.add(box(0.06, o.height, 0.06, M('#5a4430'), cx + dx * (W / 2 - 0.1), o.height / 2, cz + dz * (D / 2 - 0.1)));
      for (const dz of [-1, 1]) {
        const chz = cz + dz * (D / 2 + 0.3);
        grp.add(box(0.45, 0.05, 0.45, M('#6f5640', 0.6), cx, 0.46, chz));
        grp.add(box(0.45, 0.5, 0.05, M('#6f5640', 0.6), cx, 0.72, chz + dz * 0.22));
        for (const [ex, ez] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) grp.add(box(0.04, 0.46, 0.04, M('#4a3a2a'), cx + ex, 0.23, chz + ez));
      }
      grp.add(box(0.36, 0.02, 0.25, M('#2b2f33', 0.3), cx, o.height + 0.035, cz - 0.2));
      const scr = box(0.36, 0.24, 0.015, M('#1a2a3a', 0.2, { emissive: new THREE.Color('#2b5f8f'), emissiveIntensity: 0.6 }), cx, o.height + 0.15, cz - 0.33);
      scr.rotation.x = 0.25;
      grp.add(scr);
      break;
    }
    case 'wardrobe':
      grp.add(box(W, o.height, D, M('#7a5638', 0.6), cx, o.height / 2, cz));
      grp.add(box(0.02, o.height - 0.2, 0.02, M('#3a2a1c'), cx, o.height / 2, r.z1 + 0.01, false));
      for (const dx of [-0.08, 0.08]) grp.add(box(0.03, 0.3, 0.03, metal('#c9b26b'), cx + dx, 1.1, r.z1 + 0.03, false));
      break;
    case 'sofa': {
      const fab = M('#4f6d60', 0.95);
      grp.add(box(W, 0.4, D, fab, cx, 0.2, cz));
      grp.add(box(0.3, 0.85, D, fab, r.x0 + 0.15, 0.43, cz));
      for (const z of [r.z0 + 0.12, r.z1 - 0.12]) grp.add(box(W, 0.6, 0.24, fab, cx, 0.3, z));
      for (const z of [cz - D / 4, cz + D / 4]) grp.add(box(W - 0.4, 0.14, D / 2 - 0.3, M('#5d7d6f', 0.95), cx + 0.1, 0.46, z));
      break;
    }
    case 'tv':
      grp.add(box(W, o.height, D, M('#3a2e25', 0.6), cx, o.height / 2, cz));
      grp.add(box(0.05, 0.75, 1.3, M('#0b0b0d', 0.15, { emissive: new THREE.Color('#1d3557'), emissiveIntensity: 0.5 }), cx, o.height + 0.45, cz));
      break;
    case 'shower':
      grp.add(box(W, 0.1, D, M('#f4f4f4', 0.3), cx, 0.05, cz));
      grp.add(box(0.03, o.height, D, glassM(), r.x0, o.height / 2, cz, false));
      grp.add(box(W, o.height, 0.03, M('#e8eef0', 0.4), cx, o.height / 2, r.z0));
      grp.add(cyl(0.12, 0.12, 0.03, metal('#ccc'), cx + 0.3, 2.0, cz, 12));
      grp.add(box(0.5, 0.4, 0.4, M('#fafafa', 0.3), r.x1 - 0.25, 0.85, r.z1 + 0.6));
      grp.add(box(0.02, 0.7, 0.6, M('#cfe3ea', 0.05, { metalness: 0.8 }), r.x1 - 0.02, 1.5, r.z1 + 0.6, false));
      break;
    case 'rug': grp.add(box(W, 0.015, D, texMat(tex.carpet('#8a3e3a'), 1), cx, 0.09, cz, false, 1)); break;
    case 'plant':
      grp.add(cyl(0.22, 0.17, 0.4, M('#9a5b3a', 0.8), cx, 0.2, cz, 12));
      for (let i = 0; i < 5; i++) { const lf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), M('#3f7f45', 0.9)); lf.position.set(cx + Math.sin(i * 1.3) * 0.12, 0.6 + i * 0.12, cz + Math.cos(i * 1.3) * 0.12); lf.castShadow = true; grp.add(lf); }
      break;
    case 'lampstand': grp.add(cyl(0.02, 0.02, 1.5, metal('#333'), cx, 0.75, cz, 8)); grp.add(cyl(0.15, 0.2, 0.25, M('#f3e8d0', 0.8, { emissive: new THREE.Color('#ffdca0'), emissiveIntensity: 0.4 }), cx, 1.55, cz, 14)); break;
    case 'board':
      grp.add(box(W, 1.4, D, M('#c9a66b', 0.8), cx, 1.5, cz));
      for (let i = 0; i < 8; i++) grp.add(box(0.55, 0.42, 0.02, M(['#ffffff', '#fff6b0', '#d9f0ff', '#ffe0e0'][i % 4], 0.9), r.x0 + 0.5 + (i % 4) * 1.45, 1.25 + Math.floor(i / 4) * 0.55, r.z1 + 0.01, false));
      grp.add(box(W, 0.2, 0.05, M('#1f4e79', 0.6), cx, 2.35, r.z1));
      break;
    case 'desk':
      grp.add(box(W, 0.05, D, M('#b8bec5', 0.5), cx, o.height, cz));
      grp.add(box(W, o.height, 0.04, M('#7b8794', 0.6), cx, o.height / 2, r.z1));
      grp.add(box(0.5, 0.35, 0.04, M('#111', 0.2, { emissive: new THREE.Color('#2b5f8f'), emissiveIntensity: 0.5 }), cx, o.height + 0.28, cz));
      grp.add(box(0.5, 0.45, 0.5, M('#333', 0.6), cx, 0.5, r.z0 - 0.5));
      break;
    case 'tree': {
      grp.add(cyl(0.16, 0.24, 2.6, M('#5d4330', 0.95), cx, 1.3, cz, 10));
      const greens = ['#3f7a3a', '#4b8a43', '#356b31'];
      for (let i = 0; i < 6; i++) {
        const c = new THREE.Mesh(new THREE.IcosahedronGeometry(1.0 + (i % 3) * 0.25, 1), M(greens[i % 3], 0.95));
        c.position.set(cx + Math.sin(i * 2.1) * 0.8, 3.2 + (i % 3) * 0.55, cz + Math.cos(i * 2.1) * 0.8);
        c.castShadow = true;
        grp.add(c);
      }
      break;
    }
    case 'bench': {
      const wood = M('#8b6a48', 0.7);
      for (let i = 0; i < 3; i++) grp.add(box(W, 0.05, 0.12, wood, cx, 0.45, r.z0 + 0.1 + i * 0.16));
      for (let i = 0; i < 2; i++) grp.add(box(W, 0.1, 0.04, wood, cx, 0.65 + i * 0.15, r.z0 - 0.02));
      for (const x of [r.x0 + 0.15, r.x1 - 0.15]) { grp.add(box(0.06, 0.45, D, metal('#2f3438'), x, 0.22, cz)); grp.add(box(0.06, 0.5, 0.06, metal('#2f3438'), x, 0.7, r.z0 - 0.02)); }
      break;
    }
    case 'bin': grp.add(cyl(0.3, 0.26, o.height, M('#2f5d3a', 0.6), cx, o.height / 2, cz, 14)); grp.add(cyl(0.32, 0.32, 0.06, M('#244a2e', 0.6), cx, o.height, cz, 14)); break;
    case 'busstop':
      grp.add(box(W, 0.06, D + 0.6, M('#9fb3c8', 0.3, { transparent: true, opacity: 0.6 }), cx, 2.45, cz));
      for (const x of [r.x0, r.x1]) grp.add(cyl(0.04, 0.04, 2.45, metal('#555'), x, 1.22, cz, 8));
      grp.add(box(W, 1.7, 0.03, glassM(), cx, 1.3, cz, false));
      grp.add(box(W * 0.8, 0.06, 0.35, M('#555', 0.6), cx, 0.5, cz + 0.25));
      grp.add(box(0.6, 0.9, 0.05, M('#2a6fbf', 0.4, { emissive: new THREE.Color('#2a6fbf'), emissiveIntensity: 0.3 }), r.x1 + 0.4, 1.9, cz));
      break;
    case 'lamp': case 'car': break;
    default: grp.add(box(W, o.height, D, M('#888'), cx, o.height / 2, cz));
  }
  return grp;
}

export function buildCar(color: string, x: number, z: number, rot: number, van = false): THREE.Group {
  const grp = new THREE.Group();
  const body = M(color, 0.3, { metalness: 0.5 });
  const glass = M('#1f2a33', 0.08, { metalness: 0.6 });
  const trim = M('#1c1c1c', 0.6);
  const L = van ? 5 : 4.3;
  if (van) {
    grp.add(box(1.9, 1.75, L - 1.0, body, 0, 1.25, -0.5));
    grp.add(box(1.9, 1.2, 1.1, body, 0, 1.0, L / 2 - 0.55));
    const ws = box(1.75, 0.65, 0.05, glass, 0, 1.45, L / 2 - 0.15, false);
    ws.rotation.x = -0.35;
    grp.add(ws);
    for (const s of [-1, 1]) grp.add(box(0.03, 0.5, 0.8, glass, s * 0.96, 1.5, L / 2 - 0.7, false));
    grp.add(box(1.92, 0.4, 2.8, M('#f4c20d', 0.6), 0, 1.25, -0.6));
  } else {
    grp.add(box(1.85, 0.6, L, body, 0, 0.65, 0));
    grp.add(box(1.7, 0.55, 2.2, body, 0, 1.2, -0.25));
    const ws = box(1.6, 0.55, 0.04, glass, 0, 1.2, 0.95, false); ws.rotation.x = -0.6; grp.add(ws);
    const rw = box(1.6, 0.5, 0.04, glass, 0, 1.2, -1.42, false); rw.rotation.x = 0.55; grp.add(rw);
    for (const s of [-1, 1]) grp.add(box(0.03, 0.4, 1.9, glass, s * 0.86, 1.22, -0.25, false));
  }
  grp.add(box(1.88, 0.22, 0.12, trim, 0, 0.45, L / 2 + 0.02));
  grp.add(box(1.88, 0.22, 0.12, trim, 0, 0.45, -L / 2 - 0.02));
  for (const s of [-1, 1]) {
    grp.add(box(0.35, 0.14, 0.04, M('#fff7d0', 0.3, { emissive: new THREE.Color('#fff2b0'), emissiveIntensity: 0.4 }), s * 0.7, 0.75, L / 2 + 0.01, false));
    grp.add(box(0.35, 0.14, 0.04, M('#c0392b', 0.3, { emissive: new THREE.Color('#ff2a2a'), emissiveIntensity: 0.3 }), s * 0.7, 0.75, -L / 2 - 0.01, false));
  }
  const tyre = M('#141414', 0.85);
  const rim = metal('#b9bdc2', 0.3);
  for (const [dx, dz] of [[-0.93, 1.35], [0.93, 1.35], [-0.93, -1.35], [0.93, -1.35]]) {
    const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.26, 18), tyre);
    wh.rotation.z = Math.PI / 2; wh.position.set(dx, 0.36, dz * (L / 4.3)); wh.castShadow = true; grp.add(wh);
    const rm = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.27, 12), rim);
    rm.rotation.z = Math.PI / 2; rm.position.copy(wh.position); grp.add(rm);
  }
  grp.position.set(x, 0, z);
  grp.rotation.y = rot;
  return grp;
}
