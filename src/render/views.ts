// Presentation of dynamic simulation state. Views read state; they never change it.
import * as THREE from 'three';
import type { GameState, Person } from '../sim/types';
import { AnimationController, buildRig, dress, type Rig } from './character';
import { buildCar } from './world';
import { modelInstance } from './models';
import { planRoute } from '../sim/world/nav';
import { productGeometry, productMaterial, productUnitGeometry } from './products';
import { buildingAt, getWorld, type Interactable, SHELF_LAYOUT, PALLET_X, SHOPS, U4_SECTIONS, U4_PALLET_Z, WH_PRODUCTS } from '../sim/world/layout';
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
  binbag: THREE.Object3D | null = null;
  handItem: THREE.Mesh | null = null;
  private handProd: string | null = null;
  label: THREE.Sprite | null = null;
  culled = false;
  /** sideways offset so two people standing on the same spot are drawn side by side */
  nudge = { x: 0, z: 0 };
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
    if (this.mop) this.mop.visible = root.visible;
    if (this.binbag) this.binbag.visible = root.visible;
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
        this.carried = null; this.carriedItem = '';
        this.mop?.parent?.remove(this.mop); this.mop = null;
        this.binbag?.parent?.remove(this.binbag); this.binbag = null;
      } else dress(this.rig, p.appearance);
      this.outfitKey = key;
    }
    const stage = this.staging(state, p, dt);
    const target = stage ? new THREE.Vector3(stage.pos.x, 0, stage.pos.z) : new THREE.Vector3(p.pos.x + this.nudge.x, 0, p.pos.z + this.nudge.z);
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
    const stepping = a?.type === 'shower' && this.showerStep;
    const realSpeed = stage ? (stage.walking ? Math.max(0.6, this.speed) : 0) : stepping ? 0.9 : a || this.bedIt ? 0 : this.speed;
    const clipAction = stage ? (stage.walking ? null : stage.clip) : this.bedIt ? this.bedPose : stepping ? null : a?.type ?? null;
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
    if (!this.mop && !this.carried && !this.binbag && !this.handItem) return;
    this.rig.root.updateMatrixWorld(true);
    const hl = this.rig.bones.handL.getWorldPosition(HAND_L), hr = this.rig.bones.handR.getWorldPosition(HAND_R);
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

  dispose(scene: THREE.Scene) { scene.remove(this.rig.root); this.mop?.parent?.remove(this.mop); this.binbag?.parent?.remove(this.binbag); this.handItem?.parent?.remove(this.handItem); }
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
      { until: 0.32, at: board, face, clip: 'cook' },         // chop on the worktop
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

export class Views {
  people = new Map<string, PersonView>();
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

  constructor(private scene: THREE.Scene) {
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
    scene.add(this.home);
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
  }

  update(state: GameState, dt: number, viewer?: { x: number; z: number }, viewerInside?: string | null, speech?: Map<string, { text: string; until: number }>) {
    buildBudget = 1;
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
      const sp = speech?.get(p.id);
      v.setSpeech(sp && sp.until > performance.now() ? sp.text : null);
    }
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
        pl.position.set(16.35 + (k % 2) * 0.01, top + 0.01 + k * 0.02, 25.45);
        add(pl);
        if (k % 2 === 0) { const g = new THREE.Mesh(new THREE.CircleGeometry(0.05, 10), grime); g.rotation.x = -Math.PI / 2; g.position.set(16.33, top + 0.021 + k * 0.02, 25.44); this.home.add(g); }
      } else if (k < 10) {
        const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.1, 14), mugMat);
        mug.position.set(16.75 + ((k - 6) % 2) * 0.1, top + 0.05, 25.35 + Math.floor((k - 6) / 2) * 0.12);
        add(mug);
      } else {
        const pan = new THREE.Group();
        const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, 0.08, 20, 1, true), new THREE.MeshStandardMaterial({ color: '#2a2a2c', roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide }));
        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.03), new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.5 }));
        handle.position.set(0.22, 0.02, 0);
        pan.add(bowl, handle);
        pan.position.set(17.85 + (k - 10) * 0.05, top + 0.04, 25.5 - (k - 10) * 0.1);
        add(pan);
      }
    }
    // clutter: things left lying about on the furniture the designer placed
    const spots: { kind: string; at: THREE.Vector3; rot: number }[] = [];
    const center = (r: { x0: number; z0: number; x1: number; z1: number }) => new THREE.Vector3((r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2);
    const find = (k: string) => w.obstacles.filter((o) => o.kind === k && o.rect.x0 > 12 && o.rect.x1 < 30 && o.rect.z0 > 13 && o.rect.z1 < 26);
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
