// The building sites at the end of Harbour Road, drawn from the build's real progress: Heras fencing,
// trenches being dug, concrete going in, brick walls rising course by course inside scaffolding, roof
// trusses then tiles, windows fitted, then a rendered and painted house with a garden fence.
import * as THREE from 'three';
import type { GameState } from '../sim/types';
import { PLOTS, STAGES, courses } from '../sim/construction';
import { modelInstance, fitModel } from './models';
import { tex, worldUV, normalOf } from './textures';

const WALL_H = 5.2;
const mats = new Map<string, THREE.Material>();
const M = (key: string, make: () => THREE.Material) => { let m = mats.get(key); if (!m) { m = make(); mats.set(key, m); } return m; };
const std = (color: string, rough = 0.9, metal = 0) => M(`${color}${rough}${metal}`, () => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
const texd = (key: string, t: () => THREE.Texture, rough = 0.9) => M(key, () => { const tx = t(); return new THREE.MeshStandardMaterial({ map: tx, roughness: rough, normalMap: normalOf(tx) ?? null }); });

function box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, tile = 0) {
  const g = new THREE.BoxGeometry(Math.max(0.001, w), Math.max(0.001, h), Math.max(0.001, d));
  if (tile) worldUV(g, w, h, d, tile);
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true; o.receiveShadow = true;
  return o;
}

export class Sites {
  private groups: THREE.Group[] = [];
  private keys: string[] = [];
  private brickMeshes: THREE.InstancedMesh[] = [];
  constructor(scene: THREE.Scene) {
    for (let i = 0; i < PLOTS.length; i++) { const g = new THREE.Group(); scene.add(g); this.groups.push(g); this.keys.push(''); }
    // bricks on each pallet (live count)
    const brickGeo = new THREE.BoxGeometry(0.215, 0.065, 0.1025);
    const brickMat = std('#a5583e', 0.95);
    for (const pl of PLOTS) {
      const sgn = pl.front === 'x1' ? 1 : -1, bx = pl.front === 'x1' ? pl.rect.x0 : pl.rect.x1;
      const px = bx + sgn * 4.0;
      const m = new THREE.InstancedMesh(brickGeo, brickMat, 160);
      const d = new THREE.Object3D();
      for (let k = 0; k < 160; k++) {
        const layer = Math.floor(k / 20), i = k % 20;
        d.position.set(px - 0.45 + (i % 4) * 0.225 + (layer % 2) * 0.05, 0.18 + layer * 0.068, 67.85 + Math.floor(i / 4) * 0.17);
        d.updateMatrix(); m.setMatrixAt(k, d.matrix);
      }
      m.count = 0; m.castShadow = true; m.frustumCulled = false;
      scene.add(m);
      this.brickMeshes.push(m);
    }
  }

  update(state: GameState) {
    const b = state.build;
    PLOTS.forEach((pl, i) => {
      const done = !!b && b.plot > i;
      const active = !!b && b.plot === i;
      const stage = active ? b!.stage : done ? STAGES.length : -1;
      const prog = active ? b!.done / STAGES[b!.stage].units : 0;
      const key = `${stage}:${Math.floor(prog * 20)}:${courses(state, i)}`;
      this.brickMeshes[i].count = active ? Math.min(160, Math.ceil((state.containers.site_bricks?.items.bricks ?? 0) / 3)) : 0;
      if (key === this.keys[i]) return;
      this.keys[i] = key;
      const g = this.groups[i];
      while (g.children.length) g.remove(g.children[0]);
      this.build(g, pl, stage, prog, courses(state, i));
    });
  }

  private build(g: THREE.Group, pl: typeof PLOTS[number], stage: number, p: number, crs: number) {
    const r = pl.rect, h = pl.house;
    const finished = stage >= STAGES.length;
    const cx = (h.x0 + h.x1) / 2, cz = (h.z0 + h.z1) / 2, W = h.x1 - h.x0, D = h.z1 - h.z0;
    const sgn = pl.front === 'x1' ? 1 : -1, fx = pl.front === 'x1' ? r.x1 : r.x0, bx = pl.front === 'x1' ? r.x0 : r.x1;
    // ground: churned mud on a site, lawn when finished
    const groundM = finished ? texd('grass', () => tex.grass()) : std('#6b5640', 1);
    g.add(box(r.x1 - r.x0, 0.03, r.z1 - r.z0, groundM, (r.x0 + r.x1) / 2, 0.015, (r.z0 + r.z1) / 2, finished ? 2 : 0));
    // fence: Heras panels while building, a low painted picket fence once finished (same line, with the gate gap)
    const runs: [number, number, number, number][] = [[r.x0, r.z0, r.x1, r.z0], [r.x0, r.z1, r.x1, r.z1], [bx, r.z0, bx, r.z1], [fx, r.z0, fx, 70.6], [fx, 72.6, fx, r.z1]];
    for (const [x0, z0, x1, z1] of runs) {
      const len = Math.hypot(x1 - x0, z1 - z0), rot = Math.atan2(x1 - x0, z1 - z0) - Math.PI / 2;
      if (finished) {
        const fence = box(len, 0.9, 0.05, std('#f1ede4', 0.6), (x0 + x1) / 2, 0.45, (z0 + z1) / 2);
        fence.rotation.y = rot; g.add(fence);
        continue;
      }
      const n = Math.max(1, Math.round(len / 3.45));
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        const a = { x: x0 + (x1 - x0) * t0, z: z0 + (z1 - z0) * t0 }, c = { x: x0 + (x1 - x0) * t1, z: z0 + (z1 - z0) * t1 };
        const panel = modelInstance('heras_panel');
        if (panel) {
          panel.position.set((a.x + c.x) / 2, 0, (a.z + c.z) / 2);
          panel.rotation.y = rot;
          panel.scale.set(len / n / 3.45, 1, 1);
          g.add(panel);
        }
      }
    }
    if (stage < 0) {
      // not started yet: a sign on the fence
      g.add(box(1.4, 0.8, 0.04, std('#2f6d8f', 0.6), fx - sgn * 0.1, 1.4, 69.5));
      return;
    }
    // site kit (gone when finished)
    if (!finished) {
      const cab = fitModel('site_cabin', { x0: Math.min(bx + sgn * 0.2, bx + sgn * 2.6), z0: 67.6, x1: Math.max(bx + sgn * 0.2, bx + sgn * 2.6), z1: 68.9 }, Math.PI, '#2f6d8f');
      if (cab) g.add(cab);
      const mix = fitModel('cement_mixer', { x0: Math.min(fx - sgn * 1.0, fx - sgn * 2.1), z0: 74.6, x1: Math.max(fx - sgn * 1.0, fx - sgn * 2.1), z1: 75.6 }, Math.PI / 2);
      if (mix) g.add(mix);
      const pal = fitModel('pallet', { x0: bx + sgn * 4.0 - 0.55, z0: 67.75, x1: bx + sgn * 4.0 + 0.55, z1: 68.7 }, 0, undefined, 0.15);
      if (pal) g.add(pal);
      const barrow = fitModel('wheelbarrow', { x0: Math.min(fx - sgn * 0.6, fx - sgn * 1.25), z0: 68.2, x1: Math.max(fx - sgn * 0.6, fx - sgn * 1.25), z1: 69.6 }, 0);
      if (barrow) g.add(barrow);
    }
    const ring = (wid: number, fill: number, m: THREE.Material, y: number, hgt: number) => {
      // the four sides of the footprint, laid in order, `fill` of the way round
      const sides: [number, number, number, number][] = [[h.x0, h.z0, h.x1, h.z0], [h.x1, h.z0, h.x1, h.z1], [h.x1, h.z1, h.x0, h.z1], [h.x0, h.z1, h.x0, h.z0]];
      const total = 2 * (W + D);
      let left = fill * total;
      for (const [x0, z0, x1, z1] of sides) {
        const len = Math.hypot(x1 - x0, z1 - z0), use = Math.min(len, left);
        if (use <= 0) break;
        left -= use;
        const t = use / len;
        const ex = x0 + (x1 - x0) * t, ez = z0 + (z1 - z0) * t;
        const horiz = Math.abs(z1 - z0) < 1e-6;
        g.add(box(horiz ? Math.abs(ex - x0) + wid : wid, hgt, horiz ? wid : Math.abs(ez - z0) + wid, m, (x0 + ex) / 2, y + hgt / 2, (z0 + ez) / 2, 2));
      }
    };
    const concrete = texd('concrete', () => tex.render('#a3a29c'));
    const brick = texd('sitebrick', () => tex.brick('#a5583e'));
    // 0 groundworks: trenches (dark, slightly sunk) dug round the footprint, spoil heaps alongside
    if (stage === 0) {
      ring(0.6, p, std('#3a2c20', 1), 0.0, 0.035);
      for (let k = 0; k < Math.ceil(p * 4); k++) {
        const heap = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), std('#5e4a36', 1));
        heap.scale.y = 0.45; heap.position.set(bx + sgn * (1.6 + k * 1.3), 0.15, 75.0); heap.castShadow = true; g.add(heap);
      }
      return;
    }
    // 1 foundations: concrete going into the trenches, then the slab
    if (stage === 1) { ring(0.6, 1, std('#3a2c20', 1), 0, 0.035); ring(0.62, p, concrete, 0, 0.06); if (p > 0.6) g.add(box(W, 0.12, D, concrete, cx, 0.06, cz, 2)); return; }
    g.add(box(W + 0.3, 0.15, D + 0.3, concrete, cx, 0.075, cz, 2));
    // 2 walls: courses of brick, window and door openings left as they rise
    const wallTop = Math.max(0.2, (crs / 12) * WALL_H);
    const T = 0.3;
    const wallM = finished || stage >= 5 ? (stage >= 5 && !finished ? brick : texd('render', () => tex.render('#efe6d4'))) : brick;
    const wall = (x0: number, z0: number, x1: number, z1: number) => g.add(box(Math.abs(x1 - x0) || T, wallTop, Math.abs(z1 - z0) || T, wallM, (x0 + x1) / 2, 0.15 + wallTop / 2, (z0 + z1) / 2, 2));
    wall(h.x0, h.z0 + T / 2, h.x1, h.z0 + T / 2);
    wall(h.x0, h.z1 - T / 2, h.x1, h.z1 - T / 2);
    wall(h.x0 + T / 2, h.z0, h.x0 + T / 2, h.z1);
    wall(h.x1 - T / 2, h.z0, h.x1 - T / 2, h.z1);
    // scaffolding round the house while the walls and roof are going up
    if (stage === 2 || stage === 3) {
      const tubeM = std('#9aa0a6', 0.4, 0.7), boardM = std('#a07a4e', 0.9);
      const lifts = Math.min(3, Math.ceil(wallTop / 1.8) + (stage === 3 ? 1 : 0));
      const ofs = 0.9;
      for (const [x, z] of [[h.x0 - ofs, h.z0 - ofs], [h.x1 + ofs, h.z0 - ofs], [h.x0 - ofs, h.z1 + ofs], [h.x1 + ofs, h.z1 + ofs], [cx, h.z0 - ofs], [cx, h.z1 + ofs]]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, lifts * 1.9 + 1, 8), tubeM);
        pole.position.set(x, (lifts * 1.9 + 1) / 2, z); pole.castShadow = true; g.add(pole);
      }
      for (let l = 1; l <= lifts; l++) {
        const y = l * 1.9;
        g.add(box(W + ofs * 2, 0.05, 0.6, boardM, cx, y, h.z0 - ofs + 0.3));
        g.add(box(W + ofs * 2, 0.05, 0.6, boardM, cx, y, h.z1 + ofs - 0.3));
        g.add(box(W + ofs * 2, 0.04, 0.04, tubeM, cx, y + 1.0, h.z0 - ofs));
        g.add(box(W + ofs * 2, 0.04, 0.04, tubeM, cx, y + 1.0, h.z1 + ofs));
      }
    }
    if (stage < 3) return;
    // 3 roof: trusses go up along the house, then felt and tiles cover them (ridge runs along the long side)
    const ridgeAlongX = W >= D;
    const span = ridgeAlongX ? D : W, run = ridgeAlongX ? W : D;
    const rise = span * 0.42;
    const top = 0.15 + WALL_H;
    const rp = stage === 3 ? p : 1;
    const trusses = Math.round(rp * 2 * 8);
    const timber = std('#b48a5a', 0.85);
    for (let k = 0; k <= Math.min(8, trusses); k++) {
      const t = k / 8;
      const pos = (ridgeAlongX ? h.x0 : h.z0) + t * run;
      for (const s of [-1, 1]) {
        const rafter = box(0.06, Math.hypot(span / 2, rise), 0.12, timber, 0, 0, 0);
        const ang = Math.atan2(span / 2, rise) * s;
        if (ridgeAlongX) { rafter.position.set(pos, top + rise / 2, cz - s * span / 4); rafter.rotation.x = ang; }
        else { rafter.position.set(cx - s * span / 4, top + rise / 2, pos); rafter.rotation.z = -ang; }
        g.add(rafter);
      }
    }
    if (trusses > 8 || stage > 3) {
      const tiled = stage === 3 ? Math.max(0, (rp - 0.5) * 2) : 1;
      const roofM = texd('rooftiles', () => tex.roof('#7a4a3a'));
      const slope = Math.hypot(span / 2, rise);
      for (const s of [-1, 1]) {
        const len = run * tiled;
        const plane = box(ridgeAlongX ? len + 0.4 : 0.06, ridgeAlongX ? 0.06 : slope + 0.3, ridgeAlongX ? slope + 0.3 : len + 0.4, roofM, 0, 0, 0, 2);
        const ang = Math.atan2(rise, span / 2);
        if (ridgeAlongX) { plane.position.set(h.x0 + len / 2, top + rise / 2, cz - s * span / 4); plane.rotation.x = -s * ang; }
        else { plane.position.set(cx - s * span / 4, top + rise / 2, h.z0 + len / 2); plane.rotation.z = s * ang; }
        g.add(plane);
      }
      // gable ends (brick triangles)
      if (tiled > 0.95) for (const e of [0, 1]) {
        const shape = new THREE.Shape([new THREE.Vector2(-span / 2, 0), new THREE.Vector2(span / 2, 0), new THREE.Vector2(0, rise)]);
        const gable = new THREE.Mesh(new THREE.ShapeGeometry(shape), wallM);
        (gable.material as THREE.Material).side = THREE.DoubleSide;
        if (ridgeAlongX) { gable.position.set(e ? h.x1 - 0.15 : h.x0 + 0.15, top, cz); gable.rotation.y = Math.PI / 2; }
        else { gable.position.set(cx, top, e ? h.z1 - 0.15 : h.z0 + 0.15); }
        g.add(gable);
      }
    }
    if (stage < 4) return;
    // 4 windows and doors: frames and glass fitted one by one on the front and back
    const fitted = stage === 4 ? Math.round(p * 8) : 8;
    const frameM = std('#f4f4f2', 0.4), glass = M('siteglass', () => new THREE.MeshStandardMaterial({ color: '#9fb8c8', roughness: 0.1, metalness: 0.3 }));
    const frontX = pl.front === 'x1' ? h.x1 : h.x0;
    const slots: [number, number, boolean][] = [];
    for (const z of [cz - 1.2, cz + 1.2]) for (const y of [1.5, 4.0]) slots.push([z, y, false]);
    slots.push([cz, 1.1, true]);
    for (const z of [cz - 1.2, cz + 1.2]) for (const y of [1.5, 4.0]) slots.push([z, y, false]);
    slots.slice(0, fitted).forEach(([z, y, door], k) => {
      const backSide = k >= 5;
      const xFace = backSide ? (pl.front === 'x1' ? h.x0 : h.x1) : frontX;
      const out = (backSide ? -sgn : sgn) * 0.02;
      const w = door ? 1.0 : 1.1, hh = door ? 2.1 : 1.2;
      g.add(box(0.08, hh + 0.1, w + 0.1, frameM, xFace + out, y, z));
      g.add(box(0.09, hh - 0.08, w - 0.1, door ? std('#2f4f6f', 0.5) : glass, xFace + out * 1.5, y, z));
    });
    if (finished) {
      // a path to the front door and a little planting
      g.add(box(Math.abs(fx - frontX), 0.04, 1.2, texd('paving', () => tex.paving()), (fx + frontX) / 2, 0.04, cz, 1));
      for (const z of [h.z0 - 0.5, h.z1 + 0.5]) { const b2 = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), std('#3f7f45', 0.9)); b2.position.set(frontX + sgn * 0.8, 0.35, z); b2.castShadow = true; g.add(b2); }
    }
  }
}
