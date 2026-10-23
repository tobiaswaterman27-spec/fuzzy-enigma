// The emergency services, seen on the street: an ambulance for someone lying hurt in the road, a fire
// engine for a car on fire. They come in from a junction a little way off with their blue lights going,
// pull up beside the scene, do their work (the fire crew hose the wreck down) and leave once it is over.
// What happens to the patient is the sim's business; this is what you see of it.
import * as THREE from 'three';
import type { GameState } from '../sim/types';
import { buildCar } from './world';
import { clearLine, resolveCircle } from '../sim/world/nav';
import { collidersIn, getWorld } from '../sim/world/layout';
import { planX } from '../sim/world/levels';
import type { Fx } from './fx';

type Kind = 'ambulance' | 'fire';
interface Unit { kind: Kind; obj: THREE.Group; lights: THREE.Mesh[]; x: number; z: number; heading: number; speed: number; target: string; at: { x: number; z: number }; arrived: number; leaving: number; aim: { x: number; z: number } | null; aimAt: number }

function ambulance(): { g: THREE.Group; lights: THREE.Mesh[] } {
  const g = buildCar('#f4f4f2', 0, 0, 0, true);
  const yellow = new THREE.MeshStandardMaterial({ color: '#d6e01a', roughness: 0.5 });
  const green = new THREE.MeshStandardMaterial({ color: '#1f8a3a', roughness: 0.5 });
  for (const side of [-1, 1]) for (let i = 0; i < 8; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.32, 0.5), i % 2 ? green : yellow);
    b.position.set(side * 0.97, 0.95, -2.1 + i * 0.52); g.add(b);
  }
  const lights = [-0.5, 0.5].map((x) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.25), new THREE.MeshStandardMaterial({ color: '#1640ff', emissive: '#1640ff', emissiveIntensity: 0 })); m.position.set(x, 2.2, 1.6); g.add(m); return m; });
  return { g, lights };
}

function fireEngine(): { g: THREE.Group; lights: THREE.Mesh[] } {
  const g = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: '#c0161c', roughness: 0.45, metalness: 0.2 });
  const glass = new THREE.MeshStandardMaterial({ color: '#1d2a33', roughness: 0.1 });
  const steel = new THREE.MeshStandardMaterial({ color: '#c9cdd1', roughness: 0.35, metalness: 0.7 });
  const black = new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.8 });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
  add(new THREE.BoxGeometry(2.4, 2.4, 7.8), red, 0, 1.6, -0.4);
  add(new THREE.BoxGeometry(2.4, 2.0, 1.8), red, 0, 1.4, 3.9);
  add(new THREE.BoxGeometry(2.2, 0.9, 0.06), glass, 0, 1.95, 4.81);
  add(new THREE.BoxGeometry(2.42, 0.25, 7.8), new THREE.MeshStandardMaterial({ color: '#f2d000', roughness: 0.5 }), 0, 1.0, -0.4);
  // the ladder on the roof
  add(new THREE.BoxGeometry(0.9, 0.15, 7.4), steel, 0, 2.95, -0.6);
  for (let z = -4.1; z < 3; z += 0.6) add(new THREE.BoxGeometry(0.9, 0.05, 0.06), steel, 0, 3.05, z);
  for (const [x, z] of [[-1.15, 3.3], [1.15, 3.3], [-1.15, -2.2], [1.15, -2.2], [-1.15, -3.4], [1.15, -3.4]]) { const w = add(new THREE.CylinderGeometry(0.5, 0.5, 0.35, 16), black, x, 0.5, z); w.rotation.z = Math.PI / 2; }
  const lights = [-0.7, 0.7].map((x) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.3), new THREE.MeshStandardMaterial({ color: '#1640ff', emissive: '#1640ff', emissiveIntensity: 0 })); m.position.set(x, 2.5, 4.4); g.add(m); return m; });
  return { g, lights };
}

export class Emergency {
  private units: Unit[] = [];
  /** scenes already dealt with (so a burnt-out shell does not keep calling the fire brigade) */
  private served = new Set<string>();
  constructor(private scene: THREE.Scene, private fx: Fx) {}
  /** a siren somewhere: how far away the nearest one on the move is (for the sound) */
  sirenAt = Infinity;

  private spawnNear(x: number, z: number) {
    const js = getWorld().city.junctions.map((j) => ({ j, d: Math.hypot(j.x - x, j.z - z) })).filter((c) => c.d > 50 && c.d < 140).sort((a, b) => a.d - b.d);
    const j = js[Math.floor(Math.random() * Math.min(4, js.length))]?.j ?? { x: x + 80, z };
    return { x: j.x + 2, z: j.z, h: Math.atan2(x - j.x, z - j.z) };
  }

  update(state: GameState, dt: number, player: { x: number; z: number }) {
    // who needs them: people down in the street (not just knocked over), cars on fire or burnt out
    const need = new Map<string, { kind: Kind; x: number; z: number }>();
    for (const p of Object.values(state.people)) if (p.down != null && p.downUntil == null && p.visible && !p.away && p.where === 'outside' && Math.hypot(planX(p.pos.x) - player.x, p.pos.z - player.z) < 160) need.set(`p:${p.id}`, { kind: 'ambulance', x: planX(p.pos.x), z: p.pos.z });
    for (const v of Object.values(state.vehicles)) if ((v.burning != null || v.wrecked) && Math.hypot(v.pos.x - player.x, v.pos.z - player.z) < 160 && state.minute - (v.burning ?? state.minute) < 30) need.set(`v:${v.id}`, { kind: 'fire', x: v.pos.x, z: v.pos.z });
    for (const [key, n] of need) {
      if (this.served.has(key) || this.units.some((u) => u.target === key) || this.units.filter((u) => u.kind === n.kind).length >= 2) continue;
      const s = this.spawnNear(n.x, n.z);
      const made = n.kind === 'ambulance' ? ambulance() : fireEngine();
      this.scene.add(made.g);
      this.units.push({ kind: n.kind, obj: made.g, lights: made.lights, x: s.x, z: s.z, heading: s.h, speed: 0, target: key, at: { x: n.x, z: n.z }, arrived: 0, leaving: 0, aim: null, aimAt: 0 });
    }
    const t = performance.now() / 1000;
    this.sirenAt = Infinity;
    for (const u of [...this.units]) {
      const live = need.get(u.target);
      if (live) u.at = { x: live.x, z: live.z };
      if (!live && !u.leaving) { u.leaving = t; this.served.add(u.target); }
      // drive: to the scene (round by the junctions when there is no straight run), stopping short of it
      let tx = u.at.x, tz = u.at.z;
      if (u.leaving) { tx = u.x + Math.sin(u.heading) * 50; tz = u.z + Math.cos(u.heading) * 50; }
      else if (t - u.aimAt > 0.5) {
        u.aimAt = t;
        if (clearLine({ x: u.x, z: u.z }, u.at, 1.0)) u.aim = null;
        else u.aim = getWorld().city.junctions.map((j) => ({ j, d: Math.hypot(j.x - u.x, j.z - u.z) })).filter((q) => q.d > 6 && q.d < 200).sort((a, b) => Math.hypot(a.j.x - u.at.x, a.j.z - u.at.z) - Math.hypot(b.j.x - u.at.x, b.j.z - u.at.z)).slice(0, 8).find((q) => clearLine({ x: u.x, z: u.z }, q.j, 1.0))?.j ?? u.aim;
      }
      if (!u.leaving && u.aim) { tx = u.aim.x; tz = u.aim.z; if (Math.hypot(tx - u.x, tz - u.z) < 5) u.aimAt = 0; }
      const d = Math.hypot(u.at.x - u.x, u.at.z - u.z);
      const turn = ((Math.atan2(tx - u.x, tz - u.z) - u.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      const want = u.leaving ? 14 : d < 7 ? 0 : d < 20 ? 5 : Math.abs(turn) > 1 ? 6 : 15;
      if (!u.leaving && d < 7 && !u.arrived) u.arrived = t;
      if (u.speed > 0.5 || want > 0) u.heading += Math.max(-1.6 * dt, Math.min(1.6 * dt, turn));
      u.speed += Math.max(-10 * dt, Math.min(5 * dt, want - u.speed));
      const nx = u.x + Math.sin(u.heading) * u.speed * dt, nz = u.z + Math.cos(u.heading) * u.speed * dt;
      const r = resolveCircle({ x: nx, z: nz }, 1.2, collidersIn(nx - 4, nz - 4, nx + 4, nz + 4));
      if (Math.hypot(r.x - nx, r.z - nz) > 0.01) u.speed *= 0.6;
      u.x = r.x; u.z = r.z;
      u.obj.position.set(u.x, 0, u.z);
      u.obj.rotation.y = u.heading;
      u.lights.forEach((l, i) => { (l.material as THREE.MeshStandardMaterial).emissiveIntensity = Math.sin(t * 10 + i * Math.PI) > 0 ? 3 : 0.1; });
      if (!u.arrived && !u.leaving) this.sirenAt = Math.min(this.sirenAt, Math.hypot(u.x - player.x, u.z - player.z));
      // the fire crew put it out: water from the hose, steam off the wreck
      if (u.kind === 'fire' && u.arrived && !u.leaving && Math.random() < dt * 20) {
        const dx = u.at.x - u.x, dz = u.at.z - u.z, l = Math.hypot(dx, dz) || 1;
        this.fx.emit('smoke', u.x + dx / l * 2, 1.6, u.z + dz / l * 2, new THREE.Vector3(dx / l * 6, 1.2, dz / l * 6), 0.25, 0.9);
      }
      if (u.kind === 'fire' && u.arrived && !u.leaving && t - u.arrived > 12) { u.leaving = t; this.served.add(u.target); }
      // gone once well away (or after a while)
      if (u.leaving && (t - u.leaving > 8 || Math.hypot(u.x - player.x, u.z - player.z) > 220)) { this.scene.remove(u.obj); this.units.splice(this.units.indexOf(u), 1); }
    }
  }
}
