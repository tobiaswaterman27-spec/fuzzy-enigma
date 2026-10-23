// Pigeons: little flocks pecking about round the benches and fountains. They hop out of the way of
// people walking through, and go up all at once in a clatter of wings if you run or drive at them,
// circle for a bit and come back down when it is quiet. Pure decoration, render side only.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getWorld } from '../sim/world/layout';

const MAX = 72;
type Mode = 'ground' | 'fly' | 'land';
interface Bird { x: number; y: number; z: number; h: number; vx: number; vy: number; vz: number; mode: Mode; next: number; peck: number; flap: number; hx: number; hz: number; tint: number }
interface Flock { x: number; z: number; birds: Bird[]; scared: number }

function bodyGeo() {
  const body = new THREE.SphereGeometry(0.11, 8, 6); body.scale(0.85, 0.8, 1.45); body.translate(0, 0.13, 0);
  const tail = new THREE.BoxGeometry(0.1, 0.02, 0.12); tail.translate(0, 0.14, -0.2);
  const legs = new THREE.CylinderGeometry(0.008, 0.008, 0.06, 4); legs.translate(0, 0.03, 0.02);
  return mergeGeometries([body, tail, legs])!;
}
function headGeo() { const h = new THREE.SphereGeometry(0.055, 8, 6); const beak = new THREE.ConeGeometry(0.015, 0.04, 4); beak.rotateX(Math.PI / 2); beak.translate(0, -0.005, 0.06); return mergeGeometries([h, beak])!; }
function wingGeo() { const w = new THREE.BoxGeometry(0.2, 0.012, 0.14); w.translate(0.1, 0, 0); return w; }

export class Pigeons {
  private flocks: Flock[] = [];
  private body: THREE.InstancedMesh; private head: THREE.InstancedMesh; private wings: THREE.InstancedMesh;
  private spots: { x: number; z: number }[] | null = null;
  private lastPick = -1e9;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(0, 0, 0, 'YXZ'); private v = new THREE.Vector3(); private one = new THREE.Vector3(1, 1, 1);
  /** how many birds went up this frame (for the sound of wings) */
  flushed = 0;

  constructor(scene: THREE.Scene) {
    const grey = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 });
    this.body = new THREE.InstancedMesh(bodyGeo(), grey, MAX);
    this.head = new THREE.InstancedMesh(headGeo(), new THREE.MeshStandardMaterial({ color: '#4a5560', roughness: 0.8 }), MAX);
    this.wings = new THREE.InstancedMesh(wingGeo(), new THREE.MeshStandardMaterial({ color: '#5f6973', roughness: 0.9 }), MAX * 2);
    const c = new THREE.Color();
    for (let i = 0; i < MAX; i++) this.body.setColorAt(i, c.setHSL(0.6, 0.06 + (i % 3) * 0.03, 0.1 + ((i * 37) % 11) / 80));
    for (const o of [this.body, this.head, this.wings]) { o.count = 0; o.frustumCulled = false; o.castShadow = false; scene.add(o); }
  }

  private pickSpots() {
    if (!this.spots) this.spots = getWorld().city.props.filter((p) => p.kind === 'bench' || p.kind === 'fountain').map((p, i) => ({ x: p.x + (p.kind === 'bench' ? Math.cos(p.rot) * 2.5 : 4) + (i % 3) - 1, z: p.z + (p.kind === 'bench' ? -Math.sin(p.rot) * 2.5 : 1) }));
    return this.spots;
  }

  private spawn(x: number, z: number): Flock {
    const birds: Bird[] = [];
    const n = 5 + Math.floor(Math.random() * 6);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 2.2;
      birds.push({ x: x + Math.cos(a) * r, y: 0, z: z + Math.sin(a) * r, h: Math.random() * 6.3, vx: 0, vy: 0, vz: 0, mode: 'ground', next: 0, peck: Math.random() * 5, flap: 0, hx: x, hz: z, tint: i });
    }
    return { x, z, birds, scared: 0 };
  }

  /** threats: things moving about (the player, anyone walking, cars), with how fast they are going */
  update(dt: number, threats: { x: number; z: number; speed: number; car?: boolean }[], at: { x: number; z: number }, visible: boolean) {
    this.flushed = 0;
    const t = performance.now() / 1000;
    // keep a few flocks at the benches near you, drop the ones well behind
    if (t - this.lastPick > 3) {
      this.lastPick = t;
      this.flocks = this.flocks.filter((f) => Math.hypot(f.x - at.x, f.z - at.z) < 110);
      const near = this.pickSpots().filter((s) => Math.hypot(s.x - at.x, s.z - at.z) < 80).sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z));
      for (const s of near) {
        if (this.flocks.reduce((n, f) => n + f.birds.length, 0) > MAX - 10) break;
        if (this.flocks.some((f) => Math.hypot(f.x - s.x, f.z - s.z) < 14)) continue;
        // not every bench has its birds
        if (((Math.floor(s.x) * 7 + Math.floor(s.z) * 13) & 3) === 0) continue;
        this.flocks.push(this.spawn(s.x, s.z));
      }
    }
    let i = 0, w = 0;
    for (const f of this.flocks) {
      // anything coming at the flock fast, or right through it, puts the lot up
      let panic = false;
      for (const th of threats) {
        const d = Math.hypot(th.x - f.x, th.z - f.z);
        if (d < (th.car ? 9 : 4.2) && th.speed > (th.car ? 2 : 3.2)) panic = true;
      }
      if (panic && t - f.scared > 2) { f.scared = t; for (const b of f.birds) if (b.mode !== 'fly') { b.mode = 'fly'; b.next = t + 6 + Math.random() * 6; const a = Math.atan2(b.z - f.z, b.x - f.x) + (Math.random() - 0.5); b.vx = Math.cos(a) * 4; b.vz = Math.sin(a) * 4; b.vy = 3 + Math.random() * 2; this.flushed++; } }
      for (const b of f.birds) {
        if (b.mode === 'ground') {
          // walk about pecking; step aside from feet
          for (const th of threats) {
            const dx = b.x - th.x, dz = b.z - th.z, d = Math.hypot(dx, dz);
            if (d < 1.3 && d > 0.01) { b.vx += dx / d * 3 * dt * 6; b.vz += dz / d * 3 * dt * 6; b.flap = t + 0.3; if (d < 0.6) { b.vy = 1.6; b.flap = t + 0.6; } }
          }
          if (t > b.next) {
            b.next = t + 0.8 + Math.random() * 2.5;
            const back = Math.hypot(b.x - f.x, b.z - f.z) > 2.8;
            const a = back ? Math.atan2(f.z - b.z, f.x - b.x) : Math.random() * Math.PI * 2;
            const s = 0.35 + Math.random() * 0.3; b.vx = Math.cos(a) * s; b.vz = Math.sin(a) * s;
            if (Math.random() < 0.4) { b.vx = b.vz = 0; }
          }
          b.vx *= 1 - Math.min(1, dt * 1.5); b.vz *= 1 - Math.min(1, dt * 1.5);
          b.vy -= 9.8 * dt; b.y = Math.max(0, b.y + b.vy * dt); if (b.y === 0) b.vy = Math.max(0, b.vy);
        } else if (b.mode === 'fly') {
          // up and round in a loose circle over the spot
          const a = Math.atan2(b.z - f.z, b.x - f.x) + 0.9;
          const tx = f.x + Math.cos(a) * 12, tz = f.z + Math.sin(a) * 12, ty = 7 + (b.tint % 4);
          b.vx += (tx - b.x - b.vx) * dt * 0.9; b.vz += (tz - b.z - b.vz) * dt * 0.9; b.vy += (ty - b.y - b.vy) * dt * 1.2;
          b.y += b.vy * dt; b.flap = t + 1;
          if (t > b.next && t - f.scared > 8) b.mode = 'land';
        } else {
          // glide back down to the spot
          const tx = f.x + Math.cos(b.tint * 2.4) * 1.6, tz = f.z + Math.sin(b.tint * 2.4) * 1.6;
          b.vx += (tx - b.x - b.vx * 1.5) * dt * 1.4; b.vz += (tz - b.z - b.vz * 1.5) * dt * 1.4; b.vy += (-b.y * 0.8 - b.vy) * dt * 2;
          b.y = Math.max(0, b.y + b.vy * dt); b.flap = b.y > 0.6 ? t + 0.2 : b.flap;
          if (b.y < 0.05 && Math.hypot(tx - b.x, tz - b.z) < 1.2) { b.mode = 'ground'; b.y = 0; b.vx = b.vz = b.vy = 0; }
        }
        b.x += b.vx * dt; b.z += b.vz * dt;
        if (Math.hypot(b.vx, b.vz) > 0.15) b.h += (((Math.atan2(b.vx, b.vz) - b.h + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 8);
        if (i >= MAX) continue;
        // draw: body pitched up in flight, the head bobbing down to peck on the ground
        const flying = b.mode !== 'ground' || b.y > 0.1;
        const pecking = !flying && Math.hypot(b.vx, b.vz) < 0.1 && Math.sin(t * 3 + b.peck) > 0.4;
        const walkBob = !flying && Math.hypot(b.vx, b.vz) > 0.1 ? Math.sin(t * 18 + b.peck) * 0.025 : 0;
        this.e.set(flying ? -0.25 : 0, b.h, 0); this.q.setFromEuler(this.e);
        this.m.compose(this.v.set(b.x, b.y, b.z), this.q, this.one); this.body.setMatrixAt(i, this.m);
        const hz = pecking ? 0.19 : 0.15 + walkBob, hy = pecking ? 0.07 : flying ? 0.19 : 0.23;
        this.v.set(Math.sin(b.h) * hz, hy, Math.cos(b.h) * hz).add({ x: b.x, y: b.y, z: b.z } as THREE.Vector3);
        this.e.set(pecking ? 0.9 : 0, b.h, 0); this.q.setFromEuler(this.e); this.m.compose(this.v, this.q, this.one); this.head.setMatrixAt(i, this.m);
        const beat = t < b.flap ? Math.sin(t * 38 + b.peck) * 1.1 : 0;
        for (const side of [-1, 1]) {
          const open = flying || t < b.flap;
          // folded, the wings lie back along the body; open, they beat
          if (open) this.e.set(0, b.h + (side < 0 ? Math.PI : 0), beat); else this.e.set(0, b.h + Math.PI / 2 + side * 0.1, side * 0.06);
          this.q.setFromEuler(this.e);
          this.v.set(side * Math.cos(b.h) * (open ? 0.06 : 0.045), b.y + (open ? 0.17 : 0.19), -side * Math.sin(b.h) * (open ? 0.06 : 0.045)).add({ x: b.x, y: 0, z: b.z } as THREE.Vector3);
          this.m.compose(this.v, this.q, this.one); this.wings.setMatrixAt(w++, this.m);
        }
        i++;
      }
    }
    this.body.count = this.head.count = i; this.wings.count = w;
    for (const o of [this.body, this.head, this.wings]) { o.visible = visible && i > 0; o.instanceMatrix.needsUpdate = true; }
  }
}
