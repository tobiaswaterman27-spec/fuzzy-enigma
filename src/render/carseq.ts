// Getting into and out of a car, acted out: walk round to the driver's door (on the right, this being
// Britain), reach for the handle, the door swings open on its front hinge, you climb in and pull it
// shut; getting out is the same the other way round. The car models are one piece, so the door is a
// panel in the car's paint laid over its side for the length of the sequence. The sim only changes
// state at one moment (`commit`), so the player stays where the game thinks they are.
import * as THREE from 'three';
import type { Person } from '../sim/types';

export type SeqMode = 'in' | 'out';
interface Seq {
  mode: SeqMode;
  /** stands where the car is, so the door stays put even if the car's own mesh is swapped mid-way */
  holder: THREE.Group;
  door: THREE.Group;
  t: number;
  /** where the car is and which way it faces (world) */
  x: number; z: number; heading: number;
  from: { x: number; z: number };
  commit: () => void;
  committed: boolean;
  smash: boolean;
}

/** car-local spots, front along +z, the driver's side at -x */
const SIDE = -1;
const DOOR_SPOT = { x: SIDE * 1.35, z: 0.15 };
const SEAT = { x: SIDE * 0.42, z: 0.1 };
const HINGE = { x: SIDE * 0.93, z: 0.98 };

function doorPanel(color: string): THREE.Group {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: '#1f2a33', roughness: 0.08, metalness: 0.6, transparent: true, opacity: 0.7 });
  const trim = new THREE.MeshStandardMaterial({ color: '#2a2a2a', roughness: 0.7 });
  const lower = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.55, 1.08), paint); lower.position.set(0, 0.72, -0.54);
  const win = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.38, 0.95), glass); win.position.set(0, 1.2, -0.58);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 1.0), trim); frame.position.set(0, 1.4, -0.56);
  const inner = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.5, 1.0), new THREE.MeshStandardMaterial({ color: '#3a3a3a', roughness: 0.9 })); inner.position.set(-SIDE * 0.045, 0.74, -0.54);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.16), trim); handle.position.set(SIDE * 0.045, 0.92, -0.85);
  for (const m of [lower, win, frame, inner, handle]) { m.castShadow = true; g.add(m); }
  g.position.set(HINGE.x, 0, HINGE.z);
  return g;
}

const ease = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

export class CarSeq {
  private s: Seq | null = null;
  constructor(private scene: THREE.Scene) {}
  get active() { return !!this.s; }
  onSound: (what: 'open' | 'slam' | 'engine') => void = () => {};

  /** world position of a car-local point */
  private at(s: Seq, l: { x: number; z: number }) {
    const c = Math.cos(s.heading), n = Math.sin(s.heading);
    return { x: s.x + l.x * c + l.z * n, z: s.z - l.x * n + l.z * c };
  }

  start(mode: SeqMode, color: string, x: number, z: number, heading: number, from: { x: number; z: number }, commit: () => void, smash = false) {
    this.stop();
    const door = doorPanel(color);
    const holder = new THREE.Group();
    holder.position.set(x, 0, z); holder.rotation.y = heading;
    holder.add(door);
    this.scene.add(holder);
    this.s = { mode, holder, door, t: 0, x, z, heading, from: { ...from }, commit, committed: false, smash };
    if (mode === 'out') { this.s.committed = true; commit(); }
  }

  stop() {
    if (!this.s) return;
    this.scene.remove(this.s.holder);
    this.s = null;
  }

  /** where the driver's door is, for walking round to it */
  doorSpot(x: number, z: number, heading: number) { return this.at({ x, z, heading } as Seq, DOOR_SPOT); }

  /** advance; moves the player (who is visible until they are in the seat) and swings the door */
  update(dt: number, p: Person, minute: number): boolean {
    const s = this.s;
    if (!s) return false;
    const t0 = s.t;
    s.t += dt;
    const t = s.t;
    // the sounds: the door's latch, the slam, the engine catching
    const cross = (at: number) => t0 < at && t >= at;
    if (s.mode === 'in') { if (cross(0.75)) this.onSound('open'); if (cross(1.9)) this.onSound('slam'); if (cross(1.98)) this.onSound('engine'); }
    else { if (cross(0.001) || t0 === 0) this.onSound('open'); if (cross(1.2)) this.onSound('slam'); }
    const spot = this.at(s, DOOR_SPOT), seat = this.at(s, SEAT);
    const faceCar = s.heading - SIDE * Math.PI / 2 + Math.PI;
    let open = 0;
    if (s.mode === 'in') {
      // walk round to the door (0-0.7 s), open it (0.7-1.15), climb in (1.15-1.6), pull it shut (1.6-2.0)
      const walk = clamp01(t / 0.7);
      if (t < 0.7) {
        p.pos = { x: s.from.x + (spot.x - s.from.x) * ease(walk), z: s.from.z + (spot.z - s.from.z) * ease(walk) };
        p.facing = Math.atan2(spot.x - s.from.x, spot.z - s.from.z);
      } else if (t < 1.15) {
        p.pos = spot; p.facing = faceCar;
        if (!p.gesture || p.gesture.until < minute) p.gesture = { clip: s.smash ? 'fight' : 'knock', until: minute + 0.25 };
        open = ease(clamp01((t - 0.75) / 0.4));
      } else if (t < 1.6) {
        open = 1;
        const k = ease(clamp01((t - 1.15) / 0.4));
        p.pos = { x: spot.x + (seat.x - spot.x) * k, z: spot.z + (seat.z - spot.z) * k };
        p.facing = s.heading;
        if (!s.committed && t > 1.5) { s.committed = true; s.commit(); }
      } else {
        open = 1 - ease(clamp01((t - 1.6) / 0.35));
      }
      if (t > 2.0) { this.stop(); return false; }
    } else {
      // getting out: the door opens (0-0.4), you step out (0.4-0.9), it shuts behind you (0.9-1.3)
      if (t < 0.4) { open = ease(t / 0.4); p.pos = seat; p.visible = false; }
      else if (t < 0.9) { open = 1; p.visible = true; const k = ease((t - 0.4) / 0.5); p.pos = { x: seat.x + (spot.x - seat.x) * k, z: seat.z + (spot.z - seat.z) * k }; p.facing = s.heading + SIDE * Math.PI / 2 * -1; }
      else { open = 1 - ease(clamp01((t - 0.9) / 0.35)); if (t > 1.0 && (!p.gesture || p.gesture.until < minute)) p.gesture = { clip: 'knock', until: minute + 0.2 }; }
      if (t > 1.3) { this.stop(); return false; }
    }
    s.door.rotation.y = -SIDE * 1.15 * open;
    return true;
  }
}
