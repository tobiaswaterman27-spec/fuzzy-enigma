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
import { buildingAt, getWorld, HOUSE_IDS, setHomeDesign } from '../sim/world/layout';
import { houseOpen } from '../sim/houses';
import { capability } from '../sim/needs';
import { daylight, hourOfDay } from '../sim/clock';
import { buildWorld, type WorldView } from '../render/world';
import { Views } from '../render/views';
import { Traffic } from '../render/traffic';
import { PoliceCar } from '../render/police';
import { GatheringProps } from '../render/gatherings';
import { Harbour, MOORED } from '../render/harbour';
import { Football } from '../render/football';
import { Fireworks } from '../render/fireworks';
import { Rain } from '../render/rain';
import { Audio } from '../render/audio';
import { Sites } from '../render/sites';
import { MarketStalls } from '../render/marketStalls';
import { raining, seasonOf, snowCover, snowing } from '../sim/weather';
import { safeWrite, loadSlot, type KV } from '../sim/save';
import { news } from '../sim/events';
import { CAR_MODELS, exitCar, stealCar } from '../sim/cars';
import { forkliftAction } from '../sim/forklift';
import { attack, attackTarget, hitByVehicle, nextWeapon } from '../sim/health';
import { fitnessFactor, trainRun } from '../sim/leisure';
import { taxiBump, taxiTarget } from '../sim/taxi';
import { castFromBoat, fishingBlocker, strike } from '../sim/fishing';
import { returnBoat, WATER } from '../sim/boats';
import { hasAi } from '../ai/openai';
import { inOutage } from '../sim/inspections';

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
  traffic: Traffic;
  police: PoliceCar;
  gatheringProps: GatheringProps;
  harbour: Harbour;
  football: Football;
  fireworks: Fireworks;
  private cabMarker: THREE.Mesh | null = null;
  private seasonKey = '';
  private seasonTick = 0;
  private snowLayer: THREE.Mesh | null = null;
  private leafMats: THREE.MeshStandardMaterial[] | null = null;
  /** the season on the world: leaves turn in autumn and fall in winter; snow lies on the ground */
  private seasonLook() {
    const nowMs = performance.now();
    if (nowMs < this.seasonTick) return;
    this.seasonTick = nowMs + 1000;
    const s = this.state;
    const sea = seasonOf(s.minute);
    const cover = Math.round(snowCover(s) * 20) / 20;
    const key = `${sea}:${cover}`;
    if (key === this.seasonKey) return;
    this.seasonKey = key;
    if (!this.leafMats) {
      const found = new Set<THREE.MeshStandardMaterial>();
      this.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m && !Array.isArray(m) && m.name === 'leaves') found.add(m); });
      this.leafMats = [...found];
    }
    const tint = { spring: '#f2fff0', summer: '#ffffff', autumn: '#f0a040', winter: '#ffffff' }[sea];
    for (const m of this.leafMats) { m.color.set(tint); m.visible = sea !== 'winter'; }
    if (!this.snowLayer) {
      // a white sheet just above the grass: roads and pavements sit on top of it, so only open ground shows white
      this.snowLayer = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: '#f4f6f8', roughness: 0.95, transparent: true, opacity: 0 }));
      this.snowLayer.rotation.x = -Math.PI / 2;
      this.snowLayer.position.y = 0.008;
      this.snowLayer.receiveShadow = true;
      this.scene.add(this.snowLayer);
    }
    (this.snowLayer.material as THREE.MeshStandardMaterial).opacity = Math.min(0.92, cover);
    this.snowLayer.visible = cover > 0.02;
  }
  rain: Rain;
  audio: Audio;
  sites: Sites;
  market: MarketStalls;
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
  private sunAnchor = new THREE.Vector3();
  /** mouse look: the automatic camera waits until this time (ms) */
  private manualUntil = 0;
  /** in conversation with someone: the camera looks past your shoulder at them */
  frameTalk(npcId: string | null) {
    if (!npcId) { this.manualUntil = 0; this.zoom = this.zoomBeforeTalk ?? this.zoom; this.zoomBeforeTalk = null; return; }
    const me = this.player, o = this.state.people[npcId];
    if (!o) return;
    const f = Math.atan2(o.pos.x - me.pos.x, o.pos.z - me.pos.z);
    this.camYaw = f + Math.PI + 0.38;
    this.zoomBeforeTalk ??= this.zoom;
    this.zoom = 0.75;
    this.manualUntil = performance.now() + 3600000;
  }
  private zoomBeforeTalk: number | null = null;
  /** wheel zoom multiplier on the camera distance */
  zoom = 1;
  private distCur = 0;
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
  /** the player was hurt (for the red flash) */
  onHurt: (amount: number) => void = () => {};
  /** the player has died */
  onGameOver: (cause: string) => void = () => {};
  private lastHealth = 100;
  private hitCooldown = new Map<string, number>();
  private last = performance.now();
  private autosaveAt = performance.now() + 120000;
  insideId: string | null = null;
  sky!: Sky;
  composer: EffectComposer | null = null;
  quality: 'high' | 'medium' | 'low' = 'high';
  private cutawayOn = false;
  frameMs = 0;

  constructor(public canvas: HTMLCanvasElement, public state: GameState) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // a near plane of 0.2 m doubles depth precision over 0.1 (less flicker between close surfaces)
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.2, 500);
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
    this.quality = (() => { try { return (localStorage.getItem('bigshot.gfx') as 'high' | 'medium' | 'low') ?? 'high'; } catch { return 'high'; } })();
    this.setupComposer();
    this.world = buildWorld(this.scene);
    this.views = new Views(this.scene);
    this.traffic = new Traffic(this.scene);
    this.police = new PoliceCar(this.scene);
    this.gatheringProps = new GatheringProps(this.scene);
    this.harbour = new Harbour(this.scene);
    this.football = new Football(this.scene);
    this.fireworks = new Fireworks(this.scene);
    this.fireworks.onBang = (d) => this.audio.bang(d);
    this.football.onGoal = (m, yours) => { this.onToast(yours ? m : `${m} Not yours, that one.`); if (yours) this.player.goals = (this.player.goals ?? 0) + 1; };
    this.rain = new Rain(this.scene);
    this.sites = new Sites(this.scene);
    this.market = new MarketStalls(this.scene);
    this.audio = new Audio();
    try { this.audio.muted = localStorage.getItem('bigshot.sound') === 'off'; } catch { /* */ }
    const unlock = () => { this.audio.start(); window.removeEventListener('keydown', unlock); window.removeEventListener('pointerdown', unlock); };
    window.addEventListener('keydown', unlock); window.addEventListener('pointerdown', unlock);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bindInput();
  }

  /** re-furnish the player's home from the state's design: the world is rebuilt around the player */
  applyHomeDesign() {
    const d = this.state.homeDesigns.flat;
    if (!d) return;
    setHomeDesign(d);
    this.homeKey = JSON.stringify(d);
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
    // shadows: sharp and wide on high, cheaper further down
    const size = this.quality === 'low' ? 1024 : 2048;
    if (this.sun.shadow.mapSize.x !== size) { this.sun.shadow.mapSize.set(size, size); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }
    if (this.quality === 'low') { this.composer = null; return; }
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    const c = new EffectComposer(this.renderer);
    c.addPass(new RenderPass(this.scene, this.camera));
    if (this.quality === 'high') {
      const ao = new GTAOPass(this.scene, this.camera, w, h);
      ao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1.2, scale: 1.0 });
      ao.blendIntensity = 0.85;
      c.addPass(ao);
      c.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.12, 0.4, 0.985));
    }
    c.addPass(new OutputPass());
    c.addPass(new SMAAPass());
    this.composer = c;
  }

  private slowFrames = 0;
  private frameCount = 0;
  private autoLowered = false;
  onQualityAuto: () => void = () => {};

  /** render resolution scale (0.6..1): lowered while frames are slow, raised again when there is headroom */
  resScale = 1;
  private dtAcc = 0;
  private dtN = 0;
  private adaptResolution(dt: number) {
    if (document.hidden || this.frameCount < 120) return;
    this.dtAcc += dt; this.dtN++;
    if (this.dtAcc < 1) return;
    const avg = this.dtAcc / this.dtN;
    this.dtAcc = 0; this.dtN = 0;
    const was = this.resScale;
    if (avg > 1 / 45) this.resScale = Math.max(0.6, this.resScale - 0.1);
    else if (avg < 1 / 57) this.resScale = Math.min(1, this.resScale + 0.05);
    if (this.resScale !== was) this.resize();
  }

  /** If high quality cannot keep up (sustained frames over ~35 ms), drop to low once, automatically. */
  private watchFrameRate(dt: number) {
    this.frameCount++;
    this.adaptResolution(dt);
    if (this.quality === 'low' || this.autoLowered || document.hidden) return;
    if (this.frameCount < 120) return; // ignore start-up and shader compilation
    this.slowFrames = dt > 0.035 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 2);
    // only once lowering the resolution has not been enough
    if (this.slowFrames > 150 && this.resScale <= 0.6) {
      // one step down at a time; stop adjusting once at low
      this.setQuality(this.quality === 'high' ? 'medium' : 'low');
      this.autoLowered = (this.quality as string) === 'low';
      this.slowFrames = 0;
      this.resScale = 1;
      this.resize();
      this.onQualityAuto();
    }
  }

  setQuality(q: 'high' | 'medium' | 'low') {
    this.quality = q;
    try { localStorage.setItem('bigshot.gfx', q); } catch { /* ignore */ }
    this.setupComposer();
    this.resize();
  }

  resize() {
    // post-processing already anti-aliases, so high quality caps the pixel ratio; low renders at CSS pixels
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality === 'low' ? 1 : 1.5) * this.resScale);
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
      if (e.code === 'KeyE' && this.drivingVan()?.kind === 'forklift') {
        if (Math.abs(this.vanSpeed) > 1) { this.onToast('Stop first.'); return; }
        this.onToast(forkliftAction(this.state, this.player.id).msg);
        return;
      }
      if (e.code === 'KeyE' && this.drivingVan()?.kind === 'boat') {
        if (Math.abs(this.vanSpeed) > 1) { this.onToast('Ease off first.'); return; }
        const r = returnBoat(this.state, this.player.id);
        if (r.ok) { this.onToast(r.msg); return; }
        const why = fishingBlocker(this.state, this.player);
        if (why) { this.onToast(r.msg ? `${r.msg} (${why} to fish out here.)` : why); return; }
        castFromBoat(this.state, this.player);
        this.onToast('You cast a line over the side.');
        return;
      }
      if (e.code === 'KeyE' && this.drivingVan()?.kind === 'car') {
        if (Math.abs(this.vanSpeed) > 1.5) { this.onToast('Slow down to park.'); return; }
        this.onToast(exitCar(this.state, this.player.id).msg);
        return;
      }
      if (e.code === 'KeyF' && !this.drivingVan()) {
        const p = this.player;
        if (p.down != null || p.away || p.dead || p.sleeping) return;
        // next to the football: a shot rather than a punch
        if (this.football.near(p.pos.x, p.pos.z)) { this.football.shoot(p.facing, 9 + (p.fitness ?? 40) / 15); p.action = { type: 'attack', target: 'air', arg: 'kick', started: this.state.minute, progress: 0, unitTime: 0, duration: 0.35, units: 0 }; return; }
        const t = attackTarget(this.state, p.id);
        const msg = attack(this.state, p.id, t?.id ?? null);
        if (msg) this.onToast(msg);
        return;
      }
      if (e.code === 'KeyG' && !this.drivingVan()) {
        const p = this.player;
        if (p.down != null || p.away || p.dead || p.sleeping || p.action) return;
        const c = this.traffic.take(p.pos.x, p.pos.z);
        if (!c) { this.onToast('No car close enough (walk up to a slow or stopped car and press G).'); return; }
        this.onToast(stealCar(this.state, p.id, { x: c.x, z: c.z }, c.heading, c.color, c.body));
        return;
      }
      if (e.code === 'KeyQ' && !this.drivingVan()) { this.onToast(nextWeapon(this.state, this.player.id)); return; }
      if (e.code === 'KeyE' && this.player.action?.type === 'fish') { const m = strike(this.state, this.player); if (m) this.onToast(m); return; }
      if (e.code === 'KeyE') this.interact(0);
      if (/^Digit[1-6]$/.test(e.code)) this.interact(Number(e.code.slice(5)) - 1);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    // look around: drag with the mouse (either button) or a finger; the camera recentres by itself a few
    // seconds after you let go once you walk forward. Wheel to zoom.
    let drag: { x: number; y: number; id: number } | null = null;
    this.canvas.addEventListener('pointerdown', (e) => { if (this.uiOpen) return; drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; this.canvas.setPointerCapture?.(e.pointerId); });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      this.camYaw -= dx * 0.006;
      this.camPitch = Math.max(-0.12, Math.min(1.25, this.camPitch + dy * 0.004));
      this.manualUntil = performance.now() + 4000;
    });
    const end = (e: PointerEvent) => { if (drag?.id === e.pointerId) drag = null; };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom = Math.max(0.55, Math.min(2.2, this.zoom * (1 + Math.sign(e.deltaY) * 0.1))); }, { passive: false });
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

  onUi: (which: 'jobs' | 'advisor' | 'interview' | 'laptop' | 'homestore' | 'invite' | 'chat', arg?: string) => void = () => {};

  /** game minutes per real second right now */
  get rate() {
    const away = this.player.away;
    if (away) return away.place === 'prison' ? 900 : away.place === 'custody' ? 150 : 120;
    if (this.player.down != null) return 1;
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

  private lastDt = 0;
  tick(dt: number) {
    this.lastDt = dt;
    const s = this.state;
    if (!this.paused) {
      this.updatePlayer(dt);
      const ev = step(s, dt * this.rate);
      for (const m of ev.player) this.onToast(m);
      const hp = this.player.health ?? 100;
      if (hp < this.lastHealth - 0.5) this.onHurt(this.lastHealth - hp);
      this.lastHealth = hp;
      if (s.gameOver && !this.paused) { this.paused = true; this.onGameOver(s.gameOver.cause); }
      this.updateFocus();
      if (performance.now() > this.autosaveAt) { this.autosave(); this.autosaveAt = performance.now() + 180000; }
    }
    // the flat is refitted when an order arrives (or a save is loaded): rebuild it
    if (++this.homeCheck % 30 === 0) { const k = JSON.stringify(s.homeDesigns.flat ?? null); if (k !== this.homeKey) { if (this.homeKey) this.applyHomeDesign(); this.homeKey = k; } }
    if (!this.paused) { this.chatter(); this.approaches(); }
    this.views.update(s, this.paused ? 0 : dt, this.player.pos, this.insideId, this.speech);
    this.traffic.update(s, this.paused ? 0 : dt);
    if (s.wanted || this.police.active) {
      // the patrol car steers round everything, the car you are driving included
      const mine = this.drivingVan();
      const cols = this.collidersWithCars(undefined, true);
      if (mine) cols.push({ x0: mine.pos.x - 1.6, z0: mine.pos.z - 1.6, x1: mine.pos.x + 1.6, z1: mine.pos.z + 1.6 });
      this.police.update(s, this.paused ? 0 : dt, mine ? this.vanSpeed : Math.hypot(this.vel.x, this.vel.z), cols);
    }
    this.sites.update(s);
    this.gatheringProps.update(s);
    this.harbour.update(dt);
    this.fireworks.update(s, this.paused ? 0 : dt, this.camera.position);
    { const p = this.player; this.football.update(s, this.paused ? 0 : dt, { x: p.pos.x, z: p.pos.z, vx: this.vel.x, vz: this.vel.z, facing: p.facing }); }
    // where HarbourCabs wants you to go: a glowing ring on the kerb
    const cab = taxiTarget(s);
    if (cab) {
      if (!this.cabMarker) {
        this.cabMarker = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.07, 8, 40), new THREE.MeshStandardMaterial({ color: '#f4c20d', emissive: '#f4c20d', emissiveIntensity: 1.5 }));
        this.cabMarker.rotation.x = Math.PI / 2;
        this.scene.add(this.cabMarker);
      }
      this.cabMarker.visible = true;
      this.cabMarker.position.set(cab.pos.x, 0.15 + Math.sin(performance.now() / 300) * 0.05, cab.pos.z);
    } else if (this.cabMarker) this.cabMarker.visible = false;
    this.market.update(s, this.paused ? 0 : dt, this.player.pos);
    this.audio.update(s, this.paused ? 0 : dt, Math.hypot(this.vel.x, this.vel.z), this.drivingVan() ? this.vanSpeed : null);
    this.watchFrameRate(dt);
    this.world.update(s, dt);
    if (!this.freeCam) this.updateCamera(dt);
    this.updateLighting();
    if (this.composer && !this.freeCam) this.composer.render(); else this.renderer.render(this.scene, this.camera);
    this.onFrame();
  }

  /** townspeople chatting near the player: now and then their conversation is heard (written by the AI) */
  private chatter() {
    const now = performance.now();
    if (now < this.nextChatter) return;
    this.nextChatter = now + 40000;
    if (!hasAi()) return;
    const me = this.player.pos;
    const talkers = Object.values(this.state.people).filter((q) => q.action?.type === 'talk' && q.action.arg === 'long' && q.visible && Math.hypot(q.pos.x - me.x, q.pos.z - me.z) < 16);
    const a = talkers[0];
    const b = a ? this.state.people[a.action!.target.replace('person:', '')] : null;
    if (a && b) this.onAmbientChat(a.id, b.id);
    else this.nextChatter = now + 5000;
  }
  onAmbientChat: (a: string, b: string) => void = () => {};
  private nextChatter = 0;
  private nextApproach = 0;
  /** someone who has stopped you in the street to talk (press E on them) */
  approachBy: string | null = null;
  onApproach: (id: string) => void = () => {};

  /** now and then someone you pass stops, turns to you and starts a conversation */
  private approaches() {
    const now = performance.now();
    if (now < this.nextApproach || this.uiOpen || this.drivingVan()) return;
    this.nextApproach = now + 4000;
    const s = this.state, me = this.player;
    if (me.action || me.sleeping) return;
    const day = Math.floor(s.minute / 1440);
    for (const o of Object.values(s.people)) {
      if (o.isPlayer || !o.visible || o.sleeping || o.action || o.dead || !o.npc) continue;
      const g = o.npc.goal;
      if (g === 'work' || g === 'go_work' || g === 'shop') continue;
      const d = Math.hypot(o.pos.x - me.pos.x, o.pos.z - me.pos.z);
      if (d > 4.5 || d < 0.6) continue;
      if ((o.npc as any).approachedDay === day) continue;
      const rel = o.relations[me.id] ?? 0;
      const chance = 0.06 + o.traits.sociability * 0.12 + (rel >= 30 ? 0.15 : 0) - (o.grudge ? 0.2 : 0);
      if (Math.random() > chance) continue;
      (o.npc as any).approachedDay = day;
      o.move = null;
      o.npc.plan.unshift({ kind: 'wait', until: s.minute + 4 });
      o.facing = Math.atan2(me.pos.x - o.pos.x, me.pos.z - o.pos.z);
      this.approachBy = o.id;
      this.onApproach(o.id);
      return;
    }
  }

  /** the static colliders plus any privately owned parked cars (they move, so they are not in the layout) */
  private collidersWithCars(except?: string, noPolice = false) {
    const base = getWorld().colliders;
    // parked private cars, the delivery van and the forklift when nobody is driving them, and traffic
    const cars = Object.values(this.state.vehicles).filter((v) => v.id !== except && (v.state === 'parked' || v.state === 'loaded' || (v.driverId && v.driverId !== this.player.id)));
    const pc = noPolice ? null : this.police?.rect();
    // locked front doors on Harbour Road (open once you are let in or force them)
    const locked = HOUSE_IDS.filter((h) => !houseOpen(this.state, h)).map((h) => {
      const b = getWorld().buildings.find((x) => x.id === h)!;
      const zc = (b.rect.z0 + b.rect.z1) / 2, x = b.rect.x0 > 0 ? b.rect.x0 : b.rect.x1;
      return { x0: x - 0.15, z0: zc - 0.65, x1: x + 0.15, z1: zc + 0.65 };
    });
    return [...base, ...locked, ...this.traffic.rects(), ...(pc ? [pc] : []), ...cars.map((v) => {
      const ew = Math.abs(Math.sin(v.heading)) > 0.7;
      const hx = ew ? 2.1 : 0.95, hz = ew ? 0.95 : 2.1;
      return { x0: v.pos.x - hx, z0: v.pos.z - hz, x1: v.pos.x + hx, z1: v.pos.z + hz };
    })];
  }

  /** the van the player is driving, if any */
  drivingVan() {
    const p = this.player;
    if (p.where !== 'vehicle') return null;
    return Object.values(this.state.vehicles).find((v) => v.driverId === p.id) ?? null;
  }
  private vanSpeed = 0;
  private homeCheck = 0;
  private homeKey = '';

  /** driving: W/S throttle and brake/reverse, A/D steer; buildings and walls stop the van */
  private updateDriving(dt: number) {
    const v = this.drivingVan()!;
    const p = this.player;
    const k = this.keys;
    const canDrive = !this.uiOpen && (v.state === 'manual_out' || v.state === 'manual_back');
    const car = v.kind === 'car' ? CAR_MODELS.find((m) => m.id === v.model) : undefined;
    const thr = canDrive ? (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) : 0;
    const steer = canDrive ? (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) : 0;
    const fork = v.kind === 'forklift', boat = v.kind === 'boat';
    const MAX = fork ? 4.5 : boat ? 7.5 : car?.topSpeed ?? 11, REV = fork ? 2.5 : 3;
    if (boat && this.player.action?.type === 'fish' && thr !== 0) cancelAction(this.state, this.player, 'moved');
    if (thr > 0) this.vanSpeed += (this.vanSpeed < 0 ? 9 : 3.5) * dt;
    else if (thr < 0) this.vanSpeed -= (this.vanSpeed > 0 ? 9 : 2.5) * dt;
    else this.vanSpeed -= Math.sign(this.vanSpeed) * Math.min(Math.abs(this.vanSpeed), 2.2 * dt);
    this.vanSpeed = Math.max(-REV, Math.min(MAX, this.vanSpeed));
    // steering: tighter at low speed, the turn rate scales with how fast the wheels roll
    v.heading += steer * Math.sign(this.vanSpeed) * Math.min(Math.abs(this.vanSpeed), 3.5) * dt * 0.22;
    const nx = v.pos.x + Math.sin(v.heading) * this.vanSpeed * dt, nz = v.pos.z + Math.cos(v.heading) * this.vanSpeed * dt;
    // a boat keeps to the water: the quay wall on one side, open sea (within reason) on the other
    const res = boat ? { x: Math.max(WATER.x0, Math.min(WATER.x1, nx)), z: Math.max(WATER.z0, Math.min(WATER.z1, nz)) } : resolveCircle({ x: nx, z: nz }, fork ? 0.8 : 1.15, this.collidersWithCars(v.id));
    if (boat) for (const [mx, mz] of MOORED) {
      const dx = res.x - mx, dz = res.z - mz, d = Math.hypot(dx, dz);
      if (d < 3.4 && d > 1e-3) { res.x = mx + (dx / d) * 3.4; res.z = mz + (dz / d) * 3.4; }
    }
    if (Math.hypot(res.x - nx, res.z - nz) > 0.01) { if (Math.abs(this.vanSpeed) > 2) taxiBump(this.state); this.vanSpeed *= 0.4; } // bumped into something
    v.odometer += Math.hypot(res.x - v.pos.x, res.z - v.pos.z);
    // people in the way are hit (and knocked aside)
    if (Math.abs(this.vanSpeed) > 1.5 && !boat) {
      const now = performance.now();
      const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
      for (const o of Object.values(this.state.people)) {
        if (o.isPlayer || !o.visible || o.dead || o.where === 'vehicle') continue;
        const dx = o.pos.x - res.x, dz = o.pos.z - res.z;
        const along = dx * fx + dz * fz, side = dx * fz - dz * fx;
        if (Math.abs(along) > (fork ? 1.3 : 2.3) || Math.abs(side) > (fork ? 0.8 : 1.05)) continue;
        if ((this.hitCooldown.get(o.id) ?? 0) > now) continue;
        this.hitCooldown.set(o.id, now + 1500);
        hitByVehicle(this.state, o.id, p.id, Math.abs(this.vanSpeed));
        o.pos = resolveCircle({ x: o.pos.x + Math.sign(side || 1) * fz * 1.2 + fx * Math.sign(this.vanSpeed) * 0.8, z: o.pos.z - Math.sign(side || 1) * fx * 1.2 + fz * Math.sign(this.vanSpeed) * 0.8 }, 0.3);
        this.vanSpeed *= 0.7;
        this.onToast(`You hit ${o.name}!`);
      }
    }
    v.pos = res;
    p.pos = { ...v.pos };
    p.facing = v.heading;
  }

  private updatePlayer(dt: number) {
    const p = this.player;
    if (this.drivingVan()) { this.updateDriving(dt); return; }
    this.vanSpeed = 0;
    if (this.uiOpen || p.sleeping || p.down != null || p.away || p.dead) { this.vel.x = this.vel.z = 0; return; }
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
      const sp = (run ? RUN_SPEED * fitnessFactor(p) : WALK_SPEED) * capability(p).move;
      tx = ((fwd.x * iz + right.x * ix) / len) * sp;
      tz = ((fwd.z * iz + right.z * ix) / len) * sp;
    }
    // drunk: you weave about whether you mean to or not
    const drunk = p.drunk ?? 0;
    if (drunk > 35) {
      const t = performance.now() / 1000, sway = ((drunk - 35) / 65) * 1.1 * (len > 0 ? 1 : 0.25);
      tx += Math.sin(t * 1.3) * sway * Math.cos(p.facing); tz -= Math.sin(t * 1.3) * sway * Math.sin(p.facing);
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
    const before = p.pos;
    p.pos = resolveCircle({ x: p.pos.x + this.vel.x * dt, z: p.pos.z + this.vel.z * dt }, 0.3, this.collidersWithCars());
    if (run && speed > 3) trainRun(p, Math.hypot(p.pos.x - before.x, p.pos.z - before.z));
    // people are solid too: step round them rather than through them
    for (const o of Object.values(this.state.people)) {
      if (o.isPlayer || !o.visible || o.sleeping) continue;
      const dx = p.pos.x - o.pos.x, dz = p.pos.z - o.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.55 && d > 1e-4) { const k = (0.55 - d) / d; p.pos = resolveCircle({ x: p.pos.x + dx * k, z: p.pos.z + dz * k }, 0.3, this.collidersWithCars()); }
    }
    enforceLocationRules(this.state, p);
  }

  private updateFocus() {
    const p = this.player;
    const it = p.action || p.sleeping ? null : focusInteractable(this.state, p);
    if (!it) { this.focus = null; return; }
    const options = optionsFor(this.state, p.id, it.id);
    // talking needs the player's own OpenAI key: there are no canned conversations
    if (!hasAi()) for (const o of options) if (o.ui === 'chat') { o.enabled = false; o.reason = 'Add your OpenAI API key (Menu) to talk to people'; }
    this.focus = { id: it.id, label: it.label, options };
  }

  private updateCamera(dt: number) {
    const p = this.player;
    const inside = buildingAt(p.pos)?.id ?? null;
    if (this.overview !== this.cutawayOn || inside !== this.insideId) {
      // cut-away walls only in overview mode; in the normal camera rooms keep their walls and ceilings
      for (const [id, c] of this.world.cutaway) {
        const cut = this.overview && id === inside;
        for (const r of c.roof) r.visible = !cut;
        for (const wm of c.walls) { wm.scale.y = cut ? 0.34 : 1; wm.position.y = wm.userData.anchored ? 0 : (cut ? 0.34 : 1) * c.fullH / 2; }
      }
      this.insideId = inside;
      this.cutawayOn = this.overview;
    }
    const van = this.drivingVan();
    if (van && !this.camLocked) {
      // chase camera behind the van
      const behind = van.heading + Math.PI;
      const dYaw = ((behind - this.camYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this.camYaw += dYaw * Math.min(1, dt * 2.5);
      const fk = van.kind === 'forklift';
      this.camPitch += ((fk ? 0.45 : 0.3) - this.camPitch) * Math.min(1, dt * 2);
      if (!fk) this.camDist = Math.max(this.camDist, 7.5);
      this.camDist += ((fk ? 5 : 9) - this.camDist) * Math.min(1, dt * 2);
    } else if (!this.camLocked && performance.now() < this.manualUntil) {
      // the player is looking around with the mouse: leave the angle alone, keep the distance
      const wantDist = (p.sleeping ? 3.4 : inside ? 3.3 : 4.4) * this.zoom;
      this.camDist += (wantDist - this.camDist) * Math.min(1, dt * 3);
    } else if (!this.camLocked) {
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
      // in a small room the walls pull the camera in: look down from higher up instead
      const cramped = inside && this.distCur > 0 && this.distCur < 1.6;
      const wantPitch = p.sleeping ? 0.75 : cramped ? 0.6 : inside ? 0.42 : 0.24;
      const wantDist = (p.sleeping ? 3.4 : inside ? 3.3 : 4.4) * this.zoom;
      this.camPitch += (wantPitch - this.camPitch) * Math.min(1, dt * 2);
      this.camDist += (wantDist - this.camDist) * Math.min(1, dt * 2);
      void dYaw;
    }
    // follow the drawn body (it may be acting out a multi-step action away from its sim spot)
    const drawn = p.action ? this.views.people.get(p.id)?.rig.root.position : null;
    const pivot = new THREE.Vector3(drawn?.x ?? p.pos.x, van ? (van.kind === 'forklift' ? 2.0 : van.kind === 'boat' ? 1.0 : 2.7) : p.sleeping ? 1.0 : 1.62, drawn?.z ?? p.pos.z);
    const pitch = this.camPitch;
    const dir = new THREE.Vector3(Math.sin(this.camYaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(this.camYaw) * Math.cos(pitch));
    // over-the-shoulder offset to the right of the view direction
    const right = new THREE.Vector3(-Math.cos(this.camYaw), 0, Math.sin(this.camYaw));
    const shoulder = this.overview || van ? 0 : 0.42;
    const origin = pivot.clone().addScaledVector(right, -shoulder);
    let dist = this.camDist;
    // ray-cast against walls and buildings so the camera never ends up inside geometry
    this.raycaster.set(origin, dir);
    this.raycaster.far = dist + 0.3;
    const hits = this.raycaster.intersectObjects(this.world.occluders, false);
    if (hits.length) dist = Math.max(0.35, hits[0].distance - 0.28);
    // the distance is smoothed rather than the position: quick to pull in when a wall comes between,
    // slow to ease back out, and no lag behind the player when running (which made the view swim)
    if (this.distCur <= 0 || this.camCur.distanceTo(origin) > 15) this.distCur = dist;
    this.distCur += (dist - this.distCur) * Math.min(1, dt * (dist < this.distCur ? 18 : 3));
    if (hits.length) this.distCur = Math.min(this.distCur, dist);
    this.camCur.copy(origin).addScaledVector(dir, this.distCur);
    this.camera.position.copy(this.camCur);
    // too close to see past: hide the player's own body
    this.views.hidePlayer = this.distCur < 0.6 && !van;
    this.camera.lookAt(origin.x - dir.x * 2, origin.y - dir.y * 2 + (this.overview ? 0 : 0.05), origin.z - dir.z * 2);
    // the shadow box follows the player in whole shadow-map texels, so shadow edges do not shimmer
    const texel = (this.sun.shadow.camera.right - this.sun.shadow.camera.left) / this.sun.shadow.mapSize.x;
    this.sunAnchor.set(Math.round(p.pos.x / texel) * texel, 0, Math.round(p.pos.z / texel) * texel);
    this.sun.target.position.copy(this.sunAnchor);
  }

  private updateLighting() {
    const s = this.state;
    const d = daylight(s.minute);
    // the sun moves in 5-minute steps: a sun that turns a little every frame makes shadows crawl
    const h = Math.floor(hourOfDay(s.minute) * 12) / 12;
    const ang = ((h - 6) / 12) * Math.PI;
    const p = this.player;
    this.sun.position.set(this.sunAnchor.x + Math.cos(ang) * 50, Math.max(8, Math.sin(ang) * 70), this.sunAnchor.z + 30);
    // rain: overcast and dimmer, the fog closes in, streaks of rain around you
    const r = raining(s);
    this.rain.update(this.lastDt, buildingAt(this.player.pos) ? 0 : r, this.camera.position, snowing(this.state));
    this.seasonLook();
    this.sun.intensity = (0.15 + 2.1 * d) * (1 - 0.72 * r);
    this.sun.color.set(d < 0.6 ? '#ffc58a' : '#fff3dd');
    // sun direction drives the sky shader; the horizon colour feeds the fog so distance blends naturally
    const sunDir = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0.45).normalize();
    this.sky.material.uniforms.sunPosition.value.copy(sunDir);
    this.sky.position.set(p.pos.x, 0, p.pos.z);
    const day = new THREE.Color('#b9cfdf'), dusk = new THREE.Color('#e8a878'), night = new THREE.Color('#0d1626');
    const horizon = d > 0.5 ? dusk.clone().lerp(day, (d - 0.5) * 2) : night.clone().lerp(dusk, d * 2);
    if (r > 0) horizon.lerp(new THREE.Color(d > 0.3 ? '#8f979e' : '#1a1f26'), 0.75 * r);
    (this.scene.fog as THREE.Fog).color = horizon;
    (this.scene.fog as THREE.Fog).near = 110 - 80 * r;
    (this.scene.fog as THREE.Fog).far = 380 - 230 * r;
    const su = this.sky.material.uniforms;
    su.turbidity.value = 4 + 14 * r; su.rayleigh.value = 1.2 + 1.5 * r;
    // an overcast sky replaces the clear one as the rain sets in
    const overcast = r > 0.25;
    this.scene.background = d < 0.05 ? night : overcast ? horizon.clone() : null;
    this.sky.visible = d >= 0.05 && !overcast;
    this.scene.environmentIntensity = (this.insideId ? 0.25 : 0.15 + 0.55 * d) * (1 - 0.45 * r);
    this.hemi.intensity = (0.25 + 0.75 * d) * (this.insideId ? 0.45 : 1) * (1 - 0.25 * r);
    const lit = d < 0.45;
    this.world.lampBulbs.emissiveIntensity = lit ? 1.6 : 0;
    // buildings in a power cut stay dark
    const dark = new Set(Object.values(s.businesses).filter((b) => inOutage(b, s.minute)).map((b) => b.locationId));
    // the light pool goes to the room you are in first, then whatever lights are nearest (street lamps only at night)
    const inside = buildingAt(p.pos)?.id ?? null;
    const near = (x: number, z: number) => Math.hypot(x - p.pos.x, z - p.pos.z);
    const cands = [
      ...this.world.lightSpots.filter((l) => !dark.has(l.bid)).map((l) => ({ x: l.x, y: l.y, z: l.z, i: l.intensity, d: l.distance, c: '#fff1dc', score: near(l.x, l.z) - (l.bid === inside ? 1000 : 0) })),
      ...(lit ? getWorld().lamps.map((l) => ({ x: l.x, y: 4.6, z: l.z, i: 18, d: 18, c: '#ffcf80', score: near(l.x, l.z) + (inside ? 30 : 0) })) : []),
    ].sort((a, b) => a.score - b.score);
    this.world.lampLights.forEach((l, i) => {
      const c = cands[i];
      if (!c || c.score > 60) { l.intensity = 0; return; }
      l.position.set(c.x, c.y, c.z); l.intensity = c.i; l.distance = c.d; l.color.set(c.c);
    });
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
