// Static world presentation built from the shared layout data: textured
// ground and roads, facades with framed windows, working doors, roofs,
// street furniture and detailed interiors.
import * as THREE from 'three';
import { dartboardMesh } from './dartboard';
import { getWorld, wallsFor, WALL_T, type BuildingDef, type Obstacle, type Rect } from '../sim/world/layout';
import { fitModel, hasModel, modelInstance } from './models';
import { FLOORS, WALLPAPERS } from '../sim/world/homes';
import { tex, TILE, worldUV, planeUV, signTexture, normalOf } from './textures';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GameState } from '../sim/types';

let occ: THREE.Object3D[] = [];
let lightSpots: WorldView['lightSpots'] = [];
export const LIGHT_POOL = 6;
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
/** textured materials are shared: the same texture, roughness and tint is one material (and so merges into one draw call) */
const texMats = new Map<string, THREE.MeshStandardMaterial>();
const texMat = (t: THREE.Texture, rough = 0.9, color = '#ffffff') => {
  const k = `${t.uuid}|${rough}|${color}`;
  let m = texMats.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({ map: t, color, roughness: rough, normalMap: normalOf(t) ?? null }); texMats.set(k, m); }
  return m;
};

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
  /** a private house: the door only opens when someone answers it or it has been unlocked */
  house?: string;
}

export interface WorldView {
  group: THREE.Group;
  cutaway: Map<string, { roof: THREE.Object3D[]; walls: THREE.Mesh[]; fullH: number }>;
  windowsMat: THREE.MeshStandardMaterial[];
  lampBulbs: THREE.MeshStandardMaterial;
  /** a fixed pool of point lights, moved each frame to the light sources nearest the player (a
   * constant light count keeps shaders cheap and avoids recompiling them) */
  lampLights: THREE.PointLight[];
  /** ceiling lights inside buildings: drawn by the pool when near */
  lightSpots: { x: number; y: number; z: number; intensity: number; distance: number; bid: string }[];
  occluders: THREE.Object3D[];
  doors: AnimDoor[];
  update: (state: GameState, dt: number) => void;
}

function facadeFor(b: BuildingDef): { mat: THREE.MeshStandardMaterial; tile: number } {
  const id = b.id;
  let t: THREE.CanvasTexture;
  let key: string;
  if (id === 'flat' || id === 'terrace_w' || id === 'homestore') { t = tex.brick(b.color); key = `brick${b.color}`; }
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
  pub: () => ({ t: tex.wood('#5a3a24'), tile: TILE['wood#5a3a24'] ?? 1.2 }),
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
  lightSpots = [];
  fixtures.length = 0;

  // ---------------- ground
  const grassT = tex.grass();
  // the land ends at the quay wall; the harbour water lies beyond (harbour.ts)
  const gg = new THREE.PlaneGeometry(260, 177);
  planeUV(gg, 260, 177, TILE.grass);
  const grass = new THREE.Mesh(gg, texMat(grassT, 1));
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(0, -0.02, 1.5);
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
  // zebra crossings sit exactly where the walking routes cross (see layout nav): Main Street at x, Harbour Road at z
  const mainX = [-7.5, 7.5, -24, 17, -70, 57];
  const harbourZ = [-7.5, 7.5];
  const clearOf = (v: number, list: number[], half: number) => list.every((c) => Math.abs(v - c) > half);
  for (let x = -94; x < 94; x += 6) if (Math.abs(x) > 9 && clearOf(x, mainX, 3)) g.add(box(3, 0.02, 0.14, paint, x, 0.04, 0, false));
  for (let z = -46; z < 74; z += 6) if (Math.abs(z) > 9 && clearOf(z, harbourZ, 3)) g.add(box(0.14, 0.02, 3, paint, 0, 0.04, z, false));
  // white edge lines along the kerb (parking allowed), broken at the junction and at each crossing
  for (const z of [-4.82, 4.82]) {
    const cuts = [...mainX.map((x) => [x - 1.6, x + 1.6]), [-5.5, 5.5]].sort((a, b) => a[0] - b[0]);
    let from = -94;
    for (const [a, b] of [...cuts, [94, 94]]) { if (a - from > 0.5) g.add(box(a - from, 0.02, 0.1, paint, (from + a) / 2, 0.035, z, false)); from = Math.max(from, b); }
  }
  for (const x of mainX) for (let i = -4; i <= 4; i++) g.add(box(2.6, 0.02, 0.55, paint, x, 0.042, i * 1.05, false));
  for (const z of harbourZ) for (let i = -4; i <= 4; i++) g.add(box(0.55, 0.02, 2.6, paint, i * 1.05, 0.042, z, false));

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
  for (let i = 0; i < LIGHT_POOL; i++) { const pl = new THREE.PointLight('#ffcf80', 0, 18, 1.6); pl.position.y = 4.6; g.add(pl); lampLights.push(pl); }

  // ---------------- parked cars
  w.parked.forEach((p, i) => g.add(buildCar(p.color, p.pos.x, p.pos.z, p.rot, false, ['car', 'saloon', 'suv', 'car', 'sports'][i % 5])));

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
    for (const f of fixtures) f(state, dt);
    for (const d of doors) {
      let near = false;
      // a locked house door stays shut; it opens while someone is answering it
      if (d.house && !((state.houseOpen?.[d.house] ?? 0) > state.minute)) {
        const call = state.doorCall;
        near = !!call && call.house === d.house && call.stage === 'open';
      } else for (const p of Object.values(state.people)) {
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
  return { group: g, cutaway, windowsMat, lampBulbs, lampLights, lightSpots, occluders: occ, doors, update };
}

/** world-space pieces of a mesh, one per material (multi-material boxes are split by their groups) */
function piecesOf(m: THREE.Mesh): [THREE.Material, THREE.BufferGeometry][] {
  const base = m.geometry;
  const clean = (geo: THREE.BufferGeometry) => {
    geo.applyMatrix4(m.matrixWorld);
    for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
    if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    geo.clearGroups();
    return geo;
  };
  if (!Array.isArray(m.material)) return [[m.material, clean(base.index ? base.toNonIndexed() : base.clone())]];
  const flat = base.index ? base.toNonIndexed() : base.clone();
  const out: [THREE.Material, THREE.BufferGeometry][] = [];
  const groups = base.groups.length ? base.groups : [{ start: 0, count: flat.getAttribute('position').count, materialIndex: 0 }];
  for (const gr of groups) {
    const mat = m.material[gr.materialIndex ?? 0];
    if (!mat) continue;
    const sub = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(flat.attributes)) {
      const a = attr as THREE.BufferAttribute;
      sub.setAttribute(name, new THREE.BufferAttribute((a.array as Float32Array).slice(gr.start * a.itemSize, (gr.start + gr.count) * a.itemSize), a.itemSize));
    }
    out.push([mat, clean(sub)]);
  }
  return out;
}

/** one mesh per material for a set of meshes (they are removed from their parents) */
function mergeMeshes(g: THREE.Group, list: THREE.Mesh[], shadow?: boolean): THREE.Mesh[] {
  const by = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; shadow: boolean }>();
  for (const m of list) {
    for (const [mat, geo] of piecesOf(m)) {
      const e = by.get(mat) ?? { geos: [], shadow: false };
      e.geos.push(geo);
      e.shadow ||= shadow ?? m.castShadow;
      by.set(mat, e);
    }
    m.parent?.remove(m);
  }
  const out: THREE.Mesh[] = [];
  for (const [mat, e] of by) {
    const merged = mergeGeometries(e.geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = e.shadow;
    mesh.receiveShadow = true;
    g.add(mesh);
    out.push(mesh);
  }
  return out;
}

/** Merge static meshes into few draw calls. Merges are made per material within 24 m cells so that
 * whatever is off screen (or outside the sun's shadow box) is still culled. Each building's walls and
 * roof are merged on their own so the cut-away view can still lower and hide them. The camera's
 * collision uses invisible copies of the original wall pieces. */
const CELL = 32;
function bakeStatic(g: THREE.Group, cutaway: WorldView['cutaway']) {
  g.updateMatrixWorld(true);
  // collision proxies for the camera (never drawn)
  const proxies: THREE.Mesh[] = [];
  for (const root of occ) root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const p = new THREE.Mesh(m.geometry, PROXY_MAT);
    p.matrixAutoUpdate = false;
    p.matrix.copy(m.matrixWorld);
    p.matrixWorld.copy(m.matrixWorld);
    proxies.push(p);
  });
  occ = proxies;
  // cut-away walls and roofs: merged per building
  const special = new Set<THREE.Object3D>();
  for (const c of cutaway.values()) {
    const roofMeshes: THREE.Mesh[] = [];
    c.roof.forEach((o) => o.traverse((x) => { if ((x as THREE.Mesh).isMesh && !x.userData.dynamic) roofMeshes.push(x as THREE.Mesh); }));
    const keepRoof = c.roof.filter((o) => !(o as THREE.Mesh).isMesh || o.userData.dynamic);
    const walls = c.walls.filter((w) => !w.userData.dynamic);
    for (const w of walls) special.add(w);
    for (const r of roofMeshes) special.add(r);
    const mw = mergeMeshes(g, walls);
    for (const m of mw) m.userData.anchored = true;
    c.walls = mw;
    c.roof = [...keepRoof, ...mergeMeshes(g, roofMeshes)];
    for (const m of [...c.walls, ...c.roof]) special.add(m);
  }
  // everything else that never moves: per material and cell
  const buckets = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; shadow: boolean }>();
  const victims: THREE.Mesh[] = [];
  const pieces: { mat: THREE.Material; geo: THREE.BufferGeometry; shadow: boolean; cx: number; cz: number }[] = [];
  const trisOf = new Map<THREE.Material, number>();
  const box = new THREE.Box3(), c = new THREE.Vector3();
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || special.has(m) || m.userData.dynamic || (m as THREE.InstancedMesh).isInstancedMesh) return;
    for (let q: THREE.Object3D | null = m.parent; q; q = q.parent) if (q.userData.dynamic) return;
    box.setFromObject(m).getCenter(c);
    for (const [mat, geo] of piecesOf(m)) {
      pieces.push({ mat, geo, shadow: m.castShadow, cx: c.x, cz: c.z });
      trisOf.set(mat, (trisOf.get(mat) ?? 0) + geo.getAttribute('position').count / 3);
    }
    victims.push(m);
  });
  for (const v of victims) v.parent?.remove(v);
  // only materials carrying a lot of geometry are split into cells: for the rest, one call beats culling
  for (const p of pieces) {
    const cell = (trisOf.get(p.mat) ?? 0) > 15000 ? `${Math.floor(p.cx / CELL)},${Math.floor(p.cz / CELL)}` : 'all';
    const key = `${p.mat.uuid}|${p.shadow}|${cell}`;
    const b = buckets.get(key) ?? { mat: p.mat, geos: [], shadow: p.shadow };
    b.geos.push(p.geo);
    buckets.set(key, b);
  }
  for (const b of buckets.values()) {
    const merged = mergeGeometries(b.geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, b.mat);
    mesh.castShadow = b.shadow;
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  // drop the groups left empty
  const empty: THREE.Object3D[] = [];
  g.traverse((o) => { if (o !== g && !(o as THREE.Mesh).isMesh && !(o as THREE.Light).isLight && o.children.length === 0 && !o.userData.dynamic) empty.push(o); });
  for (const o of empty) o.parent?.remove(o);
}
const PROXY_MAT = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });

// ------------------------------------------------------------------ buildings
function wallOutwardFace(r: Rect, b: BuildingDef): number {
  const cx = (b.rect.x0 + b.rect.x1) / 2, cz = (b.rect.z0 + b.rect.z1) / 2;
  const horiz = r.x1 - r.x0 > r.z1 - r.z0;
  if (horiz) return (r.z0 + r.z1) / 2 < cz ? 5 : 4;
  return (r.x0 + r.x1) / 2 < cx ? 1 : 0;
}

/** Glass for windows you cannot walk behind: a hint of the room inside (curtains, blinds, a lamp)
 * under a sky reflection. Several variants so a street of windows never repeats; they glow at night. */
let roomGlass: THREE.MeshStandardMaterial[] | null = null;
function roomGlasses(windowsMat: THREE.MeshStandardMaterial[]): THREE.MeshStandardMaterial[] {
  if (!roomGlass) {
    const palettes = [['#c9b18a', '#8a6f4f'], ['#7f95b5', '#4e6585'], ['#d8d2c4', '#a59d8c'], ['#a35b4c', '#6e3a30'], ['#9fb58c', '#617550'], ['#e7e2d7', '#bdb6a6']];
    roomGlass = palettes.map(([a, b], k) => {
      const cv = document.createElement('canvas');
      cv.width = 128; cv.height = 128;
      const c = cv.getContext('2d')!;
      // dim room interior with a ceiling light and the far wall
      const g = c.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, '#3b3f44'); g.addColorStop(1, '#1d2024'); c.fillStyle = g; c.fillRect(0, 0, 128, 128);
      c.fillStyle = 'rgba(255,230,190,0.18)'; c.fillRect(30 + (k * 17) % 50, 70, 40, 30);
      if (k % 3 === 2) {
        // venetian blinds
        for (let y = 0; y < 128; y += 6) { c.fillStyle = a; c.fillRect(0, y, 128, 4); c.fillStyle = b; c.fillRect(0, y + 4, 128, 1); }
      } else {
        // curtains drawn to the sides with soft folds
        for (const [x0, w] of [[0, 30 + (k * 7) % 14], [128 - 30 - (k * 5) % 14, 30 + (k * 5) % 14]] as const) {
          for (let x = 0; x < w; x++) { const f = 0.75 + 0.25 * Math.sin(x * 0.7); c.fillStyle = a; c.globalAlpha = f; c.fillRect(x0 + x, 0, 1, 128); }
          c.globalAlpha = 1;
        }
        c.fillStyle = b; c.fillRect(0, 0, 128, 6);
      }
      // sky reflection across the glass
      const r = c.createLinearGradient(0, 0, 128, 128); r.addColorStop(0, 'rgba(200,225,245,0.45)'); r.addColorStop(0.5, 'rgba(200,225,245,0.08)'); r.addColorStop(1, 'rgba(200,225,245,0.25)');
      c.fillStyle = r; c.fillRect(0, 0, 128, 128);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: new THREE.Color('#000000'), emissiveIntensity: 3.5, roughness: 0.1, metalness: 0.2 });
      return m;
    });
  }
  for (const m of roomGlass) if (!windowsMat.includes(m)) windowsMat.push(m);
  return roomGlass;
}

/** window openings per building (wallpaper is cut around them too) */
const buildingWindows = new Map<string, { side: string; along: number; ww: number; wh: number; wy: number }[]>();

/** clear glass for windows you can see through (walk-in buildings) */
const CLEAR_GLASS = new THREE.MeshPhysicalMaterial({ color: '#dceaf0', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false, envMapIntensity: 1.2 });

function windowMesh(w: number, h: number, frameCol: string, lit: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial, inner = false, pane = true) {
  const grp = new THREE.Group();
  const fm = M(frameCol, 0.5);
  const glass = lit === CLEAR_GLASS ? lit : inner ? M('#d9ecf5', 0.1, { emissive: new THREE.Color('#bfe0f0'), emissiveIntensity: 0.35 }) : lit;
  if (pane) grp.add(box(w, h, 0.012, glass, 0, 0, 0, false));
  grp.add(box(w + 0.12, 0.08, 0.1, fm, 0, h / 2, 0, false));
  grp.add(box(w + 0.12, 0.08, 0.1, fm, 0, -h / 2, 0, false));
  grp.add(box(0.08, h, 0.1, fm, -w / 2, 0, 0, false));
  grp.add(box(0.08, h, 0.1, fm, w / 2, 0, 0, false));
  grp.add(box(0.05, h, 0.06, fm, 0, 0, 0, false));
  if (!inner) grp.add(box(w + 0.25, 0.06, 0.22, M('#d8d4cc', 0.7), 0, -h / 2 - 0.05, 0.06, false));
  grp.traverse((o) => { if ((o as THREE.Mesh).material === CLEAR_GLASS) o.userData.dynamic = true; });
  return grp;
}

/** Marlow Court above the ground floor: a modern block of flats. Light render with charcoal cladding
 * framing the balcony bays, a glazed stair tower over the entrance, tall dark-framed windows, glass
 * balconies, a metal-capped parapet, a lift overrun and solar panels on the roof. */
export const FLAT_CORE = { x0: 14.0, x1: 18.4 };
function flatUpper(g: THREE.Group, b: BuildingDef, roofs: THREE.Object3D[], windowsMat: THREE.MeshStandardMaterial[]) {
  const { x0, z0, x1, z1 } = b.rect;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, W = x1 - x0, D = z1 - z0;
  const add = (o: THREE.Object3D) => { roofs.push(o); g.add(o); return o; };
  const top = b.height, upH = top - 3.2;
  const renderM = texMat(tex.render('#e9e6df'), 0.9);
  const cladM = texMat(tex.cladding('#3c4146'), 0.55);
  const frame = '#33373b';
  const capM = metal('#a7adb2', 0.4);
  const slabM = M('#d9d6cf', 0.8);
  const railM = glassM();
  const handM = metal('#2f3337', 0.4);
  // the upper mass in render, with a thin shadow gap above the brick ground floor
  add(box(W + WALL_T, upH, D + WALL_T, [renderM, renderM, M('#5b5f63', 0.9), M('#5b5f63', 0.9), renderM, renderM], cx, 3.2 + upH / 2, cz, true, TILE[`render#e9e6df`] ?? 2));
  occ.push(roofs[roofs.length - 1]);
  add(box(W + WALL_T + 0.06, 0.12, D + WALL_T + 0.06, M('#2c2f33', 0.7), cx, 3.26, cz));
  // stair tower over the entrance: a glazed box standing proud of the facade, rising above the roof,
  // with the flights and landings of the stairs visible behind the glass (lit at night)
  const core = FLAT_CORE, coreW = core.x1 - core.x0, coreX = (core.x0 + core.x1) / 2, coreTop = top + 1.6;
  const depth = 1.1, front = z0 - WALL_T / 2 - depth;
  const coreH = coreTop - 3.2, coreY = 3.2 + coreH / 2;
  add(box(0.25, coreH, depth, cladM, core.x0 + 0.125, coreY, front + depth / 2, true, 1.6));
  add(box(0.25, coreH, depth, cladM, core.x1 - 0.125, coreY, front + depth / 2, true, 1.6));
  add(box(coreW, 0.3, depth, cladM, coreX, coreTop - 0.15, front + depth / 2, true, 1.6));
  add(box(coreW, 0.2, depth, cladM, coreX, 3.3, front + depth / 2, true, 1.6));
  const well = M('#e7e3da', 0.85, { emissive: new THREE.Color('#000000') });
  windowsMat.push(well);
  add(box(coreW - 0.5, coreH - 0.5, 0.04, well, coreX, coreY, z0 - WALL_T / 2 - 0.02, false));
  const treadM = M('#8c9196', 0.6), stringM = M('#5c6166', 0.5);
  for (let f = 1; f <= 3; f++) {
    const y0 = 3.2 * f;
    // landing, then a flight rising across the tower and back
    add(box(coreW - 0.5, 0.15, depth - 0.2, treadM, coreX, y0 + 0.1, front + depth / 2));
    for (const [k, dir] of [[0, 1], [1, -1]] as const) {
      const fl = new THREE.Mesh(new THREE.BoxGeometry((coreW - 0.5) / 2 + 0.3, 0.12, 0.42), stringM);
      fl.position.set(coreX + dir * 0.3 - dir * 0.15, y0 + 0.9 + k * 1.6, front + 0.3 + k * 0.42);
      fl.rotation.z = dir * 0.6;
      fl.castShadow = false;
      add(fl);
      add(box(0.04, 0.9, 0.04, handM, coreX + dir * ((coreW - 0.5) / 2 - 0.1), y0 + 1.1 + k * 1.6, front + 0.3 + k * 0.42));
    }
  }
  const coreGlass = new THREE.MeshPhysicalMaterial({ color: '#a9c2cf', roughness: 0.05, metalness: 0.1, transmission: 0, transparent: true, opacity: 0.38, depthWrite: false });
  add(box(coreW - 0.5, coreH - 0.5, 0.03, coreGlass, coreX, coreY, front + 0.02, false));
  for (let x = core.x0 + 0.25; x <= core.x1 - 0.2; x += (coreW - 0.5) / 4) add(box(0.07, coreH - 0.5, 0.1, M(frame, 0.5), x, coreY, front, false));
  for (let f = 1; f <= 4; f++) add(box(coreW - 0.5, 0.09, 0.12, M(frame, 0.5), coreX, Math.min(3.2 * f + 0.25, coreTop - 0.3), front, false));
  // lift overrun on the roof behind the tower
  add(box(coreW + 0.3, 1.6, 3.2, cladM, coreX, top + 0.8, z0 + 1.6, true, 1.6));
  // window bays on every side; balconies on the street front and the east (park) side
  const rg = roomGlasses(windowsMat);
  for (let f = 1; f < b.floors; f++) {
    const fy = 3.2 * f;
    for (const [side, len] of [['zmin', W], ['zmax', W], ['xmin', D], ['xmax', D]] as const) {
      const n = Math.floor((len - 1.6) / 3.0);
      const start = side === 'zmin' || side === 'zmax' ? x0 : z0;
      for (let i = 0; i < n; i++) {
        const along = start + 0.8 + 3.0 * (i + 0.5) + ((len - 1.6) - n * 3.0) / 2;
        if (side === 'zmin' && along > core.x0 - 0.9 && along < core.x1 + 0.9) continue;
        const balcony = (side === 'zmin' || side === 'xmax') && i % 2 === 1;
        const ww = balcony ? 1.7 : 1.3, wh = balcony ? 2.25 : 1.8;
        const wy = balcony ? fy + 0.08 + wh / 2 : fy + 0.55 + wh / 2;
        const win = windowMesh(ww, wh, frame, rg[Math.abs(Math.floor(along * 7 + f * 13)) % rg.length]);
        const off = WALL_T / 2 + 0.03;
        const place = (o: THREE.Object3D, out: number, y: number) => {
          if (side === 'zmin') { o.position.set(along, y, z0 - out); o.rotation.y = Math.PI; }
          if (side === 'zmax') o.position.set(along, y, z1 + out);
          if (side === 'xmin') { o.position.set(x0 - out, y, along); o.rotation.y = -Math.PI / 2; }
          if (side === 'xmax') { o.position.set(x1 + out, y, along); o.rotation.y = Math.PI / 2; }
          return add(o);
        };
        place(win, off, wy);
        if (!balcony) continue;
        // charcoal cladding fins framing the balcony bay, one storey high
        for (const sgn of [-1, 1]) {
          const fin = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.2, 1.3), cladM);
          fin.castShadow = true;
          const grp = new THREE.Group(); fin.position.set(sgn * 1.31, 0, 0.65); grp.add(fin);
          place(grp, WALL_T / 2, fy + 1.6);
        }
        // the balcony: slab, glass balustrade, slim handrail, a light under the slab
        const bal = new THREE.Group();
        bal.add(box(2.4, 0.16, 1.25, slabM, 0, 0.08, 0.62));
        bal.add(box(2.36, 0.95, 0.02, railM, 0, 0.62, 1.23, false));
        bal.add(box(0.02, 0.95, 1.2, railM, -1.17, 0.62, 0.62, false));
        bal.add(box(0.02, 0.95, 1.2, railM, 1.17, 0.62, 0.62, false));
        bal.add(box(2.38, 0.04, 0.06, handM, 0, 1.11, 1.23));
        bal.add(box(0.06, 0.04, 1.2, handM, -1.17, 1.11, 0.62));
        bal.add(box(0.06, 0.04, 1.2, handM, 1.17, 1.11, 0.62));
        const k = Math.abs(Math.floor(along + f * 5)) % 4;
        if (k === 0) { bal.add(cyl(0.16, 0.12, 0.32, M('#9a5b3a', 0.8), 0.8, 0.32, 0.8, 10)); bal.add(cyl(0.22, 0.05, 0.4, M('#3f7f45', 0.9), 0.8, 0.65, 0.8, 8)); }
        if (k === 1) { bal.add(box(0.45, 0.04, 0.45, handM, -0.6, 0.6, 0.7)); bal.add(box(0.45, 0.5, 0.04, handM, -0.6, 0.85, 0.48)); bal.add(cyl(0.25, 0.25, 0.03, handM, 0.2, 0.72, 0.75, 14)); }
        if (k === 2) bal.add(box(1.4, 0.02, 0.9, M('#8a7a62', 0.9), 0, 0.17, 0.6, false));
        place(bal, WALL_T / 2, fy);
      }
    }
  }
  // roof: membrane, metal-capped parapet, solar panels in rows
  add(box(W + WALL_T, 0.1, D + WALL_T, M('#4d5155', 0.95), cx, top + 0.05, cz));
  for (const [px, pz, pw, pd] of [[cx, z0 - WALL_T / 2, W + WALL_T + 0.1, 0.3], [cx, z1 + WALL_T / 2, W + WALL_T + 0.1, 0.3], [x0 - WALL_T / 2, cz, 0.3, D + WALL_T + 0.1], [x1 + WALL_T / 2, cz, 0.3, D + WALL_T + 0.1]] as const) {
    add(box(pw, 0.55, pd, renderM, px, top + 0.27, pz, true, 2));
    add(box(pw + 0.06, 0.06, pd + 0.08, capM, px, top + 0.58, pz));
  }
  const pv = M('#1d2a44', 0.25, { metalness: 0.4 });
  const pvFrame = metal('#b9bec3', 0.4);
  for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++) {
    const px = x0 + 7.2 + col * 2.0, pz = z0 + 5 + row * 3.4;
    const panel = new THREE.Group();
    const face = box(1.8, 0.04, 1.1, pv, 0, 0, 0); face.castShadow = true; panel.add(face);
    panel.add(box(1.84, 0.02, 1.14, pvFrame, 0, -0.03, 0));
    panel.rotation.x = -0.45;
    panel.position.set(px, top + 0.55, pz);
    add(panel);
    add(box(0.05, 0.5, 0.05, pvFrame, px, top + 0.3, pz + 0.4));
  }
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
    // where the windows go (shared by the wall openings and the frames)
    const wins: { side: 'zmin' | 'zmax' | 'xmin' | 'xmax'; along: number; ww: number; wh: number; wy: number }[] = [];
    for (const ws of [{ side: 'zmin', len: W }, { side: 'zmax', len: W }, { side: 'xmin', len: D }, { side: 'xmax', len: D }] as const) {
      const shopFront = (b.id === 'market' && ws.side === 'zmax') || (b.id === 'unit4' && ws.side === 'zmin') || (b.id === 'cafe' && ws.side === 'zmin');
      const spacing = shopFront ? 3.4 : 3.2;
      const n = Math.floor((ws.len - 2) / spacing);
      for (let i = 0; i < n; i++) {
        const along = (ws.side === 'zmin' || ws.side === 'zmax' ? x0 : z0) + 1 + spacing * (i + 0.5) + ((ws.len - 2) - n * spacing) / 2;
        if (b.doors.some((d) => d.side === ws.side && along > d.a - 1.7 && along < d.b + 1.7)) continue;
        if ((ws.side === 'zmin' || ws.side === 'zmax') && b.internalWalls?.some((r) => along > r.x0 - 1 && along < r.x1 + 1 && r.x1 - r.x0 < 1)) continue;
        if ((ws.side === 'xmin' || ws.side === 'xmax') && b.internalWalls?.some((r) => along > r.z0 - 1 && along < r.z1 + 1 && r.z1 - r.z0 < 1)) continue;
        wins.push({ side: ws.side, along, ww: shopFront ? 2.6 : 1.5, wh: shopFront ? 2.0 : 1.3, wy: shopFront ? 1.35 : 1.65 });
      }
    }
    buildingWindows.set(b.id, wins);
    const skirtM = M('#f6f3ee', 0.6);
    for (const r of wallsFor(b)) {
      const isInternal = b.internalWalls?.includes(r);
      const mats = [innerM, innerM, M(b.trim, 0.8), innerM, innerM, innerM];
      if (!isInternal) mats[wallOutwardFace(r, b)] = facade.mat;
      const horiz = r.x1 - r.x0 > r.z1 - r.z0;
      const side = horiz ? ((r.z0 + r.z1) / 2 < cz ? 'zmin' : 'zmax') : ((r.x0 + r.x1) / 2 < cx ? 'xmin' : 'xmax');
      const a0 = horiz ? r.x0 : r.z0, a1 = horiz ? r.x1 : r.z1;
      const holes = isInternal ? [] : wins.filter((w) => w.side === side && w.along - w.ww / 2 > a0 && w.along + w.ww / 2 < a1).sort((p, q) => p.along - q.along);
      // the wall is built in pieces around real window openings, so you can see out (and in)
      const piece = (from: number, to: number, y0: number, y1: number, full: boolean) => {
        if (to - from < 0.01 || y1 - y0 < 0.01) return;
        const pr: Rect = horiz ? { x0: from, x1: to, z0: r.z0, z1: r.z1 } : { x0: r.x0, x1: r.x1, z0: from, z1: to };
        const m = rbox(pr, y1 - y0, mats, y0, true, facade.tile);
        g.add(m);
        occ.push(m);
        if (full) wallsOut.push(m);
      };
      let at = a0;
      for (const w of holes) {
        const h0 = w.along - w.ww / 2, h1 = w.along + w.ww / 2;
        piece(at, h0, 0, 3.2, true);
        piece(h0, h1, 0, w.wy - w.wh / 2, false);
        piece(h0, h1, w.wy + w.wh / 2, 3.2, false);
        at = h1;
      }
      piece(at, a1, 0, 3.2, true);
      if (!isInternal) {
        const inwardOff = horiz ? ((r.z0 + r.z1) / 2 < cz ? 0.17 : -0.17) : ((r.x0 + r.x1) / 2 < cx ? 0.17 : -0.17);
        g.add(horiz ? box(r.x1 - r.x0, 0.12, 0.03, skirtM, (r.x0 + r.x1) / 2, 0.1, (r.z0 + r.z1) / 2 + inwardOff, false) : box(0.03, 0.12, r.z1 - r.z0, skirtM, (r.x0 + r.x1) / 2 + inwardOff, 0.1, (r.z0 + r.z1) / 2, false));
      }
    }
    const fl = FLOOR[b.id]?.() ?? (b.id.startsWith('house_') ? { t: tex.wood(b.floorColor ?? '#a8865f'), tile: TILE['wood#a0784e'] ?? 1.2 } : { t: tex.tiles('#cccccc', '#bbbbbb'), tile: 1.2 });
    g.add(box(W, 0.08, D, texMat(fl.t, 0.75), cx, 0.04, cz, false, fl.tile));
    // frames on both faces and one clear pane in each opening
    for (const w of wins) {
      for (const inner of [false, true]) {
        const win = windowMesh(w.ww, w.wh, b.trim, CLEAR_GLASS, inner, !inner);
        const off = (WALL_T / 2 - 0.04) * (inner ? -1 : 1);
        if (w.side === 'zmin') { win.position.set(w.along, w.wy, z0 - off); win.rotation.y = Math.PI; }
        if (w.side === 'zmax') win.position.set(w.along, w.wy, z1 + off);
        if (w.side === 'xmin') { win.position.set(x0 - off, w.wy, w.along); win.rotation.y = -Math.PI / 2; }
        if (w.side === 'xmax') { win.position.set(x1 + off, w.wy, w.along); win.rotation.y = Math.PI / 2; }
        if (inner) win.rotation.y += Math.PI;
        g.add(win);
      }
      // window reveal (the wall thickness around the opening)
      const rev = M('#f1eee8', 0.8);
      const hz = w.side === 'zmin' || w.side === 'zmax';
      const wz = w.side === 'zmin' ? z0 : w.side === 'zmax' ? z1 : 0, wx = w.side === 'xmin' ? x0 : w.side === 'xmax' ? x1 : 0;
      const sill = hz ? box(w.ww, 0.03, WALL_T, rev, w.along, w.wy - w.wh / 2 + 0.015, wz, false) : box(WALL_T, 0.03, w.ww, rev, wx, w.wy - w.wh / 2 + 0.015, w.along, false);
      g.add(sill);
    }
    if (b.id === 'flat') flatUpper(g, b, roofs, windowsMat);
    else if (b.height > 3.3) {
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
        // every upper floor: a string course, windows on all four sides; flats get balconies on the street side
        const residential = b.id === 'flat';
        const railM = glassM();
        const metalM = metal('#3b4045', 0.4);
        for (let f = 1; f < b.floors; f++) {
          const fy = 3.2 * f;
          const course = box(W + WALL_T + 0.1, 0.14, D + WALL_T + 0.1, trimM, cx, fy, cz);
          roofs.push(course); g.add(course);
          for (const [side, len] of [['zmin', W], ['zmax', W], ['xmin', D], ['xmax', D]] as const) {
            const n = Math.floor((len - 2) / 3.2);
            const start = side === 'zmin' || side === 'zmax' ? x0 : z0;
            for (let i = 0; i < n; i++) {
              const along = start + 1 + 3.2 * (i + 0.5) + ((len - 2) - n * 3.2) / 2;
              const balcony = residential && side === 'zmin' && i % 2 === 1;
              const wh = balcony ? 2.1 : 1.4;
              const wy = balcony ? fy + 0.12 + wh / 2 : fy + 1.65;
              const rg = roomGlasses(windowsMat);
              const win = windowMesh(balcony ? 1.6 : 1.4, wh, b.trim, rg[Math.abs(Math.floor(along * 7 + f * 13)) % rg.length]);
              const off = WALL_T / 2 + 0.03;
              if (side === 'zmin') { win.position.set(along, wy, z0 - off); win.rotation.y = Math.PI; }
              if (side === 'zmax') win.position.set(along, wy, z1 + off);
              if (side === 'xmin') { win.position.set(x0 - off, wy, along); win.rotation.y = -Math.PI / 2; }
              if (side === 'xmax') { win.position.set(x1 + off, wy, along); win.rotation.y = Math.PI / 2; }
              roofs.push(win); g.add(win);
              if (balcony) {
                const bz = z0 - WALL_T / 2 - 0.55;
                const parts: THREE.Mesh[] = [
                  box(2.1, 0.14, 1.1, M('#cfcac0', 0.7), along, fy + 0.07, bz),
                  box(2.1, 0.95, 0.02, railM, along, fy + 0.62, bz - 0.54, false),
                  box(0.02, 0.95, 1.1, railM, along - 1.04, fy + 0.62, bz, false),
                  box(0.02, 0.95, 1.1, railM, along + 1.04, fy + 0.62, bz, false),
                  box(2.12, 0.05, 0.05, metalM, along, fy + 1.12, bz - 0.54),
                  box(0.05, 0.05, 1.1, metalM, along - 1.04, fy + 1.12, bz),
                  box(0.05, 0.05, 1.1, metalM, along + 1.04, fy + 1.12, bz),
                ];
                // a few lived-in touches: a plant pot or a folding chair on some balconies
                if ((f + i) % 3 === 0) parts.push(cyl(0.16, 0.12, 0.3, M('#9a5b3a', 0.8), along + 0.7, fy + 0.29, bz + 0.2, 10), cyl(0.2, 0.05, 0.35, M('#3f7f45', 0.9), along + 0.7, fy + 0.6, bz + 0.2, 8));
                if ((f + i) % 3 === 1) parts.push(box(0.45, 0.04, 0.45, metalM, along - 0.5, fy + 0.6, bz + 0.15), box(0.45, 0.5, 0.04, metalM, along - 0.5, fy + 0.85, bz + 0.37));
                for (const pt of parts) { roofs.push(pt); g.add(pt); }
              }
            }
          }
        }
      }
    }
    const roofTop = b.height;
    if (b.id !== 'flat') {
      const roof = box(W + 0.6, 0.25, D + 0.6, texMat(tex.gravel(), 0.95), cx, roofTop + 0.12, cz, true, TILE.gravel);
      roofs.push(roof);
      g.add(roof);
      for (const [px, pz, pw, pd] of [[cx, z0 - 0.2, W + 0.6, 0.2], [cx, z1 + 0.2, W + 0.6, 0.2], [x0 - 0.2, cz, 0.2, D + 0.6], [x1 + 0.2, cz, 0.2, D + 0.6]]) {
        const par = box(pw, 0.5, pd, trimM, px, roofTop + 0.45, pz);
        roofs.push(par);
        g.add(par);
      }
    }
    if (b.id !== 'flat') { const hv = box(1.6, 0.9, 1.1, metal('#9aa3a8'), x1 - 3, roofTop + 0.7, z0 + 3); roofs.push(hv); g.add(hv); }
    // a solid ceiling slab that also blocks sunlight, so no light leaks along the top of the walls
    const ceil = box(W + WALL_T, 0.08, D + WALL_T, M('#f3f1ec', 0.95), cx, 3.2, cz, true);
    ceil.receiveShadow = true;
    roofs.push(ceil);
    g.add(ceil);
    const panel = M('#ffffff', 0.3, { emissive: new THREE.Color('#fff6e0'), emissiveIntensity: 0.6 });
    for (let x = x0 + 3; x < x1 - 1.5; x += 5) for (let z = z0 + 3; z < z1 - 1.5; z += 5) { const p = box(1.4, 0.04, 0.5, panel, x, 3.16, z, false); roofs.push(p); g.add(p); }
    const nL = Math.max(1, Math.round((W * D) / 220));
    for (let i = 0; i < nL; i++) {
      lightSpots.push({ x: x0 + (W * (i + 0.5)) / nL, y: 2.9, z: cz, intensity: 7, distance: Math.max(W, D), bid: b.id });
    }
    for (const d of b.doors) addDoor(g, b, d.side, d.a, d.b, d.open, doors);
    if (b.id === 'flat') {
      // entrance canopy, intercom panel and flat numbers by the communal door
      const main = b.doors[0];
      const mx = (main.a + main.b) / 2;
      g.add(box(main.b - main.a + 1.4, 0.12, 1.3, M('#2f3337', 0.4), mx, 2.75, z0 - 0.7));
      for (const sx of [-1, 1]) g.add(box(0.03, 0.5, 0.03, metal('#2f3337', 0.4), mx + sx * ((main.b - main.a) / 2 + 0.55), 3.0, z0 - 1.25));
      g.add(box(0.22, 0.38, 0.04, metal('#9aa1a8', 0.3), main.b + 0.4, 1.35, z0 - WALL_T / 2 - 0.03));
      for (let k = 0; k < 4; k++) g.add(box(0.05, 0.035, 0.02, M('#222', 0.4), main.b + 0.4, 1.47 - k * 0.07, z0 - WALL_T / 2 - 0.06, false));
      const tag = signTexture('FLATS 1-8', '#222222', '#e6e1d6');
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.5 * tag.aspect * 0.35, 0.5 * 0.35), new THREE.MeshStandardMaterial({ map: tag.tex, roughness: 0.6 }));
      plate.position.set(main.a - 0.55, 1.9, z0 - WALL_T / 2 - 0.02);
      plate.rotation.y = Math.PI;
      g.add(plate);
    }
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
        const rg = roomGlasses(windowsMat);
        const win = windowMesh(isHouse ? 1.2 : 1.5, isHouse ? 1.25 : 1.5, b.trim, rg[Math.abs(Math.floor(along * 7 + f * 13 + x0)) % rg.length]);
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
    doors.push({ kind: 'swing', center, parts: [{ obj: pivot, closed: new THREE.Vector3(0, 0, 0), open: -out * 1.4 }], t: 0, house: b.id.startsWith('house_') ? b.id : undefined });
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
/** wallpaper patterns, tiled at 1.2 m */
const wpCache = new Map<string, THREE.Texture>();
function wallpaperTexture(id: string): THREE.Texture {
  const hit = wpCache.get(id);
  if (hit) return hit;
  const w = WALLPAPERS[id] ?? WALLPAPERS.cream;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const c = cv.getContext('2d')!;
  c.fillStyle = w.base; c.fillRect(0, 0, 256, 256);
  c.fillStyle = w.accent; c.strokeStyle = w.accent;
  if (w.pattern === 'stripe') for (let x = 0; x < 256; x += 32) { c.fillRect(x, 0, 12, 256); c.globalAlpha = 0.5; c.fillRect(x + 16, 0, 2, 256); c.globalAlpha = 1; }
  if (w.pattern === 'damask') for (let y = 0; y < 256; y += 64) for (let x = (y / 64) % 2 ? 32 : 0; x < 256; x += 64) {
    c.globalAlpha = 0.55; c.beginPath(); c.ellipse(x + 16, y + 32, 9, 22, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(x + 16, y + 14, 14, 6, 0, 0, Math.PI * 2); c.fill(); c.beginPath(); c.ellipse(x + 16, y + 50, 14, 6, 0, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1;
  }
  if (w.pattern === 'geo') { c.lineWidth = 3; for (let y = 0; y < 256; y += 32) for (let x = 0; x < 256; x += 32) { c.beginPath(); c.moveTo(x + 16, y + 2); c.lineTo(x + 30, y + 16); c.lineTo(x + 16, y + 30); c.lineTo(x + 2, y + 16); c.closePath(); c.stroke(); } }
  if (w.pattern === 'panel') for (let x = 0; x < 256; x += 42) { c.globalAlpha = 0.6; c.fillRect(x, 0, 3, 256); c.globalAlpha = 0.15; c.fillRect(x + 3, 0, 18, 256); c.globalAlpha = 1; }
  if (w.pattern === 'brick') { c.fillStyle = w.base; for (let r = 0; r < 16; r++) for (let k = -1; k < 5; k++) { c.fillStyle = `hsl(14, 45%, ${30 + ((r * 7 + k * 13) % 9)}%)`; c.fillRect(k * 64 + (r % 2 ? 32 : 0) + 2, r * 16 + 2, 60, 12); } }
  if (w.pattern === 'plain') { for (let i = 0; i < 2500; i++) { c.globalAlpha = 0.05; c.fillStyle = i % 2 ? '#000' : '#fff'; c.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); } c.globalAlpha = 1; }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  wpCache.set(id, t);
  return t;
}

/** a simple abstract print for framed pictures */
function artTexture(color: string): THREE.Texture {
  const key = `art${color}`;
  const hit = wpCache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 180;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#f2ede2'; c.fillRect(0, 0, 256, 180);
  let h = 0; for (const ch of color) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const rnd = () => ((h = (h * 1103515245 + 12345) | 0) >>> 0) / 4294967296;
  if (rnd() < 0.5) {
    // landscape: sky, hills and sun
    const g = c.createLinearGradient(0, 0, 0, 110); g.addColorStop(0, '#9cc3dd'); g.addColorStop(1, '#f1e1c6'); c.fillStyle = g; c.fillRect(0, 0, 256, 110);
    c.fillStyle = color; c.beginPath(); c.arc(60 + rnd() * 140, 50, 18, 0, Math.PI * 2); c.fill();
    for (let k = 0; k < 3; k++) { c.fillStyle = `hsl(${100 + k * 15}, 25%, ${45 - k * 8}%)`; c.beginPath(); c.moveTo(0, 110 + k * 20); for (let x = 0; x <= 256; x += 32) c.lineTo(x, 95 + k * 22 + Math.sin(x * 0.03 + k + rnd()) * 14); c.lineTo(256, 180); c.lineTo(0, 180); c.fill(); }
  } else {
    // abstract blocks
    for (let k = 0; k < 6; k++) { c.fillStyle = k % 2 ? color : ['#2f3f5e', '#d9b44a', '#e8e2d0', '#8a3e3a'][k % 4]; c.globalAlpha = 0.85; c.fillRect(rnd() * 200, rnd() * 130, 40 + rnd() * 90, 30 + rnd() * 70); }
    c.globalAlpha = 1;
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  wpCache.set(key, t);
  return t;
}

/** per-frame animators for fixtures that respond to people using them (shower door, water, ...) */
const fixtures: ((state: GameState, dt: number) => void)[] = [];

/** rotation that turns a fixture's front (+z) towards the spot where people stand to use it */
function userFacing(o: Obstacle): number {
  const r = o.rect;
  const its = Object.values(getWorld().interactables).filter((it) => it.obj.x >= r.x0 - 0.5 && it.obj.x <= r.x1 + 0.5 && it.obj.z >= r.z0 - 0.5 && it.obj.z <= r.z1 + 0.5);
  const it = its[0];
  return it ? Math.atan2(it.pos.x - it.obj.x, it.pos.z - it.obj.z) : o.rot ?? 0;
}

function buildObstacle(o: Obstacle): THREE.Object3D {
  const r = o.rect;
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, W = r.x1 - r.x0, D = r.z1 - r.z0;
  const grp = new THREE.Group();
  // Blender-modelled furniture where available (front of each model faces +z; rotate into place)
  const fit = (name: string, rr: Rect, rot: number, paint?: string, h?: number) => { const m = fitModel(name, rr, rot, paint, h); if (m) grp.add(m); return !!m; };
  // natural-size model centred on the footprint (trees, shelters: the collider is smaller than the model)
  const place = (name: string, rot: number, paint?: string, scale = 1) => { const m = modelInstance(name, paint); if (!m) return false; m.position.set(cx, 0, cz); m.rotation.y = rot; m.scale.setScalar(scale); grp.add(m); return true; };
  switch (o.kind) {
    case 'sofa': if (fit('sofa', r, o.rot ?? Math.PI / 2, o.color ?? '#4f6d60')) return grp; break;
    case 'armchair': if (fit('armchair', r, o.rot ?? 0, o.color ?? '#6b6e73')) return grp; break;
    case 'bed': if (fit('bed', r, o.rot ?? -Math.PI / 2, o.color ?? '#4e6e9e')) return grp; break;
    case 'bedside': if (fit('bedside', r, o.rot ?? 0)) return grp; break;
    case 'desk':
      if (W > 2.5 && fit('office_desk', r, o.rot ?? 0)) return grp;
      if (fit('desk', r, o.rot ?? 0)) {
        // desk chair pulled up in front
        const rot = o.rot ?? 0, fx = Math.sin(rot), fz = Math.cos(rot);
        const c = { x: cx + fx * 0.65, z: cz + fz * 0.65 };
        fit('chair', { x0: c.x - 0.22, z0: c.z - 0.22, x1: c.x + 0.22, z1: c.z + 0.22 }, rot + Math.PI, '#3c3f44');
        return grp;
      }
      break;
    case 'sideboard': if (fit('sideboard', r, o.rot ?? 0)) return grp; break;
    case 'basin': if (fit('basin', r, o.rot ?? 0)) return grp; break;
    case 'baler': if (fit('baler', r, o.rot ?? 0)) return grp; grp.add(box(W, o.height, D, M('#d98c14', 0.5), cx, o.height / 2, cz)); return grp;
    case 'dumpster': if (fit('dumpster', r, o.rot ?? 0, '#2f6b3a')) return grp; grp.add(box(W, o.height, D, metal('#8a8f94'), cx, o.height / 2, cz)); return grp;
    case 'shopbin': if (fit('shopbin', r, o.rot ?? 0)) return grp; grp.add(cyl(W / 2, W / 2, o.height, metal('#c0c4c8'), cx, o.height / 2, cz, 16)); return grp;
    case 'pallet_rack': {
      // Blender racking bays tiled along the run (the ground-level pick face is filled from live stock)
      const along = W >= D, len = along ? W : D, n = Math.max(1, Math.round(len / 2.7)), bay = len / n;
      for (let k = 0; k < n; k++) {
        const rr = along ? { x0: r.x0 + k * bay, x1: r.x0 + (k + 1) * bay, z0: r.z0, z1: r.z1 } : { x0: r.x0, x1: r.x1, z0: r.z0 + k * bay, z1: r.z0 + (k + 1) * bay };
        if (!fit('rack_bay', rr, o.rot ?? Math.PI)) grp.add(box(rr.x1 - rr.x0, o.height, rr.z1 - rr.z0, M('#2b4f8c', 0.5), (rr.x0 + rr.x1) / 2, o.height / 2, (rr.z0 + rr.z1) / 2));
      }
      return grp;
    }
    case 'lane_marking': {
      // yellow floor lines around a staging lane, with the lane number painted at the front
      const paint = M('#e8c12a', 0.6);
      grp.add(box(W, 0.006, 0.08, paint, cx, 0.093, r.z0), box(W, 0.006, 0.08, paint, cx, 0.093, r.z1), box(0.08, 0.006, D, paint, r.x0, 0.093, cz), box(0.08, 0.006, D, paint, r.x1, 0.093, cz));
      return grp;
    }
    case 'forklift': if (fit('forklift', r, o.rot ?? 0, '#f2a516')) return grp; break;
    case 'pallet_load': if (fit('pallet_load', r, o.rot ?? 0)) return grp; break;
    case 'roller_door': if (fit('roller_door', r, o.rot ?? 0)) return grp; break;
    // building sites are drawn from the build's progress (render/sites.ts); colliders stay here
    case 'site_fence': case 'site_house': case 'site_cabin': case 'site_pallet': case 'site_mixer': return grp;
    case 'waiting_chairs': case 'water_cooler': case 'leaflet_stand': case 'bistro_set':
      if (fit(o.kind, r, o.rot ?? 0)) return grp; break;
    case 'terminal': { const f = userFacing(o); if (fit('terminal', Math.abs(Math.sin(f)) > 0.5 ? { x0: cx - 0.06, x1: cx + 0.06, z0: cz - 0.25, z1: cz + 0.25 } : { x0: cx - 0.25, x1: cx + 0.25, z0: cz - 0.06, z1: cz + 0.06 }, f)) return grp; break; }
    case 'cupboard': if (fit('locker', r, userFacing(o))) return grp; break;
    case 'kiosk': if (fit('kiosk', r, userFacing(o))) return grp; break;
    case 'board': if (fit('notice_board', r, 0)) return grp; break;
    case 'tree': if (place('tree', ((cx * 7 + cz * 3) % 6.28), undefined, 0.85 + (Math.abs(cx * 13 + cz) % 10) / 30)) return grp; break;
    case 'bench': if (fit('park_bench', r, o.rot ?? 0)) return grp; break;
    case 'bin': if (place('street_bin', cz > 0 ? Math.PI : 0, '#2f5d3a')) return grp; break;
    case 'busstop': if (place('bus_shelter', cz < 0 ? 0 : Math.PI)) return grp; break;
    case 'plant': if (fit('house_plant', r, 0, undefined, o.height)) return grp; break;
    case 'lampstand': if (fit('floor_lamp', r, 0)) return grp; break;
    case 'storage_shelf': case 'ironing_board': case 'laundry_basket': case 'drying_rack': case 'bike': case 'vacuum':
      if (fit(o.kind, r, o.rot ?? 0, o.kind === 'bike' ? '#2f6d8f' : undefined)) return grp;
      grp.add(box(W, o.height, D, M('#9aa0a6', 0.6), cx, o.height / 2, cz)); return grp;
    case 'washer': if (fit('washer', r, o.rot ?? 0)) return grp; grp.add(box(W, o.height, D, M('#f0f0ee', 0.3), cx, o.height / 2, cz)); return grp;
    case 'wardrobe': if (fit('wardrobe', r, o.rot ?? Math.PI)) return grp; break;
    case 'drawers': if (fit('drawers', r, o.rot ?? Math.PI)) return grp; break;
    case 'coffee_table': if (fit('coffee_table', r, o.rot ?? Math.PI / 2)) return grp; break;
    case 'bookcase': if (fit('bookcase', r, o.rot ?? Math.PI / 2)) return grp; break;
    case 'tv': if (fit('tvunit', r, o.rot ?? -Math.PI / 2)) return grp; break;
    case 'dining_table': if (fit('table', r, o.rot ?? 0, undefined, o.height)) return grp; break;
    case 'dining_chair': if (fit('chair', r, o.rot ?? 0, '#5a5550')) return grp; break;
    case 'laptop': {
      const lap = new THREE.Group();
      lap.add(box(0.36, 0.02, 0.25, M('#2b2f33', 0.3), 0, 0.01, 0));
      const scr = box(0.36, 0.24, 0.012, M('#1a2a3a', 0.2, { emissive: new THREE.Color('#2b5f8f'), emissiveIntensity: 0.6 }), 0, 0.13, -0.13);
      scr.rotation.x = 0.25;
      lap.add(scr);
      lap.position.set(cx, o.height, cz);
      lap.rotation.y = (o.rot ?? 0);
      grp.add(lap);
      return grp;
    }
    case 'art': {
      // framed print on the wall, front facing into the room
      const rot = o.rot ?? 0;
      const art = new THREE.Group();
      art.add(box(0.8, 0.6, 0.03, M('#2b2b2b', 0.5), 0, 0, 0));
      art.add(new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.48), new THREE.MeshStandardMaterial({ map: artTexture(o.color ?? '#c45a3c'), roughness: 0.6 })).translateZ(0.017));
      art.position.set(cx, o.height, cz);
      art.rotation.y = rot;
      grp.add(art);
      return grp;
    }
    case 'floorfinish': {
      const f = FLOORS[o.color ?? 'oak'] ?? FLOORS.oak;
      const t = f.kind === 'wood' ? tex.wood(f.a) : f.kind === 'carpet' ? tex.carpet(f.a) : tex.tiles(f.a, f.b, 4);
      const key = f.kind === 'wood' ? `wood${f.a}` : f.kind === 'carpet' ? `carpet${f.a}` : `tiles${f.a}${f.b}`;
      grp.add(box(W, 0.012, D, texMat(t, f.kind === 'tiles' ? 0.3 : f.kind === 'carpet' ? 1 : 0.6), cx, 0.086, cz, false, TILE[key] ?? 1.2));
      return grp;
    }
    case 'wallfinish': {
      // line every wall face that bounds this room (doorways stay open)
      const wp = WALLPAPERS[o.color ?? 'cream'] ?? WALLPAPERS.cream;
      const mat = texMat(wallpaperTexture(o.color ?? 'cream'), wp.pattern === 'plain' ? 0.92 : 0.8);
      const b = getWorld().buildings.find((bb) => bb.interior && r.x0 >= bb.rect.x0 - 0.5 && r.x1 <= bb.rect.x1 + 0.5 && r.z0 >= bb.rect.z0 - 0.5 && r.z1 <= bb.rect.z1 + 0.5);
      if (!b) return grp;
      const H = 3.18;
      for (const wr of wallsFor(b)) {
        for (const side of ['x0', 'x1', 'z0', 'z1'] as const) {
          // the room side that this wall forms
          const e = side === 'x0' ? r.x0 : side === 'x1' ? r.x1 : side === 'z0' ? r.z0 : r.z1;
          const horiz = side === 'z0' || side === 'z1';
          const face = horiz ? (side === 'z0' ? wr.z1 : wr.z0) : (side === 'x0' ? wr.x1 : wr.x0);
          if (Math.abs(face - e) > 0.2) continue;
          const a0 = Math.max(horiz ? r.x0 : r.z0, horiz ? wr.x0 : wr.z0), a1 = Math.min(horiz ? r.x1 : r.z1, horiz ? wr.x1 : wr.z1);
          if (a1 - a0 < 0.05) continue;
          const off = (side === 'x0' || side === 'z0' ? 1 : -1) * 0.014;
          const bside = horiz ? (Math.abs(face - b.rect.z0) < 0.4 ? 'zmin' : Math.abs(face - b.rect.z1) < 0.4 ? 'zmax' : '') : (Math.abs(face - b.rect.x0) < 0.4 ? 'xmin' : Math.abs(face - b.rect.x1) < 0.4 ? 'xmax' : '');
          const holes = (buildingWindows.get(b.id) ?? []).filter((w) => w.side === bside && w.along - w.ww / 2 >= a0 - 0.01 && w.along + w.ww / 2 <= a1 + 0.01).sort((p, q) => p.along - q.along);
          const panel = (f: number, t: number, y0: number, y1: number) => {
            if (t - f < 0.01 || y1 - y0 < 0.01) return;
            grp.add(horiz ? box(t - f, y1 - y0, 0.008, mat, (f + t) / 2, (y0 + y1) / 2, face + off, false, 1.2) : box(0.008, y1 - y0, t - f, mat, face + off, (y0 + y1) / 2, (f + t) / 2, false, 1.2));
          };
          let at = a0;
          for (const w of holes) {
            const h0 = w.along - w.ww / 2, h1 = w.along + w.ww / 2;
            panel(at, h0, 0.12, H); panel(h0, h1, 0.12, w.wy - w.wh / 2); panel(h0, h1, w.wy + w.wh / 2, H);
            at = h1;
          }
          panel(at, a1, 0.12, H);
        }
      }
      return grp;
    }
    case 'stove': if (fit('cooker', r, Math.PI)) return grp; break;
    case 'table':
      if (hasModel('table') && hasModel('chair')) {
        fit('table', r, 0, undefined, o.height);
        for (const dz of [-1, 1]) {
          const chz = cz + dz * (D / 2 + 0.25);
          fit('chair', { x0: cx - 0.22, z0: chz - 0.22, x1: cx + 0.22, z1: chz + 0.22 }, dz < 0 ? 0 : Math.PI, '#5a5550');
        }
        if (D < 1.0) {
          // the laptop on the player's dining table (cafe tables are square)
          grp.add(box(0.36, 0.02, 0.25, M('#2b2f33', 0.3), cx, o.height + 0.01, cz - 0.15));
          const scr = box(0.36, 0.24, 0.015, M('#1a2a3a', 0.2, { emissive: new THREE.Color('#2b5f8f'), emissiveIntensity: 0.6 }), cx, o.height + 0.13, cz - 0.28);
          scr.rotation.x = 0.25;
          grp.add(scr);
        }
        return grp;
      }
      break;
    case 'kitchen':
      if (hasModel('kitchen_base') && hasModel('fridge')) {
        // fridge at the left end, a run of 60 cm base units, a sink in the worktop, wall cupboards above
        fit('fridge', { x0: r.x0, z0: r.z0, x1: r.x0 + 0.7, z1: r.z1 }, Math.PI);
        const n = Math.max(1, Math.round((W - 0.7) / 0.6)), uw = (W - 0.7) / n;
        for (let k = 0; k < n; k++) fit('kitchen_base', { x0: r.x0 + 0.7 + k * uw, z0: r.z0, x1: r.x0 + 0.7 + (k + 1) * uw, z1: r.z1 }, Math.PI, '#e9e6df', o.height);
        grp.add(box(0.55, 0.02, 0.42, metal('#c6c9cc', 0.2), cx + 0.6, o.height + 0.005, cz));
        grp.add(box(0.48, 0.015, 0.36, metal('#9da1a5', 0.25), cx + 0.6, o.height + 0.012, cz));
        grp.add(cyl(0.015, 0.015, 0.3, metal('#d0d3d6', 0.2), cx + 0.6, o.height + 0.15, r.z1 - 0.08, 10));
        return grp;
      }
      break;
  }
  switch (o.kind) {
    case 'gondola': {
      const frame = metal('#dfe2e6', 0.4);
      if (hasModel('gondola_bay')) {
        // Blender-modelled bays tiled along the run, with end panels and a header sign
        const n = Math.max(1, Math.round(D / 1.25)), bay = D / n;
        for (let k = 0; k < n; k++) {
          const b = modelInstance('gondola_bay', o.color ?? '#2e8b57')!;
          b.position.set(cx, 0, r.z0 + (k + 0.5) * bay);
          b.scale.set(W / 1.2, 1, bay / 1.25);
          grp.add(b);
        }
        for (const z of [r.z0, r.z1]) grp.add(box(W + 0.04, o.height + 0.05, 0.04, frame, cx, (o.height + 0.05) / 2, z));
        grp.add(box(0.05, 0.3, D * 0.7, M(o.color ?? '#2e8b57', 0.5), cx, o.height + 0.3, cz));
        break;
      }
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
      if (o.color && fit('cafe_counter', r, Math.PI)) return grp;
      if (!o.color && hasModel('checkout')) {
        // the cashier stands where the till's interaction point is; customers face them across the belt
        const till = Object.values(getWorld().interactables).find((it) => it.kind === 'till' && it.obj.x >= r.x0 && it.obj.x <= r.x1 && Math.abs(it.obj.z - cz) < 2);
        const c = modelInstance('checkout', '#2e8b57')!;
        c.position.set(cx, 0, cz);
        c.rotation.y = till && till.pos.z > cz ? Math.PI : 0;
        c.scale.set(W / 4, o.height / 0.92, D / 1.2);
        grp.add(c);
        break;
      }
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
    case 'kennel_gate': {
      // a low galvanised gate: top and bottom rails with upright bars
      const steel = metal('#9aa3a8');
      const L = Math.max(W, D), along = D > W;
      for (const y of [0.06, o.height - 0.03]) grp.add(along ? box(0.05, 0.05, L, steel, cx, y, cz) : box(L, 0.05, 0.05, steel, cx, y, cz));
      for (let t = -L / 2 + 0.06; t <= L / 2 - 0.05; t += 0.12) grp.add(along ? cyl(0.012, 0.012, o.height, steel, cx, o.height / 2, cz + t, 6) : cyl(0.012, 0.012, o.height, steel, cx + t, o.height / 2, cz, 6));
      break;
    }
    case 'pallet': {
      if (fit('pallet', r, o.rot ?? (W > D ? 0 : Math.PI / 2), undefined, o.height)) return grp;
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
    case 'shower': {
      // corner shower: tiled walls behind, frosted glass on the open sides, a hinged door, riser, head and mixer
      const tile = texMat(tex.tiles('#e9eef0', '#dde4e7', 6), 0.25);
      const frost = new THREE.MeshPhysicalMaterial({ color: '#e8f1f4', roughness: 0.35, transmission: 0.6, thickness: 0.01, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
      const chrome = metal('#d6d9dc', 0.15);
      const H = o.height;
      grp.add(box(W, 0.08, D, M('#f7f7f5', 0.2), cx, 0.04, cz));
      grp.add(box(0.12, 0.012, 0.12, chrome, cx, 0.085, cz, false));
      // which open side faces the person using it decides where the door goes
      const it = Object.values(getWorld().interactables).find((x) => x.kind === 'shower' && x.obj.x >= r.x0 - 0.1 && x.obj.x <= r.x1 + 0.1 && x.obj.z >= r.z0 - 0.1 && x.obj.z <= r.z1 + 0.1);
      const doorSide = it ? (Math.abs(it.pos.x - cx) > Math.abs(it.pos.z - cz) ? (it.pos.x < cx ? 'xmin' : 'xmax') : (it.pos.z < cz ? 'zmin' : 'zmax')) : 'xmin';
      const sides = ['xmin', 'xmax', 'zmin', 'zmax'] as const;
      const along = (sd: string) => (sd === 'xmin' || sd === 'xmax' ? D : W);
      for (const sd of sides) {
        const atWall = (sd === 'xmax') || (sd === 'zmin' && doorSide !== 'zmin') ;
        const len = along(sd);
        const px = sd === 'xmin' ? r.x0 : sd === 'xmax' ? r.x1 : cx, pz = sd === 'zmin' ? r.z0 : sd === 'zmax' ? r.z1 : cz;
        const horiz = sd === 'zmin' || sd === 'zmax';
        if (sd === doorSide) continue;
        if (atWall) grp.add(box(horiz ? len : 0.02, H, horiz ? 0.02 : len, tile, px, H / 2, pz, false, 1.2));
        else {
          grp.add(box(horiz ? len : 0.01, H - 0.1, horiz ? 0.01 : len, frost, px, H / 2 + 0.05, pz, false));
          grp.add(box(horiz ? len : 0.03, 0.03, horiz ? 0.03 : len, chrome, px, H, pz, false));
        }
      }
      // hinged door on the side you enter from
      const len = along(doorSide);
      const horizD = doorSide === 'zmin' || doorSide === 'zmax';
      const hinge = new THREE.Group();
      hinge.position.set(doorSide === 'xmin' ? r.x0 : doorSide === 'xmax' ? r.x1 : r.x0, 0, doorSide === 'zmin' ? r.z0 : doorSide === 'zmax' ? r.z1 : r.z0);
      const leaf = box(horizD ? len : 0.012, H - 0.1, horizD ? 0.012 : len, frost, horizD ? len / 2 : 0, H / 2 + 0.05, horizD ? 0 : len / 2, false);
      const handle = box(horizD ? 0.02 : 0.03, 0.3, horizD ? 0.03 : 0.02, chrome, horizD ? len - 0.08 : 0, 1.05, horizD ? 0 : len - 0.08, false);
      hinge.add(leaf, handle);
      hinge.userData.dynamic = true;
      hinge.traverse((x) => { x.userData.dynamic = true; });
      grp.add(hinge);
      // riser, head and mixer on the wall
      const wallX = r.x1 - 0.06;
      grp.add(cyl(0.012, 0.012, 1.0, chrome, wallX, 1.5, cz, 10));
      const head = cyl(0.09, 0.07, 0.025, chrome, wallX - 0.18, 2.02, cz, 18);
      grp.add(head, box(0.2, 0.02, 0.02, chrome, wallX - 0.09, 2.04, cz, false), box(0.05, 0.14, 0.1, chrome, wallX, 1.05, cz, false));
      // falling water: a cloud of droplets that only runs while someone is washing
      const N = 260;
      const drops = new Float32Array(N * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(drops, 3));
      const water = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#cfe8f5', size: 0.025, transparent: true, opacity: 0.75, depthWrite: false }));
      water.frustumCulled = false;
      water.visible = false;
      water.userData.dynamic = true;
      grp.add(water);
      const hx = wallX - 0.18, hz = cz;
      const seed = drops.map(() => Math.random());
      fixtures.push((state: GameState, dt: number) => {
        const user = Object.values(state.people).find((p) => p.action?.type === 'shower' && p.action.target === it?.id);
        const f = user?.action ? user.action.progress / Math.max(1e-6, user.action.duration) : -1;
        // door: open while stepping in and out, shut while washing
        const openT = f < 0 ? 0 : f < 0.12 ? 1 : f < 0.16 ? 1 - (f - 0.12) / 0.04 : f < 0.86 ? 0 : f < 0.9 ? (f - 0.86) / 0.04 : 1;
        const sign = doorSide === 'xmin' || doorSide === 'zmax' ? -1 : 1;
        hinge.rotation.y += (sign * openT * 1.4 - hinge.rotation.y) * Math.min(1, dt * 6);
        const running = f > 0.15 && f < 0.86;
        water.visible = running;
        if (running) {
          for (let i = 0; i < N; i++) {
            seed[i * 3 + 1] = (seed[i * 3 + 1] + dt * 1.6 * (0.8 + seed[i * 3] * 0.4)) % 1;
            const t = seed[i * 3 + 1];
            const a = seed[i * 3 + 2] * Math.PI * 2, rr = 0.03 + 0.07 * seed[i * 3] + t * 0.12;
            drops[i * 3] = hx + Math.cos(a) * rr;
            drops[i * 3 + 1] = 2.0 - t * 1.92;
            drops[i * 3 + 2] = hz + Math.sin(a) * rr;
          }
          (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
        }
      });
      break;
    }
    case 'stairs': {
      // dog-leg stair: first flight along the front wall, half landing, second flight back up to the next floor
      const stepM = M('#b9b2a6', 0.8), noseM = M('#3a3a3a', 0.6), railM = metal('#2f3337', 0.4), wallM = M('#e6e0d6', 0.9);
      const half = (r.z1 - r.z0) / 2, landW = 1.0, run = W - landW, n = 9, rise = 1.6 / n, go = run / n;
      for (let k = 0; k < n; k++) {
        const h1 = rise * (k + 1);
        grp.add(box(go + 0.02, h1, half - 0.05, stepM, r.x1 - go * (k + 0.5), h1 / 2, r.z0 + half / 2));
        grp.add(box(0.04, 0.02, half - 0.05, noseM, r.x1 - go * (k + 1) + 0.02, h1, r.z0 + half / 2, false));
        const h2 = 1.6 + rise * (k + 1);
        grp.add(box(go + 0.02, 0.18, half - 0.05, stepM, r.x0 + landW + go * (k + 0.5), h2 - 0.09, r.z1 - half / 2));
        grp.add(box(0.04, 0.02, half - 0.05, noseM, r.x0 + landW + go * k + 0.02, h2, r.z1 - half / 2, false));
      }
      grp.add(box(landW, 1.6, D, stepM, r.x0 + landW / 2, 0.8, cz));
      // spine wall between the flights, and a sloping soffit under the upper flight
      grp.add(box(run, 1.2, 0.08, wallM, r.x0 + landW + run / 2, 0.6, cz));
      const soffit = box(Math.hypot(run, 1.6), 0.1, half - 0.05, wallM, r.x0 + landW + run / 2, 2.35, r.z1 - half / 2);
      soffit.rotation.z = Math.atan2(1.6, run);
      grp.add(soffit);
      // handrails on posts
      for (const [zr, y0, dir] of [[r.z0 + half - 0.04, 0, -1], [r.z1 - half + 0.04, 1.6, 1]] as const) {
        const rail = box(Math.hypot(run, 1.6), 0.05, 0.05, railM, r.x0 + landW + run / 2, y0 + 0.8 + 0.9, zr, false);
        rail.rotation.z = dir * Math.atan2(1.6, run);
        grp.add(rail);
        for (let k = 0; k <= 3; k++) { const x = r.x0 + landW + (run * k) / 3, y = dir > 0 ? y0 + (1.6 * k) / 3 : 1.6 - (1.6 * k) / 3; grp.add(box(0.04, 0.9, 0.04, railM, x, y + 0.45, zr, false)); }
      }
      break;
    }
    case 'mailboxes': {
      grp.add(box(W, 1.0, D, metal('#8d949b', 0.35), cx, 0.95, cz));
      const doorM = metal('#a9b0b6', 0.3), slotM = M('#1b1d20', 0.5);
      const face = r.x0 - 0.005;
      for (let row = 0; row < 4; row++) for (let col = 0; col < 2; col++) {
        const y = 0.6 + row * 0.24, z = cz - D / 4 + col * (D / 2);
        grp.add(box(0.012, 0.21, D / 2 - 0.04, doorM, face, y, z, false));
        grp.add(box(0.014, 0.025, D / 2 - 0.2, slotM, face - 0.002, y + 0.05, z, false));
        grp.add(box(0.014, 0.03, 0.08, M('#f2f2f2', 0.5), face - 0.002, y - 0.05, z - D / 8, false));
      }
      break;
    }
    case 'flatdoor': {
      // frame round the doorway and Flat 1's front door standing open into the hall
      const frameM = M('#f3f0ea', 0.5), leafM = M('#2f4a5f', 0.45);
      grp.add(box(0.08, 2.15, 0.34, frameM, r.x0 - 0.04, 1.075, cz), box(0.08, 2.15, 0.34, frameM, r.x1 + 0.04, 1.075, cz), box(W + 0.16, 0.1, 0.34, frameM, cx, 2.15, cz));
      const leaf = new THREE.Group();
      leaf.position.set(r.x0 + 0.02, 0, r.z1);
      leaf.rotation.y = -1.35;
      leaf.add(box(W - 0.04, 2.05, 0.045, leafM, (W - 0.04) / 2, 1.04, 0));
      leaf.add(box(0.12, 0.04, 0.05, metal('#c9b26b', 0.25), W - 0.15, 1.02, -0.04));
      leaf.add(box(0.1, 0.12, 0.01, metal('#c9b26b', 0.25), (W - 0.04) / 2, 1.6, -0.03));
      grp.add(leaf);
      break;
    }
    case 'tilefloor': grp.add(box(W, 0.012, D, texMat(tex.tiles('#eef0f1', '#e2e6e8', 8), 0.35), cx, 0.087, cz, false, TILE['tiles#eef0f1#e2e6e8'] ?? 1.2)); break;
    case 'toilet': {
      const ceramic = M('#f7f7f5', 0.15);
      grp.add(box(0.36, 0.4, 0.5, ceramic, cx - 0.02, 0.2, cz));
      const bowl = cyl(0.2, 0.17, 0.12, ceramic, cx - 0.08, 0.44, cz, 20); bowl.scale.set(1.15, 1, 0.9); grp.add(bowl);
      grp.add(box(0.06, 0.03, 0.42, M('#ececea', 0.3), cx - 0.08, 0.51, cz));
      grp.add(box(0.18, 0.38, 0.46, ceramic, r.x1 - 0.09, 0.62, cz));
      grp.add(cyl(0.025, 0.025, 0.02, metal('#ccc'), r.x1 - 0.09, 0.82, cz, 10));
      break;
    }
    case 'rug': grp.add(box(W, 0.015, D, texMat(tex.carpet(o.color ?? '#8a3e3a'), 1), cx, 0.09, cz, false, 1)); break;
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
    case 'railing': {
      // black metal railings: posts, top and bottom rails, bars
      const iron = metal('#1f2326', 0.45);
      const horiz = W > D, len = horiz ? W : D;
      const rail = (y: number) => grp.add(horiz ? box(W, 0.04, 0.04, iron, cx, y, cz) : box(0.04, 0.04, D, iron, cx, y, cz));
      rail(0.12); rail(o.height - 0.05);
      for (let t = 0.06; t < len; t += 0.13) {
        const p = horiz ? [r.x0 + t, cz] : [cx, r.z0 + t];
        grp.add(box(0.022, o.height - 0.1, 0.022, iron, p[0], o.height / 2, p[1], false));
      }
      for (let t = 0; t <= len + 0.01; t += 2) { const p = horiz ? [Math.min(r.x1, r.x0 + t), cz] : [cx, Math.min(r.z1, r.z0 + t)]; grp.add(box(0.06, o.height + 0.08, 0.06, iron, p[0], (o.height + 0.08) / 2, p[1])); }
      break;
    }
    case 'planter': {
      // a timber-edged raised bed with clipped shrubs and lavender
      grp.add(box(W, o.height, D, texMat(tex.wood('#7a5a3c'), 0.8), cx, o.height / 2, cz, true, 1));
      grp.add(box(W - 0.1, 0.04, D - 0.1, M('#3b2d22', 1), cx, o.height + 0.01, cz, false));
      const n = Math.max(2, Math.round(W / 0.7));
      for (let i = 0; i < n; i++) {
        const sx = r.x0 + (i + 0.5) * (W / n);
        const shrub = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28 + (i % 2) * 0.06, 1), M(i % 3 === 2 ? '#6c5a8e' : '#3f6b3a', 0.95));
        shrub.position.set(sx, o.height + 0.22, cz + ((i % 2) - 0.5) * 0.15);
        shrub.scale.y = i % 3 === 2 ? 0.7 : 0.85;
        shrub.castShadow = true;
        grp.add(shrub);
      }
      break;
    }
    case 'bin_store': {
      // slatted timber enclosure with a sloping roof and two wheelie bins showing through the gate
      const slat = texMat(tex.wood('#8a6a48'), 0.85);
      grp.add(box(W, o.height, 0.06, slat, cx, o.height / 2, r.z1 - 0.03, true, 1));
      grp.add(box(0.06, o.height, D, slat, r.x0 + 0.03, o.height / 2, cz, true, 1));
      grp.add(box(0.06, o.height, D, slat, r.x1 - 0.03, o.height / 2, cz, true, 1));
      for (let x = r.x0 + 0.1; x < r.x1 - 0.05; x += 0.16) grp.add(box(0.1, o.height - 0.15, 0.03, slat, x, (o.height - 0.15) / 2 + 0.05, r.z0 + 0.03));
      const roof = box(W + 0.2, 0.06, D + 0.25, M('#3c4146', 0.6), cx, o.height + 0.05, cz);
      roof.rotation.x = 0.08;
      grp.add(roof);
      break;
    }
    case 'bike_shelter': {
      // a curved polycarbonate roof on steel hoops over Sheffield stands, with a couple of bikes
      const steel = metal('#5d646a', 0.4);
      for (const z of [r.z0 + 0.1, r.z1 - 0.1]) { grp.add(box(0.06, o.height, 0.06, steel, r.x1 - 0.1, o.height / 2, z)); grp.add(box(0.06, o.height - 0.3, 0.06, steel, r.x0 + 0.1, (o.height - 0.3) / 2, z)); }
      const roof = box(W + 0.3, 0.03, D + 0.2, M('#cfe0e8', 0.2, { transparent: true, opacity: 0.55 }), cx, o.height - 0.12, cz, false);
      roof.rotation.z = 0.12;
      grp.add(roof);
      for (let z = r.z0 + 0.6; z < r.z1 - 0.3; z += 0.9) {
        grp.add(box(0.05, 0.7, 0.05, steel, cx - 0.25, 0.35, z)); grp.add(box(0.05, 0.7, 0.05, steel, cx + 0.25, 0.35, z)); grp.add(box(0.55, 0.05, 0.05, steel, cx, 0.7, z));
      }
      if (hasModel('bike')) for (const z of [r.z0 + 1.05, r.z0 + 2.85]) { const bike = modelInstance('bike', z < cz ? '#2a6fbf' : '#b03a2e'); if (bike) { bike.position.set(cx, 0, z); bike.rotation.y = Math.PI / 2; grp.add(bike); } }
      break;
    }
    case 'lamp': case 'car': break;
    case 'bait_hut': break; // drawn with the harbour
    case 'dartboard': {
      // on the north wall, facing into the room, with a cabinet surround and the oche on the floor
      const m = dartboardMesh();
      m.position.set(cx, o.height, cz - 0.03); m.rotation.y = Math.PI;
      grp.add(m);
      grp.add(box(0.8, 0.8, 0.04, M('#4a2f1e', 0.6), cx, o.height, cz + 0.01, false));
      grp.add(box(0.6, 0.012, 0.05, M('#d9c27a', 0.5), cx, 0.09, cz - 2.37, false));
      return grp;
    }
    default: grp.add(box(W, o.height, D, M('#888'), cx, o.height / 2, cz));
  }
  return grp;
}

/** body styles: car (hatchback), saloon, suv, sports */
export function buildCar(color: string, x: number, z: number, rot: number, van = false, style = 'car'): THREE.Group {
  const name = van ? 'van' : style;
  const model = modelInstance(name, color) ?? (van ? null : modelInstance('car', color));
  if (model) {
    // full detail close up, a lighter model further away
    const far = modelInstance(`${name}_lod`, color) ?? (van ? null : modelInstance('car_lod', color));
    const out = new THREE.Group();
    if (far) {
      const lod = new THREE.LOD();
      lod.addLevel(model, 0);
      far.traverse((o) => { o.castShadow = false; });
      lod.addLevel(far, 18);
      out.add(lod);
    } else out.add(model);
    out.userData.dynamic = true;
    out.position.set(x, 0, z);
    out.rotation.y = rot;
    return out;
  }
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
