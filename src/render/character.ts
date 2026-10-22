// CharacterAppearance + AnimationController.
// A procedural, articulated low-poly figure. Every body variation, hairstyle
// and outfit shares the same joint hierarchy, so every animation clip works
// for every character and clothing never needs separate skinning (no clipping
// between incompatible meshes by construction).
import * as THREE from 'three';
import type { Appearance } from '../sim/types';
import { BONE_NAMES, buildHumanMeshes, buildSkeleton, type HBone } from './human';
import { buildRealHuman, humanAsset } from './humanAsset';

// --------------------------------------------------------------- outfits
export interface OutfitStyle {
  top: string;
  bottom: string;
  shoes: string;
  kind: 'tee' | 'shirt' | 'polo_apron' | 'hivis' | 'apron';
  accent?: string;
}

export const OUTFITS: Record<string, OutfitStyle> = {
  outfit_casual: { top: '#4a6fa5', bottom: '#2f3b52', shoes: '#e8e8e8', kind: 'tee' },
  outfit_smart: { top: '#e9e4da', bottom: '#2f3640', shoes: '#3a2a1e', kind: 'shirt', accent: '#7a2b2b' },
  uniform_market: { top: '#2e8b57', bottom: '#2b2b2b', shoes: '#1b1b1b', kind: 'polo_apron', accent: '#1f5f3c' },
  uniform_wholesale: { top: '#3d4a57', bottom: '#2b3440', shoes: '#4a3520', kind: 'hivis', accent: '#f4d000' },
  uniform_cafe: { top: '#f2efe8', bottom: '#242424', shoes: '#1b1b1b', kind: 'apron', accent: '#7b2d26' },
};

// --------------------------------------------------------------- rig
export const BONES = BONE_NAMES;
export type BoneName = HBone;

export interface Rig {
  root: THREE.Group; // positioned at the feet, rotated to face
  body: THREE.Group; // scaled for height; lies down for sleeping
  bones: Record<BoneName, THREE.Object3D>;
  skeleton: THREE.Skeleton;
  meshes: THREE.SkinnedMesh[];
  /** attachment points */
  carry: THREE.Object3D;
  toolR: THREE.Object3D;
  real?: boolean;
  joints?: Record<string, THREE.Vector3>;
}

const BUILD_NUM = { slim: 0.88, average: 1, broad: 1.15 } as const;

export function buildRig(a: Appearance): Rig {
  if (humanAsset()) return buildRealRig(a);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(a.height);
  root.add(body);
  const { bones } = buildSkeleton(a.frame ?? 'm', BUILD_NUM[a.build]);
  body.add(bones.hips);
  body.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(BONE_NAMES.map((n) => bones[n]));
  const carry = new THREE.Object3D();
  carry.position.set(0, -0.02, 0.33);
  bones.chest.add(carry);
  const toolR = new THREE.Object3D();
  toolR.position.set(0, -0.06, 0.02);
  bones.handR.add(toolR);
  const rig: Rig = { root, body, bones, skeleton, meshes: [], carry, toolR };
  dress(rig, a);
  return rig;
}

/** height scale so the average MakeHuman body (1.67 m) becomes a realistic adult */
const realScale = (a: Appearance) => a.height * ((a.frame ?? 'm') === 'f' ? 1.0 : 1.06);

function buildRealRig(a: Appearance): Rig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(realScale(a));
  root.add(body);
  const hb = buildRealHuman(a);
  const J = hb.joints;
  const bones = {} as Record<BoneName, THREE.Bone>;
  for (const n of BONE_NAMES) { const b = new THREE.Bone(); b.name = n; bones[n] = b; }
  // the clips animate hips.position around y = 0.95, so an offset node carries the real hip height
  const pelvis = new THREE.Group();
  pelvis.position.set(J.hips.x, J.hips.y - 0.95, J.hips.z);
  body.add(pelvis);
  pelvis.add(bones.hips);
  bones.hips.position.set(0, 0.95, 0);
  const parent: Partial<Record<BoneName, BoneName>> = { spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck', armL: 'chest', foreL: 'armL', handL: 'foreL', armR: 'chest', foreR: 'armR', handR: 'foreR', thighL: 'hips', shinL: 'thighL', footL: 'shinL', thighR: 'hips', shinR: 'thighR', footR: 'shinR' };
  for (const n of BONE_NAMES) { const pn = parent[n]; if (pn) { bones[pn].add(bones[n]); bones[n].position.copy(J[n]).sub(J[pn]); } }
  const skeleton = new THREE.Skeleton(BONE_NAMES.map((n) => bones[n]));
  const carry = new THREE.Object3D();
  carry.position.set(0, -0.06, 0.3);
  bones.chest.add(carry);
  const toolR = new THREE.Object3D();
  toolR.position.set(0, -0.08, 0.02);
  bones.handR.add(toolR);
  const rig: Rig = { root, body, bones, skeleton, meshes: [], carry, toolR, real: true, joints: J };
  dress(rig, a);
  return rig;
}

function dressReal(rig: Rig, a: Appearance) {
  // geometries are shared through the build cache, so they are not disposed here
  for (const m of rig.meshes) m.parent?.remove(m);
  const saved = BONE_NAMES.map((n) => rig.bones[n].quaternion.clone());
  const hipsPos = rig.bones.hips.position.clone();
  for (const n of BONE_NAMES) rig.bones[n].quaternion.identity();
  rig.bones.hips.position.set(0, 0.95, 0);
  const rot = rig.body.rotation.clone(), pos = rig.body.position.clone(), scl = rig.body.scale.clone();
  rig.body.rotation.set(0, 0, 0); rig.body.position.set(0, 0, 0); rig.body.scale.set(1, 1, 1);
  const rootM = rig.root.matrixWorld.clone();
  rig.root.matrixWorld.identity();
  rig.body.updateMatrixWorld(true);
  rig.skeleton.calculateInverses();
  const hb = buildRealHuman(a);
  const objs = hb.meshes(rig.skeleton);
  rig.meshes = [];
  for (const o of objs) {
    if (o.userData.attach) {
      const bone = rig.bones[o.userData.attach as BoneName];
      if (o.userData.worldPos) o.position.copy(o.userData.worldPos).sub(rig.joints![o.userData.attach]);
      bone.add(o);
    } else rig.body.add(o);
    rig.meshes.push(o as THREE.SkinnedMesh);
  }
  BONE_NAMES.forEach((n, i) => rig.bones[n].quaternion.copy(saved[i]));
  rig.bones.hips.position.copy(hipsPos);
  rig.body.rotation.copy(rot); rig.body.position.copy(pos); rig.body.scale.copy(scl);
  rig.root.matrixWorld.copy(rootM);
}

/** (re)build visible meshes for an appearance; bones and animation state are untouched */
export function dress(rig: Rig, a: Appearance) {
  if (rig.real) return dressReal(rig, a);
  for (const m of rig.meshes) { rig.body.remove(m); m.geometry.dispose(); }
  // bind in rest pose so every garment shares the same bind matrices
  const saved = BONE_NAMES.map((n) => rig.bones[n].quaternion.clone());
  const hipsPos = rig.bones.hips.position.clone();
  for (const n of BONE_NAMES) rig.bones[n].quaternion.identity();
  rig.bones.hips.position.set(0, 0.95, 0);
  const rot = rig.body.rotation.clone(), pos = rig.body.position.clone();
  rig.body.rotation.set(0, 0, 0); rig.body.position.set(0, 0, 0);
  const rootM = rig.root.matrixWorld.clone();
  rig.root.matrixWorld.identity();
  rig.body.updateMatrixWorld(true);
  rig.skeleton.calculateInverses();
  rig.meshes = buildHumanMeshes(a, rig.skeleton);
  for (const m of rig.meshes) rig.body.add(m);
  BONE_NAMES.forEach((n, i) => rig.bones[n].quaternion.copy(saved[i]));
  rig.bones.hips.position.copy(hipsPos);
  rig.body.rotation.copy(rot); rig.body.position.copy(pos);
  rig.root.matrixWorld.copy(rootM);
}

// --------------------------------------------------------------- clips
type Key = [number, number, number, number]; // t, rx, ry, rz
type ClipDef = { dur: number; bones: Partial<Record<BoneName, Key[]>>; hipsY?: [number, number][] };

const q = new THREE.Quaternion();
const e = new THREE.Euler();
function makeClip(name: string, def: ClipDef): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  for (const [bn, keys] of Object.entries(def.bones) as [BoneName, Key[]][]) {
    const times: number[] = [];
    const vals: number[] = [];
    for (const [t, x, y, z] of keys) {
      times.push(t * def.dur);
      e.set(x, y, z);
      q.setFromEuler(e);
      vals.push(q.x, q.y, q.z, q.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bn}.quaternion`, times, vals));
  }
  if (def.hipsY) {
    const times = def.hipsY.map((k) => k[0] * def.dur);
    const vals = def.hipsY.flatMap((k) => [0, k[1], 0]);
    tracks.push(new THREE.VectorKeyframeTrack('hips.position', times, vals));
  }
  return new THREE.AnimationClip(name, def.dur, tracks);
}

const still = (x = 0, y = 0, z = 0): Key[] => [[0, x, y, z], [1, x, y, z]];
const STAND_HIPS: [number, number][] = [[0, 0.95], [1, 0.95]];

/** neutral values for every bone so each clip fully defines the pose */
function full(def: ClipDef): ClipDef {
  const bones = { ...def.bones };
  for (const b of BONES) if (!bones[b]) bones[b] = still(b === 'armL' ? 0 : 0, 0, b === 'armL' ? 0.06 : b === 'armR' ? -0.06 : 0);
  return { ...def, bones, hipsY: def.hipsY ?? STAND_HIPS };
}

function walkLegs(amp: number, knee: number): Partial<Record<BoneName, Key[]>> {
  return {
    thighL: [[0, -amp, 0, 0], [0.25, 0, 0, 0], [0.5, amp, 0, 0], [0.75, 0, 0, 0], [1, -amp, 0, 0]],
    shinL: [[0, 0.05, 0, 0], [0.25, 0.1, 0, 0], [0.5, 0.2, 0, 0], [0.75, knee, 0, 0], [1, 0.05, 0, 0]],
    thighR: [[0, amp, 0, 0], [0.25, 0, 0, 0], [0.5, -amp, 0, 0], [0.75, 0, 0, 0], [1, amp, 0, 0]],
    shinR: [[0, 0.2, 0, 0], [0.25, knee, 0, 0], [0.5, 0.05, 0, 0], [0.75, 0.1, 0, 0], [1, 0.2, 0, 0]],
    footL: [[0, 0.15, 0, 0], [0.5, -0.2, 0, 0], [1, 0.15, 0, 0]],
    footR: [[0, -0.2, 0, 0], [0.5, 0.15, 0, 0], [1, -0.2, 0, 0]],
  };
}

const HOLD_ARMS: Partial<Record<BoneName, Key[]>> = {
  armL: still(-0.95, 0, 0.15), foreL: still(-0.75, 0.3, 0), armR: still(-0.95, 0, -0.15), foreR: still(-0.75, -0.3, 0),
};

export const CLIP_DEFS: Record<string, ClipDef> = {
  idle: { dur: 3, bones: { spine: [[0, 0, 0, 0], [0.5, 0.03, 0, 0], [1, 0, 0, 0]], armL: [[0, 0, 0, 0.07], [0.5, 0.02, 0, 0.09], [1, 0, 0, 0.07]], armR: [[0, 0, 0, -0.07], [0.5, 0.02, 0, -0.09], [1, 0, 0, -0.07]], head: [[0, 0, 0, 0], [0.3, 0, 0.12, 0], [0.7, 0, -0.08, 0], [1, 0, 0, 0]], foreL: still(-0.08), foreR: still(-0.08) }, hipsY: [[0, 0.95], [0.5, 0.94], [1, 0.95]] },
  walk: { dur: 1.0, bones: { ...walkLegs(0.45, 0.65), armL: [[0, 0.38, 0, 0.06], [0.5, -0.38, 0, 0.06], [1, 0.38, 0, 0.06]], armR: [[0, -0.38, 0, -0.06], [0.5, 0.38, 0, -0.06], [1, -0.38, 0, -0.06]], foreL: still(-0.25), foreR: still(-0.25), spine: still(0.04), chest: [[0, 0, 0.06, 0], [0.5, 0, -0.06, 0], [1, 0, 0.06, 0]] }, hipsY: [[0, 0.95], [0.25, 0.97], [0.5, 0.95], [0.75, 0.97], [1, 0.95]] },
  run: { dur: 0.62, bones: { ...walkLegs(0.85, 1.45), armL: [[0, 0.75, 0, 0.1], [0.5, -0.75, 0, 0.1], [1, 0.75, 0, 0.1]], armR: [[0, -0.75, 0, -0.1], [0.5, 0.75, 0, -0.1], [1, -0.75, 0, -0.1]], foreL: still(-1.3), foreR: still(-1.3), spine: still(0.18), chest: [[0, 0, 0.12, 0], [0.5, 0, -0.12, 0], [1, 0, 0.12, 0]] }, hipsY: [[0, 0.9], [0.25, 0.97], [0.5, 0.9], [0.75, 0.97], [1, 0.9]] },
  carry_idle: { dur: 3, bones: { ...HOLD_ARMS, spine: [[0, -0.04, 0, 0], [0.5, -0.02, 0, 0], [1, -0.04, 0, 0]] } },
  carry_walk: { dur: 1.0, bones: { ...walkLegs(0.4, 0.6), ...HOLD_ARMS, spine: still(-0.04) }, hipsY: [[0, 0.95], [0.25, 0.97], [0.5, 0.95], [0.75, 0.97], [1, 0.95]] },
  pickup: { dur: 1.0, bones: { spine: [[0, 0, 0, 0], [0.45, 0.75, 0, 0], [1, 0.1, 0, 0]], chest: [[0, 0, 0, 0], [0.45, 0.3, 0, 0], [1, 0, 0, 0]], thighL: [[0, 0, 0, 0], [0.45, -0.9, 0, 0], [1, 0, 0, 0]], thighR: [[0, 0, 0, 0], [0.45, -0.9, 0, 0], [1, 0, 0, 0]], shinL: [[0, 0, 0, 0], [0.45, 1.4, 0, 0], [1, 0, 0, 0]], shinR: [[0, 0, 0, 0], [0.45, 1.4, 0, 0], [1, 0, 0, 0]], footL: [[0, 0, 0, 0], [0.45, -0.5, 0, 0], [1, 0, 0, 0]], footR: [[0, 0, 0, 0], [0.45, -0.5, 0, 0], [1, 0, 0, 0]], armL: [[0, 0, 0, 0.06], [0.45, -0.9, 0, 0.2], [1, -0.95, 0, 0.15]], armR: [[0, 0, 0, -0.06], [0.45, -0.9, 0, -0.2], [1, -0.95, 0, -0.15]], foreL: [[0, 0, 0, 0], [0.45, -0.3, 0, 0], [1, -0.75, 0.3, 0]], foreR: [[0, 0, 0, 0], [0.45, -0.3, 0, 0], [1, -0.75, -0.3, 0]] }, hipsY: [[0, 0.95], [0.45, 0.62], [1, 0.95]] },
  stock: { dur: 0.9, bones: { armL: still(-0.95, 0, 0.15), foreL: still(-0.75, 0.3, 0), armR: [[0, -0.9, 0, -0.15], [0.5, -1.45, 0.2, -0.1], [1, -0.9, 0, -0.15]], foreR: [[0, -0.8, 0, 0], [0.5, -0.2, 0, 0], [1, -0.8, 0, 0]], spine: [[0, 0.05, 0, 0], [0.5, 0.15, -0.15, 0], [1, 0.05, 0, 0]] } },
  scan: { dur: 0.7, bones: { armR: [[0, -0.95, 0.35, -0.1], [0.5, -0.95, -0.35, -0.1], [1, -0.95, 0.35, -0.1]], foreR: still(-0.9), armL: still(-0.7, 0, 0.1), foreL: still(-0.9), spine: still(0.12), head: still(0.35) } },
  type: { dur: 0.5, bones: { armL: still(-0.6, 0, 0.12), armR: still(-0.6, 0, -0.12), foreL: [[0, -1.1, 0.3, 0], [0.5, -1.0, 0.3, 0], [1, -1.1, 0.3, 0]], foreR: [[0, -1.0, -0.3, 0], [0.5, -1.1, -0.3, 0], [1, -1.0, -0.3, 0]], head: still(0.3), spine: still(0.06) } },
  mop: { dur: 1.3, bones: { armL: [[0, -0.7, 0.3, 0.2], [0.5, -0.5, -0.3, 0.1], [1, -0.7, 0.3, 0.2]], armR: [[0, -0.4, 0.3, -0.1], [0.5, -0.2, -0.3, -0.2], [1, -0.4, 0.3, -0.1]], foreL: still(-0.6), foreR: still(-0.5), spine: [[0, 0.25, 0.3, 0], [0.5, 0.25, -0.3, 0], [1, 0.25, 0.3, 0]] } },
  // knuckles on a door: forearm raised, rapping three times
  knock: { dur: 0.9, bones: { armR: still(-1.05, 0, -0.2), foreR: [[0, -1.2, 0, 0], [0.15, -1.75, 0, 0], [0.3, -1.2, 0, 0], [0.45, -1.75, 0, 0], [0.6, -1.2, 0, 0], [0.75, -1.75, 0, 0], [1, -1.2, 0, 0]], armL: still(0.02, 0, 0.08), foreL: still(-0.1), head: still(0.05) } },
  eat: { dur: 1.8, bones: { armR: [[0, -0.3, 0, -0.1], [0.4, -0.7, 0, -0.2], [0.6, -0.7, 0, -0.2], [1, -0.3, 0, -0.1]], foreR: [[0, -0.6, 0, 0], [0.4, -2.1, 0, 0], [0.6, -2.1, 0, 0], [1, -0.6, 0, 0]], armL: still(-0.5, 0, 0.1), foreL: still(-1.0), head: [[0, 0.1, 0, 0], [0.5, -0.05, 0, 0], [1, 0.1, 0, 0]] } },
  sit: { dur: 3, bones: { thighL: still(-1.5, 0, 0.05), thighR: still(-1.5, 0, -0.05), shinL: still(1.5), shinR: still(1.5), armL: still(-0.4, 0, 0.1), armR: still(-0.4, 0, -0.1), foreL: still(-0.6), foreR: still(-0.6), spine: [[0, -0.05, 0, 0], [0.5, -0.02, 0, 0], [1, -0.05, 0, 0]] }, hipsY: [[0, 0.5], [1, 0.5]] },
  lie: { dur: 4, bones: { armL: still(0, 0, 0.12), armR: still(0, 0, -0.12), spine: [[0, 0, 0, 0], [0.5, 0.04, 0, 0], [1, 0, 0, 0]], head: still(-0.1, 0.3, 0) } },
  talk: { dur: 2.2, bones: { armR: [[0, -0.2, 0, -0.1], [0.3, -0.7, 0.2, -0.3], [0.6, -0.4, 0, -0.2], [1, -0.2, 0, -0.1]], foreR: [[0, -0.3, 0, 0], [0.3, -1.2, 0, 0], [0.6, -0.8, 0, 0], [1, -0.3, 0, 0]], armL: still(0, 0, 0.08), head: [[0, 0, 0, 0], [0.4, 0.08, 0.1, 0], [1, 0, 0, 0]] } },
  clipboard: { dur: 1.2, bones: { armL: still(-0.8, 0, 0.1), foreL: still(-0.9, 0.4, 0), armR: [[0, -0.7, 0, -0.1], [0.5, -0.85, 0.15, -0.1], [1, -0.7, 0, -0.1]], foreR: still(-1.0, -0.3, 0), head: [[0, 0.35, 0, 0], [0.5, 0.2, 0.2, 0], [1, 0.35, 0, 0]] } },
};

// ------------------------------------------------- motion capture
// Real human motion (CMU motion capture, retargeted by tools/build_anims.py) replaces the
// hand-keyed clips where available: walk, run, idle, carry_walk, pickup, sit, mop, talk, eat.
interface MocapClip { dur: number; speed: number; times: number[]; bones: Record<string, number[]>; hips: number[] }
let MOCAP: Record<string, MocapClip> = {};
export async function loadMocap(url = 'assets/anim/clips.json'): Promise<boolean> {
  try {
    const r = await fetch(url);
    if (!r.ok) return false;
    MOCAP = (await r.json()).clips ?? {};
    const walk = MOCAP.walk?.speed, run = MOCAP.run?.speed;
    if (walk) WALK_SPEED_REF = walk;
    if (run) RUN_SPEED_REF = run;
    if (MOCAP.carry_walk?.speed) CARRY_SPEED_REF = MOCAP.carry_walk.speed;
    for (const k of Object.keys(CLIPS)) delete CLIPS[k];
    return true;
  } catch {
    return false;
  }
}

function mocapClip(name: string, m: MocapClip): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  for (const [bone, vals] of Object.entries(m.bones)) tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, m.times, vals));
  tracks.push(new THREE.VectorKeyframeTrack('hips.position', m.times, m.hips));
  return new THREE.AnimationClip(name, m.dur, tracks);
}

const CLIPS: Record<string, THREE.AnimationClip> = {};
export function getClip(name: string): THREE.AnimationClip {
  if (!CLIPS[name]) CLIPS[name] = MOCAP[name] ? mocapClip(name, MOCAP[name]) : makeClip(name, full(CLIP_DEFS[name]));
  return CLIPS[name];
}

// --------------------------------------------------------------- controller
/** which clip presents which simulation action (presentation only) */
export const ACTION_CLIP: Record<string, string> = {
  clock_in: 'type', clock_out: 'type', take_case: 'pickup', return_case: 'pickup', stock_shelf: 'place',
  serve_customer: 'scan', self_checkout: 'scan', take_mop: 'pickup', return_mop: 'pickup', clean: 'mop',
  check_in_delivery: 'clipboard', pick_item: 'place', sleep: 'lie', eat: 'eat', store_food: 'place',
  change_outfit: 'dress', buy_meal: 'eat', sit: 'sit', watch_tv: 'sit', talk: 'talk', shower: 'wash', cook: 'type', phone: 'phone',
  take_order: 'talk', take_tool: 'pickup', return_tool: 'pickup', take_bricks: 'pickup', site_work: 'place', cook_meal: 'type', serve_meal: 'place', drive_van: 'pickup', drive_car: 'pickup', drive_forklift: 'pickup', attack: 'punch', scratch: 'type', lotto: 'scan', knock: 'knock', break_in: 'fight', search: 'pickup', down: 'fall', buy_pint: 'drink', buy_weapon: 'pickup', study: 'sit', buy_stall: 'talk', pick_case: 'pickup', stage_case: 'place', face_shelf: 'place', bale_cardboard: 'place', empty_bin: 'pickup', dump_rubbish: 'place', wash_up: 'type', laundry: 'pickup', tidy: 'pickup',
};

/** seated clips: getting into and out of them plays a real sit-down / stand-up move */
const SEATED = new Set(['sit', 'sit_down']);
/** clips that play once and hold their last pose (falls, one-off gestures) */
const ONCE = new Set(['fall', 'wave', 'shrug', 'yawn', 'handshake']);

/** ground speeds (m/s) the locomotion clips were captured at; playback rate scales with real speed */
export let WALK_SPEED_REF = 1.5;
export let RUN_SPEED_REF = 4.2;
export let CARRY_SPEED_REF = 1.2;

export class AnimationController {
  readonly mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private current = '';
  state = 'idle';

  constructor(rig: Rig) {
    this.mixer = new THREE.AnimationMixer(rig.body);
  }

  private get(name: string) {
    let a = this.actions.get(name);
    if (!a) {
      a = this.mixer.clipAction(getClip(name));
      if (name === 'pickup') { a.setLoop(THREE.LoopRepeat, Infinity); }
      if (ONCE.has(name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      this.actions.set(name, a);
    }
    return a;
  }

  private transition: string | null = null;
  private transitionEnd = 0;

  private play(clip: string, fade: number) {
    const next = this.get(clip);
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.play();
    const prev = this.current ? this.actions.get(this.current) : null;
    // locomotion to locomotion keeps the stride phase so the feet never skip
    const loco = (c: string) => c.startsWith('walk') || c === 'run' || c === 'carry_walk';
    if (prev && loco(clip) && loco(this.current)) {
      next.time = (prev.time / prev.getClip().duration) * next.getClip().duration;
      fade = 0.3;
    }
    if (prev && prev !== next) next.crossFadeFrom(prev, fade, true);
    this.current = clip;
  }

  /** Decide the clip from authoritative state: an action wins over locomotion. */
  /** this person's way of walking (a clip name), set from who they are and how they are */
  walkStyle = 'walk';

  update(dt: number, speed: number, carrying: boolean, action: string | null) {
    let clip: string;
    let rate = 1;
    if (action) {
      // 'g:<clip>' plays a gesture or feeling directly (waving, shrugging, laughing, crying...)
      clip = action.startsWith('g:') ? action.slice(2) : ACTION_CLIP[action] ?? 'idle';
      if (action === 'attack') rate = 1.7;
    } else if (speed > 2.6) {
      clip = 'run';
      rate = speed / RUN_SPEED_REF;
    } else if (speed > 0.15) {
      clip = carrying ? 'carry_walk' : MOCAP[this.walkStyle] ? this.walkStyle : 'walk';
      const ref = carrying ? CARRY_SPEED_REF : MOCAP[clip]?.speed || WALK_SPEED_REF;
      rate = Math.max(0.5, Math.min(2.2, speed / ref));
    } else {
      clip = carrying ? 'carry_idle' : 'idle';
    }
    // transitions between standing and seated play the captured sit-down / stand-up move first
    const now = this.mixer.time;
    if (this.transition && now >= this.transitionEnd) this.transition = null;
    if (!this.transition && this.current && MOCAP.sit_down && SEATED.has(clip) !== SEATED.has(this.current) && this.current !== 'lie' && clip !== 'lie') {
      this.transition = SEATED.has(clip) ? 'sit_down' : 'stand_up';
      const t = this.get(this.transition);
      t.setLoop(THREE.LoopOnce, 1);
      t.clampWhenFinished = true;
      this.transitionEnd = now + t.getClip().duration * 0.92;
      this.play(this.transition, 0.25);
    }
    if (this.transition) { this.mixer.update(dt); this.state = this.transition; return; }
    if (clip !== this.current) this.play(clip, clip === 'lie' || this.current === 'lie' ? 0.08 : 0.35);
    this.get(clip).timeScale = rate;
    this.state = clip;
    this.mixer.update(dt);
  }
}
