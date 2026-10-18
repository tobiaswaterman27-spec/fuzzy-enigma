// Presentation of dynamic simulation state. Views read state; they never change it.
import * as THREE from 'three';
import type { GameState, Person } from '../sim/types';
import { AnimationController, buildRig, dress, type Rig } from './character';
import { buildCar } from './world';
import { productGeometry, productMaterial, productUnitGeometry } from './products';
import { buildingAt, getWorld, type Interactable, SHELF_LAYOUT, PALLET_X, SHOPS, U4_SECTIONS, U4_PALLET_Z } from '../sim/world/layout';
import { ITEMS } from '../sim/items';
import { count, total, firstItem } from '../sim/inventory';
import { SHELF_CAPACITY } from '../sim/retail';

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
  label: THREE.Sprite | null = null;
  culled = false;
  shadow = true;

  constructor(public p: Person, scene: THREE.Scene) {
    this.rig = buildRig(p.appearance);
    this.anim = new AnimationController(this.rig);
    this.outfitKey = JSON.stringify(p.appearance);
    scene.add(this.rig.root);
    this.rig.root.position.set(p.pos.x, 0, p.pos.z);
    this.lastPos.copy(this.rig.root.position);
  }

  update(state: GameState, p: Person, dt: number) {
    this.p = p;
    const root = this.rig.root;
    root.visible = p.visible && !this.culled;
    if (!root.visible) { root.position.set(p.pos.x, 0, p.pos.z); return; }
    const key = JSON.stringify(p.appearance);
    if (key !== this.outfitKey && buildBudget > 0) {
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
        this.carried = null; this.carriedItem = ''; this.mop = null;
      } else dress(this.rig, p.appearance);
      this.outfitKey = key;
    }
    const target = new THREE.Vector3(p.pos.x, 0, p.pos.z);
    // smooth presentation, but snap on large jumps (teleports, loading)
    if (root.position.distanceTo(target) > 3) root.position.copy(target);
    else root.position.lerp(target, Math.min(1, dt * 20));
    const moved = root.position.distanceTo(this.lastPos);
    this.lastPos.copy(root.position);
    const inst = dt > 0 ? moved / dt : 0;
    this.speed += (inst - this.speed) * Math.min(1, dt * 10);
    // facing
    let yaw = p.facing;
    const cur = root.rotation.y;
    let diff = ((yaw - cur + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    root.rotation.y = cur + diff * Math.min(1, dt * 12);
    // lying down / sitting alignment
    const a = p.action;
    const it = a ? getWorld().interactables[a.target] : null;
    // getting into and out of bed: sit on the edge, then swing round and lie down (and the reverse)
    if (a?.type === 'sleep' && it) this.bedIt = it;
    this.bedT = Math.max(0, Math.min(1, this.bedT + (a?.type === 'sleep' ? dt : -dt) / 1.6));
    if (this.bedT <= 0 && a?.type !== 'sleep') this.bedIt = null;
    const bed = this.bedIt;
    if (bed) {
      const t = smooth(this.bedT);
      const isBed = bed.kind === 'bed';
      const bedTop = isBed ? 0.62 : 0.5;
      // edge: seated beside the bed facing the room; lying: along the bed, head on the pillow
      const ex = bed.pos.x + (bed.obj.x - bed.pos.x) * 0.45, ez = bed.pos.z + (bed.obj.z - bed.pos.z) * 0.45;
      const outYaw = Math.atan2(bed.pos.x - bed.obj.x, bed.pos.z - bed.obj.z);
      // lie along the bed's long axis: feet at the foot end, head towards the headboard (against the wall)
      const r = getWorld().obstacles.find((o) => (o.kind === 'bed' || o.kind === 'sofa') && bed.obj.x >= o.rect.x0 - 0.2 && bed.obj.x <= o.rect.x1 + 0.2 && bed.obj.z >= o.rect.z0 - 0.2 && bed.obj.z <= o.rect.z1 + 0.2)?.rect;
      let lx = bed.obj.x, lz = bed.obj.z, lieYaw = 0;
      if (r) {
        const alongX = r.x1 - r.x0 >= r.z1 - r.z0;
        // the headboard is on the side away from where you get in (the interaction point)
        const headPlus = alongX ? Math.abs(bed.pos.x - r.x1) > Math.abs(bed.pos.x - r.x0) : Math.abs(bed.pos.z - r.z1) > Math.abs(bed.pos.z - r.z0);
        const cxr = (r.x0 + r.x1) / 2, czr = (r.z0 + r.z1) / 2;
        if (alongX) { lx = headPlus ? r.x0 + 0.12 : r.x1 - 0.12; lz = czr; lieYaw = headPlus ? -Math.PI / 2 : Math.PI / 2; }
        else { lz = headPlus ? r.z0 + 0.12 : r.z1 - 0.12; lx = cxr; lieYaw = headPlus ? Math.PI : 0; }
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
      } else if ((a?.type === 'sit' || a?.type === 'watch_tv') && it && (it.kind === 'sofa' || it.kind === 'chair' || it.kind === 'iv_chair' || it.kind === 'iv_host')) {
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
    // shopping basket (picked goods) in the left hand, carrier bag (paid goods) in the right
    this.syncHeld(state, p);
    const stepping = a?.type === 'shower' && this.showerStep;
    const realSpeed = stepping ? 0.9 : a || this.bedIt ? 0 : this.speed;
    const clipAction = this.bedIt ? this.bedPose : stepping ? null : a?.type ?? null;
    this.anim.update(dt, realSpeed, !!item, clipAction);
    // keep the feet on the floor: whatever the animation does, the lower foot rests on the ground
    if (!this.bedIt && this.rig.joints) {
      this.rig.root.updateMatrixWorld(true);
      this.rig.bones.footL.getWorldPosition(FOOT_A);
      this.rig.bones.footR.getWorldPosition(FOOT_B);
      const rest = this.rig.joints.footL.y * this.rig.body.scale.y;
      const target = Math.max(-0.3, Math.min(0.3, rest - (Math.min(FOOT_A.y, FOOT_B.y) - root.position.y)));
      this.ground += (target - this.ground) * Math.min(1, dt * 14);
      this.rig.body.position.y = this.ground;
    }
    this.placeProps(a?.type ?? null, p.facing);
  }
  private ground = 0;
  private showerStep = false;
  private bedIt: Interactable | null = null;
  private bedT = 0;
  private bedPose = 'sit';
  private basket: THREE.Group | null = null;
  private basketKey = '';
  private bag: THREE.Group | null = null;

  /** Props that follow the hands of the final pose: the mop runs through both hands to the floor,
   * a carried case sits between the hands. */
  private placeProps(action: string | null, facing: number) {
    if (!this.mop && !this.carried) return;
    this.rig.root.updateMatrixWorld(true);
    const hl = this.rig.bones.handL.getWorldPosition(HAND_L), hr = this.rig.bones.handR.getWorldPosition(HAND_R);
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
    const hasBag = !!bagC && total(bagC) > 0 && p.where !== (p.homeId ?? '-');
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

  dispose(scene: THREE.Scene) { scene.remove(this.rig.root); this.mop?.parent?.remove(this.mop); }
}

export class Views {
  people = new Map<string, PersonView>();
  shelfMeshes = new Map<string, { mesh: THREE.InstancedMesh; bid: string; product: string }>();
  palletMeshes = new Map<string, { mesh: THREE.InstancedMesh; bid: string; shelf: string }>();
  bayMeshes = new Map<string, THREE.InstancedMesh>();
  van: THREE.Group;
  spills = new Map<string, THREE.Mesh>();
  queueMarker: THREE.Mesh;

  constructor(private scene: THREE.Scene) {
    // shelf products: one instanced mesh per shelf section (count = real shelf stock)
    const sections = [
      ...SHELF_LAYOUT.map((x) => ({ id: `shelf_${x.product}`, bid: 'market', gx: x.gx, zc: x.zc, len: 4.5 })),
      ...U4_SECTIONS.map((x) => ({ id: x.id, bid: 'unit4', gx: x.gx, zc: x.zc, len: 5 })),
    ];
    for (const sct of sections) {
      const m = new THREE.InstancedMesh(productGeometry('bread'), productMaterial, SHELF_CAPACITY);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < SHELF_CAPACITY; i++) {
        // 16 facings per shelf level: 8 along the run on each face of the gondola, filling from the bottom
        const level = Math.floor(i / 16);
        const col = i % 16;
        const side = col % 2 === 0 ? -1 : 1;
        dummy.position.set(sct.gx + side * 0.42, 0.19 + level * 0.45, sct.zc - sct.len / 2 + (Math.floor(col / 2) + 0.5) * (sct.len / 8));
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
      }
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = true;
      scene.add(m);
      this.shelfMeshes.set(sct.id, { mesh: m, bid: sct.bid, product: '' });
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
    this.van = buildCar('#f2f2f2', 0, 0, 0, true);
    scene.add(this.van);
    this.queueMarker = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.45, 24), new THREE.MeshBasicMaterial({ color: '#2e8b57', transparent: true, opacity: 0.5 }));
    this.queueMarker.rotation.x = -Math.PI / 2;
    this.queueMarker.position.set(22, 0.1, -11.7);
    scene.add(this.queueMarker);
  }

  update(state: GameState, dt: number, viewer?: { x: number; z: number }, viewerInside?: string | null) {
    buildBudget = 1;
    for (const p of Object.values(state.people)) {
      let v = this.people.get(p.id);
      if (!v) { v = new PersonView(p, this.scene); this.people.set(p.id, v); }
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
    }
    for (const [id, v] of this.shelfMeshes) {
      const b = state.businesses[v.bid];
      const k = b?.sections[id];
      if (!k) { v.mesh.count = 0; continue; }
      if (k !== v.product) { v.mesh.geometry = productGeometry(k); v.product = k; }
      v.mesh.count = Math.min(SHELF_CAPACITY, count(state.containers[id], k));
    }
    for (const v of this.palletMeshes.values()) {
      const b = state.businesses[v.bid];
      const k = b?.sections[v.shelf];
      v.mesh.count = k ? Math.min(16, Math.ceil(count(state.containers[SHOPS[v.bid].backroom], k) / ITEMS[k].caseSize)) : 0;
    }
    for (const [bid, m] of this.bayMeshes) m.count = state.containers[SHOPS[bid].bayContainer] ? Math.min(40, Math.ceil(total(state.containers[SHOPS[bid].bayContainer]) / 10)) : 0;
    const van = state.vehicles.van_1;
    this.van.position.set(van.pos.x, 0, van.pos.z);
    this.van.rotation.y = van.heading;
    // spills
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
}
