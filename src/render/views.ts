// Presentation of dynamic simulation state. Views read state; they never change it.
import * as THREE from 'three';
import type { GameState, Person } from '../sim/types';
import { AnimationController, buildRig, dress, type Rig } from './character';
import { buildCar } from './world';
import { DogView } from './dog';
import { Ragdoll } from './ragdoll';
import { Fx } from './fx';
import { applyCarDamage } from './cardamage';
import { stairY } from '../sim/world/layout';
import { LEVEL_DX, LEVEL_H, levelOf, STAIR_RUN } from '../sim/world/levels';
import { boat as harbourBoat } from './harbour';
import { CAR_MODELS } from '../sim/cars';
import { modelInstance } from './models';
import { planRoute } from '../sim/world/nav';
import { pace } from '../sim/npc';
import { productGeometry, productMaterial, productUnitGeometry } from './products';
import { buildingAt, getWorld, type Interactable, SHELF_LAYOUT, PALLET_X, SHOPS, U4_SECTIONS, U4_PALLET_Z, WH_PRODUCTS } from '../sim/world/layout';
import { ITEMS } from '../sim/items';
import { count, total, firstItem } from '../sim/inventory';
import { SHELF_CAPACITY } from '../sim/retail';
import { FORKLIFT_ID, palletsWaiting } from '../sim/forklift';
import { ageOf } from '../sim/persona';
import { buildOneOnMainThread, requestHuman, workerActive } from './humanBuilder';

/** realistic bodies are costly to cut and drape, so outfit/body rebuilds are spread over frames */
let buildBudget = 0;

/** an irregular, glossy puddle (shape varies per spill) */
const spillMat = new THREE.MeshPhysicalMaterial({ color: '#c9b48a', roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.55, depthWrite: false });
function spillGeometry(id: string): THREE.BufferGeometry {
  let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const shape = new THREE.Shape();
  const n = 28;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 0.5 * (1 + 0.22 * Math.sin(a * 3 + h) + 0.12 * Math.sin(a * 5 + h * 0.7) + 0.08 * Math.cos(a * 7 + h * 1.3));
    const x = Math.cos(a) * r * (1 + 0.25 * Math.cos(a)), y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  return new THREE.ShapeGeometry(shape);
}

const smooth = (t: number) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
const FOOT_A = new THREE.Vector3(), FOOT_B = new THREE.Vector3(), HAND_L = new THREE.Vector3(), HAND_R = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const MOP_STICK = new THREE.MeshStandardMaterial({ color: '#c9ccd0', metalness: 0.6, roughness: 0.35 });
const MOP_BLOCK = new THREE.MeshStandardMaterial({ color: '#2a7fd4', roughness: 0.6 });
const MOP_STRAND = new THREE.MeshStandardMaterial({ color: '#e8e4da', roughness: 0.95 });
const BASKET_MAT = new THREE.MeshStandardMaterial({ color: '#c0392b', roughness: 0.5, wireframe: false });
const BASKET_GEO = (() => { const g = new THREE.CylinderGeometry(0.17, 0.14, 0.14, 4, 1, true); g.rotateY(Math.PI / 4); g.scale(1.2, 1, 0.75); return g; })();
const BAG_MAT = new THREE.MeshStandardMaterial({ color: '#f2f2ee', roughness: 0.7, side: THREE.DoubleSide, transparent: true, opacity: 0.92 });

const BASE_WALKS = ['walk', 'walk_b', 'walk_c'];
const GEAR = new Set(['fishing_rod', 'bait', 'cricket_bat', 'kitchen_knife', 'golf_club', 'crowbar']);

/** a cricket bat or a kitchen knife, gripped in the fist (the hand bone's -y runs out past the fingers) */
function weaponMesh(kind: 'bat' | 'knife' | 'golf' | 'crowbar'): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'golf') {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.01, 0.95, 8), new THREE.MeshStandardMaterial({ color: '#c9ced3', metalness: 0.9, roughness: 0.25 }));
    shaft.position.y = -0.4;
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.014, 0.24, 10), new THREE.MeshStandardMaterial({ color: '#1d1d1f', roughness: 0.9 }));
    grip.position.y = 0.0;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.035, 0.03), new THREE.MeshStandardMaterial({ color: '#d4d8dc', metalness: 0.95, roughness: 0.2 }));
    head.position.set(0.035, -0.88, 0);
    g.add(shaft, grip, head);
  } else if (kind === 'crowbar') {
    const red = new THREE.MeshStandardMaterial({ color: '#8a1c1c', metalness: 0.6, roughness: 0.45 });
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.62, 8), red);
    bar.position.y = -0.24;
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 6, 10, Math.PI), red);
    hook.position.set(0.045, -0.55, 0); hook.rotation.z = Math.PI;
    g.add(bar, hook);
  } else if (kind === 'bat') {
    const wood = new THREE.MeshStandardMaterial({ color: '#d9b77a', roughness: 0.55 });
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.26, 10), new THREE.MeshStandardMaterial({ color: '#1d1d1f', roughness: 0.9 }));
    grip.position.y = -0.02;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.56, 0.035), wood);
    blade.position.y = -0.43;
    const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.019, 0.08, 10), wood);
    shoulder.position.y = -0.17;
    g.add(grip, shoulder, blade);
  } else {
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.11, 0.016), new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.6 }));
    handle.position.y = -0.02;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.19, 0.003), new THREE.MeshStandardMaterial({ color: '#d4d8dc', metalness: 0.9, roughness: 0.22 }));
    blade.position.y = -0.17;
    g.add(handle, blade);
  }
  g.traverse((o) => { o.castShadow = true; });
  return g;
}

/** turn a bone so the way it runs (towards its child) points at a world position */
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();
function aimBone(bone: THREE.Object3D, child: THREE.Object3D, target: THREE.Vector3) {
  if (!bone.parent || child.position.lengthSq() < 1e-8) return;
  bone.parent.updateWorldMatrix(true, false);
  const from = bone.getWorldPosition(_v1);
  const dir = _v2.copy(target).sub(from);
  if (dir.lengthSq() < 1e-8) return;
  dir.normalize().applyQuaternion(bone.parent.getWorldQuaternion(_q).invert());
  bone.quaternion.setFromUnitVectors(child.position.clone().normalize(), dir);
  bone.updateMatrixWorld(true);
}

const BLOOD_MAT = new THREE.MeshStandardMaterial({ color: '#4a0606', roughness: 0.18, metalness: 0.05, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
let bloodGeos: THREE.BufferGeometry[] | null = null;
/** the height of the paving or road surface at a point (pavements are raised above the road) */
function surfaceY(x: number, z: number): number {
  let y = 0;
  for (const r of getWorld().roads) {
    if (r.kind === 'grass' || x < r.rect.x0 || x > r.rect.x1 || z < r.rect.z0 || z > r.rect.z1) continue;
    y = Math.max(y, (r.kind === 'sidewalk' || r.kind === 'plaza' ? 0.12 : 0.06) - 0.03);
  }
  return y;
}
/** a few irregular splat shapes, shared by every pool of blood */
function bloodShapes(): THREE.BufferGeometry[] {
  if (bloodGeos) return bloodGeos;
  bloodGeos = [];
  for (let k = 0; k < 4; k++) {
    const sh = new THREE.Shape();
    const n = 22;
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * Math.PI * 2;
      const r = 0.75 + 0.25 * Math.sin(t * (3 + k) + k) + 0.12 * Math.sin(t * 7 + k * 2);
      const x = Math.cos(t) * r, y = Math.sin(t) * r * (0.75 + k * 0.08);
      if (i === 0) sh.moveTo(x, y); else sh.lineTo(x, y);
    }
    const geo = new THREE.ShapeGeometry(sh);
    geo.rotateX(-Math.PI / 2);
    bloodGeos.push(geo);
  }
  return bloodGeos;
}
/** how someone walks: their own gait, changed by injury, drink, mood, age and confidence */
export function walkStyleFor(p: Person): string {
  if (p.injured || (p.health ?? 100) < 50) return 'walk_limp';
  if ((p.drunk ?? 0) > 40) return 'walk_drunk';
  if (p.needs.mood < 25) return 'walk_sad';
  if (ageOf(p) > 70) return 'walk_slow';
  if (p.traits.ambition > 0.75 && p.needs.mood > 70) return 'walk_proud';
  if (p.gait) return p.gait;
  if (p.isPlayer) return 'walk';
  // brisk walkers stride, slow ones amble; the rest have one of three ordinary gaits
  const pc = pace(p);
  if (pc > 1.1) return 'walk_brisk';
  if (pc < 0.88) return 'walk_slow';
  let h = 0;
  for (let i = 0; i < p.id.length; i++) h = (h * 33 + p.id.charCodeAt(i)) >>> 0;
  return BASE_WALKS[h % BASE_WALKS.length];
}

/** the group for a storey: what is inside it is placed in simulation coordinates (see levels.ts) */
const levelGroups = new Map<number, THREE.Group>();
export function levelGroup(scene: THREE.Scene, k: number): THREE.Object3D {
  if (k === 0) return scene;
  let g = levelGroups.get(k);
  if (!g || g.parent !== scene) {
    g = new THREE.Group();
    g.position.set(-k * LEVEL_DX, k * LEVEL_H, 0);
    scene.add(g);
    levelGroups.set(k, g);
  }
  return g;
}
/** move an object (and its hangers-on) into the group for the storey it should be drawn on */
function toLevel(scene: THREE.Scene, k: number, ...objs: (THREE.Object3D | null | undefined)[]) {
  const g = levelGroup(scene, k);
  for (const o of objs) if (o && o.parent !== g) { o.parent?.remove(o); g.add(o); }
}

/** a Harbour Bikes hire bike, in the scheme's blue, front along +z */
function hireBike(): THREE.Group {
  const g = new THREE.Group();
  const frame = new THREE.MeshStandardMaterial({ color: '#1f6fd1', roughness: 0.4, metalness: 0.4 });
  const black = new THREE.MeshStandardMaterial({ color: '#151515', roughness: 0.8 });
  const steel = new THREE.MeshStandardMaterial({ color: '#b0b5ba', roughness: 0.3, metalness: 0.8 });
  for (const z of [-0.52, 0.52]) {
    const w = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.035, 8, 24), black); w.rotation.y = Math.PI / 2; w.position.set(0, 0.36, z); g.add(w);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.08, 8), steel); hub.rotation.z = Math.PI / 2; hub.position.set(0, 0.36, z); g.add(hub);
  }
  const bar = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m = frame, r = 0.025) => {
    const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, a.distanceTo(b), 8), m);
    c.position.copy(a).add(b).multiplyScalar(0.5);
    c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    g.add(c);
  };
  bar(0, 0.36, -0.52, 0, 0.45, -0.05); bar(0, 0.45, -0.05, 0, 0.82, -0.18); bar(0, 0.45, -0.05, 0, 0.8, 0.38);
  bar(0, 0.8, 0.38, 0, 0.36, 0.52); bar(0, 0.82, -0.18, 0, 0.8, 0.38); bar(0, 0.36, -0.52, 0, 0.82, -0.18);
  bar(0, 0.8, 0.38, 0, 1.0, 0.33); bar(-0.28, 1.0, 0.33, 0.28, 1.0, 0.33, black, 0.02);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.26), black); seat.position.set(0, 0.88, -0.2); g.add(seat);
  const basket = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.26), black); basket.position.set(0, 0.92, 0.58); g.add(basket);
  g.traverse((o) => { o.castShadow = true; });
  return g;
}

class PersonView {
  rig: Rig;
  anim: AnimationController;
  outfitKey = '';
  lastPos = new THREE.Vector3();
  speed = 0;
  carried: THREE.Mesh | null = null;
  carriedItem = '';
  carriedHeld = true;
  mop: THREE.Group | null = null;
  binbag: THREE.Object3D | null = null;
  handItem: THREE.Mesh | null = null;
  plate: THREE.Group | null = null;
  tool: THREE.Object3D | null = null;
  private toolName: string | null = null;
  private handProd: string | null = null;
  label: THREE.Sprite | null = null;
  culled = false;
  /** sideways offset so two people standing on the same spot are drawn side by side */
  nudge = { x: 0, z: 0 };
  shadow = true;

  constructor(public p: Person, private scene: THREE.Scene) {
    this.rig = buildRig(p.appearance);
    this.anim = new AnimationController(this.rig);
    this.outfitKey = JSON.stringify(p.appearance);
    levelGroup(scene, levelOf(p.pos.x)).add(this.rig.root);
    this.rig.root.position.set(p.pos.x, 0, p.pos.z);
    this.lastPos.copy(this.rig.root.position);
  }

  /** a world-space point into the coordinates of the storey this person is drawn on */
  private toLocal(v: THREE.Vector3) { this.rig.root.parent?.worldToLocal(v); return v; }

  update(state: GameState, p: Person, dt: number) {
    this.p = p;
    const root = this.rig.root;
    // drawn on the storey they are on (props and all)
    const lv = levelOf(p.pos.x);
    if (root.parent !== levelGroup(this.scene, lv)) {
      toLevel(this.scene, lv, root, this.mop, this.binbag, this.tool, this.handItem, this.plate, this.rod?.rod, this.rod?.line, this.rod?.float);
      root.position.set(p.pos.x, 0, p.pos.z);
      this.lastPos.copy(root.position);
    }
    // at the wheel: drawn sitting in the driver's seat, hands on the wheel, seen through the glass
    const seat = p.where === 'vehicle' ? Object.values(state.vehicles).find((v) => v.driverId === p.id && (v.kind === 'car' || v.kind === 'van' || v.kind === 'forklift' || v.kind === 'bike')) : undefined;
    root.visible = (p.visible || !!seat) && !this.culled;
    if (this.mop) this.mop.visible = root.visible && !seat;
    if (this.binbag) this.binbag.visible = root.visible && !seat;
    if (!root.visible) { root.position.set(p.pos.x, 0, p.pos.z); return; }
    if (seat) { this.atWheel(seat, dt); return; }
    root.rotation.x = 0;
    const key = JSON.stringify(p.appearance);
    // a change of clothes waits for the new body (built in the background) and then swaps it in
    if (key !== this.outfitKey && (requestHuman(p.appearance, true) || (!workerActive() && buildBudget > 0))) {
      buildBudget--;
      const prev = JSON.parse(this.outfitKey);
      if (prev.build !== p.appearance.build || prev.height !== p.appearance.height || prev.frame !== p.appearance.frame || prev.skin !== p.appearance.skin) {
        const parent = this.rig.root.parent!;
        const pos = this.rig.root.position.clone(), rot = this.rig.root.rotation.y;
        parent.remove(this.rig.root);
        this.rig = buildRig(p.appearance);
        this.anim = new AnimationController(this.rig);
        this.rig.root.position.copy(pos); this.rig.root.rotation.y = rot;
        parent.add(this.rig.root);
        this.carried = null; this.carriedItem = '';
        this.mop?.parent?.remove(this.mop); this.mop = null;
        this.binbag?.parent?.remove(this.binbag); this.binbag = null;
      } else dress(this.rig, p.appearance);
      this.outfitKey = key;
    }
    const stage = this.staging(state, p, dt);
    const target = stage ? new THREE.Vector3(stage.pos.x, 0, stage.pos.z) : new THREE.Vector3(p.pos.x + this.nudge.x, stairY(p.pos), p.pos.z + this.nudge.z);
    // on the stairs: partway up (or down) the flight to the next storey
    const m = p.move, nxt = m?.path[m.idx];
    if (m && nxt && (m.climb ?? 0) > 0 && levelOf(nxt.x) !== lv) {
      const dk = levelOf(nxt.x) - lv, f = Math.min(1, (m.climb ?? 0) / STAIR_RUN);
      target.set(p.pos.x + (nxt.x - dk * LEVEL_DX - p.pos.x) * f, dk * LEVEL_H * f, p.pos.z + (nxt.z - p.pos.z) * f);
    }
    // smooth presentation, but snap on large jumps (teleports, loading)
    if (root.position.distanceTo(target) > 3) root.position.copy(target);
    else root.position.lerp(target, Math.min(1, dt * 20));
    const moved = root.position.distanceTo(this.lastPos);
    this.lastPos.copy(root.position);
    const inst = dt > 0 ? moved / dt : 0;
    this.speed += (inst - this.speed) * Math.min(1, dt * 10);
    // facing
    let yaw = stage ? stage.face : p.facing;
    const cur = root.rotation.y;
    let diff = ((yaw - cur + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    root.rotation.y = cur + diff * Math.min(1, dt * 12);
    // lying down / sitting alignment
    const a = p.action;
    const it = a ? getWorld().interactables[a.target] : null;
    // getting into and out of bed: sit on the edge, then swing round and lie down (and the reverse)
    const lying = a?.type === 'sleep' || a?.type === 'serve_time';
    if (lying && it) this.bedIt = it;
    this.bedT = Math.max(0, Math.min(1, this.bedT + (lying ? dt : -dt) / 1.6));
    if (this.bedT <= 0 && !lying) this.bedIt = null;
    const bed = this.bedIt;
    if (bed) {
      const t = smooth(this.bedT);
      const isBed = bed.kind === 'bed';
      const bedTop = isBed ? 0.62 : 0.5;
      // edge: seated beside the bed facing the room; lying: along the bed, head on the pillow
      const ex = bed.pos.x + (bed.obj.x - bed.pos.x) * 0.45, ez = bed.pos.z + (bed.obj.z - bed.pos.z) * 0.45;
      const outYaw = Math.atan2(bed.pos.x - bed.obj.x, bed.pos.z - bed.obj.z);
      // lie along the bed: feet at the foot end (the way the bed faces), head on the pillows by the headboard
      const ob = getWorld().obstacles.find((o) => (o.kind === 'bed' || o.kind === 'sofa') && bed.obj.x >= o.rect.x0 - 0.3 && bed.obj.x <= o.rect.x1 + 0.3 && bed.obj.z >= o.rect.z0 - 0.3 && bed.obj.z <= o.rect.z1 + 0.3);
      let lx = bed.obj.x, lz = bed.obj.z, lieYaw = 0;
      if (ob) {
        const rot = ob.rot ?? (ob.kind === 'bed' ? -Math.PI / 2 : 0);
        const fx = Math.sin(rot), fz = Math.cos(rot);
        const len = Math.abs(fx) > 0.5 ? ob.rect.x1 - ob.rect.x0 : ob.rect.z1 - ob.rect.z0;
        lx = (ob.rect.x0 + ob.rect.x1) / 2 + fx * (len / 2 - 0.12);
        lz = (ob.rect.z0 + ob.rect.z1) / 2 + fz * (len / 2 - 0.12);
        lieYaw = rot;
      }
      const k = smooth((t - 0.35) / 0.65);
      root.position.set(ex + (lx - ex) * k, 0, ez + (lz - ez) * k);
      let dy = lieYaw - outYaw; dy = ((dy + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      root.rotation.y = outYaw + dy * k;
      this.rig.body.rotation.set(-Math.PI / 2 * k, 0, 0);
      this.rig.body.position.set(0, (bedTop + 0.1) * k, 0);
      yaw = root.rotation.y;
      this.bedPose = this.bedT < 0.4 ? 'sit' : 'sleep';
    } else {
      this.rig.body.rotation.set(0, 0, 0);
      this.rig.body.position.set(0, 0, 0);
      if (a?.type === 'shower' && it) {
        // walk in through the door, wash under the water, walk back out: driven by the action's progress
        const f = a.progress / Math.max(1e-6, a.duration);
        const inside = { x: it.obj.x - 0.05, z: it.obj.z };
        const k = f < 0.12 ? smooth(f / 0.12) : f > 0.88 ? 1 - smooth((f - 0.88) / 0.12) : 1;
        root.position.set(it.pos.x + (inside.x - it.pos.x) * k, 0, it.pos.z + (inside.z - it.pos.z) * k);
        const inYaw = Math.atan2(inside.x - it.pos.x, inside.z - it.pos.z);
        root.rotation.y = f > 0.88 ? inYaw + Math.PI : f < 0.12 ? inYaw : inYaw + Math.PI * 0.5;
        yaw = root.rotation.y;
        this.showerStep = f < 0.12 || f > 0.88;
      } else if (a?.type === 'study' && it) {
        // seated at the desk, facing it
        root.position.set(it.obj.x, 0, it.obj.z);
        root.rotation.y = Math.atan2(it.obj.x - it.pos.x, it.obj.z - it.pos.z);
        yaw = root.rotation.y;
      } else if (a?.type === 'feed_pigeons' && it) {
        // back to the bench, scattering crumbs on the ground in front
        root.rotation.y = Math.atan2(it.pos.x - it.obj.x, it.pos.z - it.obj.z);
        yaw = root.rotation.y;
      } else if ((a?.type === 'sit' || a?.type === 'watch_tv') && it && (it.kind === 'sofa' || it.kind === 'chair' || it.kind === 'iv_chair' || it.kind === 'iv_host' || it.kind === 'bench')) {
        // sit on the seat itself, facing out from the back rest
        const dx = it.pos.x - it.obj.x, dz = it.pos.z - it.obj.z, l = Math.hypot(dx, dz) || 1;
        root.position.set(it.obj.x + (dx / l) * (it.kind === 'sofa' ? 0.12 : 0.02), 0, it.obj.z + (dz / l) * (it.kind === 'sofa' ? 0.12 : 0.02));
        root.rotation.y = Math.atan2(dx, dz);
        yaw = root.rotation.y;
      }
    }
    void diff;
    // carried case (real hands inventory)
    const hands = state.containers[p.handsId];
    const item = firstItem(hands);
    if (item && item !== this.carriedItem) {
      if (this.carried) this.rig.carry.remove(this.carried);
      this.carried = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.34), new THREE.MeshStandardMaterial({ color: '#b8925d', roughness: 0.9 }));
      const label = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.01), new THREE.MeshStandardMaterial({ color: ITEMS[item].color }));
      label.position.set(0, 0.02, 0.172);
      this.carried.add(label);
      this.carried.castShadow = true;
      this.rig.carry.add(this.carried);
      this.carriedItem = item;
    } else if (!item && this.carried) {
      this.rig.carry.remove(this.carried);
      this.carried = null;
      this.carriedItem = '';
    }
    if (this.carried) this.carried.scale.y = Math.max(0.35, total(hands) / ITEMS[item!].caseSize);
    // mop: a world-space prop solved after the pose each frame (see placeProps)
    if (p.equipment === 'mop' && !this.mop) {
      this.mop = new THREE.Group();
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1, 8), MOP_STICK);
      stick.name = 'stick';
      const head = new THREE.Group();
      head.name = 'head';
      const block = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.035, 0.09), MOP_BLOCK);
      block.position.y = 0.04;
      head.add(block);
      for (let k = 0; k < 14; k++) {
        const strand = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.012, 0.16), MOP_STRAND);
        strand.position.set(-0.14 + k * 0.0215, 0.012, (k % 2 ? 0.02 : -0.02));
        strand.rotation.y = (k % 3 - 1) * 0.15;
        head.add(strand);
      }
      this.mop.add(stick, head);
      this.mop.traverse((o) => { o.castShadow = true; });
      this.rig.root.parent!.add(this.mop);
    } else if (p.equipment !== 'mop' && this.mop) {
      this.mop.parent?.remove(this.mop);
      this.mop = null;
    }
    // a single item in the right hand while it moves between case/shelf/basket: taken in the first part
    // of each unit, put down at the end (the stock change happens when the unit completes)
    let handProd: string | null = null;
    if (a && a.unitTime > 0 && (a.type === 'stock_shelf' || a.type === 'pick_item' || a.type === 'face_shelf')) {
      const prod = it?.product ?? (it?.businessId ? state.businesses[it.businessId]?.sections[it.id] : undefined) ?? null;
      const phase = a.progress / a.unitTime;
      if (prod && phase > 0.15 && phase < 0.9) handProd = prod;
    }
    if (handProd !== this.handProd) {
      if (this.handItem) { this.handItem.parent?.remove(this.handItem); this.handItem = null; }
      if (handProd) {
        const m = new THREE.Mesh(productUnitGeometry(handProd), productMaterial);
        m.castShadow = true;
        this.rig.root.parent!.add(m);
        this.handItem = m;
      }
      this.handProd = handProd;
    }
    // site tools in the hand
    const toolName = p.equipment?.startsWith('tool_') ? p.equipment : null;
    if (toolName !== this.toolName) {
      if (this.tool) { this.tool.parent?.remove(this.tool); this.tool = null; }
      if (toolName) { const t = modelInstance(toolName); if (t) { t.traverse((o) => { o.castShadow = true; }); this.rig.root.parent!.add(t); this.tool = t; } }
      this.toolName = toolName;
    }
    // a plated meal carried from the grill to the counter, in both hands in front
    if (p.equipment === 'plate' && !this.plate) {
      const g = new THREE.Group();
      const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, 0.02, 24), new THREE.MeshStandardMaterial({ color: '#f4f2ec', roughness: 0.25 }));
      const food = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), new THREE.MeshStandardMaterial({ color: '#c97a35', roughness: 0.7 }));
      food.scale.y = 0.45; food.position.set(0.02, 0.025, 0);
      const greens = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshStandardMaterial({ color: '#4c9a2a', roughness: 0.8 }));
      greens.position.set(-0.06, 0.02, 0.03);
      g.add(dish, food, greens);
      this.rig.root.parent!.add(g);
      this.plate = g;
    } else if (p.equipment !== 'plate' && this.plate) { this.plate.parent?.remove(this.plate); this.plate = null; }
    // a tied bin bag carried out to the dumpster in the right hand
    if (p.equipment === 'rubbish' && !this.binbag) {
      this.binbag = modelInstance('binbag') ?? new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.3 }));
      this.binbag.traverse((o) => { o.castShadow = true; });
      this.rig.root.parent!.add(this.binbag);
    } else if (p.equipment !== 'rubbish' && this.binbag) {
      this.binbag.parent?.remove(this.binbag);
      this.binbag = null;
    }
    // shopping basket (picked goods) in the left hand, carrier bag (paid goods) in the right
    this.syncHeld(state, p);
    this.syncWeapon(p);
    this.syncPhone();
    this.syncRod(state, p);
    const stepping = a?.type === 'shower' && this.showerStep;
    const realSpeed = stage ? (stage.walking ? Math.max(0.6, this.speed) : 0) : stepping ? 0.9 : a || this.bedIt ? 0 : this.speed;
    // site work looks like the job in hand: digging and shovelling, laying bricks, fixing and painting
    const siteClip = a?.type === 'site_work' ? (p.equipment === 'tool_spade' || p.equipment === 'tool_shovel' ? 'clean' : 'stock_shelf') : null;
    const floored = p.down != null || !!p.dead;
    const gest = p.gesture && state.minute < p.gesture.until && !p.move ? `g:${p.gesture.clip}` : null;
    const kick = a?.type === 'attack' && a.arg === 'kick' ? 'g:kick' : null;
    // a hold-up, beat by beat: the robber threatens, waits, takes the cash and pockets it; the clerk
    // freezes, opens the till, takes the notes out and hands them over
    const prog = a && a.duration > 0 ? a.progress / a.duration : 0;
    const beat = a?.type === 'rob' && a.duration > 1 ? (prog < 0.6 ? 'g:argue' : prog < 0.78 ? 'g:idle' : prog < 0.9 ? 'g:pickup' : 'g:place')
      : a?.type === 'hand_over_cash' ? (prog < 0.18 ? 'g:scared' : prog < 0.55 ? 'g:type' : prog < 0.78 ? 'g:pickup' : 'g:place')
      // buying over a counter: ask, wait while it is fetched or poured, take it, put it away (or drink it)
      : a?.type === 'buy_pint' ? (prog < 0.08 ? 'g:talk' : prog < 0.18 ? 'g:idle' : prog < 0.22 ? 'g:pickup' : 'g:drink')
      : a?.type === 'buy_tackle' || a?.type === 'buy_weapon' || a?.type === 'sell_catch' || a?.type === 'hire_boat' ? (prog < 0.45 ? 'g:talk' : prog < 0.75 ? 'g:pickup' : 'g:place') : null;
    this.syncPint(a?.type === 'buy_pint' && prog > 0.19);
    this.syncCash(p, a?.type === 'rob' ? prog > 0.78 && prog < 0.96 : a?.type === 'hand_over_cash' ? prog > 0.5 && prog < 0.9 : false);
    const flurry = a?.type === 'attack' && a.arg === 'flurry' ? 'g:fight' : null;
    // just back on their feet after being knocked over
    const gettingUp = !floored && performance.now() < this.getUpUntil ? 'g:stand_up' : null;
    let clipAction = floored ? 'down' : gettingUp ? gettingUp : beat ? beat : kick ? kick : flurry ? flurry : gest ? gest : stage ? (stage.walking ? null : stage.clip) : this.bedIt ? this.bedPose : stepping ? null : siteClip ?? a?.type ?? null;
    // everyone dances their own way; on a treadmill you run
    if (clipAction === 'dance') { let h = 0; for (let i = 0; i < p.id.length; i++) h = (h * 31 + p.id.charCodeAt(i)) >>> 0; clipAction = `g:${['dance', 'dance_b', 'dance_c'][h % 3]}`; }
    if (clipAction === 'workout' && a?.arg === 'treadmill') clipAction = 'g:run';
    // standing about with nothing to do: people check their phones, yawn when tired, stretch
    if (!clipAction && realSpeed === 0 && !p.isPlayer && !item) {
      this.idleFor += dt;
      if (this.idleFidget && performance.now() < this.idleFidget.until) clipAction = `g:${this.idleFidget.clip}`;
      else if (this.idleFor > 6 && Math.random() < dt * 0.12) {
        const tired = p.needs.energy < 35;
        const r = Math.random();
        const clip = tired && r < 0.5 ? 'yawn' : r < 0.6 ? 'phone' : r < 0.8 ? 'idle' : 'shrug';
        this.idleFidget = { clip, until: performance.now() + (clip === 'phone' ? 6000 : 2600) };
        this.idleFor = 0;
      }
    } else { this.idleFor = 0; this.idleFidget = null; }
    this.anim.walkStyle = walkStyleFor(p);
    this.anim.update(dt, realSpeed, !!item, clipAction);
    // keep the feet on the floor: whatever the animation does, the lower foot rests on the ground
    if (!this.bedIt && !floored && this.rig.joints) {
      this.rig.root.updateMatrixWorld(true);
      this.toLocal(this.rig.bones.footL.getWorldPosition(FOOT_A));
      this.toLocal(this.rig.bones.footR.getWorldPosition(FOOT_B));
      const rest = this.rig.joints.footL.y * this.rig.body.scale.y;
      const target = Math.max(-0.3, Math.min(0.3, rest - (Math.min(FOOT_A.y, FOOT_B.y) - root.position.y)));
      this.ground += (target - this.ground) * Math.min(1, dt * 14);
      this.rig.body.position.y = this.ground;
    }
    // knocked down or dead: the body goes limp and falls the way the blow sent it
    if (floored && this.rig.joints) {
      if (!this.ragdoll) {
        const h = p.hit && state.minute - p.hit.at < 1 ? p.hit : null;
        const dir = h ? new THREE.Vector3(Math.sin(h.dir), 0, Math.cos(h.dir)) : new THREE.Vector3(-Math.sin(p.facing), 0, -Math.cos(p.facing));
        this.rig.root.updateMatrixWorld(true);
        this.ragdoll = new Ragdoll(this.rig, this.rig.root.getWorldPosition(new THREE.Vector3()).y, dir, h?.force ?? (h?.heavy ? 4.2 : h ? 2.6 : 1.2));
      }
      this.ragdoll.step(dt);
      this.ragdoll.apply();
    } else if (this.ragdoll) {
      this.ragdoll = null;
      if (!p.dead) this.getUpUntil = performance.now() + 1100;
    }
    // a blow that does not floor them: the upper body snaps back from it
    if (!floored && p.hit && p.hit.at !== this.lastHit) {
      this.lastHit = p.hit.at;
      if (state.minute - p.hit.at < 0.5) { this.flinch = p.hit.heavy ? 1 : 0.7; this.flinchFrom = p.hit.dir - root.rotation.y; }
    }
    if (this.flinch > 0 && !floored) {
      const k = this.flinch;
      // hit from the front: lean back; from the side: twist away
      const fwd = Math.cos(this.flinchFrom), side = Math.sin(this.flinchFrom);
      this.rig.bones.spine.rotateX(0.35 * k * fwd);
      this.rig.bones.chest.rotateX(0.25 * k * fwd);
      this.rig.bones.chest.rotateZ(-0.3 * k * side);
      this.rig.bones.head.rotateX(0.45 * k * fwd);
      this.rig.bones.head.rotateZ(-0.35 * k * side);
      this.flinch = Math.max(0, this.flinch - dt * 4);
    }
    this.placeProps(a?.type ?? null, p.facing);
  }
  /** sitting in the driver's seat of a car, van or forklift: placed in the cab, turned with it */
  private atWheel(v: { kind: string; model?: string; pos: { x: number; z: number }; heading: number }, dt: number) {
    const root = this.rig.root;
    // driver's seat: right-hand side (this is Britain); the van's cab is high and forward; the forklift's seat in the middle
    const [lx, ly, lz] = v.kind === 'van' ? [-0.45, 0.15, 1.35] : v.kind === 'forklift' ? [0, 0.3, -0.25] : v.kind === 'bike' ? [0, 0.32, -0.12] : v.model === 'coupe' ? [-0.4, -0.66, -0.1] : v.model === 'suv' ? [-0.4, -0.35, 0.05] : [-0.4, -0.5, 0.05];
    const c = Math.cos(v.heading), s = Math.sin(v.heading);
    const lift = (v as { lift?: number }).lift ?? 0, pitch = (v as { pitch?: number }).pitch ?? 0;
    root.position.set(v.pos.x + lx * c + lz * s, ly + lift - Math.sin(pitch) * lz, v.pos.z - lx * s + lz * c);
    root.rotation.order = 'YXZ';
    root.rotation.set(pitch, v.heading, 0);
    this.rig.body.rotation.set(0, 0, 0);
    this.rig.body.position.set(0, 0, 0);
    this.ragdoll = null;
    this.anim.update(dt, 0, false, 'g:sit');
    const B = this.rig.bones;
    // sat on the seat itself: measure where the sitting pose puts the hips and lift the body to the
    // cushion height for this car (whatever the clip's own hip height is)
    const HIPS: Record<string, number> = { sports: 0.42, coupe: 0.42, suv: 0.74, van: 1.0 };
    if (v.kind === 'car' || v.kind === 'van') {
      root.updateMatrixWorld(true);
      const hy = B.hips.getWorldPosition(new THREE.Vector3()).y;
      const want = (v.kind === 'van' ? HIPS.van : HIPS[v.model ?? ''] ?? 0.55) + lift;
      root.position.y += want - hy;
    }
    if (v.kind === 'bike') {
      // pedalling: the legs go round with the speed, leaning on the bars
      const moved = Math.hypot(root.position.x - this.lastPos.x, root.position.z - this.lastPos.z);
      this.pedal += moved * 2.4;
      for (const [s, ph] of [['L', 0], ['R', Math.PI]] as const) {
        const a = this.pedal + ph;
        B[`thigh${s}`].quaternion.setFromEuler(new THREE.Euler(-1.15 + Math.sin(a) * 0.45, 0, 0));
        B[`shin${s}`].quaternion.setFromEuler(new THREE.Euler(1.0 + Math.cos(a) * 0.45, 0, 0));
      }
      B.spine.quaternion.setFromEuler(new THREE.Euler(0.35, 0, 0));
      B.armL.quaternion.setFromEuler(new THREE.Euler(-1.0, 0, -0.25));
      B.armR.quaternion.setFromEuler(new THREE.Euler(-1.0, 0, 0.25));
      B.foreL.quaternion.setFromEuler(new THREE.Euler(-0.3, 0, 0));
      B.foreR.quaternion.setFromEuler(new THREE.Euler(-0.3, 0, 0));
      this.lastPos.copy(root.position);
      return;
    }
    // both hands forward on the wheel, elbows bent: aim the upper arm at the elbow and the forearm at
    // the wheel rim (worked out in the world, so it holds whatever the rig's bone axes are)
    root.updateMatrixWorld(true);
    const fwd = new THREE.Vector3(Math.sin(v.heading), 0, Math.cos(v.heading));
    const chest = B.chest.getWorldPosition(new THREE.Vector3());
    const wheel = chest.clone().addScaledVector(fwd, 0.45).add(new THREE.Vector3(0, -0.12, 0));
    const turn = Math.sin(performance.now() / 900) * 0.02;
    for (const [arm, fore, hand] of [[B.armL, B.foreL, B.handL], [B.armR, B.foreR, B.handR]] as const) {
      const sh = arm.getWorldPosition(new THREE.Vector3());
      const side = sh.clone().sub(chest); side.y = 0; side.addScaledVector(fwd, -side.dot(fwd));
      const grip = wheel.clone().addScaledVector(side.normalize(), 0.17).add(new THREE.Vector3(0, turn * Math.sign(side.x + side.z), 0));
      const elbow = sh.clone().lerp(grip, 0.5).addScaledVector(side, 0.07).add(new THREE.Vector3(0, -0.12, 0));
      aimBone(arm, fore, elbow);
      aimBone(fore, hand, grip);
    }
    this.lastPos.copy(root.position);
  }
  private pedal = 0;
  private ragdoll: Ragdoll | null = null;
  private getUpUntil = 0;
  private lastHit = -1;
  private flinch = 0;
  private flinchFrom = 0;
  private ground = 0;
  private idleFor = 0;
  private idleFidget: { clip: string; until: number } | null = null;
  private stagePos: THREE.Vector3 | null = null;
  private stageIdx = -1;
  private stageRoute: { x: number; z: number }[] = [];

  /** Multi-step actions acted out around the room: the simulation runs one timed action at one spot,
   * the view walks the person through its real steps (fridge, worktop, hob...) and ends back at that spot. */
  private staging(state: GameState, p: Person, dt: number): { pos: THREE.Vector3; face: number; clip: string; walking: boolean } | null {
    void state;
    const a = p.action;
    const it = a ? getWorld().interactables[a.target] : null;
    const steps = a && it && a.duration > 0 ? stagePlan(a.type, it, p) : null;
    if (!steps) { this.stagePos = null; this.stageIdx = -1; return null; }
    const f = Math.min(1, a!.progress / a!.duration);
    const idx = Math.max(0, steps.findIndex((s) => f <= s.until));
    const cur = steps[idx] ?? steps[steps.length - 1];
    if (!this.stagePos) this.stagePos = this.rig.root.position.clone();
    if (idx !== this.stageIdx) {
      // walk there around the furniture, not through it
      this.stageIdx = idx;
      this.stageRoute = planRoute({ x: this.stagePos.x, z: this.stagePos.z }, cur.at) ?? [cur.at];
      if (!this.stageRoute.length || Math.hypot(this.stageRoute[this.stageRoute.length - 1].x - cur.at.x, this.stageRoute[this.stageRoute.length - 1].z - cur.at.z) > 0.05) this.stageRoute.push(cur.at);
    }
    while (this.stageRoute.length && Math.hypot(this.stageRoute[0].x - this.stagePos.x, this.stageRoute[0].z - this.stagePos.z) < 0.04) this.stageRoute.shift();
    const next = this.stageRoute[0];
    const walking = !!next;
    let face = cur.face;
    if (next) {
      const goal = new THREE.Vector3(next.x, 0, next.z);
      const d = this.stagePos.distanceTo(goal);
      face = Math.atan2(goal.x - this.stagePos.x, goal.z - this.stagePos.z);
      this.stagePos.add(goal.sub(this.stagePos).multiplyScalar(Math.min(1, (1.25 * dt) / d)));
    }
    return { pos: this.stagePos, face, clip: cur.clip, walking };
  }
  private showerStep = false;
  private bubble: THREE.Sprite | null = null;
  private bubbleText = '';

  /** a speech bubble above the head (null hides it) */
  setSpeech(text: string | null) {
    if (text === this.bubbleText) return;
    this.bubbleText = text ?? '';
    if (this.bubble) { this.bubble.parent?.remove(this.bubble); (this.bubble.material as THREE.SpriteMaterial).map?.dispose(); this.bubble = null; }
    if (!text) return;
    const cv = document.createElement('canvas');
    const c = cv.getContext('2d')!;
    const W = 512, pad = 22, lh = 34;
    c.font = '500 26px IBM Plex Sans, Arial, sans-serif';
    const words = text.split(' '), lines: string[] = [];
    let line = '';
    for (const w of words) { const t = line ? `${line} ${w}` : w; if (c.measureText(t).width > W - pad * 2) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line);
    cv.width = W; cv.height = lines.length * lh + pad * 2 + 22;
    c.font = '500 26px IBM Plex Sans, Arial, sans-serif';
    c.fillStyle = 'rgba(255,255,255,0.96)';
    c.beginPath(); c.roundRect(4, 4, W - 8, cv.height - 30, 18); c.fill();
    c.beginPath(); c.moveTo(W / 2 - 16, cv.height - 27); c.lineTo(W / 2, cv.height - 4); c.lineTo(W / 2 + 16, cv.height - 27); c.fill();
    c.fillStyle = '#1d2226';
    lines.forEach((l, k) => c.fillText(l, pad, pad + 26 + k * lh));
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    const w = 1.5;
    sp.scale.set(w, (w * cv.height) / W, 1);
    sp.position.set(0, 2.05 + sp.scale.y / 2, 0);
    sp.renderOrder = 10;
    this.rig.root.add(sp);
    this.bubble = sp;
  }
  private bedIt: Interactable | null = null;
  private bedT = 0;
  private bedPose = 'sit';
  private basket: THREE.Group | null = null;
  private basketKey = '';
  private bag: THREE.Group | null = null;

  /** Props that follow the hands of the final pose: the mop runs through both hands to the floor,
   * a carried case sits between the hands. */
  private placeProps(action: string | null, facing: number) {
    if (!this.mop && !this.carried && !this.binbag && !this.handItem && !this.plate && !this.tool) return;
    this.rig.root.updateMatrixWorld(true);
    const hl = this.toLocal(this.rig.bones.handL.getWorldPosition(HAND_L)), hr = this.toLocal(this.rig.bones.handR.getWorldPosition(HAND_R));
    if (this.tool) {
      // long tools run from the gripping hand down towards the ground in front; hand tools sit in the fist
      const long = this.toolName === 'tool_spade' || this.toolName === 'tool_shovel';
      this.tool.position.copy(hr);
      if (long) {
        const working = action === 'site_work';
        const tip = new THREE.Vector3(hr.x + Math.sin(facing) * (working ? 0.7 : 0.3), 0.05, hr.z + Math.cos(facing) * (working ? 0.7 : 0.3));
        const dir = tip.sub(hr).normalize();
        this.tool.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      } else this.tool.rotation.set(0, facing, 0);
      this.tool.visible = this.rig.root.visible;
    }
    if (this.plate) {
      // held level between the hands, a little in front of the body
      const mid = hl.clone().add(hr).multiplyScalar(0.5);
      this.plate.position.set(mid.x + Math.sin(facing) * 0.12, Math.max(0.85, mid.y + 0.05), mid.z + Math.cos(facing) * 0.12);
      this.plate.rotation.set(0, facing, 0);
      this.plate.visible = this.rig.root.visible;
    }
    if (this.handItem) {
      // gripped in the palm: just inside the hand, upright
      const root = this.rig.root.position;
      const ox = hr.x - root.x, oz = hr.z - root.z, ol = Math.hypot(ox, oz) || 1;
      this.handItem.position.set(hr.x + Math.sin(facing) * 0.04 - (ox / ol) * 0.02, hr.y - 0.06, hr.z + Math.cos(facing) * 0.04 - (oz / ol) * 0.02);
      this.handItem.rotation.set(0, facing, 0);
      this.handItem.visible = this.rig.root.visible;
    }
    if (this.binbag) {
      // hangs from the knot in the fist, swinging slightly behind the hand as you walk
      const lag = Math.min(0.12, this.speed * 0.05);
      // held out from the body so it clears the leg
      const root = this.rig.root.position;
      const ox = hr.x - root.x, oz = hr.z - root.z, ol = Math.hypot(ox, oz) || 1;
      this.binbag.position.set(hr.x + (ox / ol) * 0.12 - Math.sin(facing) * lag, Math.max(0.02, hr.y - 0.62), hr.z + (oz / ol) * 0.12 - Math.cos(facing) * lag);
      this.binbag.rotation.set(0, facing, 0);
    }
    if (this.mop) {
      const stick = this.mop.getObjectByName('stick')!, head = this.mop.getObjectByName('head')!;
      let top: THREE.Vector3, low: THREE.Vector3;
      if (action === 'clean') {
        // both hands on the shaft: it runs from the higher hand through the lower one to the floor
        top = hl.y > hr.y ? hl.clone() : hr.clone();
        low = hl.y > hr.y ? hr.clone() : hl.clone();
        if (top.distanceTo(low) < 0.15) low.set(top.x + Math.sin(facing) * 0.4, top.y - 0.6, top.z + Math.cos(facing) * 0.4);
      } else {
        // carried in the right hand, head resting on the floor beside the feet
        top = hr.clone();
        low = new THREE.Vector3(hr.x + Math.sin(facing) * 0.25, 0.2, hr.z + Math.cos(facing) * 0.25);
      }
      const dir = low.clone().sub(top).normalize();
      if (dir.y > -0.3) { dir.y = -0.3; dir.normalize(); }
      const lenToFloor = (top.y - 0.04) / -dir.y;
      const startUp = top.clone().addScaledVector(dir, -0.12);
      const bottom = top.clone().addScaledVector(dir, lenToFloor);
      bottom.y = 0.04;
      const len = startUp.distanceTo(bottom);
      stick.position.copy(startUp).add(bottom).multiplyScalar(0.5);
      stick.scale.set(1, len, 1);
      stick.quaternion.setFromUnitVectors(UP, bottom.clone().sub(startUp).normalize());
      head.position.set(bottom.x, 0, bottom.z);
      head.rotation.set(0, facing, 0);
    }
    if (this.carried && this.carriedHeld) {
      // a case is held between the two hands when they are close enough, else hugged to the chest
      if (hl.distanceTo(hr) < 0.75) {
        const mid = hl.clone().add(hr).multiplyScalar(0.5);
        this.carried.parent?.worldToLocal(mid);
        this.carried.position.lerp(mid.add(new THREE.Vector3(0, -0.05, 0)), 0.5);
      } else this.carried.position.set(0, 0, 0);
    }
  }

  private rod: { rod: THREE.Mesh; line: THREE.Line; float: THREE.Mesh } | null = null;
  /** a rod in the hands while fishing, the line out to a float on the water that dips at a bite */
  private syncRod(state: GameState, p: Person) {
    const on = p.action?.type === 'fish';
    if (on && !this.rod) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.02, 2.6, 6), new THREE.MeshStandardMaterial({ color: '#1f2d24', roughness: 0.4 }));
      rod.geometry.translate(0, 1.3, 0);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: '#e8e8e8', transparent: true, opacity: 0.7 }));
      const float = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshStandardMaterial({ color: '#e74c3c', roughness: 0.4 }));
      this.rig.root.parent!.add(rod, line, float);
      this.rod = { rod, line, float };
    } else if (!on && this.rod) { for (const o of [this.rod.rod, this.rod.line, this.rod.float]) o.parent?.remove(o); this.rod = null; }
    if (!this.rod) return;
    const hr = this.toLocal(this.rig.bones.handR.getWorldPosition(new THREE.Vector3()));
    const f = p.facing;
    this.rod.rod.position.copy(hr);
    const dir = new THREE.Vector3(Math.sin(f) * 0.8, 0.6, Math.cos(f) * 0.8).normalize();
    this.rod.rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const tip = hr.clone().addScaledVector(dir, 2.6);
    const fish = state.fishing?.by === p.id ? state.fishing : null;
    const bite = !!fish && state.minute >= fish.biteAt;
    const t = performance.now() / 1000;
    const fx = p.pos.x + Math.sin(f) * 5, fz = p.pos.z + Math.cos(f) * 5;
    this.rod.float.position.set(fx, -1.0 + (bite ? -0.09 + Math.sin(t * 22) * 0.03 : Math.sin(t * 1.6) * 0.015), fz);
    (this.rod.line.geometry as THREE.BufferGeometry).setFromPoints([tip, new THREE.Vector3((tip.x + fx) / 2, (tip.y - 1.0) / 2 - 0.3, (tip.z + fz) / 2), this.rod.float.position.clone()]);
  }
  private pint: THREE.Group | null = null;
  /** a pint glass in the hand while drinking */
  private syncPint(on: boolean) {
    if (on && !this.pint) {
      const g = new THREE.Group();
      const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.035, 0.15, 14, 1, true), new THREE.MeshStandardMaterial({ color: '#e8eef0', transparent: true, opacity: 0.35, roughness: 0.05, side: THREE.DoubleSide }));
      const beer = new THREE.Mesh(new THREE.CylinderGeometry(0.039, 0.033, 0.12, 14), new THREE.MeshStandardMaterial({ color: '#b5651d', roughness: 0.3, transparent: true, opacity: 0.85 }));
      beer.position.y = -0.012;
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 14), new THREE.MeshStandardMaterial({ color: '#f4ecd8', roughness: 0.9 }));
      head.position.y = 0.058;
      g.add(glass, beer, head);
      g.position.set(0, -0.08, 0.04);
      this.rig.bones.handR.add(g);
      this.pint = g;
    } else if (!on && this.pint) { this.pint.parent?.remove(this.pint); this.pint = null; }
  }
  private cash: THREE.Group | null = null;
  /** a wad of banknotes in the right hand */
  private syncCash(p: Person, on: boolean) {
    void p;
    if (on && !this.cash) {
      const g = new THREE.Group();
      for (let i = 0; i < 4; i++) { const n = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.004, 0.14), new THREE.MeshStandardMaterial({ color: i % 2 ? '#7a5bb5' : '#4a8a5a', roughness: 0.8 })); n.position.y = i * 0.005; n.rotation.y = i * 0.15; g.add(n); }
      g.position.set(0, -0.09, 0.02);
      this.rig.bones.handR.add(g);
      this.cash = g;
    } else if (!on && this.cash) { this.cash.parent?.remove(this.cash); this.cash = null; }
  }
  private phone: THREE.Mesh | null = null;
  /** a phone in the hand while the phone clip plays */
  private syncPhone() {
    const on = this.anim.state === 'phone';
    if (on && !this.phone) {
      this.phone = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.15, 0.009), new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.25, metalness: 0.4 }));
      this.phone.position.set(0, -0.08, 0.02);
      this.rig.bones.handR.add(this.phone);
    } else if (!on && this.phone) { this.phone.parent?.remove(this.phone); this.phone = null; }
  }
  private weapon: THREE.Group | null = null;
  private weaponKind: string | null = null;
  private syncWeapon(p: Person) {
    const k = p.dead || p.away ? null : p.weapon ?? null;
    if (k === this.weaponKind) return;
    if (this.weapon) { this.weapon.parent?.remove(this.weapon); this.weapon = null; }
    if (k) { this.weapon = weaponMesh(k); this.rig.bones.handR.add(this.weapon); }
    this.weaponKind = k;
  }

  private syncHeld(state: GameState, p: Person) {
    const basket = state.containers[p.basketId];
    const items = basket ? Object.entries(basket.items).filter(([, n]) => n > 0) : [];
    const key = items.map(([k, n]) => `${k}${n}`).join();
    if (key !== this.basketKey) {
      if (this.basket) { this.basket.parent?.remove(this.basket); this.basket = null; }
      if (items.length) {
        const b = new THREE.Group();
        b.add(new THREE.Mesh(BASKET_GEO, BASKET_MAT));
        const handle = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.008, 6, 16, Math.PI), BASKET_MAT);
        handle.position.y = 0.11;
        b.add(handle);
        let k = 0;
        for (const [prod, n] of items) for (let i = 0; i < Math.min(n, 6) && k < 8; i++, k++) {
          const m = new THREE.Mesh(productUnitGeometry(prod), productMaterial);
          m.position.set(-0.1 + (k % 4) * 0.065, -0.07, (Math.floor(k / 4) - 0.5) * 0.09);
          m.scale.setScalar(0.8);
          b.add(m);
        }
        b.position.set(0, -0.2, 0);
        this.rig.bones.handL.add(b);
        this.basket = b;
      }
      this.basketKey = key;
    }
    const bagC = state.containers[p.bagId];
    // gear you keep with you (rod, bait, weapons) is not shopping: no carrier bag for that
    const shopping = bagC ? Object.entries(bagC.items).some(([k, n]) => n > 0 && !GEAR.has(k)) : false;
    const hasBag = shopping && p.where !== (p.homeId ?? '-');
    if (hasBag && !this.bag) {
      const g = new THREE.Group();
      const sack = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.32, 10), BAG_MAT);
      sack.scale.z = 0.55;
      sack.position.y = -0.24;
      g.add(sack);
      const loop = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 6, 12), BAG_MAT);
      loop.position.y = -0.05;
      g.add(loop);
      g.traverse((o) => { o.castShadow = true; });
      this.rig.bones.handR.add(g);
      this.bag = g;
    } else if (!hasBag && this.bag) {
      this.bag.parent?.remove(this.bag);
      this.bag = null;
    }
  }

  dispose(_scene: THREE.Scene) { this.rig.root.parent?.remove(this.rig.root); this.tool?.parent?.remove(this.tool); this.mop?.parent?.remove(this.mop); this.binbag?.parent?.remove(this.binbag); this.handItem?.parent?.remove(this.handItem); this.plate?.parent?.remove(this.plate); }
}

interface StageStep { until: number; at: { x: number; z: number }; face: number; clip: string }
/** spots where clutter lies about in the player's home (set by Views.updateHome) */
let clutterStops: { x: number; z: number }[] = [];

/** the steps an action is acted out in, as fractions of its duration; null = done on the spot */
function stagePlan(type: string, it: Interactable, p: Person): StageStep[] | null {
  void p;
  const face = it.facing;
  if (type === 'cook') {
    // fridge at the left end of the kitchen run, a clear stretch of worktop, then the hob, then plate up
    const k = getWorld().obstacles.find((o) => o.kind === 'kitchen' && Math.abs((o.rect.z0 + o.rect.z1) / 2 - it.obj.z) < 1 && o.rect.x1 >= it.obj.x - 1.5);
    const fridge = k ? { x: k.rect.x0 + 0.35, z: it.pos.z } : { x: it.pos.x - 2.5, z: it.pos.z };
    const board = { x: it.pos.x - 1.1, z: it.pos.z };
    return [
      { until: 0.12, at: fridge, face, clip: 'take_case' },   // ingredients out of the fridge
      { until: 0.32, at: board, face, clip: 'cook' },         // chop on the worktop (hands-at-the-counter motion)
      { until: 0.88, at: it.pos, face, clip: 'cook' },        // pan on the hob, stir
      { until: 1, at: board, face, clip: 'stock_shelf' },     // dish up
    ];
  }
  if (type === 'tidy' && clutterStops.length) {
    // walk round the flat picking things up, then back to where you started
    const stops = clutterStops.slice(0, 5);
    const steps: StageStep[] = stops.map((s, i) => ({ until: (i + 1) / (stops.length + 1), at: s, face: Math.atan2(s.x - it.pos.x, s.z - it.pos.z), clip: 'take_case' }));
    steps.push({ until: 1, at: it.pos, face, clip: 'take_case' });
    return steps;
  }
  if (type === 'laundry') return [{ until: 1, at: it.pos, face, clip: 'take_case' }];
  if (type === 'eat' && it.kind === 'kitchen') {
    // take it out, sit down at the table to eat, clear the plate back to the kitchen
    const chair = getWorld().interactables.chair;
    if (!chair || Math.hypot(chair.pos.x - it.pos.x, chair.pos.z - it.pos.z) > 9) return null;
    return [
      { until: 0.1, at: it.pos, face, clip: 'take_case' },
      { until: 0.9, at: chair.pos, face: chair.facing, clip: 'sit' },
      { until: 1, at: it.pos, face, clip: 'stock_shelf' },
    ];
  }
  return null;
}

/** a food-hygiene rating sticker: the six scores 0..5 with the awarded one picked out */
const stickerTex = new Map<string, THREE.CanvasTexture>();
function hygieneSticker(rating: number | null): THREE.CanvasTexture {
  const key = String(rating);
  const hit = stickerTex.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 176;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#111'; c.fillRect(0, 0, 256, 176);
  c.fillStyle = '#fff'; c.fillRect(6, 6, 244, 164);
  c.fillStyle = '#111'; c.font = 'bold 22px sans-serif'; c.textAlign = 'center';
  c.fillText('FOOD HYGIENE RATING', 128, 36);
  for (let i = 0; i <= 5; i++) {
    const x = 28 + i * 40, on = rating === i;
    c.beginPath(); c.arc(x, 96, on ? 22 : 15, 0, Math.PI * 2);
    c.fillStyle = on ? '#3aa335' : '#ddd'; c.fill();
    c.fillStyle = on ? '#fff' : '#666'; c.font = `bold ${on ? 28 : 18}px sans-serif`;
    c.fillText(String(i), x, 96 + (on ? 10 : 6));
  }
  c.fillStyle = '#111'; c.font = 'bold 18px sans-serif';
  c.fillText(rating === null ? 'AWAITING INSPECTION' : ['URGENT IMPROVEMENT', 'MAJOR IMPROVEMENT', 'IMPROVEMENT NEEDED', 'SATISFACTORY', 'GOOD', 'VERY GOOD'][rating], 128, 152);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  stickerTex.set(key, t);
  return t;
}

export class Views {
  people = new Map<string, PersonView>();
  stickers = new Map<string, { mesh: THREE.Mesh; rating: number | null }>();
  /** the camera is right against the player: do not draw them */
  hidePlayer = false;
  /** privately owned cars */
  cars = new Map<string, THREE.Object3D>();
  /** smoke, fire and explosions */
  fx!: Fx;
  /** something blew up here (for the sound) */
  onBoom: (x: number, z: number) => void = () => {};
  /** the warehouse forklift (with a pallet on the forks when carrying) and pallets waiting at goods-in */
  private fork: { truck: THREE.Object3D; load: THREE.Object3D } | null = null;
  private goodsIn: THREE.Object3D[] = [];
  shelfMeshes = new Map<string, { mesh: THREE.InstancedMesh; bid: string; product: string; base: THREE.Vector3[]; side: number[]; mess: number }>();
  /** the player's home: dirty dishes, clutter and the washing machine */
  private home = new THREE.Group();
  private homeKey = '';
  private homeWorld: unknown = null;
  private drum: THREE.Mesh | null = null;
  /** empty cases waiting by each shop's baler */
  cartons = new Map<string, { group: THREE.Group; n: number }>();
  palletMeshes = new Map<string, { mesh: THREE.InstancedMesh; bid: string; shelf: string }>();
  bayMeshes = new Map<string, THREE.InstancedMesh>();
  rackMeshes = new Map<string, THREE.InstancedMesh>();
  stageMesh: THREE.InstancedMesh | null = null;
  van: THREE.Group;
  spills = new Map<string, THREE.Mesh>();
  queueMarker: THREE.Mesh;
  destMarker: THREE.Mesh | null = null;

  constructor(private scene: THREE.Scene) {
    this.fx = new Fx(scene);
    // shelf products: one instanced mesh per shelf section (count = real shelf stock)
    const sections = [
      ...SHELF_LAYOUT.map((x) => ({ id: `shelf_${x.product}`, bid: 'market', gx: x.gx, zc: x.zc, len: 4.5 })),
      ...U4_SECTIONS.map((x) => ({ id: x.id, bid: 'unit4', gx: x.gx, zc: x.zc, len: 5 })),
    ];
    for (const sct of sections) {
      const m = new THREE.InstancedMesh(productGeometry('bread'), productMaterial, SHELF_CAPACITY);
      const dummy = new THREE.Object3D();
      const base: THREE.Vector3[] = [], sides: number[] = [];
      for (let i = 0; i < SHELF_CAPACITY; i++) {
        // 16 facings per shelf level: 8 along the run on each face of the gondola, filling from the bottom
        const level = Math.floor(i / 16);
        const col = i % 16;
        const side = col % 2 === 0 ? -1 : 1;
        dummy.position.set(sct.gx + side * 0.42, 0.19 + level * 0.45, sct.zc - sct.len / 2 + (Math.floor(col / 2) + 0.5) * (sct.len / 8));
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
        base.push(dummy.position.clone());
        sides.push(side);
      }
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = true;
      scene.add(m);
      this.shelfMeshes.set(sct.id, { mesh: m, bid: sct.bid, product: '', base, side: sides, mess: 0 });
    }
    for (const [bid, S] of Object.entries(SHOPS)) {
      if (!S.baler) continue;
      const g = new THREE.Group();
      g.userData.it = S.baler;
      scene.add(g);
      this.cartons.set(bid, { group: g, n: 0 });
    }
    // store-room case stacks per pallet (count = cases of that product in the store room)
    const pallets = [
      ...Object.values(SHOPS.market.pallets).map((pid, i) => ({ id: pid, bid: 'market', shelf: Object.keys(SHOPS.market.pallets)[i], x: PALLET_X[i], z: -35.1 })),
      ...U4_SECTIONS.map((x, i) => ({ id: `u4_p${i + 1}`, bid: 'unit4', shelf: x.id, x: 93.3, z: U4_PALLET_Z[i] })),
    ];
    for (const pl of pallets) {
      const m = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.32, 0.5), new THREE.MeshStandardMaterial({ color: '#b8925d', roughness: 0.9 }), 16);
      const dummy = new THREE.Object3D();
      for (let k = 0; k < 16; k++) {
        dummy.position.set(pl.x + ((k % 4) % 2 ? 0.2 : -0.2), 0.3 + Math.floor(k / 4) * 0.33, pl.z + (Math.floor((k % 4) / 2) ? 0.27 : -0.27));
        dummy.updateMatrix();
        m.setMatrixAt(k, dummy.matrix);
      }
      m.castShadow = true;
      m.count = 0;
      m.frustumCulled = false;
      scene.add(m);
      this.palletMeshes.set(pl.id, { mesh: m, bid: pl.bid, shelf: pl.shelf });
    }
    for (const [bid, S] of Object.entries(SHOPS)) {
      const bm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.32, 0.5), new THREE.MeshStandardMaterial({ color: '#c4a06b', roughness: 0.9 }), 40);
      const dummy = new THREE.Object3D();
      for (let k = 0; k < 40; k++) {
        dummy.position.set(S.dropZone.x - 1.4 + (k % 6) * 0.55, 0.2 + Math.floor(k / 12) * 0.33, S.dropZone.z + (Math.floor(k / 6) % 2) * 0.55 - 0.3);
        dummy.updateMatrix();
        bm.setMatrixAt(k, dummy.matrix);
      }
      bm.count = 0;
      bm.frustumCulled = false;
      bm.castShadow = true;
      scene.add(bm);
      this.bayMeshes.set(bid, bm);
    }
    levelGroup(scene, 2).add(this.home);
    // warehouse: cases on each pick-face pallet (live stock) and picked cases in the staging lanes
    const caseGeo = new THREE.BoxGeometry(0.4, 0.26, 0.3);
    const caseMat = new THREE.MeshStandardMaterial({ color: '#b8925d', roughness: 0.9 });
    for (const p of WH_PRODUCTS) {
      const it = getWorld().interactables[`wh_rack_${p}`];
      if (!it) continue;
      const m = new THREE.InstancedMesh(caseGeo, caseMat, 48);
      const dummy = new THREE.Object3D();
      for (let k = 0; k < 48; k++) {
        const side = k % 2 ? 0.68 : -0.68, slot = Math.floor(k / 2), layer = Math.floor(slot / 6), cell = slot % 6;
        dummy.position.set(it.obj.x + side + ((cell % 3) - 1) * 0.4, 0.28 + layer * 0.27, it.obj.z - 0.3 + Math.floor(cell / 3) * 0.32);
        dummy.updateMatrix();
        m.setMatrixAt(k, dummy.matrix);
      }
      m.count = 0; m.frustumCulled = false; m.castShadow = true;
      scene.add(m);
      this.rackMeshes.set(p, m);
    }
    {
      const m = new THREE.InstancedMesh(caseGeo, new THREE.MeshStandardMaterial({ color: '#c4a06b', roughness: 0.9 }), 120);
      const dummy = new THREE.Object3D();
      for (let k = 0; k < 120; k++) {
        // one pallet per lane, cases stacked five high
        const lane = Math.floor(k / 30), slot = k % 30, layer = Math.floor(slot / 6), cell = slot % 6;
        dummy.position.set(-58 + lane * 2.6 + (cell % 3) * 0.4, 0.28 + layer * 0.27, 16.2 + Math.floor(cell / 3) * 0.32);
        dummy.updateMatrix();
        m.setMatrixAt(k, dummy.matrix);
      }
      m.count = 0; m.frustumCulled = false; m.castShadow = true;
      scene.add(m);
      this.stageMesh = m;
    }
    this.van = buildCar('#f2f2f2', 0, 0, 0, true);
    scene.add(this.van);
    this.queueMarker = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.45, 24), new THREE.MeshBasicMaterial({ color: '#2e8b57', transparent: true, opacity: 0.5 }));
    this.queueMarker.rotation.x = -Math.PI / 2;
    this.queueMarker.position.set(22, 0.1, -11.7);
    scene.add(this.queueMarker);
    // stock drawn with instancing sits indoors: no sun shadows, and only drawn when you are near it or
    // in the same building (there are thousands of small items in the shops and warehouse)
    for (const o of scene.children) {
      const m = o as THREE.InstancedMesh;
      if (!m.isInstancedMesh) continue;
      const c = new THREE.Vector3(), t = new THREE.Matrix4(), p = new THREE.Vector3();
      const n = m.instanceMatrix.count;
      for (let i = 0; i < n; i++) { m.getMatrixAt(i, t); c.add(p.setFromMatrixPosition(t)); }
      c.divideScalar(Math.max(1, n));
      m.castShadow = false;
      this.stock.push({ mesh: m, x: c.x, z: c.z, bid: buildingAt({ x: c.x, z: c.z })?.id ?? null });
    }
  }
  /** instanced stock meshes, shown by distance */
  private stock: { mesh: THREE.InstancedMesh; x: number; z: number; bid: string | null }[] = [];
  private stockTick = 0;

  private updateForklift(state: GameState) {
    const v = state.vehicles[FORKLIFT_ID];
    if (v && !this.fork) {
      const truck = new THREE.Group();
      const body = modelInstance('forklift', '#f2c200');
      if (body) truck.add(body);
      const load = modelInstance('pallet_load') ?? new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.0), new THREE.MeshStandardMaterial({ color: '#b8925d' }));
      load.position.set(0, 0.35, 1.55);
      load.rotation.y = Math.PI / 2;
      truck.add(load);
      this.scene.add(truck);
      this.fork = { truck, load };
      for (let k = 0; k < 8; k++) {
        const p = modelInstance('pallet_load') ?? new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.0), new THREE.MeshStandardMaterial({ color: '#b8925d' }));
        p.position.set(-43.3 + (k % 2) * 1.5, 0, 35.0 + Math.floor(k / 2) * 1.2);
        p.rotation.y = Math.PI / 2;
        this.scene.add(p);
        this.goodsIn.push(p);
      }
    }
    if (!v || !this.fork) return;
    this.fork.truck.position.set(v.pos.x, 0, v.pos.z);
    this.fork.truck.rotation.y = v.heading;
    this.fork.load.visible = total(state.containers[v.cargoId]) > 0;
    const waiting = palletsWaiting(state);
    this.goodsIn.forEach((p, k) => { p.visible = k < waiting; });
  }

  /** hygiene rating stickers in the shop and cafe windows, by the entrance */
  private updateStickers(state: GameState) {
    for (const b of Object.values(state.businesses)) {
      if (b.kind !== 'retail' && b.kind !== 'cafe') continue;
      const rating = state.hygiene?.[b.id]?.rating ?? null;
      let st = this.stickers.get(b.id);
      if (!st) {
        const bd = getWorld().buildings.find((x) => x.id === b.locationId);
        const door = bd?.doors.find((d) => d.open && d.side === (bd.sign?.side ?? d.side)) ?? bd?.doors.find((d) => d.open);
        if (!bd || !door) continue;
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.206), new THREE.MeshStandardMaterial({ map: hygieneSticker(rating), roughness: 0.4 }));
        const { x0, z0, x1, z1 } = bd.rect;
        const along = door.b + 0.35;
        if (door.side === 'zmax') mesh.position.set(along, 1.45, z1 + 0.16);
        else if (door.side === 'zmin') { mesh.position.set(door.a - 0.35, 1.45, z0 - 0.16); mesh.rotation.y = Math.PI; }
        else if (door.side === 'xmax') { mesh.position.set(x1 + 0.16, 1.45, door.a - 0.35); mesh.rotation.y = Math.PI / 2; }
        else { mesh.position.set(x0 - 0.16, 1.45, along); mesh.rotation.y = -Math.PI / 2; }
        this.scene.add(mesh);
        st = { mesh, rating };
        this.stickers.set(b.id, st);
      }
      if (st.rating !== rating) {
        (st.mesh.material as THREE.MeshStandardMaterial).map = hygieneSticker(rating);
        (st.mesh.material as THREE.MeshStandardMaterial).needsUpdate = true;
        st.rating = rating;
      }
    }
  }

  /** children out with a parent: drawn walking alongside them (they are part of the family record, not simulated on their own) */
  private kids = new Map<string, { p: Person; view: PersonView | null; parent: string; seen: boolean }>();
  private updateKids(state: GameState, dt: number, viewer?: { x: number; z: number }) {
    for (const k of this.kids.values()) k.seen = false;
    for (const parent of Object.values(state.people)) {
      const n = parent.npc;
      if (!n || parent.isPlayer || !parent.visible || !parent.children?.length || parent.dead || parent.away || parent.down != null || parent.where === 'vehicle') continue;
      if (!(n.goal === 'leisure' || n.goal === 'shop' || (n as any).gathering)) continue;
      // when both parents are out together, the children stay with one of them
      const partner = parent.partnerId ? state.people[parent.partnerId] : null;
      if (partner?.visible && partner.id < parent.id && Math.hypot(partner.pos.x - parent.pos.x, partner.pos.z - parent.pos.z) < 6) continue;
      if (viewer && Math.hypot(parent.pos.x - viewer.x, parent.pos.z - viewer.z) > 45) continue;
      parent.children.forEach((c, i) => {
        const age = Math.floor((state.minute - c.born) / (28 * 1440));
        if (age < 3 || age > 15) return;
        const id = `${parent.id}_kid${i}`;
        let k = this.kids.get(id);
        if (!k) {
          let h = 0;
          for (let j = 0; j < c.name.length; j++) h = (h * 31 + c.name.charCodeAt(j)) >>> 0;
          h = (h + i * 7919 + parent.id.length * 104729) >>> 0;
          const girl = ['Ava', 'Isla', 'Mia', 'Freya', 'Ruby', 'Esme', 'Zara'].includes(c.name);
          const kid: Person = {
            ...parent, id, name: c.name, isPlayer: false, npc: null, action: null, move: null, equipment: null, weapon: null, gesture: null, combat: null, following: null,
            basketId: '-', handsId: '-', bagId: '-', sleeping: false, injured: null, drunk: 0, health: 100,
            appearance: { ...parent.appearance, frame: girl ? 'f' : 'm', hair: girl ? (h % 2 ? 'long' : 'bun') : (h % 3 ? 'short' : 'curly'), build: 'slim', height: 0.6 + Math.min(age, 15) * 0.024, outfit: 'outfit_casual', style: h % 1000 },
            pos: { x: parent.pos.x - 0.8, z: parent.pos.z - 0.4 }, facing: parent.facing,
          } as Person;
          k = { p: kid, view: null, parent: parent.id, seen: true };
          this.kids.set(id, k);
        }
        k.seen = true;
        const kid = k.p;
        kid.appearance.height = 0.6 + Math.min(age, 15) * 0.024;
        // walk just behind and to the side of the parent, catching up when left behind
        const side = i % 2 ? -0.75 : 0.75, back = 0.35 + i * 0.3;
        const tx = parent.pos.x + Math.cos(parent.facing) * side - Math.sin(parent.facing) * back;
        const tz = parent.pos.z - Math.sin(parent.facing) * side - Math.cos(parent.facing) * back;
        const dx = tx - kid.pos.x, dz = tz - kid.pos.z, d = Math.hypot(dx, dz);
        if (d > 8) kid.pos = { x: tx, z: tz };
        else if (d > 0.05) {
          const step = Math.min(d, (d > 1.5 ? 4.5 : 2.2) * dt);
          kid.pos = { x: kid.pos.x + (dx / d) * step, z: kid.pos.z + (dz / d) * step };
          if (d > 0.3) kid.facing = Math.atan2(dx, dz);
        } else kid.facing = parent.facing;
        kid.visible = true;
        kid.where = parent.where;
        kid.gesture = parent.gesture && (parent.gesture.clip === 'laugh' || parent.gesture.clip === 'happy' || parent.gesture.clip === 'sad') ? parent.gesture : null;
        if (!k.view) {
          if (!requestHuman(kid.appearance, true)) return;
          k.view = new PersonView(kid, this.scene);
        }
        k.view.update(state, kid, dt);
      });
    }
    for (const [id, k] of this.kids) if (!k.seen) { if (k.view) k.view.dispose(this.scene); this.kids.delete(id); }
  }

  /** dogs out with their owners, on a lead (yours walks free at heel) */
  dogs = new Map<string, { view: DogView; lead: THREE.Line | null; seen: boolean }>();
  private updateDogs(state: GameState, dt: number, viewer?: { x: number; z: number }) {
    for (const d of this.dogs.values()) d.seen = false;
    const borrowed = (state.people[state.playerId] as any)?.borrowedDog;
    for (const o of Object.values(state.people)) {
      // a dog you are walking for its owner goes with you, not with them
      const dog = o.isPlayer ? o.dog ?? borrowed?.dog : borrowed?.owner === o.id ? null : o.dog;
      if (!dog || !o.visible || o.dead || o.away || o.where === 'vehicle' || o.down != null) continue;
      if (!o.isPlayer && (o.npc?.goal === 'work' || o.npc?.goal === 'go_work' || o.where !== 'outside' && o.where !== 'park')) continue;
      if (viewer && Math.hypot(o.pos.x - viewer.x, o.pos.z - viewer.z) > 45) continue;
      let d = this.dogs.get(o.id);
      if (!d) {
        const view = new DogView(dog.color, dog.size);
        view.pos.set(o.pos.x - 0.6, o.pos.z - 0.5);
        let lead: THREE.Line | null = null;
        if (!o.isPlayer) lead = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: '#7a2318' }));
        toLevel(this.scene, levelOf(o.pos.x), view.root, lead);
        d = { view, lead, seen: true };
        this.dogs.set(o.id, d);
      }
      d.seen = true;
      if (d.view.root.parent !== levelGroup(this.scene, levelOf(o.pos.x))) { toLevel(this.scene, levelOf(o.pos.x), d.view.root, d.lead); d.view.pos.set(o.pos.x, o.pos.z); }
      // at heel: just ahead and to the left of the owner
      const side = -0.55, ahead = 0.35;
      const tx = o.pos.x + Math.cos(o.facing) * side + Math.sin(o.facing) * ahead, tz = o.pos.z - Math.sin(o.facing) * side + Math.cos(o.facing) * ahead;
      d.view.update(dt, tx, tz, o.facing);
      const pv = this.people.get(o.id);
      if (d.lead && pv) {
        const hand = pv.rig.bones.handL.getWorldPosition(new THREE.Vector3());
        d.lead.parent?.worldToLocal(hand);
        const collar = new THREE.Vector3(d.view.pos.x + Math.sin(d.view.facing) * 0.2 * (o.dog?.size ?? 1), 0.45 * (o.dog?.size ?? 1), d.view.pos.y + Math.cos(d.view.facing) * 0.2 * (o.dog?.size ?? 1));
        const mid = hand.clone().add(collar).multiplyScalar(0.5); mid.y -= 0.15;
        (d.lead.geometry as THREE.BufferGeometry).setFromPoints([hand, mid, collar]);
        d.lead.visible = pv.rig.root.visible;
      }
      d.view.root.visible = !pv || pv.rig.root.visible || o.isPlayer;
    }
    // the rescue's dogs pace their kennels, coming up to the gate when you're near
    if (!viewer || Math.hypot(viewer.x - 84, viewer.z - 53) < 40) {
      const me = state.people[state.playerId];
      (state.rescue?.dogs ?? []).forEach((rd, i) => {
        const key = `kennel:${i}:${rd.name}`;
        let d = this.dogs.get(key);
        if (!d) {
          const view = new DogView(rd.color, rd.size);
          view.pos.set(88.5, [47.9, 51.85, 55.35, 58.6][i]);
          this.scene.add(view.root);
          d = { view, lead: null, seen: true };
          this.dogs.set(key, d);
        }
        d.seen = true;
        const zc = [47.9, 51.85, 55.35, 58.6][i];
        const near = me && me.where === 'rescue' && Math.abs(me.pos.z - zc) < 1.6 && me.pos.x > 83;
        const t = performance.now() / 1000 + i * 7.3;
        const tx = near ? 86.95 : 88.4 + Math.sin(t * 0.23) * 0.9, tz = near ? zc + Math.sin(t * 1.7) * 0.2 : zc + Math.sin(t * 0.31 + 1) * 0.9;
        d.view.update(dt, tx, tz, near ? -Math.PI / 2 : d.view.facing);
      });
    }
    for (const [id, d] of this.dogs) if (!d.seen) { d.view.root.parent?.remove(d.view.root); d.lead?.parent?.remove(d.lead); this.dogs.delete(id); }
  }

  private blood = new Map<string, THREE.Mesh>();
  /** pools and drips of blood: they darken and fade over a day */
  private syncBlood(state: GameState) {
    const list = state.blood ?? [];
    const seen = new Set<string>();
    const shapes = bloodShapes();
    for (const b of list) {
      seen.add(b.id);
      let m = this.blood.get(b.id);
      if (!m) {
        let h = 0;
        for (let i = 0; i < b.id.length; i++) h = (h * 31 + b.id.charCodeAt(i)) >>> 0;
        m = new THREE.Mesh(shapes[h % shapes.length], BLOOD_MAT.clone());
        m.rotation.y = (h % 628) / 100;
        m.position.set(b.pos.x, surfaceY(b.pos.x, b.pos.z) + 0.006 + (h % 7) * 0.0006, b.pos.z);
        m.renderOrder = 2;
        this.scene.add(m);
        this.blood.set(b.id, m);
      }
      const age = state.minute - b.at;
      // a pool spreads for the first few minutes, then dries darker and fades
      const s = b.size * Math.min(1, 0.6 + age / 2.5);
      m.scale.set(s, 1, s);
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.opacity = Math.max(0, 0.92 - age / 1500);
      mat.roughness = age > 60 ? 0.7 : 0.18;
    }
    for (const [id, m] of this.blood) if (!seen.has(id)) { this.scene.remove(m); (m.material as THREE.Material).dispose(); this.blood.delete(id); }
  }

  update(state: GameState, dt: number, viewer?: { x: number; z: number }, viewerInside?: string | null, speech?: Map<string, { text: string; until: number }>) {
    buildBudget = 1;
    this.syncBlood(state);
    // without a worker, bodies are built here, one per frame at most
    if (!workerActive() && buildOneOnMainThread()) buildBudget = 0;
    if (viewer && this.stockTick++ % 10 === 0) for (const s of this.stock) s.mesh.visible = (!!viewerInside && viewerInside === s.bid) || Math.hypot(s.x - viewer.x, s.z - viewer.z) < 32;
    // personal space: people closer than ~0.6 m are drawn shuffled apart (the player never moves)
    const vis = Object.values(state.people).filter((p) => p.visible && (!viewer || Math.hypot(p.pos.x - viewer.x, p.pos.z - viewer.z) < 40));
    const want = new Map<string, { x: number; z: number }>();
    for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
      const a = vis[i], b = vis[j];
      const fixed = (q: typeof a) => q.sleeping || q.action?.type === 'sit' || q.action?.type === 'watch_tv' || q.action?.type === 'shower';
      if (fixed(a) || fixed(b)) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz);
      if (d > 0.6) continue;
      // push apart along the line between them, or sideways to a's facing when exactly on top of each other
      const ux = d > 0.02 ? dx / d : Math.cos(a.facing), uz = d > 0.02 ? dz / d : -Math.sin(a.facing);
      const push = 0.6 - d;
      const wa = a.isPlayer ? 0 : b.isPlayer ? 1 : 0.5, wb = 1 - wa;
      const na = want.get(a.id) ?? { x: 0, z: 0 }, nb = want.get(b.id) ?? { x: 0, z: 0 };
      na.x -= ux * push * wa; na.z -= uz * push * wa; nb.x += ux * push * wb; nb.z += uz * push * wb;
      want.set(a.id, na); want.set(b.id, nb);
    }
    for (const p of Object.values(state.people)) {
      const v0 = this.people.get(p.id);
      if (v0) { const w0 = want.get(p.id) ?? { x: 0, z: 0 }; const k = Math.min(1, dt * 4); v0.nudge.x += (w0.x - v0.nudge.x) * k; v0.nudge.z += (w0.z - v0.nudge.z) * k; }
    }
    for (const p of Object.values(state.people)) {
      let v = this.people.get(p.id);
      if (!v) {
        // a new person is drawn once their body has been built (in the background); nearer people first
        const close = !viewer || p.id === state.playerId || Math.hypot(p.pos.x - viewer.x, p.pos.z - viewer.z) < 40;
        if (!p.visible || !requestHuman(p.appearance, close)) continue;
        v = new PersonView(p, this.scene);
        this.people.set(p.id, v);
      }
      // people far away, or inside another building while we are elsewhere, are not drawn at all
      let near = true;
      if (viewer && p.id !== 'player') {
        const d = Math.hypot(p.pos.x - viewer.x, p.pos.z - viewer.z);
        const inside = buildingAt(p.pos)?.id ?? null;
        near = d < 75 && !(inside && inside !== viewerInside && d > 22);
        const shadow = d < 30;
        if (shadow !== v.shadow) { v.shadow = shadow; v.rig.root.traverse((o) => { o.castShadow = shadow; }); }
      }
      v.culled = !near;
      v.update(state, p, dt);
      if (p.isPlayer && this.hidePlayer) v.rig.root.visible = false;
      const sp = speech?.get(p.id);
      v.setSpeech(sp && sp.until > performance.now() ? sp.text : null);
    }
    this.updateKids(state, dt, viewer);
    this.updateDogs(state, dt, viewer);
    for (const [id, v] of this.shelfMeshes) {
      const b = state.businesses[v.bid];
      const k = b?.sections[id];
      if (!k) { v.mesh.count = 0; continue; }
      if (k !== v.product) { v.mesh.geometry = productGeometry(k); v.product = k; }
      v.mesh.count = Math.min(SHELF_CAPACITY, count(state.containers[id], k));
      // untidy facings: packs pushed back, turned and out of line until someone faces the shelf up
      const mess = Math.round((b.messy?.[id] ?? 0) / 10);
      if (mess !== v.mess) {
        v.mess = mess;
        const dummy = new THREE.Object3D();
        const amt = mess / 10;
        for (let i = 0; i < SHELF_CAPACITY; i++) {
          const h = Math.sin(i * 12.9898 + id.length * 78.233) * 43758.5453;
          const r1 = h - Math.floor(h), r2 = (h * 7.13) - Math.floor(h * 7.13), r3 = (h * 3.71) - Math.floor(h * 3.71);
          const bp = v.base[i];
          dummy.position.set(bp.x - v.side[i] * amt * r1 * 0.22, bp.y, bp.z + (r2 - 0.5) * amt * 0.25);
          dummy.rotation.set(0, (r3 - 0.5) * amt * 1.4, r1 > 0.93 && amt > 0.5 ? Math.PI / 2 : 0);
          dummy.updateMatrix();
          v.mesh.setMatrixAt(i, dummy.matrix);
        }
        v.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    this.updateHome(state, dt);
    this.updateCooking(state, dt);
    // empty cases piled beside the baler
    for (const [bid, c] of this.cartons) {
      const n = Math.min(12, state.businesses[bid]?.cardboard ?? 0);
      if (n === c.n) continue;
      const it = getWorld().interactables[c.group.userData.it];
      while (c.group.children.length > n) c.group.remove(c.group.children[c.group.children.length - 1]);
      while (c.group.children.length < n && it) {
        const k = c.group.children.length;
        const m = modelInstance('carton') ?? new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.26, 0.3), new THREE.MeshStandardMaterial({ color: '#a8804f', roughness: 0.9 }));
        // stacked in a loose column of three, nested at odd angles, to the side of the baler
        const dx = it.obj.x - it.pos.x, dz = it.obj.z - it.pos.z, l = Math.hypot(dx, dz) || 1;
        const sx = -dz / l, sz = dx / l;
        const col = Math.floor(k / 3), lvl = k % 3;
        const off = 1.15 + col * 0.45;
        m.position.set(it.obj.x + sx * off - (dx / l) * 0.1, lvl * 0.2, it.obj.z + sz * off - (dz / l) * 0.1);
        m.rotation.set(lvl ? 0.12 : 0, Math.atan2(dx, dz) + ((k * 37) % 9 - 4) * 0.08, 0);
        c.group.add(m);
      }
      c.n = n;
    }
    for (const v of this.palletMeshes.values()) {
      const b = state.businesses[v.bid];
      const k = b?.sections[v.shelf];
      v.mesh.count = k ? Math.min(16, Math.ceil(count(state.containers[SHOPS[v.bid].backroom], k) / ITEMS[k].caseSize)) : 0;
    }
    for (const [p, m] of this.rackMeshes) m.count = Math.min(48, Math.ceil(count(state.containers.wholesale_stock, p) / (ITEMS[p]?.caseSize ?? 12)));
    if (this.stageMesh) this.stageMesh.count = Math.min(120, Math.ceil(total(state.containers.wholesale_staging) / 12));
    for (const [bid, m] of this.bayMeshes) m.count = state.containers[SHOPS[bid].bayContainer] ? Math.min(40, Math.ceil(total(state.containers[SHOPS[bid].bayContainer]) / 10)) : 0;
    // destination marker while the player drives a delivery
    const mine = Object.values(state.vehicles).find((v) => v.driverId === state.playerId && (v.state === 'manual_out' || v.state === 'manual_back'));
    const dest = mine ? (mine.state === 'manual_back' ? getWorld().depot : mine.route[mine.route.length - 1]) : null;
    if (dest) {
      if (!this.destMarker) {
        this.destMarker = new THREE.Mesh(new THREE.RingGeometry(3.2, 3.8, 40), new THREE.MeshBasicMaterial({ color: '#f2c200', transparent: true, opacity: 0.7, depthWrite: false }));
        this.destMarker.rotation.x = -Math.PI / 2;
        this.scene.add(this.destMarker);
      }
      this.destMarker.visible = true;
      this.destMarker.position.set(dest.x, 0.12, dest.z);
      (this.destMarker.material as THREE.MeshBasicMaterial).opacity = 0.45 + 0.3 * Math.sin(performance.now() / 300);
    } else if (this.destMarker) this.destMarker.visible = false;
    const van = state.vehicles.van_1;
    this.van.position.set(van.pos.x, 0, van.pos.z);
    this.van.rotation.y = van.heading;
    this.updateForklift(state);
    for (const [id, obj] of this.cars) if (!state.vehicles[id]) { this.scene.remove(obj); this.cars.delete(id); }
    for (const v of Object.values(state.vehicles)) {
      if (v.kind === 'boat') {
        let obj = this.cars.get(v.id);
        if (!obj) { obj = harbourBoat('#f0eee8', '#2b6cb0'); obj.scale.setScalar(0.62); this.scene.add(obj); this.cars.set(v.id, obj); }
        const t = performance.now() / 1000;
        obj.position.set(v.pos.x, -1.15 + Math.sin(t * 1.3) * 0.05, v.pos.z);
        obj.rotation.set(Math.sin(t * 0.9) * 0.03, v.heading, Math.sin(t * 1.1) * 0.035);
        continue;
      }
      if (v.kind === 'bike') {
        let obj = this.cars.get(v.id);
        if (!obj) { obj = hireBike(); this.scene.add(obj); this.cars.set(v.id, obj); }
        obj.position.set(v.pos.x, 0, v.pos.z);
        obj.rotation.y = v.heading;
        // parked: leant over on its stand
        obj.rotation.z = v.driverId ? 0 : 0.18;
        continue;
      }
      if (v.kind !== 'car') continue;
      let obj = this.cars.get(v.id);
      if (!obj) { obj = buildCar(v.color ?? '#8a8f94', 0, 0, 0, false, CAR_MODELS.find((m) => m.id === v.model)?.body ?? 'car'); this.scene.add(obj); this.cars.set(v.id, obj); }
      obj.position.set(v.pos.x, v.lift ?? 0, v.pos.z);
      obj.rotation.order = 'YXZ';
      obj.rotation.set(v.pitch ?? 0, v.heading, 0);
      // dents, smoke from a hurt engine, fire, and the moment it goes up
      if (v.dmg || v.wrecked) applyCarDamage(obj, v.dmg ?? [0, 0, 0, 0], !!v.wrecked);
      // lamps on only with someone at the wheel (and never on a burnt-out shell)
      const lampsG = obj.getObjectByName('lamps');
      if (lampsG) lampsG.visible = !!v.driverId && !v.wrecked && (v.dmg?.[0] ?? 0) < 0.35;
      if (v.wrecked && !obj.userData.boomed) { obj.userData.boomed = true; if (state.minute - (v.burning ?? 0) < 3) { this.fx.explode(v.pos.x, v.pos.z); this.onBoom(v.pos.x, v.pos.z); } }
      const bonnet = { x: v.pos.x + Math.sin(v.heading) * 1.6, z: v.pos.z + Math.cos(v.heading) * 1.6 };
      const smoky = v.wrecked ? 'black' : v.burning != null ? 'fire' : v.condition < 22 ? 'black' : v.condition < 50 ? 'smoke' : null;
      if (smoky && Math.random() < dt * (smoky === 'fire' ? 30 : 8)) {
        const at = smoky === 'fire' || v.wrecked ? { x: v.pos.x + (Math.random() - 0.5) * 1.6, z: v.pos.z + (Math.random() - 0.5) * 3 } : bonnet;
        this.fx.emit(smoky, at.x, 1.1, at.z, new THREE.Vector3((Math.random() - 0.5) * 0.4, smoky === 'fire' ? 1.8 : 1.1, (Math.random() - 0.5) * 0.4), smoky === 'fire' ? 0.9 : 0.7, smoky === 'fire' ? 0.6 : 2.4);
        if (smoky === 'fire' && Math.random() < 0.5) this.fx.emit('black', at.x, 1.8, at.z, new THREE.Vector3(0, 1.6, 0), 0.9, 2.5);
      }
    }
    this.fx.update(dt);
    // spills
    this.updateStickers(state);
    for (const [id, m] of this.spills) if (!state.dirt[id]) { this.scene.remove(m); this.spills.delete(id); }
    for (const d of Object.values(state.dirt)) {
      let m = this.spills.get(d.id);
      if (!m) {
        m = new THREE.Mesh(spillGeometry(d.id), spillMat);
        m.rotation.x = -Math.PI / 2;
        m.position.set(d.pos.x, 0.09, d.pos.z);
        this.scene.add(m);
        this.spills.set(d.id, m);
      }
      m.scale.setScalar(0.4 + d.dirt / 100);
    }
  }

  playerView(state: GameState) { return this.people.get(state.playerId); }

  private cook: THREE.Group | null = null;
  /** someone cooking: board and veg on the worktop, then the pan on the hob with steam, then a plate */
  private updateCooking(state: GameState, dt: number) {
    const p = state.people[state.playerId];
    const a = p?.action;
    const it = a?.type === 'cook' ? getWorld().interactables[a.target] : null;
    if (!it || !a) { if (this.cook) { this.scene.remove(this.cook); this.cook = null; } return; }
    if (!this.cook) {
      const g = new THREE.Group();
      const top = 0.935;
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.02, 0.28), new THREE.MeshStandardMaterial({ color: '#c49a63', roughness: 0.7 }));
      board.name = 'board';
      board.position.set(it.obj.x - 1.1, top + 0.01, it.obj.z - 0.1);
      for (let k = 0; k < 5; k++) {
        const v = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshStandardMaterial({ color: ['#d9452b', '#f0c419', '#4c9a2a', '#e8e0c8', '#d9452b'][k], roughness: 0.6 }));
        v.position.set(-0.12 + k * 0.06, 0.03, (k % 2) * 0.05);
        board.add(v);
      }
      const pan = new THREE.Group();
      pan.name = 'pan';
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, 0.07, 20, 1, true), new THREE.MeshStandardMaterial({ color: '#2a2a2c', roughness: 0.35, metalness: 0.6, side: THREE.DoubleSide }));
      const base = new THREE.Mesh(new THREE.CircleGeometry(0.11, 20), new THREE.MeshStandardMaterial({ color: '#c88a3a', roughness: 0.8 }));
      base.rotation.x = -Math.PI / 2; base.position.y = -0.02;
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.03), new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.5 }));
      handle.position.set(-0.22, 0.02, 0);
      pan.add(bowl, base, handle);
      pan.position.set(it.obj.x + 0.12, top + 0.04, it.obj.z - 0.05);
      for (let k = 0; k < 6; k++) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.25, depthWrite: false }));
        puff.name = 'steam';
        puff.userData.phase = k / 6;
        pan.add(puff);
      }
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.018, 20), new THREE.MeshStandardMaterial({ color: '#f4f2ec', roughness: 0.25 }));
      plate.name = 'plate';
      const food = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), new THREE.MeshStandardMaterial({ color: '#d98b3a', roughness: 0.7 }));
      food.scale.y = 0.4; food.position.y = 0.02;
      plate.add(food);
      plate.position.set(it.obj.x - 1.0, top + 0.01, it.obj.z - 0.1);
      g.add(board, pan, plate);
      this.scene.add(g);
      this.cook = g;
    }
    const f = a.duration > 0 ? a.progress / a.duration : 0;
    const board = this.cook.getObjectByName('board')!, pan = this.cook.getObjectByName('pan')!, plate = this.cook.getObjectByName('plate')!;
    board.visible = f > 0.1 && f < 0.9;
    pan.visible = f > 0.3;
    plate.visible = f > 0.9;
    for (const ch of pan.children) if (ch.name === 'steam') {
      const ph = (ch.userData.phase + performance.now() / 2400) % 1;
      ch.position.set(Math.sin(ph * 9 + ch.userData.phase * 20) * 0.04, 0.05 + ph * 0.45, Math.cos(ph * 7) * 0.03);
      ch.scale.setScalar(0.6 + ph * 1.6);
      ((ch as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = f > 0.35 && f < 0.9 ? 0.28 * (1 - ph) : 0;
    }
    void dt;
  }

  /** dirty dishes stacked by the sink, clutter on the furniture, washing tumbling in the machine */
  private updateHome(state: GameState, dt: number) {
    const p = state.people[state.playerId];
    const c = p?.chores;
    const w = getWorld();
    const running = !!c?.washer && state.minute < c.washer.until;
    const key = c ? `${Math.min(c.dishes, 12)}|${Math.floor(c.mess / 12)}|${c.washer ? (running ? 'run' : 'done') : 'off'}` : '';
    if (this.drum) this.drum.rotation.z += dt * (running ? 9 : 0);
    if (key === this.homeKey && this.homeWorld === w) return;
    this.homeKey = key;
    this.homeWorld = w;
    while (this.home.children.length) this.home.remove(this.home.children[0]);
    this.drum = null;
    if (!c) return;
    const plate = new THREE.MeshStandardMaterial({ color: '#f4f2ec', roughness: 0.25 });
    const grime = new THREE.MeshStandardMaterial({ color: '#b98f5a', roughness: 0.8 });
    const mugMat = new THREE.MeshStandardMaterial({ color: '#3d6e8f', roughness: 0.35 });
    const add = (m: THREE.Object3D) => { m.traverse((o) => { o.castShadow = true; }); this.home.add(m); };
    // dishes: a stack of plates beside the sink, then mugs, then a pan left on the hob
    const top = 0.93;
    for (let k = 0; k < Math.min(c.dishes, 12); k++) {
      if (k < 6) {
        const pl = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.018, 20), plate);
        pl.position.set(2 * LEVEL_DX + 16.35 + (k % 2) * 0.01, top + 0.01 + k * 0.02, 25.45);
        add(pl);
        if (k % 2 === 0) { const g = new THREE.Mesh(new THREE.CircleGeometry(0.05, 10), grime); g.rotation.x = -Math.PI / 2; g.position.set(2 * LEVEL_DX + 16.33, top + 0.021 + k * 0.02, 25.44); this.home.add(g); }
      } else if (k < 10) {
        const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.1, 14), mugMat);
        mug.position.set(2 * LEVEL_DX + 16.75 + ((k - 6) % 2) * 0.1, top + 0.05, 25.35 + Math.floor((k - 6) / 2) * 0.12);
        add(mug);
      } else {
        const pan = new THREE.Group();
        const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, 0.08, 20, 1, true), new THREE.MeshStandardMaterial({ color: '#2a2a2c', roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide }));
        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.03), new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.5 }));
        handle.position.set(0.22, 0.02, 0);
        pan.add(bowl, handle);
        pan.position.set(2 * LEVEL_DX + 17.85 + (k - 10) * 0.05, top + 0.04, 25.5 - (k - 10) * 0.1);
        add(pan);
      }
    }
    // clutter: things left lying about on the furniture the designer placed
    const spots: { kind: string; at: THREE.Vector3; rot: number }[] = [];
    const center = (r: { x0: number; z0: number; x1: number; z1: number }) => new THREE.Vector3((r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2);
    const find = (k: string) => w.obstacles.filter((o) => o.kind === k && o.rect.x0 > 2 * LEVEL_DX + 12 && o.rect.x1 < 2 * LEVEL_DX + 30 && o.rect.z0 > 10 && o.rect.z1 < 26);
    for (const o of find('coffee_table')) { const m = center(o.rect); spots.push({ kind: 'mug', at: m.clone().setY(0.47), rot: 0 }, { kind: 'magazine', at: m.clone().add(new THREE.Vector3(0.18, 0.46, 0.05)), rot: 0.4 }); }
    for (const o of find('bed')) { const m = center(o.rect); spots.push({ kind: 'clothes', at: m.clone().setY(0.62), rot: 0.7 }, { kind: 'clothes', at: new THREE.Vector3(o.rect.x0 - 0.25, 0.04, m.z + 0.4), rot: 2.1 }); }
    for (const o of find('sofa')) { const m = center(o.rect); spots.push({ kind: 'clothes', at: m.clone().setY(0.62), rot: 1.2 }); }
    for (const o of find('dining_table')) { const m = center(o.rect); spots.push({ kind: 'mug', at: m.clone().setY(0.77), rot: 0 }, { kind: 'box', at: m.clone().add(new THREE.Vector3(-0.2, 0.8, 0.1)), rot: 0.3 }); }
    for (const o of find('desk')) { const m = center(o.rect); spots.push({ kind: 'magazine', at: m.clone().setY(0.77), rot: -0.3 }); }
    const n = Math.min(spots.length, Math.floor(c.mess / 12));
    // where to stand to pick each thing up: the nearest free spot on the flat's walking grid
    const grid = Object.values(w.nodes).filter((nd) => nd.id.startsWith('flg_'));
    clutterStops = spots.slice(0, Math.max(n, 3)).map((s) => {
      let best = grid[0], bd = Infinity;
      for (const nd of grid) { const d = Math.hypot(nd.x - s.at.x, nd.z - s.at.z); if (d < bd) { bd = d; best = nd; } }
      return best ? { x: best.x, z: best.z } : { x: s.at.x, z: s.at.z };
    }).filter((x, i, arr) => arr.findIndex((y) => Math.hypot(y.x - x.x, y.z - x.z) < 0.3) === i);
    const cloth = ['#7a2f2f', '#2f4f7a', '#3d3d3d', '#c9b27a'];
    for (let k = 0; k < n; k++) {
      const s = spots[k];
      let m: THREE.Object3D;
      if (s.kind === 'mug') m = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.1, 14), mugMat);
      else if (s.kind === 'magazine') m = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.012, 0.3), new THREE.MeshStandardMaterial({ color: k % 2 ? '#d14b3c' : '#e8d04a', roughness: 0.6 }));
      else if (s.kind === 'box') m = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.24), new THREE.MeshStandardMaterial({ color: '#c9a36a', roughness: 0.9 }));
      else {
        // a crumpled garment: a squashed, lumpy sphere
        const g = new THREE.SphereGeometry(0.22, 10, 6);
        const pos = g.getAttribute('position');
        for (let i = 0; i < pos.count; i++) { const y = pos.getY(i) * 0.18; const f = 1 + Math.sin(i * 1.7) * 0.15; pos.setXYZ(i, pos.getX(i) * f * 1.3, y, pos.getZ(i) * f); }
        g.computeVertexNormals();
        m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: cloth[k % cloth.length], roughness: 0.95 }));
      }
      m.position.copy(s.at);
      m.rotation.y = s.rot;
      add(m);
    }
    // washing machine: clothes tumbling behind the door while it runs, a full drum when done
    const wo = w.obstacles.find((o) => o.kind === 'washer');
    if (wo && c.washer) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const g = cv.getContext('2d')!;
      g.fillStyle = '#d9dde0'; g.fillRect(0, 0, 64, 64);
      for (let i = 0; i < 9; i++) { g.fillStyle = cloth[i % cloth.length]; g.beginPath(); g.ellipse(10 + (i * 23) % 50, 12 + ((i * 37) % 44), 12, 7, i, 0, Math.PI * 2); g.fill(); }
      if (running) { g.fillStyle = 'rgba(255,255,255,0.35)'; for (let i = 0; i < 14; i++) { g.beginPath(); g.arc((i * 29) % 64, (i * 17) % 64, 3, 0, Math.PI * 2); g.fill(); } }
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.16, 24), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }));
      disc.position.set((wo.rect.x0 + wo.rect.x1) / 2, 0.42, wo.rect.z0 - 0.022);
      disc.rotation.y = Math.PI;
      this.home.add(disc);
      this.drum = disc;
    }
  }
}
