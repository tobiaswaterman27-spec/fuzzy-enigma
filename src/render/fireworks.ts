// New Year's Eve: fireworks over the harbour from a barge offshore, from a few minutes before
// midnight until twenty past. Rockets climb with a spark trail and burst into coloured shells.
import * as THREE from 'three';
import type { GameState } from '../sim/types';
import { QUAY_EDGE } from '../sim/world/layout';
import { newYearShow } from '../sim/newyear';

interface Shell { pts: THREE.Points; vel: Float32Array; age: number; life: number }
interface Rocket { obj: THREE.Mesh; vy: number; vx: number; fuse: number }
const COLOURS = ['#ff4d4d', '#ffd24d', '#4dff88', '#4dc3ff', '#d84dff', '#ffffff', '#ff8c1a'];
const PER = 160;

function sparkTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 32;
  const c = cv.getContext('2d')!;
  const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(cv);
}

export class Fireworks {
  private shells: Shell[] = [];
  private rockets: Rocket[] = [];
  private next = 0;
  private tex = sparkTexture();
  onBang: (dist: number) => void = () => {};
  constructor(private scene: THREE.Scene) {}

  update(state: GameState, dt: number, camera: THREE.Vector3) {
    const on = newYearShow(state);
    const now = performance.now();
    if (on && now > this.next) {
      this.next = now + 350 + Math.random() * 900;
      const r = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), new THREE.MeshBasicMaterial({ color: '#ffe9b0' }));
      r.position.set(-30 + Math.random() * 60, 0, QUAY_EDGE + 32 + Math.random() * 12);
      this.scene.add(r);
      this.rockets.push({ obj: r, vy: 26 + Math.random() * 8, vx: (Math.random() - 0.5) * 3, fuse: 1.3 + Math.random() * 0.6 });
    }
    for (const r of [...this.rockets]) {
      r.fuse -= dt;
      r.obj.position.y += r.vy * dt; r.obj.position.x += r.vx * dt;
      r.vy -= 9 * dt;
      if (r.fuse <= 0) { this.burst(r.obj.position.clone()); this.scene.remove(r.obj); this.rockets.splice(this.rockets.indexOf(r), 1); this.onBang(r.obj.position.distanceTo(camera)); }
    }
    for (const s of [...this.shells]) {
      s.age += dt;
      const p = s.pts.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < PER; i++) {
        s.vel[i * 3 + 1] -= 3.2 * dt;
        for (let k = 0; k < 3; k++) { s.vel[i * 3 + k] *= Math.exp(-0.9 * dt); p.array[i * 3 + k] += s.vel[i * 3 + k] * dt; }
      }
      p.needsUpdate = true;
      (s.pts.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - s.age / s.life);
      if (s.age > s.life) { this.scene.remove(s.pts); s.pts.geometry.dispose(); this.shells.splice(this.shells.indexOf(s), 1); }
    }
  }

  private burst(at: THREE.Vector3) {
    const pos = new Float32Array(PER * 3), vel = new Float32Array(PER * 3);
    const speed = 9 + Math.random() * 6;
    for (let i = 0; i < PER; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      pos.set([at.x, at.y, at.z], i * 3);
      vel.set([r * Math.cos(a) * speed, u * speed, r * Math.sin(a) * speed], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: COLOURS[Math.floor(Math.random() * COLOURS.length)], size: 0.9, map: this.tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    pts.frustumCulled = false;
    this.scene.add(pts);
    this.shells.push({ pts, vel, age: 0, life: 2.2 + Math.random() * 0.8 });
  }
}
