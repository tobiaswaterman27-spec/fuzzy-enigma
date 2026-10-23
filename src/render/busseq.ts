// The bus, acted out. A red double-decker pulls in at the stop, the doors fold open, you step on and it
// pulls away; at the other end it pulls in again and you step off. The ride itself passes in the sim
// (you are away, time running fast); this only draws the bits either side of it.
import * as THREE from 'three';
import type { Person } from '../sim/types';

function doubleDecker(): THREE.Group {
  const g = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: '#c8102e', roughness: 0.45, metalness: 0.2 });
  const glass = new THREE.MeshStandardMaterial({ color: '#1d2a33', roughness: 0.1, metalness: 0.4 });
  const cream = new THREE.MeshStandardMaterial({ color: '#efe6cf', roughness: 0.6 });
  const black = new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.8 });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
  // body along +z (the front)
  add(new THREE.BoxGeometry(2.5, 4.2, 10.6), red, 0, 2.45, 0);
  add(new THREE.BoxGeometry(2.52, 0.9, 10.2), glass, 0, 1.95, -0.1);
  add(new THREE.BoxGeometry(2.52, 0.85, 10.2), glass, 0, 3.6, -0.1);
  add(new THREE.BoxGeometry(2.54, 0.12, 10.62), cream, 0, 2.6, 0);
  add(new THREE.BoxGeometry(2.3, 1.6, 0.06), glass, 0, 2.3, 5.31);
  add(new THREE.BoxGeometry(2.0, 0.4, 0.07), black, 0, 4.25, 5.31);
  for (const [x, z] of [[-1.15, 3.6], [1.15, 3.6], [-1.15, -3.4], [1.15, -3.4]]) { const w = add(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 16), black, x, 0.5, z); w.rotation.z = Math.PI / 2; }
  // the doors on the kerb side, at the front: two panels that fold back
  const doors = new THREE.Group();
  for (const s of [-1, 1]) { const d = add(new THREE.BoxGeometry(0.05, 2.1, 0.55), glass, 0, 0, 0); g.remove(d); d.position.set(0, 1.35, s * 0.28); d.userData.s = s; doors.add(d); }
  doors.position.set(1.27, 0, 3.9);
  doors.name = 'doors';
  g.add(doors);
  // the destination blind
  return g;
}

interface Seq { bus: THREE.Group; t: number; mode: 'board' | 'alight'; stop: { x: number; z: number }; side: number; commit: () => void; done: boolean }
const ease = (t: number) => t * t * (3 - 2 * t);
const c01 = (t: number) => Math.max(0, Math.min(1, t));

export class BusSeq {
  private s: Seq | null = null;
  constructor(private scene: THREE.Scene) {}
  get active() { return !!this.s; }

  /** stop: where you wait; road: +1 if the road is towards +z of the stop, -1 if towards -z */
  start(mode: 'board' | 'alight', stop: { x: number; z: number }, road: number, commit: () => void) {
    this.stop();
    const bus = doubleDecker();
    // driving on the left: along the kerb, doors on the kerb side
    bus.rotation.y = road > 0 ? Math.PI / 2 : -Math.PI / 2;
    this.scene.add(bus);
    this.s = { bus, t: 0, mode, stop: { ...stop }, side: road, commit, done: false };
    this.place(0);
  }
  stop() { if (this.s) { this.scene.remove(this.s.bus); this.s = null; } }

  /** where the bus is at a given point of its approach (u = -1 far back, 0 at the stop, +1 well gone) */
  private place(u: number) {
    const s = this.s!;
    const along = s.side > 0 ? 1 : -1; // the way it travels along x
    s.bus.position.set(s.stop.x - 3.9 * along + u * 45 * along, 0, s.stop.z + s.side * 2.6);
  }
  doorAt() { const s = this.s!; return { x: s.stop.x, z: s.stop.z + s.side * 1.1 }; }

  update(dt: number, p: Person): boolean {
    const s = this.s;
    if (!s) return false;
    s.t += dt;
    const t = s.t;
    const doors = s.bus.getObjectByName('doors')!;
    let open = 0;
    // in (0-2.6 s), doors open (2.6-3.0), step on or off (3.0-4.0), doors shut (4.0-4.4), away (4.4-7)
    if (t < 2.6) this.place(-(1 - ease(t / 2.6)));
    else if (t < 4.4) { this.place(0); open = t < 3.0 ? (t - 2.6) / 0.4 : t < 4.0 ? 1 : 1 - (t - 4.0) / 0.4; }
    else this.place(((t - 4.4) / 2.6) ** 2);
    for (const d of doors.children) d.rotation.y = d.userData.s * open * 1.3;
    const door = this.doorAt();
    if (s.mode === 'board') {
      if (t > 3.0 && t < 4.0) { const k = ease(c01((t - 3.0) / 0.9)); p.pos = { x: s.stop.x + (door.x - s.stop.x) * k, z: s.stop.z + (door.z - s.stop.z) * k }; p.facing = Math.atan2(door.x - s.stop.x, door.z - s.stop.z); }
      if (t >= 4.0 && !s.done) { s.done = true; s.commit(); }
    } else {
      if (t < 3.0) { p.visible = false; }
      else if (t < 4.0) { p.visible = true; const k = ease(c01((t - 3.0) / 0.9)); p.pos = { x: door.x + (s.stop.x - door.x) * k, z: door.z + (s.stop.z - door.z) * k }; p.facing = Math.atan2(s.stop.x - door.x, s.stop.z - door.z); }
      if (!s.done && t >= 4.0) { s.done = true; s.commit(); }
    }
    if (t > 7) { this.stop(); return false; }
    return true;
  }
}
