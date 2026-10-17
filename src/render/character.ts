// CharacterAppearance + AnimationController.
// A procedural, articulated low-poly figure. Every body variation, hairstyle
// and outfit shares the same joint hierarchy, so every animation clip works
// for every character and clothing never needs separate skinning (no clipping
// between incompatible meshes by construction).
import * as THREE from 'three';
import type { Appearance } from '../sim/types';

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

const BUILD_SCALE = { slim: 0.88, average: 1, broad: 1.16 } as const;

// --------------------------------------------------------------- materials
const matCache = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, rough = 0.85): THREE.MeshStandardMaterial {
  const k = `${color}|${rough}`;
  let m = matCache.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 }); matCache.set(k, m); }
  return m;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function capsule(r: number, len: number) {
  const k = `c${r}|${len}`;
  let g = geoCache.get(k);
  if (!g) { g = new THREE.CapsuleGeometry(r, len, 4, 10); geoCache.set(k, g); }
  return g;
}
function boxG(w: number, h: number, d: number) {
  const k = `b${w}|${h}|${d}`;
  let g = geoCache.get(k);
  if (!g) { g = new THREE.BoxGeometry(w, h, d); geoCache.set(k, g); }
  return g;
}
function sphereG(r: number, ws = 12, hs = 10) {
  const k = `s${r}|${ws}`;
  let g = geoCache.get(k);
  if (!g) { g = new THREE.SphereGeometry(r, ws, hs); geoCache.set(k, g); }
  return g;
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = false;
  return o;
}

// --------------------------------------------------------------- rig
export const BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'] as const;
export type BoneName = (typeof BONES)[number];

export interface Rig {
  root: THREE.Group; // positioned at the feet, rotated to face
  body: THREE.Group; // scaled for height; lies down for sleeping
  bones: Record<BoneName, THREE.Object3D>;
  /** attachment points */
  carry: THREE.Object3D;
  toolR: THREE.Object3D;
}

function bone(name: string, parent: THREE.Object3D, x: number, y: number, z: number) {
  const b = new THREE.Object3D();
  b.name = name;
  b.position.set(x, y, z);
  parent.add(b);
  return b;
}

export function buildRig(a: Appearance): Rig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(a.height);
  root.add(body);
  const w = BUILD_SCALE[a.build];
  const B = {} as Record<BoneName, THREE.Object3D>;
  B.hips = bone('hips', body, 0, 0.95, 0);
  B.spine = bone('spine', B.hips, 0, 0.1, 0);
  B.chest = bone('chest', B.spine, 0, 0.24, 0);
  B.neck = bone('neck', B.chest, 0, 0.24, 0);
  B.head = bone('head', B.neck, 0, 0.08, 0);
  B.armL = bone('armL', B.chest, 0.2 * w, 0.18, 0);
  B.foreL = bone('foreL', B.armL, 0, -0.3, 0);
  B.handL = bone('handL', B.foreL, 0, -0.27, 0);
  B.armR = bone('armR', B.chest, -0.2 * w, 0.18, 0);
  B.foreR = bone('foreR', B.armR, 0, -0.3, 0);
  B.handR = bone('handR', B.foreR, 0, -0.27, 0);
  B.thighL = bone('thighL', B.hips, 0.1 * w, -0.04, 0);
  B.shinL = bone('shinL', B.thighL, 0, -0.44, 0);
  B.footL = bone('footL', B.shinL, 0, -0.44, 0);
  B.thighR = bone('thighR', B.hips, -0.1 * w, -0.04, 0);
  B.shinR = bone('shinR', B.thighR, 0, -0.44, 0);
  B.footR = bone('footR', B.shinR, 0, -0.44, 0);
  const carry = bone('carry', B.chest, 0, -0.02, 0.36);
  const toolR = bone('toolR', B.handR, 0, -0.04, 0.02);
  const rig: Rig = { root, body, bones: B, carry, toolR };
  dress(rig, a);
  return rig;
}

/** (re)build all visible meshes for an appearance; bones and animation state are untouched */
export function dress(rig: Rig, a: Appearance) {
  const B = rig.bones;
  for (const name of BONES) {
    const b = B[name];
    for (const c of [...b.children]) if ((c as THREE.Mesh).isMesh || c.userData.dressing) b.remove(c);
  }
  const w = BUILD_SCALE[a.build];
  const o = OUTFITS[a.outfit] ?? OUTFITS.outfit_casual;
  const skin = mat(a.skin, 0.7);
  const top = mat(o.top);
  const bottom = mat(o.bottom);
  const shoe = mat(o.shoes, 0.6);
  const hair = mat(a.hairColor, 0.9);

  // torso & pelvis
  B.hips.add(mesh(boxG(0.34 * w, 0.2, 0.2 * w), bottom, 0, 0.02, 0));
  B.spine.add(mesh(boxG(0.33 * w, 0.26, 0.2 * w), top, 0, 0.12, 0));
  const chest = mesh(boxG(0.4 * w, 0.28, 0.23 * w), top, 0, 0.11, 0);
  B.chest.add(chest);
  B.neck.add(mesh(capsule(0.05, 0.06), skin, 0, 0.03, 0));
  // head
  const headM = mesh(boxG(0.2, 0.24, 0.22), skin, 0, 0.12, 0.005);
  B.head.add(headM);
  const eyeM = mat('#1d1d1d', 0.4);
  B.head.add(mesh(sphereG(0.018, 8, 6), eyeM, 0.05, 0.15, 0.112));
  B.head.add(mesh(sphereG(0.018, 8, 6), eyeM, -0.05, 0.15, 0.112));
  B.head.add(mesh(boxG(0.035, 0.05, 0.04), skin, 0, 0.1, 0.12));
  B.head.add(mesh(boxG(0.07, 0.012, 0.01), mat('#8a4b45', 0.6), 0, 0.05, 0.112));
  // hair
  switch (a.hair) {
    case 'short':
      B.head.add(mesh(boxG(0.215, 0.07, 0.235), hair, 0, 0.255, 0));
      B.head.add(mesh(boxG(0.215, 0.12, 0.05), hair, 0, 0.2, -0.1));
      break;
    case 'long':
      B.head.add(mesh(boxG(0.225, 0.08, 0.24), hair, 0, 0.255, 0));
      B.head.add(mesh(boxG(0.23, 0.32, 0.06), hair, 0, 0.1, -0.11));
      B.head.add(mesh(boxG(0.03, 0.22, 0.2), hair, 0.115, 0.14, -0.01));
      B.head.add(mesh(boxG(0.03, 0.22, 0.2), hair, -0.115, 0.14, -0.01));
      break;
    case 'bun':
      B.head.add(mesh(boxG(0.215, 0.07, 0.235), hair, 0, 0.255, 0));
      B.head.add(mesh(sphereG(0.07), hair, 0, 0.27, -0.12));
      break;
    case 'curly':
      for (const [x, z] of [[-0.07, 0.05], [0.07, 0.05], [0, -0.05], [-0.08, -0.07], [0.08, -0.07], [0, 0.07]]) B.head.add(mesh(sphereG(0.075, 8, 6), hair, x, 0.25, z));
      break;
    case 'bald':
      break;
  }
  // arms: sleeves in top colour, forearms skin unless long-sleeved shirt
  const longSleeve = o.kind === 'shirt' || o.kind === 'hivis';
  for (const [arm, fore, hand] of [[B.armL, B.foreL, B.handL], [B.armR, B.foreR, B.handR]] as const) {
    arm.add(mesh(capsule(0.055 * w, 0.2), top, 0, -0.15, 0));
    fore.add(mesh(capsule(0.047 * w, 0.18), longSleeve ? top : skin, 0, -0.13, 0));
    hand.add(mesh(boxG(0.07, 0.09, 0.04), skin, 0, -0.04, 0));
  }
  // legs
  for (const [thigh, shin, foot] of [[B.thighL, B.shinL, B.footL], [B.thighR, B.shinR, B.footR]] as const) {
    thigh.add(mesh(capsule(0.075 * w, 0.3), bottom, 0, -0.22, 0));
    shin.add(mesh(capsule(0.062 * w, 0.32), bottom, 0, -0.22, 0));
    foot.add(mesh(boxG(0.1, 0.07, 0.24), shoe, 0, -0.01, 0.05));
  }
  // outfit details layered on the same bones
  if (o.kind === 'polo_apron' || o.kind === 'apron') {
    const ap = mat(o.accent ?? '#333', 0.9);
    B.chest.add(mesh(boxG(0.34 * w, 0.26, 0.02), ap, 0, 0.08, 0.125 * w));
    B.spine.add(mesh(boxG(0.32 * w, 0.28, 0.02), ap, 0, 0.1, 0.11 * w));
    B.hips.add(mesh(boxG(0.32 * w, 0.3, 0.02), ap, 0, -0.08, 0.11 * w));
    if (o.kind === 'polo_apron') {
      const badge = mesh(boxG(0.06, 0.03, 0.01), mat('#f1f1f1', 0.5), 0.09 * w, 0.17, 0.137 * w);
      B.chest.add(badge);
    }
  } else if (o.kind === 'hivis') {
    const v = mat(o.accent!, 0.55);
    const stripe = mat('#d8d8d8', 0.3);
    B.chest.add(mesh(boxG(0.41 * w, 0.29, 0.24 * w), v, 0, 0.11, 0));
    B.spine.add(mesh(boxG(0.34 * w, 0.27, 0.21 * w), v, 0, 0.12, 0));
    B.spine.add(mesh(boxG(0.345 * w, 0.035, 0.215 * w), stripe, 0, 0.06, 0));
    B.chest.add(mesh(boxG(0.415 * w, 0.035, 0.245 * w), stripe, 0, 0.02, 0));
  } else if (o.kind === 'shirt') {
    B.chest.add(mesh(boxG(0.04, 0.22, 0.01), mat(o.accent!, 0.6), 0, 0.09, 0.118 * w));
  }
  for (const name of BONES) for (const c of B[name].children) if ((c as THREE.Mesh).isMesh) c.userData.dressing = true;
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
  eat: { dur: 1.8, bones: { armR: [[0, -0.3, 0, -0.1], [0.4, -0.7, 0, -0.2], [0.6, -0.7, 0, -0.2], [1, -0.3, 0, -0.1]], foreR: [[0, -0.6, 0, 0], [0.4, -2.1, 0, 0], [0.6, -2.1, 0, 0], [1, -0.6, 0, 0]], armL: still(-0.5, 0, 0.1), foreL: still(-1.0), head: [[0, 0.1, 0, 0], [0.5, -0.05, 0, 0], [1, 0.1, 0, 0]] } },
  sit: { dur: 3, bones: { thighL: still(-1.5, 0, 0.05), thighR: still(-1.5, 0, -0.05), shinL: still(1.5), shinR: still(1.5), armL: still(-0.4, 0, 0.1), armR: still(-0.4, 0, -0.1), foreL: still(-0.6), foreR: still(-0.6), spine: [[0, -0.05, 0, 0], [0.5, -0.02, 0, 0], [1, -0.05, 0, 0]] }, hipsY: [[0, 0.5], [1, 0.5]] },
  lie: { dur: 4, bones: { armL: still(0, 0, 0.12), armR: still(0, 0, -0.12), spine: [[0, 0, 0, 0], [0.5, 0.04, 0, 0], [1, 0, 0, 0]], head: still(-0.1, 0.3, 0) } },
  talk: { dur: 2.2, bones: { armR: [[0, -0.2, 0, -0.1], [0.3, -0.7, 0.2, -0.3], [0.6, -0.4, 0, -0.2], [1, -0.2, 0, -0.1]], foreR: [[0, -0.3, 0, 0], [0.3, -1.2, 0, 0], [0.6, -0.8, 0, 0], [1, -0.3, 0, 0]], armL: still(0, 0, 0.08), head: [[0, 0, 0, 0], [0.4, 0.08, 0.1, 0], [1, 0, 0, 0]] } },
  clipboard: { dur: 1.2, bones: { armL: still(-0.8, 0, 0.1), foreL: still(-0.9, 0.4, 0), armR: [[0, -0.7, 0, -0.1], [0.5, -0.85, 0.15, -0.1], [1, -0.7, 0, -0.1]], foreR: still(-1.0, -0.3, 0), head: [[0, 0.35, 0, 0], [0.5, 0.2, 0.2, 0], [1, 0.35, 0, 0]] } },
};

const CLIPS: Record<string, THREE.AnimationClip> = {};
export function getClip(name: string): THREE.AnimationClip {
  if (!CLIPS[name]) CLIPS[name] = makeClip(name, full(CLIP_DEFS[name]));
  return CLIPS[name];
}

// --------------------------------------------------------------- controller
/** which clip presents which simulation action (presentation only) */
export const ACTION_CLIP: Record<string, string> = {
  clock_in: 'type', clock_out: 'type', take_case: 'pickup', return_case: 'pickup', stock_shelf: 'stock',
  serve_customer: 'scan', self_checkout: 'scan', take_mop: 'pickup', return_mop: 'pickup', clean: 'mop',
  check_in_delivery: 'clipboard', pick_item: 'stock', sleep: 'lie', eat: 'eat', store_food: 'stock',
  change_outfit: 'pickup', buy_meal: 'eat', sit: 'sit', talk: 'talk',
};

export const WALK_SPEED_REF = 1.5; // m/s the walk clip is authored for
export const RUN_SPEED_REF = 4.2;

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
      this.actions.set(name, a);
    }
    return a;
  }

  /** Decide the clip from authoritative state: an action wins over locomotion. */
  update(dt: number, speed: number, carrying: boolean, action: string | null) {
    let clip: string;
    let rate = 1;
    if (action) {
      clip = ACTION_CLIP[action] ?? 'idle';
    } else if (speed > 2.6) {
      clip = 'run';
      rate = speed / RUN_SPEED_REF;
    } else if (speed > 0.15) {
      clip = carrying ? 'carry_walk' : 'walk';
      rate = Math.max(0.5, speed / WALK_SPEED_REF);
    } else {
      clip = carrying ? 'carry_idle' : 'idle';
    }
    if (clip !== this.current) {
      const next = this.get(clip);
      next.reset();
      next.enabled = true;
      next.setEffectiveWeight(1);
      next.play();
      const prev = this.current ? this.actions.get(this.current) : null;
      if (prev) next.crossFadeFrom(prev, clip === 'lie' || this.current === 'lie' ? 0.05 : 0.22, false);
      this.current = clip;
    }
    this.get(clip).timeScale = rate;
    this.state = clip;
    this.mixer.update(dt);
  }
}
