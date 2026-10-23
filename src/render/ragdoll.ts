// A ragdoll for anyone knocked off their feet: the body's joints become particles joined by sticks
// (verlet integration, the bones are the sticks, the torso is braced so it stays in one piece), thrown
// the way the blow came from and left to fall under gravity onto the ground. Each frame the skeleton's
// bones are turned to point along the sticks, so the skinned body follows. After a few seconds it
// settles and stops simulating.
import * as THREE from 'three';
import type { Rig } from './character';

type P = 'hips' | 'spine' | 'chest' | 'neck' | 'head' | 'armL' | 'foreL' | 'handL' | 'armR' | 'foreR' | 'handR' | 'thighL' | 'shinL' | 'footL' | 'thighR' | 'shinR' | 'footR' | 'headTop' | 'toeL' | 'toeR';
const BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'] as const;
const PARENT: Partial<Record<P, P>> = { spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck', headTop: 'head', armL: 'chest', foreL: 'armL', handL: 'foreL', armR: 'chest', foreR: 'armR', handR: 'foreR', thighL: 'hips', shinL: 'thighL', footL: 'shinL', toeL: 'footL', thighR: 'hips', shinR: 'thighR', footR: 'shinR', toeR: 'footR' };
const TORSO: P[] = ['hips', 'spine', 'chest', 'neck', 'armL', 'armR', 'thighL', 'thighR'];
/** bone -> the particle it points at */
const AIM: [string, P][] = [['neck', 'head'], ['head', 'headTop'], ['armL', 'foreL'], ['foreL', 'handL'], ['armR', 'foreR'], ['foreR', 'handR'], ['thighL', 'shinL'], ['shinL', 'footL'], ['footL', 'toeL'], ['thighR', 'shinR'], ['shinR', 'footR'], ['footR', 'toeR']];
const RADIUS: Partial<Record<P, number>> = { head: 0.1, headTop: 0.08, chest: 0.12, spine: 0.11, hips: 0.11, neck: 0.07 };

const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();

export class Ragdoll {
  private pos = new Map<P, THREE.Vector3>();
  private prev = new Map<P, THREE.Vector3>();
  private sticks: [P, P, number][] = [];
  private restDir = new Map<string, THREE.Vector3>();
  private t = 0;
  private acc = 0;
  settled = false;

  /** dir: the way the blow was travelling (world, horizontal); force in m/s */
  constructor(private rig: Rig, private ground: number, dir: THREE.Vector3, force: number) {
    rig.root.updateMatrixWorld(true);
    const J = rig.joints!;
    for (const n of BONES) this.pos.set(n, rig.bones[n].getWorldPosition(new THREE.Vector3()));
    // the points past the end of the head and feet, so those bones have something to aim at
    const headQ = rig.bones.head.getWorldQuaternion(new THREE.Quaternion());
    this.pos.set('headTop', this.pos.get('head')!.clone().add(new THREE.Vector3(0, 0.2, 0).applyQuaternion(headQ)));
    for (const s of ['L', 'R'] as const) {
      const fq = rig.bones[`foot${s}`].getWorldQuaternion(new THREE.Quaternion());
      this.pos.set(`toe${s}`, this.pos.get(`foot${s}`)!.clone().add(new THREE.Vector3(0, -0.05, 0.16).applyQuaternion(fq)));
    }
    // rest directions in body space (all bones' rest rotations are identity)
    for (const [b, c] of AIM) this.restDir.set(b, c === 'headTop' ? new THREE.Vector3(0, 1, 0) : c.startsWith('toe') ? new THREE.Vector3(0, -0.3, 1).normalize() : J[c].clone().sub(J[b]).normalize());
    // sticks: every bone to its parent, and the torso braced corner to corner
    for (const [c, p] of Object.entries(PARENT) as [P, P][]) this.sticks.push([c, p, this.pos.get(c)!.distanceTo(this.pos.get(p)!)]);
    for (let i = 0; i < TORSO.length; i++) for (let j = i + 1; j < TORSO.length; j++) this.sticks.push([TORSO[i], TORSO[j], this.pos.get(TORSO[i])!.distanceTo(this.pos.get(TORSO[j])!)]);
    // the head stays on the shoulders
    this.sticks.push(['headTop', 'chest', this.pos.get('headTop')!.distanceTo(this.pos.get('chest')!)]);
    // the blow: the top half goes with it, the knees give way
    const h = dir.clone().setY(0).normalize();
    for (const [n, p] of this.pos) {
      const w = n === 'head' || n === 'headTop' || n === 'neck' ? 1.15 : n === 'chest' || n.startsWith('arm') || n.startsWith('fore') || n.startsWith('hand') ? 1 : n === 'spine' ? 0.7 : n === 'hips' ? 0.45 : n.startsWith('shin') ? -0.25 : 0;
      const v = h.clone().multiplyScalar(force * w * (0.9 + Math.random() * 0.2));
      v.y += n === 'hips' || n === 'spine' ? -0.6 : 0.3 * w;
      this.prev.set(n, p.clone().sub(v.multiplyScalar(1 / 60)));
    }
  }

  step(dt: number) {
    if (this.settled) return;
    this.acc += Math.min(dt, 0.1);
    const h = 1 / 60;
    while (this.acc >= h) { this.acc -= h; this.sub(h); }
    this.t += dt;
    if (this.t > 3.5) this.settled = true;
  }

  private sub(h: number) {
    const g = -9.8 * h * h;
    for (const [n, p] of this.pos) {
      const q = this.prev.get(n)!;
      _v.copy(p).sub(q).multiplyScalar(0.985);
      q.copy(p);
      p.add(_v);
      p.y += g;
    }
    for (let it = 0; it < 10; it++) {
      for (const [a, b, len] of this.sticks) {
        const pa = this.pos.get(a)!, pb = this.pos.get(b)!;
        _v.copy(pb).sub(pa);
        const d = _v.length() || 1e-6;
        _v.multiplyScalar((d - len) / d * 0.5);
        pa.add(_v); pb.sub(_v);
      }
      // the ground, with friction
      for (const [n, p] of this.pos) {
        const r = RADIUS[n] ?? 0.05, floor = this.ground + r;
        if (p.y < floor) {
          p.y = floor;
          const q = this.prev.get(n)!;
          q.x = p.x - (p.x - q.x) * 0.55; q.z = p.z - (p.z - q.z) * 0.55;
        }
      }
    }
  }

  /** turn the skeleton to match the particles (after the animation mixer has posed it) */
  apply() {
    const B = this.rig.bones, P = this.pos;
    // hips: a frame from the torso's up (hips to chest) and across (right thigh to left)
    const up = _a.copy(P.get('chest')!).sub(P.get('hips')!).normalize();
    const across = _b.copy(P.get('thighL')!).sub(P.get('thighR')!);
    across.addScaledVector(up, -across.dot(up)).normalize();
    const fwd = new THREE.Vector3().crossVectors(across, up);
    _m.makeBasis(across, up, fwd);
    _q.setFromRotationMatrix(_m);
    const hips = B.hips;
    hips.parent!.updateWorldMatrix(true, false);
    hips.parent!.getWorldQuaternion(_q2);
    hips.quaternion.copy(_q2.invert().multiply(_q));
    hips.position.copy(hips.parent!.worldToLocal(P.get('hips')!.clone()));
    // the torso rides on the hips, the chest turned to follow the shoulders
    B.spine.quaternion.identity();
    hips.updateWorldMatrix(false, true);
    const up2 = _a.copy(P.get('neck')!).sub(P.get('chest')!).normalize();
    const across2 = _b.copy(P.get('armL')!).sub(P.get('armR')!);
    across2.addScaledVector(up2, -across2.dot(up2)).normalize();
    _m.makeBasis(across2, up2, new THREE.Vector3().crossVectors(across2, up2));
    _q.setFromRotationMatrix(_m);
    B.spine.getWorldQuaternion(_q2);
    B.chest.quaternion.copy(_q2.invert().multiply(_q));
    B.chest.updateWorldMatrix(false, true);
    // limbs and head: each bone turned (the shortest way) to point at the next joint
    for (const [b, c] of AIM) {
      const bone = (B as Record<string, THREE.Object3D>)[b];
      bone.quaternion.identity();
      bone.updateWorldMatrix(true, false);
      bone.getWorldQuaternion(_q2);
      const now = this.restDir.get(b)!.clone().applyQuaternion(_q2);
      const want = _v.copy(P.get(c)!).sub(P.get(b as P)!).normalize();
      _q.setFromUnitVectors(now, want);
      // local = parent^-1 * delta * parent (the bone's world turn, expressed under its parent)
      const pq = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
      bone.quaternion.copy(pq.clone().invert().multiply(_q).multiply(pq).multiply(bone.quaternion));
      bone.updateWorldMatrix(false, true);
    }
    for (const n of ['handL', 'handR'] as const) B[n].quaternion.identity();
  }

  /** where the body has ended up (for standing up there) */
  hipsAt() { return this.pos.get('hips')!.clone(); }
}
