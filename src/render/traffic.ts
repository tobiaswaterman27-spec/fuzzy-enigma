// Ambient traffic: cars driving the main roads on the left, keeping their distance and
// stopping for people and vehicles in front of them. Presentation only (not simulated).
import * as THREE from 'three';
import type { GameState } from '../sim/types';
import { buildCar } from './world';

interface Lane { from: THREE.Vector2; to: THREE.Vector2 }
interface Car { obj: THREE.Object3D; lane: number; t: number; speed: number; cruise: number }

// drive on the left: eastbound on the north side of the high street, southbound on the east side of the cross road
const LANES: Lane[] = [
  { from: new THREE.Vector2(-98, 2.0), to: new THREE.Vector2(98, 2.0) },
  { from: new THREE.Vector2(98, -2.0), to: new THREE.Vector2(-98, -2.0) },
  { from: new THREE.Vector2(2.5, 76), to: new THREE.Vector2(2.5, -48) },
  { from: new THREE.Vector2(-2.5, -48), to: new THREE.Vector2(-2.5, 76) },
];
const COLORS = ['#b8232a', '#2b4f8c', '#e8e8e8', '#1c1c1c', '#5f7f3f', '#c4a14a', '#7a7f86', '#3d6f8f'];

export class Traffic {
  cars: Car[] = [];
  constructor(scene: THREE.Scene, count = 14) {
    for (let i = 0; i < count; i++) {
      const lane = i % LANES.length;
      const obj = buildCar(COLORS[i % COLORS.length], 0, 0, 0);
      scene.add(obj);
      const cruise = 7 + ((i * 37) % 5);
      this.cars.push({ obj, lane, t: ((i * 0.37) % 1), speed: cruise, cruise });
    }
  }

  update(state: GameState, dt: number) {
    const people = Object.values(state.people).filter((p) => p.visible);
    const vans = Object.values(state.vehicles);
    for (const c of this.cars) {
      const L = LANES[c.lane];
      const len = L.from.distanceTo(L.to);
      const dir = new THREE.Vector2().subVectors(L.to, L.from).normalize();
      const pos = new THREE.Vector2().copy(L.from).addScaledVector(dir, c.t * len);
      // anything in the lane ahead: people crossing, vans, the car in front
      let gap = Infinity;
      const ahead = (x: number, z: number, wide: number) => {
        const dx = x - pos.x, dz = z - pos.y;
        const along = dx * dir.x + dz * dir.y, side = Math.abs(-dx * dir.y + dz * dir.x);
        if (along > 0 && side < wide) gap = Math.min(gap, along);
      };
      for (const p of people) ahead(p.pos.x, p.pos.z, 2.0);
      for (const v of vans) ahead(v.pos.x, v.pos.z, 2.4);
      for (const o of this.cars) if (o !== c && o.lane === c.lane) ahead(o.obj.position.x, o.obj.position.z, 1.5);
      // the junction of the two roads: wait outside it while a crossing car is in it
      const inBox = (x: number, z: number) => Math.abs(x) < 6 && Math.abs(z) < 6;
      const toBox = (() => { for (let d = 0; d < 12; d += 1) { const x = pos.x + dir.x * d, z = pos.y + dir.y * d; if (inBox(x, z)) return d; } return Infinity; })();
      if (toBox > 0 && toBox < 12 && !inBox(pos.x, pos.y) && this.cars.some((o) => o !== c && Math.abs(new THREE.Vector2().subVectors(LANES[o.lane].to, LANES[o.lane].from).normalize().dot(dir)) < 0.5 && inBox(o.obj.position.x, o.obj.position.z))) gap = Math.min(gap, toBox + 5);
      const want = gap < 6 ? 0 : gap < 14 ? c.cruise * ((gap - 6) / 8) : c.cruise;
      c.speed += Math.max(-9 * dt, Math.min(3 * dt, want - c.speed));
      c.t += (c.speed * dt) / len;
      if (c.t > 1) c.t -= 1; // off the edge of the map, back on at the other end
      c.obj.position.set(pos.x, 0, pos.y);
      c.obj.rotation.y = Math.atan2(dir.x, dir.y);
    }
  }
}
