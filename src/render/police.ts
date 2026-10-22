// The police car: when you are wanted and driving, a patrol car comes after you with its lights
// going. It follows the roads where it can and cuts across where it must; if it pins you while you
// are stopped or crawling, you are arrested. Lose it (out of sight long enough) and the stars fade.
import * as THREE from 'three';
import type { GameState } from '../sim/types';
import { buildCar } from './world';
import { resolveCircle } from '../sim/world/nav';
import { getWorld } from '../sim/world/layout';
import { arrest } from '../sim/health';

const SPAWNS = [{ x: -95, z: 2 }, { x: 95, z: -2 }, { x: 2.5, z: 74 }, { x: -2.5, z: -46 }];

export class PoliceCar {
  private obj: THREE.Group | null = null;
  private lights: THREE.Mesh[] = [];
  private pos = new THREE.Vector2();
  private heading = 0;
  private speed = 0;
  private pinned = 0;
  private leaving = 0;
  constructor(private scene: THREE.Scene) {}
  get active() { return !!this.obj; }

  /** where the car is, for collisions */
  rect(): { x0: number; z0: number; x1: number; z1: number } | null {
    if (!this.obj) return null;
    const ew = Math.abs(Math.sin(this.heading)) > 0.7;
    const hx = ew ? 2.1 : 0.95, hz = ew ? 0.95 : 2.1;
    return { x0: this.pos.x - hx, z0: this.pos.y - hz, x1: this.pos.x + hx, z1: this.pos.y + hz };
  }

  private spawn(px: number, pz: number) {
    const s = SPAWNS.slice().sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz))[1];
    const g = buildCar('#f4f6f7', s.x, s.z, 0, false, 'saloon');
    // battenburg livery stripe, light bar on the roof
    const stripeMat = new THREE.MeshStandardMaterial({ color: '#1f5fd1', roughness: 0.4 });
    const yellow = new THREE.MeshStandardMaterial({ color: '#e8e010', roughness: 0.4 });
    for (const side of [-1, 1]) for (let i = 0; i < 6; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.22, 0.42), i % 2 ? stripeMat : yellow);
      b.position.set(side * 0.93, 0.7, -1.1 + i * 0.42);
      g.add(b);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.09, 0.22), new THREE.MeshStandardMaterial({ color: '#222', roughness: 0.5 }));
    bar.position.set(0, 1.5, 0.15);
    g.add(bar);
    this.lights = [-1, 1].map((sd) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.2), new THREE.MeshStandardMaterial({ color: '#1640ff', emissive: '#1640ff', emissiveIntensity: 0 }));
      m.position.set(sd * 0.24, 1.56, 0.15);
      g.add(m);
      return m;
    });
    this.scene.add(g);
    this.obj = g;
    this.pos.set(s.x, s.z);
    this.speed = 0;
    this.pinned = 0;
    this.leaving = 0;
  }

  private despawn() {
    if (this.obj) this.scene.remove(this.obj);
    this.obj = null;
  }

  update(state: GameState, dt: number, playerSpeed: number, colliders = getWorld().colliders) {
    const me = state.people[state.playerId];
    const wanted = state.wanted && state.wanted.level > 0 && !me.away && !me.dead;
    const driving = me.where === 'vehicle';
    if (!this.obj) {
      if (wanted && driving) this.spawn(me.pos.x, me.pos.z);
      return;
    }
    const t = performance.now() / 1000;
    this.lights.forEach((l, i) => { (l.material as THREE.MeshStandardMaterial).emissiveIntensity = Math.sin(t * 9 + i * Math.PI) > 0 ? 3 : 0.1; });
    if (!wanted) {
      // drive off and disappear once well away
      this.leaving += dt;
      if (this.leaving > 8) { this.despawn(); return; }
    }
    if (dt <= 0) return;
    const tx = wanted ? me.pos.x : this.pos.x + Math.sin(this.heading) * 40, tz = wanted ? me.pos.z : this.pos.y + Math.cos(this.heading) * 40;
    const dx = tx - this.pos.x, dz = tz - this.pos.y, d = Math.hypot(dx, dz);
    const want = Math.atan2(dx, dz);
    let turn = ((want - this.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.heading += Math.max(-1.6 * dt, Math.min(1.6 * dt, turn));
    const target = d < 4 ? 0 : d < 12 ? 6 : 15;
    this.speed += Math.max(-10 * dt, Math.min(5 * dt, target - this.speed));
    const nx = this.pos.x + Math.sin(this.heading) * this.speed * dt, nz = this.pos.y + Math.cos(this.heading) * this.speed * dt;
    const r = resolveCircle({ x: nx, z: nz }, 1.1, colliders);
    if (Math.hypot(r.x - nx, r.z - nz) > 0.01) this.speed *= 0.6;
    this.pos.set(r.x, r.z);
    this.obj.position.set(r.x, 0, r.z);
    this.obj.rotation.y = this.heading;
    if (!wanted) return;
    // close by: they can see you
    if (d < 30) state.wanted!.unseen = 0;
    // pinned: you are stopped next to the patrol car for a couple of seconds
    if (d < 4.5 && Math.abs(playerSpeed) < 1.5) this.pinned += dt; else this.pinned = Math.max(0, this.pinned - dt);
    if (this.pinned > 2) {
      const cop = Object.values(state.people).find((o) => o.police) ?? me;
      if (driving) {
        // out of the car and into the back of theirs
        for (const v of Object.values(state.vehicles)) if (v.driverId === me.id) { v.driverId = null; v.state = v.kind === 'van' ? v.state : 'parked'; }
        me.where = 'outside'; me.visible = true;
      }
      arrest(state, cop);
      this.pinned = 0;
    }
  }
}
