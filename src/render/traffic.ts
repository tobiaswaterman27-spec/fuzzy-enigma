// Ambient traffic: cars driving the city's streets on the left, keeping their distance, stopping for
// people and vehicles in front of them and waiting at junctions while a crossing car is in the box.
// Presentation only (not simulated). A pool of cars is kept around the player: one that falls far
// behind is moved to a street out ahead, so the whole city seems busy at the cost of a few dozen.
import * as THREE from 'three';
import type { GameState } from '../sim/types';
import { getWorld } from '../sim/world/layout';
import type { Lane } from '../sim/world/city';
import { buildCar, driverFigure } from './world';

interface Car { obj: THREE.Object3D; lane: number; t: number; speed: number; cruise: number; color: string; body: string }
const BODIES = ['car', 'saloon', 'suv', 'car', 'sports', 'saloon', 'suv'];
const COLORS = ['#b8232a', '#2b4f8c', '#e8e8e8', '#1c1c1c', '#5f7f3f', '#c4a14a', '#7a7f86', '#3d6f8f', '#8e44ad', '#f0f0f0'];
const KEEP = 230;

export class Traffic {
  cars: Car[] = [];
  private lanes: Lane[];
  private len: number[];
  private dir: THREE.Vector2[];
  private junctions: { x: number; z: number }[];
  private seed = 7;
  private rnd() { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }

  /** the cars as axis-aligned boxes (they drive along the roads), for collisions */
  rects(): { x0: number; z0: number; x1: number; z1: number }[] {
    return this.cars.map((c) => {
      const p = c.obj.position;
      const alongX = this.lanes[c.lane].axis === 'x';
      const hx = alongX ? 2.15 : 0.95, hz = alongX ? 0.95 : 2.15;
      return { x0: p.x - hx, z0: p.z - hz, x1: p.x + hx, z1: p.z + hz };
    });
  }
  private taken = 0;
  /** a slow or stopped car within reach, pulled out of the traffic (for carjacking) */
  /** stop and hand over the car nearest a point (its mesh is the caller's to remove) */
  take(x: number, z: number, reach = 3.4): { x: number; z: number; heading: number; color: string; body: string; obj: THREE.Object3D } | null {
    let best: Car | null = null, bd = reach;
    for (const c of this.cars) {
      const d = Math.hypot(c.obj.position.x - x, c.obj.position.z - z);
      // a car that has stopped for you can be reached from in front of it (it stops a few metres short)
      if (c.speed < 2.5 && (d < bd || (c.speed < 0.6 && d < 7.5 && !best))) { best = c; bd = Math.min(bd, d); }
    }
    if (!best) return null;
    this.cars.splice(this.cars.indexOf(best), 1);
    this.taken++;
    return { x: best.obj.position.x, z: best.obj.position.z, heading: best.obj.rotation.y, color: best.color, body: best.body, obj: best.obj };
  }
  private respawnAt = 0;

  constructor(private scene: THREE.Scene, count = 34) {
    const w = getWorld();
    this.lanes = w.city.lanes;
    this.len = this.lanes.map((l) => Math.hypot(l.to.x - l.from.x, l.to.z - l.from.z));
    this.dir = this.lanes.map((l, i) => new THREE.Vector2((l.to.x - l.from.x) / this.len[i], (l.to.z - l.from.z) / this.len[i]));
    this.junctions = w.city.junctions;
    for (let i = 0; i < count; i++) this.add({ x: 0, z: 0 });
  }

  private add(near: { x: number; z: number }) {
    const i = this.cars.length + this.taken;
    const body = BODIES[i % BODIES.length], color = COLORS[(i * 3) % COLORS.length];
    const obj = buildCar(color, 0, 0, 0, false, body);
    obj.add(driverFigure(i + 0.37));
    this.scene.add(obj);
    const cruise = 8 + ((i * 37) % 5) + (body === 'sports' ? 2 : 0);
    const c: Car = { obj, lane: 0, t: 0, speed: cruise, cruise, color, body };
    this.place(c, near, 0, KEEP * 0.9);
    this.cars.push(c);
  }

  /** put a car on a street somewhere between two distances from a point */
  private place(c: Car, p: { x: number; z: number }, dmin: number, dmax: number) {
    for (let tries = 0; tries < 40; tries++) {
      const lane = Math.floor(this.rnd() * this.lanes.length);
      const L = this.lanes[lane], len = this.len[lane];
      // the point on this lane nearest p, then a random way along from there
      const d = this.dir[lane];
      const tn = Math.max(0, Math.min(len, (p.x - L.from.x) * d.x + (p.z - L.from.z) * d.y));
      const off = (this.rnd() - 0.5) * 2 * dmax;
      const t = Math.max(0, Math.min(len, tn + off));
      const x = L.from.x + d.x * t, z = L.from.z + d.y * t;
      const dist = Math.hypot(x - p.x, z - p.z);
      if (dist < dmin || dist > dmax) continue;
      if (this.cars.some((o) => o !== c && o.lane === lane && Math.abs(o.t - t / len) * len < 12)) continue;
      c.lane = lane; c.t = t / len; c.speed = c.cruise * 0.6;
      c.obj.position.set(x, 0, z);
      return;
    }
  }

  update(state: GameState, dt: number) {
    const me = state.people[state.playerId];
    const p = { x: me.pos.x, z: me.pos.z };
    // a replacement for a taken car joins the traffic after a while
    if (this.taken > 0 && (this.respawnAt += dt) > 30) { this.respawnAt = 0; this.taken--; this.add(p); }
    const people = Object.values(state.people).filter((q) => q.visible && Math.abs(q.pos.x - p.x) < KEEP + 20 && Math.abs(q.pos.z - p.z) < KEEP + 20);
    const vans = Object.values(state.vehicles);
    const inBox = (x: number, z: number, j: { x: number; z: number }) => Math.abs(x - j.x) < 6 && Math.abs(z - j.z) < 6;
    for (const c of this.cars) {
      const L = this.lanes[c.lane], dir = this.dir[c.lane], len = this.len[c.lane];
      const pos = new THREE.Vector2(L.from.x + dir.x * c.t * len, L.from.z + dir.y * c.t * len);
      // fallen far behind: move it to a street out ahead of the player, out of sight
      if (Math.hypot(pos.x - p.x, pos.y - p.z) > KEEP) { this.place(c, p, 140, KEEP - 10); continue; }
      // anything in the lane ahead: people crossing, vans, the car in front
      let gap = Infinity;
      const ahead = (x: number, z: number, wide: number) => {
        const dx = x - pos.x, dz = z - pos.y;
        const along = dx * dir.x + dz * dir.y, side = Math.abs(-dx * dir.y + dz * dir.x);
        if (along > 0 && along < 30 && side < wide) gap = Math.min(gap, along);
      };
      for (const q of people) ahead(q.pos.x, q.pos.z, 2.0);
      for (const v of vans) ahead(v.pos.x, v.pos.z, 2.4);
      for (const o of this.cars) if (o !== c && o.lane === c.lane) ahead(o.obj.position.x, o.obj.position.z, 1.5);
      // the next junction: wait outside it while a car on the cross street is in it
      for (const j of this.junctions) {
        const dx = j.x - pos.x, dz = j.z - pos.y;
        const along = dx * dir.x + dz * dir.y;
        if (along < 6 || along > 18 || Math.abs(-dx * dir.y + dz * dir.x) > 6) continue;
        if (this.cars.some((o) => o !== c && Math.abs(this.dir[o.lane].dot(dir)) < 0.5 && inBox(o.obj.position.x, o.obj.position.z, j))) gap = Math.min(gap, along - 1);
      }
      const want = gap < 6 ? 0 : gap < 14 ? c.cruise * ((gap - 6) / 8) : c.cruise;
      c.speed += Math.max(-9 * dt, Math.min(3 * dt, want - c.speed));
      c.t += (c.speed * dt) / len;
      // the end of the street: on to another one near the player
      if (c.t > 1) { this.place(c, p, 140, KEEP - 10); continue; }
      c.obj.position.set(pos.x, 0, pos.y);
      c.obj.rotation.y = Math.atan2(dir.x, dir.y);
    }
  }
}
