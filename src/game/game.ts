// Game: owns the authoritative GameState, advances the simulation from real
// time, runs the player controller and camera, and feeds the renderer & UI.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import type { GameState } from '../sim/types';
import { step } from '../sim/sim';
import { cancelAction, focusInteractable, optionsFor, startAction, enforceLocationRules, type ActionOption } from '../sim/actions';
import { resolveCircle } from '../sim/world/nav';
import { buildingAt, getWorld, setHomeDesign } from '../sim/world/layout';
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
  camPitch = 0.22;
  camDist = 4.2;
  overview = false;
  /** debug/screenshot scripts can pin the camera; players cannot move it */
  camLocked = false;
  /** speech bubbles over people's heads: what they are saying and until when (real seconds) */
  speech = new Map<string, { text: string; until: number }>();
  say(personId: string, text: string, seconds = 5) { this.speech.set(personId, { text, until: performance.now() + seconds * 1000 }); }
  private vel = { x: 0, z: 0 };
  private stillFor = 0;
  /** debug/photo mode: the camera is positioned externally */
  freeCam = false;
  private raycaster = new THREE.Raycaster();
  private camCur = new THREE.Vector3();
  speedMult = 1;
  paused = false;
  uiOpen = false; // when a modal UI is open, movement keys are ignored
  focus: Focus | null = null;
  onToast: (msg: string) => void = () => {};
  onFrame: () => void = () => {};
  private last = performance.now();
  private autosaveAt = performance.now() + 120000;
  insideId: string | null = null;
  sky!: Sky;
  composer: EffectComposer | null = null;
  quality: 'high' | 'low' = 'high';
  private cutawayOn = false;
  frameMs = 0;

  constructor(public canvas: HTMLCanvasElement, public state: GameState) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
    this.hemi = new THREE.HemisphereLight('#cfe6ff', '#5d6b4a', 0.9);
    this.scene.add(this.hemi);
    this.scene.add(new THREE.AmbientLight('#fff6ea', 0.35));
    this.sun = new THREE.DirectionalLight('#fff3dd', 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 160;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03; // removes saw-tooth acne on surfaces at grazing angles
    this.scene.add(this.sun, this.sun.target);
    this.scene.fog = new THREE.Fog('#bcd4e6', 110, 380);
    // physically based sky, image-based lighting for reflections, and a post-processing chain
    this.sky = new Sky();
    this.sky.scale.setScalar(450);
    const su = this.sky.material.uniforms;
    su.turbidity.value = 4; su.rayleigh.value = 1.2; su.mieCoefficient.value = 0.004; su.mieDirectionalG.value = 0.8;
    this.scene.add(this.sky);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.renderer.toneMappingExposure = 0.95;
    this.quality = (() => { try { return (localStorage.getItem('bigshot.gfx') as 'high' | 'low') ?? 'high'; } catch { return 'high'; } })();
    this.setupComposer();
    this.world = buildWorld(this.scene);
    this.views = new Views(this.scene);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bindInput();
  }

  /** re-furnish the player's home from the state's design: the world is rebuilt around the player */
  applyHomeDesign() {
    const d = this.state.homeDesigns.flat;
    if (!d) return;
    setHomeDesign(d);
    this.scene.remove(this.world.group);
    this.world = buildWorld(this.scene);
    this.cutawayOn = !this.cutawayOn; // force the cut-away state to be re-applied
    // if the new arrangement put furniture where you stand, step to the nearest free spot
    const p = this.player;
    p.pos = resolveCircle(p.pos, 0.3);
    if (p.action) cancelAction(this.state, p, 'moved');
  }

  setState(s: GameState) {
    // rebuild dynamic views for a loaded game
    for (const v of this.views.people.values()) v.dispose(this.scene);
    this.views.people.clear();
    this.state = s;
    this.applyHomeDesign();
  }

  setupComposer() {
    if (this.quality !== 'high') { this.composer = null; return; }
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    const c = new EffectComposer(this.renderer);
    c.addPass(new RenderPass(this.scene, this.camera));
    const ao = new GTAOPass(this.scene, this.camera, w, h);
    ao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1.2, scale: 1.0 });
    ao.blendIntensity = 0.85;
    c.addPass(ao);
    c.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.12, 0.4, 0.985));
    c.addPass(new OutputPass());
    c.addPass(new SMAAPass());
    this.composer = c;
  }

  private slowFrames = 0;
  private frameCount = 0;
  private autoLowered = false;
  onQualityAuto: () => void = () => {};

  /** If high quality cannot keep up (sustained frames over ~35 ms), drop to low once, automatically. */
  private watchFrameRate(dt: number) {
    if (this.quality !== 'high' || this.autoLowered || document.hidden) return;
    this.frameCount++;
    if (this.frameCount < 120) return; // ignore start-up and shader compilation
    this.slowFrames = dt > 0.035 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 2);
    if (this.slowFrames > 150) {
      this.autoLowered = true;
      this.setQuality('low');
      this.onQualityAuto();
    }
  }

  setQuality(q: 'high' | 'low') {
    this.quality = q;
    try { localStorage.setItem('bigshot.gfx', q); } catch { /* ignore */ }
    this.setupComposer();
    this.resize();
  }

  resize() {
    // post-processing already anti-aliases, so high quality caps the pixel ratio; low renders at CSS pixels
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality === 'high' ? 1.5 : 1));
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
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
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    // the camera is fully automatic: no mouse look, zoom or camera keys
  }

  releaseMouse() { if (document.pointerLockElement) document.exitPointerLock(); }

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
    if (o.type === 'ui') { this.onUi(o.ui!, o.arg); return { ok: true, msg: '' }; }
    const r = startAction(this.state, p.id, f.id, o.type, o.arg);
    if (!r.ok) this.onToast(r.msg);
    return r;
  }

  onUi: (which: 'jobs' | 'advisor' | 'interview' | 'laptop', arg?: string) => void = () => {};

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
    this.views.update(s, this.paused ? 0 : dt, this.player.pos, this.insideId, this.speech);
    this.watchFrameRate(dt);
    this.world.update(s, dt);
    if (!this.freeCam) this.updateCamera(dt);
    this.updateLighting();
    if (this.composer && !this.freeCam) this.composer.render(); else this.renderer.render(this.scene, this.camera);
    this.onFrame();
  }

  private updatePlayer(dt: number) {
    const p = this.player;
    if (this.uiOpen || p.sleeping) return;
    // movement is relative to the camera: W away from the camera, S towards it, A/D to the sides.
    // The body accelerates, decelerates and turns smoothly towards where it is going.
    const k = this.keys;
    let ix = 0, iz = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) iz += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) iz -= 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) ix -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) ix += 1;
    const run = k.has('ShiftLeft') || k.has('ShiftRight');
    const len = Math.hypot(ix, iz);
    const fwd = { x: -Math.sin(this.camYaw), z: -Math.cos(this.camYaw) };
    const right = { x: -fwd.z, z: fwd.x };
    let tx = 0, tz = 0;
    if (len > 0) {
      if (p.action) cancelAction(this.state, p, 'moved');
      const sp = (run ? RUN_SPEED : WALK_SPEED) * capability(p).move;
      tx = ((fwd.x * iz + right.x * ix) / len) * sp;
      tz = ((fwd.z * iz + right.z * ix) / len) * sp;
    }
    // acceleration: quick to start, a little slower to stop
    const acc = len > 0 ? 7 : 9;
    this.vel.x += (tx - this.vel.x) * Math.min(1, dt * acc);
    this.vel.z += (tz - this.vel.z) * Math.min(1, dt * acc);
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed < 0.03 && len === 0) { this.vel.x = this.vel.z = 0; return; }
    if (len > 0) {
      const want = Math.atan2(tx, tz);
      let d = ((want - p.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      p.facing += d * Math.min(1, dt * 9);
    }
    p.pos = resolveCircle({ x: p.pos.x + this.vel.x * dt, z: p.pos.z + this.vel.z * dt }, 0.3);
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
    const inside = buildingAt(p.pos)?.id ?? null;
    if (this.overview !== this.cutawayOn || inside !== this.insideId) {
      // cut-away walls only in overview mode; in the normal camera rooms keep their walls and ceilings
      for (const [id, c] of this.world.cutaway) {
        const cut = this.overview && id === inside;
        for (const r of c.roof) r.visible = !cut;
        for (const wm of c.walls) { wm.scale.y = cut ? 0.34 : 1; wm.position.y = (cut ? 0.34 : 1) * c.fullH / 2; }
      }
      this.insideId = inside;
      this.cutawayOn = this.overview;
    }
    if (!this.camLocked) {
      // automatic camera: settles behind the player; closer and higher indoors so rooms read clearly
      const behind = p.facing + Math.PI;
      let dYaw = ((behind - this.camYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      // only walking forward (W) swings the view round behind you; strafing or walking towards the camera
      // keeps it still so directions stay stable. After standing still for a moment it recentres gently.
      const spd = Math.hypot(this.vel.x, this.vel.z);
      const fwdKey = this.keys.has('KeyW') || this.keys.has('ArrowUp');
      const backKey = this.keys.has('KeyS') || this.keys.has('ArrowDown');
      if (spd > 0.3 || p.action) this.stillFor = 0; else this.stillFor += dt;
      const rate = spd > 0.3 ? (fwdKey && !backKey ? 0.8 + 0.4 * Math.min(1, spd / 4) : 0) : p.action ? 0.6 : this.stillFor > 1.5 ? 0.5 : 0;
      this.camYaw += dYaw * Math.min(1, dt * rate);
      const wantPitch = p.sleeping ? 0.75 : inside ? 0.42 : 0.24;
      const wantDist = p.sleeping ? 3.4 : inside ? 3.3 : 4.4;
      this.camPitch += (wantPitch - this.camPitch) * Math.min(1, dt * 2);
      this.camDist += (wantDist - this.camDist) * Math.min(1, dt * 2);
      void dYaw;
    }
    // follow the drawn body (it may be acting out a multi-step action away from its sim spot)
    const drawn = p.action ? this.views.people.get(p.id)?.rig.root.position : null;
    const pivot = new THREE.Vector3(drawn?.x ?? p.pos.x, p.sleeping ? 1.0 : 1.62, drawn?.z ?? p.pos.z);
    const pitch = this.camPitch;
    const dir = new THREE.Vector3(Math.sin(this.camYaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(this.camYaw) * Math.cos(pitch));
    // over-the-shoulder offset to the right of the view direction
    const right = new THREE.Vector3(-Math.cos(this.camYaw), 0, Math.sin(this.camYaw));
    const shoulder = this.overview ? 0 : 0.42;
    const origin = pivot.clone().addScaledVector(right, -shoulder);
    let dist = this.camDist;
    // ray-cast against walls and buildings so the camera never ends up inside geometry
    this.raycaster.set(origin, dir);
    this.raycaster.far = dist + 0.3;
    const hits = this.raycaster.intersectObjects(this.world.occluders, false);
    if (hits.length) dist = Math.max(0.35, hits[0].distance - 0.28);
    const want = origin.clone().addScaledVector(dir, dist);
    if (this.camCur.lengthSq() === 0 || this.camCur.distanceTo(want) > 12) this.camCur.copy(want);
    // pull in instantly when blocked, ease back out otherwise
    const k = hits.length ? 1 : Math.min(1, dt * 10);
    this.camCur.lerp(want, k);
    this.camera.position.copy(this.camCur);
    this.camera.lookAt(origin.x - dir.x * 2, origin.y - dir.y * 2 + (this.overview ? 0 : 0.05), origin.z - dir.z * 2);
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
    // sun direction drives the sky shader; the horizon colour feeds the fog so distance blends naturally
    const sunDir = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0.45).normalize();
    this.sky.material.uniforms.sunPosition.value.copy(sunDir);
    this.sky.position.set(p.pos.x, 0, p.pos.z);
    const day = new THREE.Color('#b9cfdf'), dusk = new THREE.Color('#e8a878'), night = new THREE.Color('#0d1626');
    const horizon = d > 0.5 ? dusk.clone().lerp(day, (d - 0.5) * 2) : night.clone().lerp(dusk, d * 2);
    (this.scene.fog as THREE.Fog).color = horizon;
    this.scene.background = d < 0.05 ? night : null;
    this.sky.visible = d >= 0.05;
    this.scene.environmentIntensity = (this.insideId ? 0.25 : 0.15 + 0.55 * d);
    this.hemi.intensity = (0.25 + 0.75 * d) * (this.insideId ? 0.45 : 1);
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
