// Presentation of dynamic simulation state. Views read state; they never change it.
import * as THREE from 'three';
import type { GameState, Person } from '../sim/types';
import { AnimationController, buildRig, dress, type Rig } from './character';
import { buildCar } from './world';
import { getWorld, SHELF_LAYOUT, PALLET_X } from '../sim/world/layout';
import { ITEMS, PRODUCTS } from '../sim/items';
import { count, total, firstItem } from '../sim/inventory';
import { SHELF_CAPACITY } from '../sim/retail';

class PersonView {
  rig: Rig;
  anim: AnimationController;
  outfitKey = '';
  lastPos = new THREE.Vector3();
  speed = 0;
  carried: THREE.Mesh | null = null;
  carriedItem = '';
  mop: THREE.Group | null = null;
  label: THREE.Sprite | null = null;

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
    root.visible = p.visible;
    if (!p.visible) return;
    const key = JSON.stringify(p.appearance);
    if (key !== this.outfitKey) {
      const prev = JSON.parse(this.outfitKey);
      if (prev.build !== p.appearance.build || prev.height !== p.appearance.height) {
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
    if (a?.type === 'sleep' && it) {
      this.rig.body.rotation.set(-Math.PI / 2, 0, 0);
      const bedTop = it.kind === 'bed' ? 0.62 : 0.5;
      this.rig.body.position.set(0, bedTop + 0.12, -0.9);
      root.position.set(it.obj.x - (it.kind === 'bed' ? 0.9 : 0), 0, it.obj.z);
      root.rotation.y = it.kind === 'bed' ? Math.PI / 2 : 0;
      yaw = root.rotation.y;
    } else {
      this.rig.body.rotation.set(0, 0, 0);
      this.rig.body.position.set(0, 0, 0);
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
    // mop
    if (p.equipment === 'mop' && !this.mop) {
      this.mop = new THREE.Group();
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 6), new THREE.MeshStandardMaterial({ color: '#c9c9c9' }));
      stick.position.y = -0.5;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.08, 0.12), new THREE.MeshStandardMaterial({ color: '#2a7fd4' }));
      head.position.y = -1.2;
      this.mop.add(stick, head);
      this.mop.rotation.x = 0.3;
      this.rig.toolR.add(this.mop);
    } else if (p.equipment !== 'mop' && this.mop) {
      this.rig.toolR.remove(this.mop);
      this.mop = null;
    }
    const realSpeed = a ? 0 : this.speed;
    this.anim.update(dt, realSpeed, !!item, a?.type ?? null);
  }

  dispose(scene: THREE.Scene) { scene.remove(this.rig.root); }
}

export class Views {
  people = new Map<string, PersonView>();
  shelfMeshes = new Map<string, THREE.InstancedMesh>();
  palletMeshes = new Map<string, THREE.InstancedMesh>();
  bayMesh: THREE.InstancedMesh;
  van: THREE.Group;
  spills = new Map<string, THREE.Mesh>();
  queueMarker: THREE.Mesh;

  constructor(private scene: THREE.Scene) {
    const w = getWorld();
    // shelf products: one instanced mesh per product section, 30 slots
    for (const s of SHELF_LAYOUT) {
      const m = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.26, 0.2), new THREE.MeshStandardMaterial({ color: ITEMS[s.product].color, roughness: 0.6 }), SHELF_CAPACITY);
      m.castShadow = true;
      const dummy = new THREE.Object3D();
      for (let i = 0; i < SHELF_CAPACITY; i++) {
        const level = Math.floor(i / 10);
        const col = i % 10;
        const side = col % 2 === 0 ? -1 : 1;
        dummy.position.set(s.gx + side * 0.36, 0.3 + level * 0.45, s.zc - 1.9 + Math.floor(col / 2) * 0.95);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
      }
      m.count = 0;
      scene.add(m);
      this.shelfMeshes.set(s.product, m);
    }
    // store-room stacks on pallets
    PRODUCTS.forEach((p, i) => {
      const m = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.32, 0.5), new THREE.MeshStandardMaterial({ color: '#b8925d', roughness: 0.9 }), 16);
      const dummy = new THREE.Object3D();
      for (let k = 0; k < 16; k++) {
        dummy.position.set(PALLET_X[i] + ((k % 4) % 2 ? 0.27 : -0.27), 0.3 + Math.floor(k / 4) * 0.33, -35.1 + (Math.floor((k % 4) / 2) ? 0.27 : -0.27));
        dummy.updateMatrix();
        m.setMatrixAt(k, dummy.matrix);
      }
      m.castShadow = true;
      m.count = 0;
      scene.add(m);
      // product colour tag on the pallet
      const tag = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.12, 0.04), new THREE.MeshStandardMaterial({ color: ITEMS[p].color }));
      tag.position.set(PALLET_X[i], 0.2, -34.48);
      scene.add(tag);
      this.palletMeshes.set(p, m);
    });
    this.bayMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.32, 0.5), new THREE.MeshStandardMaterial({ color: '#c4a06b', roughness: 0.9 }), 40);
    const dummy = new THREE.Object3D();
    for (let k = 0; k < 40; k++) {
      dummy.position.set(w.dropZone.x - 1.4 + (k % 6) * 0.55, 0.2 + Math.floor(k / 12) * 0.33, w.dropZone.z + (Math.floor(k / 6) % 2) * 0.55 - 0.3);
      dummy.updateMatrix();
      this.bayMesh.setMatrixAt(k, dummy.matrix);
    }
    this.bayMesh.count = 0;
    this.bayMesh.castShadow = true;
    scene.add(this.bayMesh);
    this.van = buildCar('#f2f2f2', 0, 0, 0, true);
    scene.add(this.van);
    this.queueMarker = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.45, 24), new THREE.MeshBasicMaterial({ color: '#2e8b57', transparent: true, opacity: 0.5 }));
    this.queueMarker.rotation.x = -Math.PI / 2;
    this.queueMarker.position.set(22, 0.1, -11.7);
    scene.add(this.queueMarker);
  }

  update(state: GameState, dt: number) {
    for (const p of Object.values(state.people)) {
      let v = this.people.get(p.id);
      if (!v) { v = new PersonView(p, this.scene); this.people.set(p.id, v); }
      v.update(state, p, dt);
    }
    for (const [k, m] of this.shelfMeshes) m.count = Math.min(SHELF_CAPACITY, count(state.containers[`shelf_${k}`], k));
    for (const [k, m] of this.palletMeshes) m.count = Math.min(16, Math.ceil(count(state.containers.market_backroom, k) / ITEMS[k].caseSize));
    this.bayMesh.count = Math.min(40, Math.ceil(total(state.containers.market_bay) / 10));
    const van = state.vehicles.van_1;
    this.van.position.set(van.pos.x, 0, van.pos.z);
    this.van.rotation.y = van.heading;
    // spills
    for (const [id, m] of this.spills) if (!state.dirt[id]) { this.scene.remove(m); this.spills.delete(id); }
    for (const d of Object.values(state.dirt)) {
      let m = this.spills.get(d.id);
      if (!m) {
        m = new THREE.Mesh(new THREE.CircleGeometry(0.6, 18), new THREE.MeshStandardMaterial({ color: '#7a5a2a', roughness: 0.2, transparent: true, opacity: 0.7 }));
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
