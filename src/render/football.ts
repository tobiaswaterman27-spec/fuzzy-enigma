// A football in the park: run into it to dribble, F next to it for a shot, chip it on the run. Two
// small goals at either end of the lawn; people out in the park (and children) kick it back.
import * as THREE from 'three';
import type { GameState } from '../sim/types';
import { resolveCircle } from '../sim/world/nav';
import { gesture } from '../sim/talk';

const R = 0.11;
const CENTRE = { x: 56, z: 38 };
const GOALS = [{ x: 47, side: -1 }, { x: 65, side: 1 }];
const MOUTH = 1.0; // half-width of the goal mouth (z)
const BAR = 1.2;

function ballTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#f7f7f5'; c.fillRect(0, 0, 256, 128);
  c.fillStyle = '#1b1b1b';
  for (let i = 0; i < 12; i++) { const x = (i % 6) * 44 + (i >= 6 ? 22 : 0), y = i >= 6 ? 88 : 30; c.beginPath(); for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; c.lineTo(x + Math.cos(a) * 11, y + Math.sin(a) * 11); } c.fill(); }
  return new THREE.CanvasTexture(cv);
}

function goal(x: number, side: number): THREE.Group {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.4 });
  for (const z of [-MOUTH, MOUTH]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, BAR, 8), white); p.position.set(0, BAR / 2, z); g.add(p); }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, MOUTH * 2, 8), white);
  bar.rotation.x = Math.PI / 2; bar.position.y = BAR; g.add(bar);
  const net = new THREE.Mesh(new THREE.BoxGeometry(0.8, BAR, MOUTH * 2), new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.25, wireframe: true }));
  net.position.set(side * 0.4, BAR / 2, 0); g.add(net);
  g.position.set(x, 0, CENTRE.z);
  g.traverse((o) => { o.castShadow = true; });
  return g;
}

export class Football {
  private ball: THREE.Mesh;
  private pos = new THREE.Vector3(CENTRE.x, R, CENTRE.z);
  private vel = new THREE.Vector3();
  private npcKickAt = 0;
  private cooldown = 0;
  score = [0, 0];
  onGoal: (msg: string, yours: boolean) => void = () => {};
  private lastTouch: 'you' | 'them' = 'them';

  constructor(scene: THREE.Scene) {
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(R, 20, 14), new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.45 }));
    this.ball.castShadow = true;
    scene.add(this.ball);
    for (const g of GOALS) scene.add(goal(g.x, g.side));
  }

  /** how close the player is to the ball (for F to shoot rather than punch) */
  near(x: number, z: number) { return Math.hypot(this.pos.x - x, this.pos.z - z) < 1.1; }

  /** a deliberate shot in the direction you face */
  shoot(facing: number, power = 13) {
    this.vel.set(Math.sin(facing) * power, 3.2, Math.cos(facing) * power);
    this.cooldown = 0.4;
    this.lastTouch = 'you';
  }

  update(state: GameState, dt: number, player: { x: number; z: number; vx: number; vz: number; facing: number }) {
    if (dt <= 0) return;
    this.cooldown -= dt;
    // dribbling: running into the ball pushes it ahead of you
    const dx = this.pos.x - player.x, dz = this.pos.z - player.z, d = Math.hypot(dx, dz);
    const sp = Math.hypot(player.vx, player.vz);
    if (d < 0.45 && this.pos.y < 0.4 && this.cooldown <= 0) {
      const k = sp > 3 ? 1.6 : 1.25;
      this.vel.x = player.vx * k + (dx / (d || 1)) * 0.6;
      this.vel.z = player.vz * k + (dz / (d || 1)) * 0.6;
      if (sp > 4.2) this.vel.y = 1.2;
      this.cooldown = 0.18;
      this.lastTouch = 'you';
    }
    // people in the park kick it back now and then
    if (performance.now() > this.npcKickAt) {
      for (const p of Object.values(state.people)) {
        if (p.isPlayer || !p.visible || p.action || p.down != null || p.where !== 'park') continue;
        if (Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) > 1.4) continue;
        const a = Math.atan2(player.x - this.pos.x, player.z - this.pos.z) + (Math.random() - 0.5) * 0.6;
        this.vel.set(Math.sin(a) * (6 + Math.random() * 4), 1.5 + Math.random() * 2, Math.cos(a) * (6 + Math.random() * 4));
        gesture(state, p, 'kick', 1.2);
        this.lastTouch = 'them';
        this.npcKickAt = performance.now() + 2500;
        break;
      }
    }
    // flight and rolling
    this.vel.y -= 9.8 * dt;
    const next = this.pos.clone().addScaledVector(this.vel, dt);
    if (next.y < R) { next.y = R; this.vel.y = Math.abs(this.vel.y) > 1 ? -this.vel.y * 0.55 : 0; }
    const onGround = next.y <= R + 0.01;
    const fr = onGround ? Math.exp(-1.1 * dt) : Math.exp(-0.15 * dt);
    this.vel.x *= fr; this.vel.z *= fr;
    // walls, trees and benches: bounce off
    if (next.y < 1.2) {
      const r = resolveCircle({ x: next.x, z: next.z }, R);
      if (Math.abs(r.x - next.x) > 1e-4) { this.vel.x *= -0.6; next.x = r.x; }
      if (Math.abs(r.z - next.z) > 1e-4) { this.vel.z *= -0.6; next.z = r.z; }
    }
    // goals: the posts and bar ring, the net stops it; through the mouth is a goal
    for (const [i, g] of GOALS.entries()) {
      const crossed = (this.pos.x - g.x) * (next.x - g.x) <= 0 && Math.abs(next.x - this.pos.x) > 1e-6;
      if (!crossed) continue;
      const inside = Math.abs(next.z - CENTRE.z) < MOUTH - R && next.y < BAR - R;
      const fromFront = Math.sign(next.x - this.pos.x) === g.side;
      if (inside && fromFront) {
        this.score[i]++;
        this.onGoal(`GOAL! (${this.score[0]} - ${this.score[1]})`, this.lastTouch === 'you');
        next.set(CENTRE.x, R, CENTRE.z); this.vel.set(0, 0, 0);
        for (const p of Object.values(state.people)) if (!p.isPlayer && p.visible && p.where === 'park' && Math.hypot(p.pos.x - next.x, p.pos.z - next.z) < 25) gesture(state, p, Math.random() < 0.5 ? 'happy' : 'laugh', 2.5);
        break;
      }
      if (Math.abs(Math.abs(next.z - CENTRE.z) - MOUTH) < R + 0.05 && next.y < BAR) { this.vel.x *= -0.5; next.x = this.pos.x; }
    }
    // out of the park: back to the centre spot
    if (next.x < 40.5 || next.x > 71.5 || next.z < 8.5 || next.z > 41.5) { next.set(CENTRE.x, R, CENTRE.z); this.vel.set(0, 0, 0); }
    // roll: spin about the axis across the direction of travel
    const move = next.clone().sub(this.pos);
    const dist = Math.hypot(move.x, move.z);
    if (dist > 1e-5) this.ball.rotateOnWorldAxis(new THREE.Vector3(move.z, 0, -move.x).normalize(), dist / R);
    this.pos.copy(next);
    this.ball.position.copy(this.pos);
  }
}
