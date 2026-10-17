// Game: owns the authoritative GameState, advances the simulation from real
// time, runs the player controller and camera, and feeds the renderer & UI.
import * as THREE from 'three';
import type { GameState } from '../sim/types';
import { step } from '../sim/sim';
import { cancelAction, focusInteractable, optionsFor, startAction, enforceLocationRules, type ActionOption } from '../sim/actions';
import { resolveCircle } from '../sim/world/nav';
import { buildingAt, getWorld } from '../sim/world/layout';
import { capability } from '../sim/needs';
import { daylight, hourOfDay } from '../sim/clock';
import { buildWorld, type WorldView } from '../render/world';
import { Views } from '../render/views';
import { safeWrite, loadSlot, type KV } from '../sim/save';
import { news } from '../sim/events';
import { fmtDate, fmtClock } from '../sim/clock';

export const BASE_TIME_SCALE = 1 / 3; // game minutes per real second at 1x
export const WALK_SPEED = 2.0; // m/s
export const RUN_SPEED = 4.6;

export const storage: KV = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { localStorage.setItem(k, v); },
  remove: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

export interface Focus {
  id: string;
  label: string;
  options: ActionOption[];
}

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  world: WorldView;
  views: Views;
  keys = new Set<string>();
  camYaw = Math.PI; // camera sits behind (south of) the player looking north
  camPitch = 0.75;
  camDist = 9;
  speedMult = 1;
  paused = false;
  uiOpen = false; // when a modal UI is open, movement keys are ignored
  focus: Focus | null = null;
  onToast: (msg: string) => void = () => {};
  onFrame: () => void = () => {};
  private last = performance.now();
  private dragging = false;
  private lastMouse = { x: 0, y: 0 };
  private autosaveAt = performance.now() + 120000;
  insideId: string | null = null;
  frameMs = 0;

  constructor(public canvas: HTMLCanvasElement, public state: GameState) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
    this.hemi = new THREE.HemisphereLight('#cfe6ff', '#5d6b4a', 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff3dd', 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 160;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);
    this.scene.fog = new THREE.Fog('#bcd4e6', 90, 220);
    this.world = buildWorld(this.scene);
    this.views = new Views(this.scene);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bindInput();
  }

  setState(s: GameState) {
    // rebuild dynamic views for a loaded game
    for (const v of this.views.people.values()) v.dispose(this.scene);
    this.views.people.clear();
    this.state = s;
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private bindInput() {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys.add(e.code);
      if (this.uiOpen) return;
      if (e.code === 'KeyE') this.interact(0);
      if (/^Digit[1-6]$/.test(e.code)) this.interact(Number(e.code.slice(5)) - 1);
      if (e.code === 'BracketLeft') this.camYaw += 0.3;
      if (e.code === 'BracketRight') this.camYaw -= 0.3;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.canvas.addEventListener('pointerdown', (e) => { this.dragging = true; this.lastMouse = { x: e.clientX, y: e.clientY }; this.canvas.setPointerCapture(e.pointerId); });
    this.canvas.addEventListener('pointerup', (e) => { this.dragging = false; this.canvas.releasePointerCapture(e.pointerId); });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.camYaw -= (e.clientX - this.lastMouse.x) * 0.006;
      this.camPitch = Math.min(1.35, Math.max(0.25, this.camPitch + (e.clientY - this.lastMouse.y) * 0.004));
      this.lastMouse = { x: e.clientX, y: e.clientY };
    });
    this.canvas.addEventListener('wheel', (e) => { this.camDist = Math.min(22, Math.max(3.5, this.camDist + e.deltaY * 0.01)); e.preventDefault(); }, { passive: false });
  }

  get player() { return this.state.people[this.state.playerId]; }

  /** perform the n-th option of the focused interactable */
  interact(n: number): { ok: boolean; msg: string } | null {
    const f = this.focus;
    const p = this.player;
    if (!f || p.action) return null;
    const enabled = f.options.filter((o) => o.enabled);
    const o = n === 0 ? enabled[0] ?? f.options[0] : f.options[n];
    if (!o) return null;
    if (!o.enabled) { this.onToast(o.reason ?? 'Not possible'); return { ok: false, msg: o.reason ?? '' }; }
    if (o.type === 'ui') { this.onUi(o.ui!); return { ok: true, msg: '' }; }
    const r = startAction(this.state, p.id, f.id, o.type, o.arg);
    if (!r.ok) this.onToast(r.msg);
    return r;
  }

  onUi: (which: 'jobs' | 'advisor') => void = () => {};

  /** game minutes per real second right now */
  get rate() {
    if (this.player.sleeping) return 45;
    return BASE_TIME_SCALE * this.speedMult;
  }

  start() {
    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      const t0 = performance.now();
      this.tick(dt);
      this.frameMs = this.frameMs * 0.95 + (performance.now() - t0) * 0.05;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  tick(dt: number) {
    const s = this.state;
    if (!this.paused) {
      this.updatePlayer(dt);
      const ev = step(s, dt * this.rate);
      for (const m of ev.player) this.onToast(m);
      this.updateFocus();
      if (performance.now() > this.autosaveAt) { this.autosave(); this.autosaveAt = performance.now() + 180000; }
    }
    this.views.update(s, this.paused ? 0 : dt);
    this.updateCamera(dt);
    this.updateLighting();
    this.renderer.render(this.scene, this.camera);
    this.onFrame();
  }

  private updatePlayer(dt: number) {
    const p = this.player;
    if (this.uiOpen || p.sleeping) return;
    let fx = 0, fz = 0;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) fz -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) fz += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) fx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) fx += 1;
    if (fx === 0 && fz === 0) return;
    if (p.action) cancelAction(this.state, p, 'moved');
    const len = Math.hypot(fx, fz);
    fx /= len; fz /= len;
    // camera-relative: "forward" is from camera towards player
    const fwd = { x: -Math.sin(this.camYaw), z: -Math.cos(this.camYaw) };
    const right = { x: -fwd.z, z: fwd.x };
    const dx = right.x * fx + fwd.x * -fz;
    const dz = right.z * fx + fwd.z * -fz;
    const run = k.has('ShiftLeft') || k.has('ShiftRight');
    const sp = (run ? RUN_SPEED : WALK_SPEED) * capability(p).move;
    const next = resolveCircle({ x: p.pos.x + dx * sp * dt, z: p.pos.z + dz * sp * dt }, 0.3);
    p.pos = next;
    const target = Math.atan2(dx, dz);
    p.facing = target;
    enforceLocationRules(this.state, p);
  }

  private updateFocus() {
    const p = this.player;
    const it = p.action || p.sleeping ? null : focusInteractable(this.state, p);
    if (!it) { this.focus = null; return; }
    this.focus = { id: it.id, label: it.label, options: optionsFor(this.state, p.id, it.id) };
  }

  private updateCamera(dt: number) {
    const p = this.player;
    const target = new THREE.Vector3(p.pos.x, 1.2, p.pos.z);
    const b = buildingAt(p.pos);
    const inside = b?.id ?? null;
    if (inside !== this.insideId) {
      for (const [id, c] of this.world.cutaway) {
        const cut = id === inside;
        for (const r of c.roof) r.visible = !cut;
        for (const wm of c.walls) { wm.scale.y = cut ? 0.34 : 1; wm.position.y = (cut ? 0.34 : 1) * c.fullH / 2; }
      }
      this.insideId = inside;
    }
    const dist = inside ? Math.min(this.camDist, 10) : this.camDist;
    const pitch = inside ? Math.max(this.camPitch, 0.7) : this.camPitch;
    const off = new THREE.Vector3(Math.sin(this.camYaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(this.camYaw) * Math.cos(pitch)).multiplyScalar(dist);
    const want = target.clone().add(off);
    // keep the camera out of other buildings: pull it in along the view line
    const blds = getWorld().buildings;
    for (let t = 0.15; t <= 1.001; t += 0.05) {
      const pt = target.clone().addScaledVector(off, t);
      const hit = blds.some((bb) => bb.id !== inside && pt.y < bb.height + 0.5 && pt.x > bb.rect.x0 - 0.3 && pt.x < bb.rect.x1 + 0.3 && pt.z > bb.rect.z0 - 0.3 && pt.z < bb.rect.z1 + 0.3);
      if (hit) { want.copy(target).addScaledVector(off, Math.max(0.12, t - 0.06)); break; }
    }
    this.camera.position.lerp(want, Math.min(1, dt * 8 + 0.02));
    this.camera.lookAt(target);
    this.sun.target.position.set(p.pos.x, 0, p.pos.z);
  }

  private updateLighting() {
    const s = this.state;
    const d = daylight(s.minute);
    const h = hourOfDay(s.minute);
    const ang = ((h - 6) / 12) * Math.PI;
    const p = this.player;
    this.sun.position.set(p.pos.x + Math.cos(ang) * 50, Math.max(8, Math.sin(ang) * 70), p.pos.z + 30);
    this.sun.intensity = 0.15 + 2.1 * d;
    this.sun.color.set(d < 0.6 ? '#ffc58a' : '#fff3dd');
    this.hemi.intensity = 0.25 + 0.75 * d;
    const day = new THREE.Color('#9cc7ea'), dusk = new THREE.Color('#f0a46b'), night = new THREE.Color('#0d1626');
    const sky = d > 0.5 ? dusk.clone().lerp(day, (d - 0.5) * 2) : night.clone().lerp(dusk, d * 2);
    this.scene.background = sky;
    (this.scene.fog as THREE.Fog).color = sky;
    const lit = d < 0.45;
    this.world.lampBulbs.emissiveIntensity = lit ? 1.6 : 0;
    const lamps = getWorld().lamps.slice().sort((a, b) => Math.hypot(a.x - p.pos.x, a.z - p.pos.z) - Math.hypot(b.x - p.pos.x, b.z - p.pos.z));
    this.world.lampLights.forEach((l, i) => { const lp = lamps[i]; l.position.set(lp.x, 4.6, lp.z); l.intensity = lit ? 18 : 0; });
    for (const m of this.world.windowsMat) m.emissive.set(lit ? '#3a2e1a' : '#000000');
  }

  save(slot = 'bigshot.slot1'): { ok: boolean; error?: string } {
    const s = this.state;
    const r = safeWrite(storage, slot, s, `${s.people[s.playerId].name} - ${fmtDate(s.minute)} ${fmtClock(s.minute)}`);
    return r;
  }

  autosave() {
    const r = this.save('bigshot.auto');
    if (r.ok) news(this.state, 'info', 'Autosaved', '', false);
  }

  load(slot = 'bigshot.slot1') {
    const r = loadSlot(storage, slot);
    if (r.ok) this.setState(r.state);
    return r;
  }
}
