// The police on the roads. When you are wanted and driving, patrol cars come after you with their
// lights going: one for a star or two, up to four at five stars. They drive the street grid (making
// for the junction that gets them closer, and straight at you once they can see you); if one pins you
// while you are stopped or crawling, you are arrested. At four stars the helicopter comes up too,
// circling over you with its searchlight: you cannot lose it in the open, only by getting indoors.
import * as THREE from 'three';
import type { GameState } from '../sim/types';
import { buildCar, driverFigure } from './world';
import { clearLine, resolveCircle } from '../sim/world/nav';
import { collidersIn, getWorld, shellAt } from '../sim/world/layout';
import { arrest } from '../sim/health';
import { planX } from '../sim/world/levels';

type R = { x0: number; z0: number; x1: number; z1: number };

class PatrolCar {
  obj: THREE.Group;
  lights: THREE.Mesh[] = [];
  pos = new THREE.Vector2();
  heading = 0;
  speed = 0;
  pinned = 0;
  /** where it is making for, re-chosen twice a second */
  aim: { x: number; z: number } | null = null;
  aimAt = 0;
  constructor(private scene: THREE.Scene, x: number, z: number, heading: number) {
    const g = buildCar('#f4f6f7', 0, 0, 0, false, 'saloon');
    g.add(driverFigure(x * 0.13 + z, '#f2f4f6', '#15181d'));
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
    scene.add(g);
    this.obj = g;
    this.pos.set(x, z);
    this.heading = heading;
    g.position.set(x, 0, z);
  }
  remove() { this.scene.remove(this.obj); }
  rect(): R {
    const ew = Math.abs(Math.sin(this.heading)) > 0.7;
    const hx = ew ? 2.1 : 0.95, hz = ew ? 0.95 : 2.1;
    return { x0: this.pos.x - hx, z0: this.pos.y - hz, x1: this.pos.x + hx, z1: this.pos.y + hz };
  }
}

export class PoliceCar {
  private cars: PatrolCar[] = [];
  /** cars parked across a junction ahead of you, lights going (three stars and up, when you are driving) */
  private blocks: PatrolCar[] = [];
  private blockAt = 0;
  private heli: THREE.Group | null = null;
  private rotor: THREE.Object3D | null = null;
  private beam: THREE.SpotLight | null = null;
  private heliAngle = 0;
  private leaving = 0;
  constructor(private scene: THREE.Scene) {}
  get active() { return this.cars.length > 0 || !!this.heli; }

  /** where the cars are, for collisions */
  rects(): R[] { return [...this.cars, ...this.blocks].map((c) => c.rect()); }

  /** a roadblock at the next junction or two ahead of a speeding getaway */
  private roadblocks(on: boolean, px: number, pz: number, heading: number) {
    const t = performance.now() / 1000;
    if (!on) { for (const b of this.blocks) b.remove(); this.blocks = []; return; }
    // gone by, or far off: cleared away
    this.blocks = this.blocks.filter((b) => { const far = Math.hypot(b.pos.x - px, b.pos.y - pz) > 220; if (far) b.remove(); return !far; });
    if (this.blocks.length || t - this.blockAt < 8) return;
    this.blockAt = t;
    const fx = Math.sin(heading), fz = Math.cos(heading);
    const j = getWorld().city.junctions
      .map((q) => ({ q, d: Math.hypot(q.x - px, q.z - pz), ahead: ((q.x - px) * fx + (q.z - pz) * fz) / Math.max(1, Math.hypot(q.x - px, q.z - pz)) }))
      .filter((c) => c.d > 60 && c.d < 150 && c.ahead > 0.85).sort((a, b) => a.d - b.d)[0]?.q;
    if (!j) return;
    // two cars nose to nose across the road you are on, leaving no gap
    const across = Math.abs(fx) > Math.abs(fz) ? 0 : Math.PI / 2;
    for (const s of [-1, 1]) {
      const ox = across === 0 ? 0 : s * 2.3, oz = across === 0 ? s * 2.3 : 0;
      const c = new PatrolCar(this.scene, j.x + ox - fx * 6, j.z + oz - fz * 6, across + (s > 0 ? Math.PI : 0));
      this.blocks.push(c);
    }
  }

  /** a junction out of sight, some way off, to come from */
  private spawnPoint(px: number, pz: number): { x: number; z: number; h: number } {
    const js = getWorld().city.junctions.map((j) => ({ j, d: Math.hypot(j.x - px, j.z - pz) })).filter((c) => c.d > 90 && c.d < 220).sort((a, b) => a.d - b.d);
    const j = js[Math.floor(Math.random() * Math.min(6, js.length))]?.j ?? { x: px + 150, z: pz };
    return { x: j.x + 2, z: j.z, h: Math.atan2(px - j.x, pz - j.z) };
  }

  update(state: GameState, dt: number, playerSpeed: number, colliders: R[]) {
    const me = state.people[state.playerId];
    const w = state.wanted;
    const wanted = !!w && w.level > 0 && !me.away && !me.dead;
    const driving = me.where === 'vehicle';
    const px = planX(me.pos.x), pz = me.pos.z;
    // how many cars the stars bring
    const want = wanted && driving ? Math.min(4, Math.ceil(w!.level * 0.8)) : 0;
    while (this.cars.length < want) { const s = this.spawnPoint(px, pz); this.cars.push(new PatrolCar(this.scene, s.x, s.z, s.h)); }
    if (!wanted) {
      // they drive off and disappear once well away
      this.leaving += dt;
      if (this.leaving > 8) { for (const c of this.cars) c.remove(); this.cars = []; }
    } else this.leaving = 0;
    const t = performance.now() / 1000;
    for (const c of [...this.cars, ...this.blocks]) c.lights.forEach((l, i) => { (l.material as THREE.MeshStandardMaterial).emissiveIntensity = Math.sin(t * 9 + i * Math.PI) > 0 ? 3 : 0.1; });
    const myCar = driving ? Object.values(state.vehicles).find((v) => v.driverId === me.id) : null;
    this.roadblocks(wanted && driving && w!.level >= 3, px, pz, myCar?.heading ?? 0);
    this.updateHeli(state, dt, wanted && w!.level >= 4, px, pz);
    if (dt <= 0) return;
    const junctions = getWorld().city.junctions;
    for (const c of this.cars) {
      let tx = wanted ? px : c.pos.x + Math.sin(c.heading) * 40, tz = wanted ? pz : c.pos.y + Math.cos(c.heading) * 40;
      // no clear run at you: go by the junction nearest you that it can see
      if (wanted && t - c.aimAt > 0.5) {
        c.aimAt = t;
        const here = { x: c.pos.x, z: c.pos.y };
        if (clearLine(here, { x: px, z: pz }, 1.0)) c.aim = null;
        else {
          const cands = junctions.map((j) => ({ j, d: Math.hypot(j.x - here.x, j.z - here.z) })).filter((q) => q.d > 6 && q.d < 280).sort((a, b) => Math.hypot(a.j.x - px, a.j.z - pz) - Math.hypot(b.j.x - px, b.j.z - pz));
          c.aim = cands.slice(0, 8).find((q) => clearLine(here, q.j, 1.0))?.j ?? c.aim;
        }
      }
      if (wanted && c.aim) { tx = c.aim.x; tz = c.aim.z; if (Math.hypot(tx - c.pos.x, tz - c.pos.y) < 5) c.aimAt = 0; }
      const dx = tx - c.pos.x, dz = tz - c.pos.y, d = Math.hypot(dx, dz);
      const want2 = Math.atan2(dx, dz);
      const turn = ((want2 - c.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      c.heading += Math.max(-2.0 * dt, Math.min(2.0 * dt, turn));
      const dMe = Math.hypot(px - c.pos.x, pz - c.pos.y);
      const target = dMe < 4 ? 0 : dMe < 12 ? 7 : Math.abs(turn) > 1 ? 8 : 19;
      c.speed += Math.max(-12 * dt, Math.min(6 * dt, target - c.speed));
      const nx = c.pos.x + Math.sin(c.heading) * c.speed * dt, nz = c.pos.y + Math.cos(c.heading) * c.speed * dt;
      const others = this.cars.filter((o) => o !== c).map((o) => o.rect());
      // the buildings round this car (it may be well away from you), the other cars, and yours
      const r = resolveCircle({ x: nx, z: nz }, 1.1, [...collidersIn(nx - 4, nz - 4, nx + 4, nz + 4), ...others, ...colliders.filter((q) => Math.abs((q.x0 + q.x1) / 2 - nx) < 8 && Math.abs((q.z0 + q.z1) / 2 - nz) < 8)]);
      if (Math.hypot(r.x - nx, r.z - nz) > 0.01) c.speed *= 0.6;
      c.pos.set(r.x, r.z);
      c.obj.position.set(r.x, 0, r.z);
      c.obj.rotation.y = c.heading;
      void d;
      if (!wanted) continue;
      // close by: they can see you
      if (dMe < 30) w!.unseen = 0;
      // pinned: you are stopped next to a patrol car for a couple of seconds
      if (dMe < 4.5 && Math.abs(playerSpeed) < 1.5) c.pinned += dt; else c.pinned = Math.max(0, c.pinned - dt);
      if (c.pinned > 2) {
        const cop = Object.values(state.people).find((o) => o.police) ?? me;
        if (driving) {
          // out of the car and into the back of theirs
          for (const v of Object.values(state.vehicles)) if (v.driverId === me.id) { v.driverId = null; v.state = v.kind === 'van' ? v.state : 'parked'; }
          me.where = 'outside'; me.visible = true;
        }
        arrest(state, cop);
        c.pinned = 0;
        return;
      }
    }
  }

  /** the helicopter: circles over you with its searchlight; indoors it loses you */
  private updateHeli(state: GameState, dt: number, on: boolean, px: number, pz: number) {
    if (on && !this.heli) {
      const g = new THREE.Group();
      const body = new THREE.MeshStandardMaterial({ color: '#1f2a44', roughness: 0.4, metalness: 0.3 });
      const yellow = new THREE.MeshStandardMaterial({ color: '#e8e010', roughness: 0.4 });
      const cab = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), body); cab.scale.set(1, 0.85, 1.5); g.add(cab);
      const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.35, 5, 8), body); tail.rotation.x = Math.PI / 2; tail.position.set(0, 0.2, -3.6); g.add(tail);
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.1, 0.7), yellow); fin.position.set(0, 0.7, -6); g.add(fin);
      for (const s of [-1, 1]) { const skid = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 2.6), body); skid.position.set(s * 0.8, -1.3, 0); g.add(skid); }
      const rotor = new THREE.Group();
      for (let k = 0; k < 4; k++) { const blade = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.04, 9), body); blade.rotation.y = (k * Math.PI) / 2; rotor.add(blade); }
      rotor.position.y = 1.4; g.add(rotor);
      const beam = new THREE.SpotLight('#fff8e0', 0, 120, 0.22, 0.4, 1.2);
      beam.position.set(0, -1.2, 1); g.add(beam); g.add(beam.target);
      // it comes in high from the side
      g.position.set(px + 120, 60, pz + 40);
      this.scene.add(g);
      this.heli = g; this.rotor = rotor; this.beam = beam;
    }
    if (!this.heli) return;
    // up and away when you are no longer wanted
    if (!on) {
      this.heli.position.y += dt * 8;
      if (this.heli.position.y > 120) { this.scene.remove(this.heli); this.heli = null; }
      return;
    }
    this.heliAngle += dt * 0.25;
    const cx = px + Math.cos(this.heliAngle) * 30, cz = pz + Math.sin(this.heliAngle) * 30;
    this.heli.position.lerp(new THREE.Vector3(cx, 34, cz), Math.min(1, dt * 0.8));
    this.heli.lookAt(px, 34, pz);
    this.heli.rotateY(Math.PI / 2);
    if (this.rotor) this.rotor.rotation.y += dt * 30;
    if (this.beam) {
      this.beam.target.position.copy(this.heli.worldToLocal(new THREE.Vector3(px, 0, pz)));
      const m = state.minute % 1440;
      this.beam.intensity = m < 6 * 60 || m > 19 * 60 ? 4000 : 0;
    }
    // the helicopter sees you anywhere in the open
    const me = state.people[state.playerId];
    if (state.wanted && !shellAt(me.pos)) state.wanted.unseen = 0;
  }
}
