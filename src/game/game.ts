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
import type { GameState , Vehicle } from '../sim/types';
import { step } from '../sim/sim';
import { cancelAction, focusInteractable, optionsFor, startAction, enforceLocationRules, type ActionOption } from '../sim/actions';
import { resolveCircle } from '../sim/world/nav';
import { buildingAt, collidersIn, DWELLING_IDS, dwellingDoor, getWorld, stairCross, stairY, publicDoors, setHomeDesign, shellAt, SHOP_IDS } from '../sim/world/layout';
import { shopLocked } from '../sim/breakins';
import { onPcsoShift } from '../sim/station';
import { finishRace, RACES } from '../sim/races';
import { missionGoal } from '../sim/missions';
import { CarSeq } from '../render/carseq';
import { RAMPS, type Ramp } from '../sim/world/spots';
import { landedJump } from '../sim/stunts';
import { Emergency } from '../render/emergency';
import { Pigeons } from '../render/pigeons';
import { Skids } from '../render/skids';
import { voice } from '../render/voice';
import { leaveBike } from '../sim/bikes';
import { BusSeq } from '../render/busseq';
import { STREETS } from '../sim/world/city';
import { busStops, canRideBus, rideBus } from '../sim/bus';
import { walletSpots } from '../sim/collect';
import { planRoute } from '../sim/world/nav';
import { LEVEL_DX, levelOf, planX, sceneOf , LEVEL_H } from '../sim/world/levels';
import { houseOpen } from '../sim/houses';
import { capability } from '../sim/needs';
import { daylight, hourOfDay } from '../sim/clock';
import { buildWorld, setCarLights, type WorldView } from '../render/world';
import { setWet } from '../render/wet';
import { Views } from '../render/views';
import { CityView } from '../render/city';
import { dogDies } from '../sim/rescue';
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
import { CAR_MODELS, damageCar, enterCar, exitCar, stealCar, stealOwnedCar, stealParked } from '../sim/cars';
import { forkliftAction } from '../sim/forklift';
import { attack, attackTarget, crime, flee, floor, hitByVehicle, nextWeapon } from '../sim/health';
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

/** how far along a ray it is to the first city building (a box from the ground to its roof) */
function cityBlock(o: THREE.Vector3, d: THREE.Vector3, max: number): number {
  let best = max;
  const city = getWorld().city;
  for (const list of [city.buildings, city.opened ?? []]) for (const b of list) {
    const r = b.rect;
    if (r.x1 < o.x - max - 1 || r.x0 > o.x + max + 1 || r.z1 < o.z - max - 1 || r.z0 > o.z + max + 1) continue;
    // the building you are in (an opened venue) is the world view's business
    if (o.x > r.x0 - 0.3 && o.x < r.x1 + 0.3 && o.z > r.z0 - 0.3 && o.z < r.z1 + 0.3 && o.y < b.height) continue;
    // slab test against the box, a little fattened
    let t0 = 0, t1 = best;
    for (const [oo, dd, lo, hi] of [[o.x, d.x, r.x0 - 0.2, r.x1 + 0.2], [o.y, d.y, -1, b.height + 0.5], [o.z, d.z, r.z0 - 0.2, r.z1 + 0.2]]) {
      if (Math.abs(dd) < 1e-6) { if (oo < lo || oo > hi) { t0 = Infinity; break; } continue; }
      let a = (lo - oo) / dd, c = (hi - oo) / dd;
      if (a > c) [a, c] = [c, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, c);
      if (t0 > t1) break;
    }
    if (t0 <= t1 && t0 < best) best = t0;
  }
  return best;
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
  city!: CityView;
  private nightLevel = 0;
  private lampCache: { at: { x: number; z: number }; list: { x: number; z: number }[] } | null = null;
  /** the city's street lamps within reach of the light pool (refreshed as you move) */
  private cityLampsNear(p: { x: number; z: number }) {
    if (!this.lampCache || Math.hypot(this.lampCache.at.x - p.x, this.lampCache.at.z - p.z) > 20) this.lampCache = { at: { x: p.x, z: p.z }, list: getWorld().city.props.filter((q) => q.kind === 'lamp' && Math.abs(q.x - p.x) < 80 && Math.abs(q.z - p.z) < 80) };
    return this.lampCache.list;
  }
  private beatMarkers: THREE.Mesh[] = [];
  /** a street race in progress */
  race: { id: string; cp: number; t0: number } | null = null;
  raceText = '';
  private raceRing: THREE.Mesh | null = null;
  private startRings: THREE.Mesh[] = [];
  private walletMeshes = new Map<number, THREE.Object3D>();
  /** where you are heading (set on the phone map): a beam of light there, and a line along the streets */
  waypoint: { x: number; z: number } | null = null;
  private wpBeam: THREE.Mesh | null = null;
  private wpLine: THREE.Line | null = null;
  private wpAt = 0;
  setWaypoint(p: { x: number; z: number } | null) { this.waypoint = p; this.wpAt = 0; }
  private updateWaypoint() {
    const wp = this.waypoint, p = this.player;
    if (!this.wpBeam) {
      this.wpBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 120, 12, 1, true), new THREE.MeshBasicMaterial({ color: '#ffd400', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
      this.wpBeam.position.y = 60; this.scene.add(this.wpBeam);
      this.wpLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#ffd400' }));
      this.scene.add(this.wpLine);
    }
    this.wpBeam.visible = this.wpLine!.visible = !!wp;
    if (!wp) return;
    this.wpBeam.position.set(wp.x, 60, wp.z);
    const here = { x: planX(p.pos.x), z: p.pos.z };
    if (Math.hypot(wp.x - here.x, wp.z - here.z) < 8) { this.onToast('You have arrived.'); this.waypoint = null; return; }
    // re-plan the route now and then (along the pavements, which follow every road)
    if (performance.now() - this.wpAt > 2500) {
      this.wpAt = performance.now();
      const route = planRoute(here, wp) ?? [wp];
      const pts = [here, ...route].map((q) => new THREE.Vector3(q.x, 0.35, q.z));
      (this.wpLine!.geometry as THREE.BufferGeometry).setFromPoints(pts);
    }
  }
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
  say(personId: string, text: string, seconds = 5) {
    this.speech.set(personId, { text, until: performance.now() + seconds * 1000 });
    // out loud, too (not your own lines: those are yours to say)
    const o = this.state.people[personId];
    if (o && personId !== this.player.id) voice.say(personId, text, o.appearance?.frame === 'f', Math.hypot(planX(o.pos.x) - planX(this.player.pos.x), o.pos.z - this.player.pos.z), this.audio.muted);
  }
  private vel = { x: 0, z: 0 };
  private sunAnchor = new THREE.Vector3();
  /** mouse look: the automatic camera waits until this time (ms) */
  private manualUntil = 0;
  private camAt: { x: number; z: number } | null = null;
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
  /** the title screen: the camera drifts on its own round the harbour and the towers behind it (t in seconds) */
  titleShot(t: number): number {
    this.freeCam = true; this.insideId = null;
    // three shots, twelve seconds each: high round the harbour, down a street at head height, in over the water
    const SHOT = 12, shot = Math.floor(t / SHOT) % 3, u = t % SHOT;
    const c = this.camera;
    if (shot === 0) {
      const a = 2.2 + t * 0.035, cx = 0, cz = -70, r = 165 - Math.sin(t * 0.05) * 35;
      c.position.set(cx + Math.cos(a) * r, 40 + Math.sin(t * 0.09) * 14, cz + Math.sin(a) * r);
      c.lookAt(cx + Math.cos(a + 1.2) * 30, 14, cz + Math.sin(a + 1.2) * 30 - 30);
    } else if (shot === 1) {
      c.position.set(-3.5, 2.6 + Math.sin(u * 0.8) * 0.15, -18 - u * 5.5);
      c.lookAt(-1 + Math.sin(u * 0.2) * 3, 3.5, -140 - u * 5.5);
    } else {
      c.position.set(-150 + u * 14, 7 + u * 0.8, 130 - u * 2);
      c.lookAt(-40 + u * 6, 12, -40);
    }
    // how dark the cut is (a quick dip to black between shots)
    return Math.max(0, 1 - u / 0.7, (u - SHOT + 0.7) / 0.7);
  }
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
  /** a car break-in under way: the window goes at `at` (sim minutes) */
  private theft: { at: number; kerb: number | null; car: string | null } | null = null;
  private carSeq!: CarSeq;
  private emergency!: Emergency;
  private pigeons!: Pigeons;
  private skids!: Skids;
  /** where the player is throwing crumbs: the ground in front of the bench */
  private crumbsAt() {
    const it = getWorld().interactables[this.player.action?.target ?? ''];
    const px = planX(this.player.pos.x), pz = this.player.pos.z;
    if (!it) return { x: px, z: pz };
    const dx = it.pos.x - it.obj.x, dz = it.pos.z - it.obj.z, l = Math.hypot(dx, dz) || 1;
    return { x: px + dx / l * 1.8, z: pz + dz / l * 1.8 };
  }
  private busSeq!: BusSeq;
  private wasOnBus = false;
  /** which way the road is from a pavement spot: +1 towards +z, -1 towards -z */
  private roadSide(z: number) {
    const streets = [0, ...STREETS];
    const s = streets.reduce((a, b) => (Math.abs(b - z) < Math.abs(a - z) ? b : a));
    return s >= z ? 1 : -1;
  }
  /** wait at the stop for the bus, get on, and go (the fare and the ride are the sim's) */
  boardBus(toId: string) {
    const p = this.player;
    const why = canRideBus(this.state, p.id, toId);
    if (why) { this.onToast(why); return; }
    const stop = busStops().reduce((a, b) => (Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z) < Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z) ? b : a));
    p.pos = { ...stop.pos };
    this.busSeq.start('board', stop.pos, this.roadSide(stop.pos.z), () => this.onToast(rideBus(this.state, p.id, toId).msg));
  }
  /** the driver of a car you have taken: out on the road and running */
  private ejectDriver(at: { x: number; z: number }) {
    const s = this.state;
    const o = Object.values(s.people).find((q) => q.id.startsWith('crowd_') && !q.visible && !q.dead && !q.away);
    if (!o) return;
    o.pos = { ...at }; o.visible = true; o.where = 'outside'; o.move = null; o.action = null;
    o.gesture = { clip: 'scared', until: s.minute + 0.6 };
    o.relations[this.player.id] = 0;
    flee(s, o, this.player.pos);
  }
  frameMs = 0;

  constructor(public canvas: HTMLCanvasElement, public state: GameState) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.localClippingEnabled = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // a near plane of 0.2 m doubles depth precision over 0.1 (less flicker between close surfaces)
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.12, 2200);
    this.hemi = new THREE.HemisphereLight('#cfe6ff', '#5d6b4a', 0.9);
    this.scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight('#fff6ea', 0.35);
    this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight('#fff3dd', 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 160;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03; // removes saw-tooth acne on surfaces at grazing angles
    this.scene.add(this.sun, this.sun.target);
    this.scene.fog = new THREE.Fog('#bcd4e6', 200, 950);
    // physically based sky, image-based lighting for reflections, and a post-processing chain
    this.sky = new Sky();
    this.sky.scale.setScalar(1000);
    const su = this.sky.material.uniforms;
    su.turbidity.value = 4; su.rayleigh.value = 1.2; su.mieCoefficient.value = 0.004; su.mieDirectionalG.value = 0.8;
    this.scene.add(this.sky);
    if (this.stars) this.scene.add(this.stars);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.renderer.toneMappingExposure = 0.95;
    // medium by default: high adds ambient occlusion, which draws the whole scene a second time.
    // Anyone on high from before that change is moved down once (they can pick high again).
    this.quality = (() => {
      try {
        if (!localStorage.getItem('bigshot.gfx.v2')) { localStorage.setItem('bigshot.gfx.v2', '1'); if (localStorage.getItem('bigshot.gfx') === 'high') localStorage.setItem('bigshot.gfx', 'medium'); }
        return (localStorage.getItem('bigshot.gfx') as 'high' | 'medium' | 'low') ?? 'medium';
      } catch { return 'medium'; }
    })();
    this.setupComposer();
    this.world = buildWorld(this.scene);
    this.city = new CityView(this.scene, getWorld().city);
    this.views = new Views(this.scene);
    this.views.onBoom = (x, z) => this.audio.boom(Math.hypot(x - this.player.pos.x, z - this.player.pos.z));
    this.traffic = new Traffic(this.scene);
    this.carSeq = new CarSeq(this.scene);
    this.carSeq.onSound = (w) => this.audio.car(w);
    this.traffic.onHorn = (x, z) => this.audio.horn(Math.hypot(x - this.player.pos.x, z - this.player.pos.z));
    this.emergency = new Emergency(this.scene, this.views.fx);
    this.pigeons = new Pigeons(this.scene);
    this.skids = new Skids(this.scene);
    this.busSeq = new BusSeq(this.scene);
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
      if (e.code === 'KeyE' && this.drivingVan()?.kind === 'bike') {
        if (Math.abs(this.vanSpeed) > 2.5) { this.onToast('Slow down first.'); return; }
        this.onToast(leaveBike(this.state, this.player.id));
        return;
      }
      if (e.code === 'KeyR' && this.drivingVan() && this.drivingVan()!.kind !== 'bike') { this.onToast(this.audio.radio.cycle()); return; }
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
        const v = this.drivingVan()!;
        this.carSeq.start('out', v.color ?? '#888', v.pos.x, v.pos.z, v.heading, this.player.pos, () => this.onToast(exitCar(this.state, this.player.id).msg));
        // out of the other side (the driver's door was against something): no door to act out
        const d = this.carSeq.doorSpot(v.pos.x, v.pos.z, v.heading);
        if (Math.hypot(d.x - this.player.pos.x, d.z - this.player.pos.z) > 0.8) this.carSeq.stop();
        return;
      }
      if (e.code === 'KeyF' && !this.drivingVan()) {
        const p = this.player;
        if (p.down != null || p.away || p.dead || p.sleeping) return;
        // next to the football: a shot rather than a punch
        if (this.football.near(p.pos.x, p.pos.z)) { this.football.shoot(p.facing, 9 + (p.fitness ?? 40) / 15); p.action = { type: 'attack', target: 'air', arg: 'kick', started: this.state.minute, progress: 0, unitTime: 0, duration: 0.35, units: 0 }; return; }
        const t = attackTarget(this.state, p.id);
        const msg = attack(this.state, p.id, t?.id ?? null);
        this.audio.punch(false);
        if (msg) this.onToast(msg);
        return;
      }
      if (e.code === 'KeyG' && !this.drivingVan()) {
        const p = this.player;
        if (p.down != null || p.away || p.dead || p.sleeping || p.action) return;
        // a parked car (at the kerb, or someone's own): go to the driver's door and smash the window
        const w = getWorld();
        const near = (x: number, z: number) => Math.hypot(x - p.pos.x, z - p.pos.z);
        const kerb = w.parked.map((c, i) => ({ i, c })).filter(({ i, c }) => !(this.state.takenParked ?? []).includes(i) && near(c.pos.x, c.pos.z) < 3.4).sort((a, b) => near(a.c.pos.x, a.c.pos.z) - near(b.c.pos.x, b.c.pos.z))[0];
        const owned = Object.values(this.state.vehicles).filter((v) => v.kind === 'car' && v.state === 'parked' && v.ownerId !== p.id && near(v.pos.x, v.pos.z) < 3.4)[0];
        if (kerb || owned) {
          // round to the driver's door, put the window in, open up and get in
          const at = kerb ? { x: kerb.c.pos.x, z: kerb.c.pos.z, h: kerb.c.rot, col: kerb.c.color } : { x: owned!.pos.x, z: owned!.pos.z, h: owned!.heading, col: owned!.color ?? '#888' };
          this.carSeq.start('in', at.col, at.x, at.z, at.h, p.pos, () => {
            if (p.down != null || p.dead || p.where === 'vehicle') return;
            this.onToast(kerb ? stealParked(this.state, p.id, kerb.i) : stealOwnedCar(this.state, p.id, owned!.id));
          }, true);
          setTimeout(() => this.audio.smash(), 750);
          return;
        }
        const c = this.traffic.take(p.pos.x, p.pos.z);
        if (!c) { this.onToast('No car close enough (walk up to a car and press G).'); return; }
        // the car-jack: the door is yanked open and the driver dragged out before you get in
        this.carSeq.start('in', c.color, c.x, c.z, c.heading, p.pos, () => {
          this.scene.remove(c.obj);
          this.ejectDriver(this.carSeq.doorSpot(c.x, c.z, c.heading));
          this.onToast(stealCar(this.state, p.id, { x: c.x, z: c.z }, c.heading, c.color, c.body));
        });
        return;
      }
      // hands up: stand still and let them take you in (a lighter sentence)
      if (e.code === 'KeyH' && !this.drivingVan() && this.state.wanted && !this.state.wanted.surrender) {
        this.state.wanted.surrender = true;
        this.player.gesture = { clip: 'scared', until: this.state.minute + 99 };
        this.onToast('Hands up. You wait for the police to reach you (move to change your mind).');
        return;
      }
      if (e.code === 'Space' && !this.drivingVan() && this.jumpY === 0 && !this.player.action && this.player.down == null && !this.player.away) { this.jumpV = 4.2; this.jumpY = 0.001; e.preventDefault(); return; }
      if (e.code === 'KeyQ' && !this.drivingVan()) { this.onToast(nextWeapon(this.state, this.player.id)); return; }
      if (e.code === 'KeyE' && this.player.action?.type === 'fish') { const m = strike(this.state, this.player); if (m) this.onToast(m); return; }
      if (e.code === 'KeyE') this.interact(0);
      if (/^Digit[1-6]$/.test(e.code)) this.interact(Number(e.code.slice(5)) - 1);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    // look around: drag with the mouse (either button) or a finger; the camera recentres by itself a few
    // seconds after you let go once you walk forward. Wheel to zoom.
    let drag: { x: number; y: number; id: number } | null = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      if (this.uiOpen) return;
      // a click captures the mouse so it turns the camera, as in GTA (Esc lets it go); touch drags
      if (e.pointerType === 'mouse' && !document.pointerLockElement) { try { (this.canvas.requestPointerLock as () => unknown)?.call(this.canvas); } catch { /* not allowed here */ } }
      drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; this.canvas.setPointerCapture?.(e.pointerId);
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.canvas || this.uiOpen) return;
      this.camYaw -= e.movementX * 0.0035;
      this.camPitch = Math.max(-0.12, Math.min(1.25, this.camPitch + e.movementY * 0.0025));
      this.manualUntil = performance.now() + 2500;
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId || document.pointerLockElement === this.canvas) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      this.camYaw -= dx * 0.006;
      this.camPitch = Math.max(-0.12, Math.min(1.25, this.camPitch + dy * 0.004));
      this.manualUntil = performance.now() + 2500;
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
    if (o.type === 'drive_car') {
      const v = this.state.vehicles[f.id.slice(4)];
      if (v) { this.carSeq.start('in', v.color ?? '#888', v.pos.x, v.pos.z, v.heading, p.pos, () => this.onToast(enterCar(this.state, p.id, v.id))); return { ok: true, msg: '' }; }
    }
    const r = startAction(this.state, p.id, f.id, o.type, o.arg);
    if (!r.ok) this.onToast(r.msg);
    return r;
  }

  private radioOn = false;
  private ambient!: THREE.AmbientLight;
  private wetness = 0;
  private boltAt = 0;
  private chimeAt = 0;
  /** stars in the night sky: a shell of points round the camera */
  private stars: THREE.Points | null = (() => {
    const n = 1800, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, y = Math.abs(u) * 0.95 + 0.05, r = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(a) * r * 900; pos[i * 3 + 1] = y * 900; pos[i * 3 + 2] = Math.sin(a) * r * 900;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffffff', size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  })();
  private jumpY = 0;
  private jumpV = 0;
  private boltDist = 800;
  onUi: (which: 'jobs' | 'advisor' | 'interview' | 'laptop' | 'homestore' | 'invite' | 'chat' | 'darts' | 'bus' | 'train' | 'roulette' | 'blackjack', arg?: string) => void = () => {};

  /** game minutes per real second right now */
  get rate() {
    const away = this.player.away;
    // inside HMP Harbourside on your feet the days go by quickly; on your bunk, very quickly
    if (away?.place === 'prison' && this.player.visible) return this.state.serving ? 900 : 12;
    if (away) return away.place === 'prison' ? 900 : away.place === 'custody' ? 150 : away.place === 'bus' || away.place === 'train' ? 40 : away.place === 'stadium' ? 60 : 120;
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
    if (!this.paused) { this.chatter(); this.approaches(); this.remarks(); }
    this.views.update(s, this.paused ? 0 : dt, this.player.pos, this.insideId, this.speech);
    // a jump: up and down, knees tucked in the air
    if (this.jumpY > 0 || this.jumpV > 0) {
      const ddt = this.paused ? 0 : dt;
      this.jumpY += this.jumpV * ddt; this.jumpV -= 9.8 * ddt;
      if (this.jumpY <= 0) { this.jumpY = 0; this.jumpV = 0; this.audio.land(); }
      const v = this.views.playerView(s);
      if (v && this.jumpY > 0) {
        v.rig.body.position.y += this.jumpY;
        const k = Math.min(1, this.jumpY / 0.25);
        for (const sd of ['L', 'R'] as const) { v.rig.bones[`thigh${sd}`].rotateX(-0.7 * k); v.rig.bones[`shin${sd}`].rotateX(1.1 * k); }
        v.rig.bones.armL.rotateZ(0.5 * k); v.rig.bones.armR.rotateZ(-0.5 * k);
      }
    }
    this.traffic.update(s, this.paused ? 0 : dt);
    if (s.wanted || this.police.active) {
      // the patrol car steers round everything, the car you are driving included
      const mine = this.drivingVan();
      const cols = this.collidersWithCars(undefined, true, this.player.pos, 60);
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
    this.updateRace();
    this.updateMission();
    this.updateThief();
    // the ice cream van's chime as you come near (now and then)
    if (performance.now() > this.chimeAt) {
      const iv = Object.values(getWorld().interactables).filter((i) => i.kind === 'ice_cream').map((i) => Math.hypot(i.pos.x - this.player.pos.x, i.pos.z - this.player.pos.z)).sort((a, b) => a - b)[0] ?? Infinity;
      if (iv < 45) { this.audio.chime(iv); this.chimeAt = performance.now() + 40000; } else this.chimeAt = performance.now() + 2000;
    }
    this.updateWaypoint();
    this.updateWallets();
    // a PCSO's beat: a yellow ring at each point still to check in at
    const beat = this.state.beat && this.state.beat.by === this.player.id && onPcsoShift(this.state, this.player.id) ? this.state.beat.points.filter((q) => !q.done) : [];
    while (this.beatMarkers.length < beat.length) {
      const m = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.06, 8, 40), new THREE.MeshStandardMaterial({ color: '#2f6fd6', emissive: '#4a8cff', emissiveIntensity: 1.4 }));
      m.rotation.x = Math.PI / 2; this.scene.add(m); this.beatMarkers.push(m);
    }
    this.beatMarkers.forEach((m, i) => { const q = beat[i]; m.visible = !!q; if (q) m.position.set(q.x, 0.15 + Math.sin(performance.now() / 350 + i) * 0.05, q.z); });
    this.market.update(s, this.paused ? 0 : dt, this.player.pos);
    // the first time you get behind the wheel the radio comes on
    if (!this.radioOn && this.drivingVan()?.kind === 'car') { this.radioOn = true; if (this.audio.radio.station < 0) this.onToast(`${this.audio.radio.cycle()} · R to change station`); }
    // back behind the wheel: what's on the radio
    const inCar = this.drivingVan()?.kind === 'car';
    if (inCar && !this.wasInCar && this.audio.radio.station >= 0 && this.radioOn) this.onToast(this.audio.radio.nowPlaying());
    this.wasInCar = inCar;
    this.audio.update(s, this.paused ? 0 : dt, Math.hypot(this.vel.x, this.vel.z), this.drivingVan() ? this.vanSpeed : null);
    this.watchFrameRate(dt);
    this.world.update(s, dt);
    this.emergency.update(s, this.paused ? 0 : dt, { x: planX(this.player.pos.x), z: this.player.pos.z });
    this.audio.siren(this.emergency.sirenAt);
    this.listenFor(s);
    this.audio.screech(this.paused ? 0 : this.skid);
    if (!this.insideId) {
      // the pigeons mind the player, anyone walking past, and the traffic
      const px = planX(this.player.pos.x), pz = this.player.pos.z;
      const feeding = this.player.action?.type === 'feed_pigeons';
      const threats: { x: number; z: number; speed: number; car?: boolean }[] = feeding ? [] : [{ x: px, z: pz, speed: this.drivingVan() ? Math.abs(this.vanSpeed) : Math.hypot(this.vel.x, this.vel.z), car: !!this.drivingVan() }];
      for (const p of Object.values(s.people)) if (p.id !== this.player.id && p.where === 'outside' && p.visible && Math.abs(planX(p.pos.x) - px) < 60 && Math.abs(p.pos.z - pz) < 60) threats.push({ x: planX(p.pos.x), z: p.pos.z, speed: p.move ? 1.3 : 0 });
      for (const c of this.traffic.cars) if (Math.abs(c.obj.position.x - px) < 60 && Math.abs(c.obj.position.z - pz) < 60) threats.push({ x: c.obj.position.x, z: c.obj.position.z, speed: c.speed });
      this.pigeons.update(this.paused ? 0 : dt, threats, { x: px, z: pz }, true, feeding ? this.crumbsAt() : null);
      if (this.pigeons.flushed) this.audio.wings(this.pigeons.flushed);
    } else this.pigeons.update(0, [], { x: planX(this.player.pos.x), z: this.player.pos.z }, false);
    this.world.cull(this.camera.position.x, this.camera.position.z);
    this.city.update(this.camera, this.nightLevel);
    this.city.setSignals(this.traffic.clock);
    setCarLights(this.nightLevel);
    // the ground gets wet in the rain and dries slowly after
    this.wetness += ((raining(s) > 0.1 && !snowing(s) ? Math.min(1, raining(s) * 1.4) : 0) - this.wetness) * Math.min(1, dt * (raining(s) > 0.1 ? 0.25 : 0.03));
    setWet(this.wetness);
    if (this.stars) { this.stars.position.copy(this.camera.position); (this.stars.material as THREE.PointsMaterial).opacity = this.nightLevel * (1 - raining(s)); this.stars.visible = this.nightLevel > 0.05 && !this.insideId; }
    if (!this.freeCam) this.updateCamera(dt);
    this.updateLighting();
    // the sun's shadow map is redrawn every other frame: half the shadow work, and nothing visibly lags
    this.renderer.shadowMap.needsUpdate = (this.frameCount & 1) === 0;
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
  /** passers-by say something about the state you are in: the smell, the bat, the blood, the drink */
  private nextRemark = 0;
  private remarks() {
    const now = performance.now();
    if (now < this.nextRemark || this.uiOpen || this.drivingVan() || this.insideId) return;
    this.nextRemark = now + 3000;
    const s = this.state, me = this.player;
    const lines: string[] = [];
    if (me.needs.hygiene < 20) lines.push('Phwoar. What is that smell?', 'Have you heard of a shower, mate?', 'Ugh, something died round here.');
    if (me.weapon) lines.push(`Whoa, put the ${({ bat: 'bat', knife: 'knife', golf: 'club', crowbar: 'crowbar' } as Record<string, string>)[me.weapon]} down!`, `${me.appearance.frame === 'f' ? 'She' : 'He'}\'s got a weapon, careful!`, 'Someone ring the police!');
    if (me.injured || (me.health ?? 100) < 45) lines.push('Are you alright? You\'re bleeding.', 'Blimey, what happened to you?');
    if ((me.drunk ?? 0) > 40) lines.push('Someone\'s had a few.', 'Steady on, pal.');
    if (raining(s) > 0.5 && me.needs.hygiene >= 20) lines.push('Lovely weather, eh?');
    if (!lines.length) return;
    const o = Object.values(s.people).find((q) => !q.isPlayer && q.visible && !q.sleeping && !q.action && !q.dead && q.down == null && !q.combat && q.npc && Math.hypot(q.pos.x - me.pos.x, q.pos.z - me.pos.z) < 3.2 && (this.remarked.get(q.id) ?? 0) < now);
    if (!o) return;
    this.remarked.set(o.id, now + 60000);
    this.nextRemark = now + 14000;
    o.facing = Math.atan2(me.pos.x - o.pos.x, me.pos.z - o.pos.z);
    o.gesture = { clip: me.weapon ? 'scared' : me.needs.hygiene < 20 ? 'shrug' : 'talk', until: s.minute + 0.8 };
    this.say(o.id, lines[Math.floor(Math.random() * lines.length)], 3.5);
  }
  private remarked = new Map<string, number>();

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
  private collidersWithCars(except?: string, noPolice = false, at: { x: number; z: number } = this.player.pos, reach = 14) {
    const taken = new Set((this.state.takenParked ?? []).map((i) => getWorld().obstacles.filter((o) => o.kind === 'car')[i]?.rect));
    const near = collidersIn(at.x - reach, at.z - reach, at.x + reach, at.z + reach);
    const base = taken.size ? near.filter((r) => !taken.has(r)) : near;
    // parked private cars, the delivery van and the forklift when nobody is driving them, and traffic
    const cars = Object.values(this.state.vehicles).filter((v) => v.id !== except && (v.state === 'parked' || v.state === 'loaded' || (v.driverId && v.driverId !== this.player.id)));
    const pc = noPolice ? [] : this.police?.rects() ?? [];
    // locked front doors on Harbour Road (open once you are let in or force them)
    const locked = DWELLING_IDS.filter((h) => !houseOpen(this.state, h)).map((h) => dwellingDoor(h)?.lock).filter((r): r is NonNullable<typeof r> => !!r);
    // shops shut for the night: their doors are locked from outside (you can always let yourself out)
    const here = shellAt(this.player.pos)?.id;
    for (const id of SHOP_IDS) if (id !== here && shopLocked(this.state, id)) { const b = getWorld().buildings.find((x) => x.id === id); if (b) for (const d of publicDoors(b)) locked.push(d.lock); }
    return [...base, ...locked, ...this.traffic.rects(), ...pc, ...cars.map((v) => {
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
  private wasInCar = false;
  private vanSpeed = 0;
  /** how fast you are driving (m/s), for the speedometer */
  get driveSpeed() { return Math.abs(this.vanSpeed); }
  /** the direction the car is moving (differs from where it points in a slide), how far out, how hard the tyres are scrubbing */
  private travel = 0;
  private slip = 0;
  skid = 0;
  private bumpCooldown = 0;
  private diveCooldown = new Map<string, number>();
  private fireWarned = false;
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
    const fork = v.kind === 'forklift', boat = v.kind === 'boat', bike = v.kind === 'bike';
    // a battered engine loses its power; a burning or burnt-out car goes nowhere
    const tired = v.kind === 'car' ? (v.condition < 25 ? 0.55 : v.condition < 50 ? 0.85 : 1) : 1;
    const MAX = (fork ? 4.5 : boat ? 7.5 : bike ? 7 : car?.topSpeed ?? 11) * (v.wrecked || v.burning != null ? 0 : tired), REV = fork ? 2.5 : bike ? 1 : 3;
    if (v.burning != null && !this.fireWarned) { this.fireWarned = true; this.onToast('The engine is on fire! Get out (E) before it goes up!'); }
    if (v.burning == null) this.fireWarned = false;
    if (boat && this.player.action?.type === 'fish' && thr !== 0) cancelAction(this.state, this.player, 'moved');
    // the handbrake (Space): the back steps out and the car slides round, tyres howling
    const handbrake = canDrive && k.has('Space') && (v.kind === 'car' || v.kind === 'van') && !this.air;
    if (handbrake) this.vanSpeed -= Math.sign(this.vanSpeed) * Math.min(Math.abs(this.vanSpeed), 2.6 * dt);
    else if (thr > 0) this.vanSpeed += (this.vanSpeed < 0 ? 9 : 3.5) * dt;
    else if (thr < 0) this.vanSpeed -= (this.vanSpeed > 0 ? 9 : 2.5) * dt;
    else this.vanSpeed -= Math.sign(this.vanSpeed) * Math.min(Math.abs(this.vanSpeed), 2.2 * dt);
    this.vanSpeed = Math.max(-REV, Math.min(MAX, this.vanSpeed));
    // steering: tighter at low speed, the turn rate scales with how fast the wheels roll
    // no steering in the air
    const sliding = handbrake && Math.abs(this.vanSpeed) > 4;
    if (!this.air) v.heading += steer * Math.sign(this.vanSpeed) * Math.min(Math.abs(this.vanSpeed), 3.5) * dt * (sliding ? 0.55 : 0.22);
    else this.vanSpeed = Math.max(this.vanSpeed, this.air.speed * 0.98);
    // which way the car is actually going: it lags the way it points while the back is loose
    const lag = ((v.heading - this.travel + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    if (Math.abs(lag) > 1.4 || this.vanSpeed < 0.5) this.travel = v.heading;
    else this.travel += lag * Math.min(1, dt * (sliding ? 1.4 : 7));
    this.slip = Math.abs(((v.heading - this.travel + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    // hard braking from speed locks the wheels too
    this.skid = !this.air && Math.abs(this.vanSpeed) > 3.5 && (this.slip > 0.18 || (thr < 0 && this.vanSpeed > 7) || (handbrake && this.vanSpeed > 4)) ? Math.min(1, this.slip * 2 + (thr < 0 || handbrake ? 0.5 : 0)) : 0;
    const nx = v.pos.x + Math.sin(this.travel) * this.vanSpeed * dt, nz = v.pos.z + Math.cos(this.travel) * this.vanSpeed * dt;
    // a boat keeps to the water: the quay wall on one side, open sea (within reason) on the other
    const res = boat ? { x: Math.max(WATER.x0, Math.min(WATER.x1, nx)), z: Math.max(WATER.z0, Math.min(WATER.z1, nz)) } : resolveCircle({ x: nx, z: nz }, fork ? 0.8 : bike ? 0.45 : 1.15, this.collidersWithCars(v.id, false, { x: nx, z: nz }, 16));
    if (boat) for (const [mx, mz] of MOORED) {
      const dx = res.x - mx, dz = res.z - mz, d = Math.hypot(dx, dz);
      if (d < 3.4 && d > 1e-3) { res.x = mx + (dx / d) * 3.4; res.z = mz + (dz / d) * 3.4; }
    }
    if (Math.hypot(res.x - nx, res.z - nz) > 0.01) {
      // bumped into something: which side took it (the push-back points away from what was hit)
      const cx = res.x - nx, cz = res.z - nz, cl = Math.hypot(cx, cz);
      const fwd = (cx * Math.sin(v.heading) + cz * Math.cos(v.heading)) / cl, rt = (cx * -Math.cos(v.heading) + cz * Math.sin(v.heading)) / cl;
      const side = Math.abs(fwd) > Math.abs(rt) ? (fwd < 0 ? 0 : 1) : (rt < 0 ? 3 : 2);
      if (v.kind === 'car' && !this.bumpCooldown) { damageCar(this.state, v, Math.abs(this.vanSpeed), side as 0 | 1 | 2 | 3); this.bumpCooldown = 0.4; if (Math.abs(this.vanSpeed) > 4) this.audio.crash(Math.abs(this.vanSpeed)); }
      if (Math.abs(this.vanSpeed) > 2) taxiBump(this.state);
      this.vanSpeed *= 0.4;
    }
    this.bumpCooldown = Math.max(0, this.bumpCooldown - dt);
    v.odometer += Math.hypot(res.x - v.pos.x, res.z - v.pos.z);
    // people in the way are hit (and knocked aside)
    if (Math.abs(this.vanSpeed) > 1.5 && !boat) {
      const now = performance.now();
      const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
      for (const o of Object.values(this.state.people)) {
        if (o.isPlayer || !o.visible || o.dead || o.where === 'vehicle') continue;
        const dx = o.pos.x - res.x, dz = o.pos.z - res.z;
        const along = dx * fx + dz * fz, side = dx * fz - dz * fx;
        // someone in the path of a car coming fast: most throw themselves out of the way
        if (!bike && this.vanSpeed > 7 && along > 3 && along < 11 && Math.abs(side) < 1.8 && o.down == null && !o.police && (this.diveCooldown.get(o.id) ?? 0) < now) {
          this.diveCooldown.set(o.id, now + 6000);
          if (Math.random() < 0.6) {
            const away = side >= 0 ? 1 : -1;
            const dir = v.heading + (away > 0 ? -Math.PI / 2 : Math.PI / 2);
            o.pos = resolveCircle({ x: o.pos.x + Math.sin(dir) * 1.6, z: o.pos.z + Math.cos(dir) * 1.6 }, 0.3);
            o.hit = { at: this.state.minute, dir, heavy: false, by: p.id, force: 3.2 };
            floor(this.state, o, 0.8);
            o.gesture = { clip: 'scared', until: this.state.minute + 1.5 };
            continue;
          }
        }
        if (Math.abs(along) > (fork ? 1.3 : bike ? 0.9 : 2.3) || Math.abs(side) > (fork ? 0.8 : bike ? 0.45 : 1.05)) continue;
        if ((this.hitCooldown.get(o.id) ?? 0) > now) continue;
        this.hitCooldown.set(o.id, now + 1500);
        hitByVehicle(this.state, o.id, p.id, Math.abs(this.vanSpeed) * (bike ? 0.45 : 1));
        o.pos = resolveCircle({ x: o.pos.x + Math.sign(side || 1) * fz * 1.2 + fx * Math.sign(this.vanSpeed) * 0.8, z: o.pos.z - Math.sign(side || 1) * fx * 1.2 + fz * Math.sign(this.vanSpeed) * 0.8 }, 0.3);
        this.vanSpeed *= 0.7;
        this.onToast(`You hit ${o.name}!`);
      }
      // a dog in the road
      for (const [owner, d] of this.views.dogs) {
        const o = this.state.people[owner];
        if (!o?.dog || o.isPlayer) continue;
        const dx = d.view.pos.x - res.x, dz = d.view.pos.y - res.z;
        if (Math.abs(dx * fx + dz * fz) > 2.2 || Math.abs(dx * fz - dz * fx) > 1.0) continue;
        const name = o.dog.name;
        dogDies(this.state, o, 'hit by a car');
        crime(this.state, 'ran over a dog', 1);
        this.onToast(`You ran over ${o.name.split(' ')[0]}'s dog ${name}!`);
      }
    }
    v.pos = res;
    p.pos = { ...v.pos };
    p.facing = v.heading;
    if (v.kind === 'car' || v.kind === 'van') this.stunt(v, dt);
  }

  /** stunt ramps: up the slope, off the lip, through the air, and down again */
  private air: { y: number; vy: number; t: number; x0: number; z0: number; ramp: number; pitch: number; speed: number } | null = null;
  private onRamp: Ramp | null = null;
  private stunt(v: Vehicle, dt: number) {
    const a = this.air;
    if (a) {
      a.t += dt; a.y += a.vy * dt; a.vy -= 9.8 * dt;
      a.pitch += (0.18 - a.pitch) * Math.min(1, dt * 1.2);
      if (a.y <= 0) {
        const impact = -a.vy;
        if (impact > 6) { damageCar(this.state, v, impact * 0.55, 0); this.audio.crash(impact); }
        const said = landedJump(this.state, this.player.id, a.ramp, Math.hypot(v.pos.x - a.x0, v.pos.z - a.z0), a.t);
        this.onToast(said);
        if (said.startsWith('UNIQUE')) this.audio.theme.passed();
        this.air = null; v.lift = 0; v.pitch = 0;
        return;
      }
      v.lift = a.y; v.pitch = a.pitch;
      return;
    }
    const fx = Math.sin(v.heading);
    const r = RAMPS.find((q) => { const along = (v.pos.x - q.x) * q.dir; return along > 0 && along < q.len && Math.abs(v.pos.z - q.z) < 2.2; });
    if (r && fx * r.dir > 0.7 && this.vanSpeed > 4) {
      const along = (v.pos.x - r.x) * r.dir;
      this.onRamp = r;
      v.lift = (r.h * along) / r.len; v.pitch = -Math.atan2(r.h, r.len);
      return;
    }
    if (this.onRamp) {
      const q = this.onRamp;
      this.onRamp = null;
      // over the lip at speed: airborne
      if ((v.pos.x - q.x) * q.dir >= q.len && this.vanSpeed > 4) {
        const ang = Math.atan2(q.h, q.len);
        this.air = { y: q.h, vy: this.vanSpeed * Math.sin(ang) * 1.15 + 1.5, t: 0, x0: v.pos.x, z0: v.pos.z, ramp: q.id, pitch: -ang, speed: this.vanSpeed };
        return;
      }
    }
    v.lift = 0; v.pitch = 0;
  }

  /** street races: drive into a start ring to go; make each checkpoint in turn; beat the time */
  private updateRace() {
    const p = this.player, car = this.drivingVan();
    const ring = (color: string, r: number) => { const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.25, 8, 48), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.6, transparent: true, opacity: 0.85 })); m.rotation.x = Math.PI / 2; this.scene.add(m); return m; };
    if (!this.startRings.length) for (const r of RACES) { const m = ring('#00e5ff', 5); m.position.set(r.points[0].x, 0.3, r.points[0].z); this.startRings.push(m); }
    const bob = 0.3 + Math.sin(performance.now() / 300) * 0.1;
    this.startRings.forEach((m) => { m.visible = !this.race; m.position.y = bob; });
    if (!this.race) {
      this.raceText = '';
      if (this.raceRing) this.raceRing.visible = false;
      if (!car || car.kind === 'forklift' || car.kind === 'boat') return;
      const r = RACES.find((x) => Math.hypot(x.points[0].x - car.pos.x, x.points[0].z - car.pos.z) < 6);
      if (r) { this.race = { id: r.id, cp: 1, t0: performance.now() }; this.onToast(`${r.name}! Beat ${r.rival}'s time of ${Math.floor(r.target / 60)}:${String(r.target % 60).padStart(2, '0')}. Follow the orange rings. GO!`); }
      return;
    }
    const r = RACES.find((x) => x.id === this.race!.id)!;
    if (!car) { this.race = null; this.onToast('You got out: race abandoned.'); return; }
    const t = (performance.now() - this.race.t0) / 1000;
    const target = r.points[this.race.cp % r.points.length];
    const last = this.race.cp === r.points.length;
    const goal = last ? r.points[0] : target;
    if (!this.raceRing) this.raceRing = ring('#ff6d00', 6);
    this.raceRing.visible = true;
    this.raceRing.position.set(goal.x, bob, goal.z);
    this.raceText = `${r.name}: checkpoint ${Math.min(this.race.cp, r.points.length)}/${r.points.length} · ${t.toFixed(1)} s (beat ${r.target} s)`;
    if (Math.hypot(goal.x - car.pos.x, goal.z - car.pos.z) < 9) {
      if (last) { this.onToast(finishRace(this.state, p.id, r.id, t)); this.race = null; this.raceRing.visible = false; }
      else this.race.cp++;
    }
  }

  /** Vince's job: a green ring where to go next, and the waypoint set to it whenever the goal moves */
  private missionRing: THREE.Mesh | null = null;
  private missionAim: { x: number; z: number } | null = null;
  private updateMission() {
    const goal = missionGoal(this.state);
    if (!this.missionRing) {
      this.missionRing = new THREE.Mesh(new THREE.TorusGeometry(3, 0.22, 8, 40), new THREE.MeshStandardMaterial({ color: '#00e676', emissive: '#00e676', emissiveIntensity: 1.6, transparent: true, opacity: 0.85 }));
      this.missionRing.rotation.x = Math.PI / 2; this.scene.add(this.missionRing);
    }
    this.missionRing.visible = !!goal;
    if (!goal) { if (this.missionAim && this.waypoint === this.missionAim) this.setWaypoint(null); this.missionAim = null; return; }
    this.missionRing.position.set(goal.x, 0.3 + Math.sin(performance.now() / 300) * 0.1, goal.z);
    if (!this.missionAim || Math.hypot(goal.x - this.missionAim.x, goal.z - this.missionAim.z) > 15) { this.missionAim = { ...goal }; this.setWaypoint(this.missionAim); }
  }

  /** sounds for things that happen in the sim: blows landing near you, money coming in */
  private heardHits = new Map<string, number>();
  private lastBalance = -1;
  private listenFor(s: GameState) {
    const me = this.player, px = planX(me.pos.x), pz = me.pos.z;
    for (const p of Object.values(s.people)) {
      const h = p.hit;
      if (!h || this.heardHits.get(p.id) === h.at) continue;
      const fresh = this.heardHits.has(p.id) || s.minute - h.at < 0.2;
      this.heardHits.set(p.id, h.at);
      const d = Math.hypot(planX(p.pos.x) - px, p.pos.z - pz);
      if (fresh && d < 40 && (p.visible || p.id === me.id)) this.audio.smack(d, !!h.heavy);
    }
    const bal = s.ledger.accounts[me.accountId]?.balance ?? 0;
    if (this.lastBalance >= 0 && bal > this.lastBalance + 50) this.audio.cash();
    this.lastBalance = bal;
  }

  /** a red arrow bobbing over a pickpocket making off with your money */
  private thiefMark: THREE.Mesh | null = null;
  private updateThief() {
    const t = this.state.thief;
    const o = t?.stage === 'running' ? this.state.people[t.id] : null;
    if (!this.thiefMark) {
      this.thiefMark = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.5, 4), new THREE.MeshStandardMaterial({ color: '#ff1744', emissive: '#ff1744', emissiveIntensity: 1.5 }));
      this.thiefMark.rotation.x = Math.PI; this.scene.add(this.thiefMark);
    }
    this.thiefMark.visible = !!o && o.visible;
    if (o) this.thiefMark.position.set(o.pos.x, 2.4 + Math.sin(performance.now() / 200) * 0.12, o.pos.z);
  }

  /** lost wallets glint on the ground as you get near */
  private updateWallets() {
    const p = this.player, found = this.state.wallets ?? [];
    walletSpots().forEach((w, i) => {
      const near = !found.includes(i) && Math.hypot(w.x - planX(p.pos.x), w.z - p.pos.z) < 50;
      let m = this.walletMeshes.get(i);
      if (near && !m) {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.12), new THREE.MeshStandardMaterial({ color: '#5a3a22', roughness: 0.6 })));
        const glint = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), new THREE.MeshStandardMaterial({ color: '#ffd54f', emissive: '#ffd54f', emissiveIntensity: 2 }));
        glint.position.y = 0.5; glint.name = 'glint'; g.add(glint);
        g.position.set(w.x, 0.05, w.z); this.scene.add(g); this.walletMeshes.set(i, g); m = g;
      }
      if (m) { m.visible = near; const gl = m.getObjectByName('glint'); if (gl) { gl.rotation.y += 0.05; gl.position.y = 0.5 + Math.sin(performance.now() / 250 + i) * 0.08; } }
    });
    // cash on the pavement: a green bundle of notes, spinning gently
    const drops = this.state.drops ?? [];
    for (const [id, m] of this.dropMeshes) if (!drops.some((d) => d.id === id)) { this.scene.remove(m); this.dropMeshes.delete(id); }
    for (const d of drops) {
      let m = this.dropMeshes.get(d.id);
      if (!m) {
        m = new THREE.Group();
        const note = new THREE.MeshStandardMaterial({ color: '#4caf50', emissive: '#2e7d32', emissiveIntensity: 0.6, roughness: 0.6 });
        for (let k = 0; k < 3; k++) { const n = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.15), note); n.position.y = k * 0.025; n.rotation.y = k * 0.3; m.add(n); }
        m.position.set(d.pos.x, 0.25, d.pos.z);
        this.scene.add(m); this.dropMeshes.set(d.id, m);
      }
      m.rotation.y += 0.03;
      m.position.y = 0.25 + Math.sin(performance.now() / 300) * 0.05;
    }
  }
  private dropMeshes = new Map<string, THREE.Object3D>();

  private updatePlayer(dt: number) {
    const p = this.player;
    if (this.theft && this.state.minute >= this.theft.at) {
      const t = this.theft;
      this.theft = null;
      if (p.down == null && !p.dead && p.where !== 'vehicle') {
        this.onToast(t.kerb != null ? stealParked(this.state, p.id, t.kerb) : stealOwnedCar(this.state, p.id, t.car!));
        this.audio.smash();
      }
    }
    if (this.theft) { this.vel.x = this.vel.z = 0; return; }
    if (this.carSeq.active) { this.vel.x = this.vel.z = 0; this.carSeq.update(dt, p, this.state.minute); return; }
    // off the bus at the end of the ride: it pulls in at your stop and you step down
    const onBus = p.away?.place === 'bus';
    if (this.wasOnBus && !onBus && !p.away) this.busSeq.start('alight', { ...p.pos }, this.roadSide(p.pos.z), () => {});
    this.wasOnBus = onBus;
    if (this.busSeq.active) { this.vel.x = this.vel.z = 0; this.busSeq.update(dt, p); return; }
    if (this.drivingVan()) {
      this.updateDriving(dt);
      const v = this.drivingVan();
      if (v) this.skids.lay(v.pos.x, v.pos.z, v.heading, this.skid);
      return;
    }
    this.skid = 0;
    this.vanSpeed = 0;
    const jailed = p.away?.place === 'prison' && p.visible;
    // hands up until the police arrive, unless you make a run for it after all
    const w = this.state.wanted;
    if (w?.surrender) {
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].some((k) => this.keys.has(k))) { w.surrender = false; p.gesture = null; this.onToast('You run for it!'); }
      else { this.vel.x = this.vel.z = 0; return; }
    }
    // getting up off the bunk
    if (jailed && this.state.serving && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].some((k) => this.keys.has(k))) { this.state.serving = false; if (p.action?.type === 'serve_time') p.action = null; }
    if (this.uiOpen || p.sleeping || p.down != null || (p.away && !jailed) || p.dead || this.state.serving) { this.vel.x = this.vel.z = 0; return; }
    // like GTA: W/A/S/D move you relative to the camera (away from it, to its left and right, towards
    // it), and you turn to face the way you are going. The mouse turns the camera.
    const k = this.keys;
    let iz = 0, ix = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) iz += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) iz -= 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) ix -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) ix += 1;
    const run = k.has('ShiftLeft') || k.has('ShiftRight');
    const len = Math.min(1, Math.hypot(ix, iz));
    let tx = 0, tz = 0;
    if (len > 0) {
      if (p.action) cancelAction(this.state, p, 'moved');
      // the camera's forward and right along the ground
      const fx = -Math.sin(this.camYaw), fz = -Math.cos(this.camYaw);
      const rx = Math.cos(this.camYaw), rz = -Math.sin(this.camYaw);
      const mx = fx * iz + rx * ix, mz = fz * iz + rz * ix, ml = Math.hypot(mx, mz) || 1;
      // turn towards it: quick, but a turn rather than a snap
      const want = Math.atan2(mx / ml, mz / ml);
      const dYaw = ((want - p.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      p.facing += dYaw * Math.min(1, dt * 11);
      // you walk the way you face once you have turned (so a sharp turn starts with a step round)
      const sp = (run ? RUN_SPEED * fitnessFactor(p) : WALK_SPEED) * capability(p).move * Math.max(0.15, Math.cos(Math.min(Math.PI / 2, Math.abs(dYaw))));
      tx = Math.sin(p.facing) * sp * len;
      tz = Math.cos(p.facing) * sp * len;
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
    const before = p.pos;
    p.pos = resolveCircle({ x: p.pos.x + this.vel.x * dt, z: p.pos.z + this.vel.z * dt }, 0.3, this.collidersWithCars());
    if (run && speed > 3) trainRun(p, Math.hypot(p.pos.x - before.x, p.pos.z - before.z));
    // off the top of a flight onto the floor above, or off the bottom onto the floor below
    p.pos = stairCross(p.pos);
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
    if (!hasAi()) for (const o of options) if (o.ui === 'chat') { o.enabled = false; o.reason = 'No AI to voice people: allow Claude for this page, or add an OpenAI key (Menu)'; }
    this.focus = { id: it.id, label: it.label, options };
  }

  private updateCamera(dt: number) {
    const p = this.player;
    const inside = shellAt(p.pos)?.id ?? null;
    const lv = levelOf(p.pos.x);
    if (this.overview !== this.cutawayOn || inside !== this.insideId) {
      // cut-away walls only in overview mode; in the normal camera rooms keep their walls and ceilings.
      // Looking down into a storey, the floors above it are lifted away too
      const levelOfCut = (id: string) => id.startsWith('level:') ? Number(id.slice(6)) : getWorld().buildings.find((b) => b.id === id)?.level ?? 0;
      for (const [id, c] of this.world.cutaway) {
        const above = this.overview && !!inside && levelOfCut(id) > lv && (lv > 0 || inside === 'marlow');
        const cut = (this.overview && id === inside) || above;
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
      const fk = van.kind === 'forklift', bk = van.kind === 'bike';
      this.camPitch += ((fk ? 0.45 : bk ? 0.28 : 0.3) - this.camPitch) * Math.min(1, dt * 2);
      if (!fk && !bk) this.camDist = Math.max(this.camDist, 7.5);
      this.camDist += ((fk ? 5 : bk ? 4.2 : 9) - this.camDist) * Math.min(1, dt * 2);
    } else if (!this.camLocked && performance.now() < this.manualUntil) {
      // the player is looking around with the mouse: leave the angle alone, keep the distance
      const wantDist = (p.sleeping ? 3.4 : inside ? 3.3 : 4.4) * this.zoom;
      this.camDist += (wantDist - this.camDist) * Math.min(1, dt * 3);
    } else if (!this.camLocked) {
      // automatic camera: while you walk it drifts round behind you (gently, like GTA's); standing
      // still it stays where you left it. Closer and higher indoors so rooms read clearly
      const behind = p.facing + Math.PI;
      const dYaw = ((behind - this.camYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      // a fresh start or a jump (a load, a teleport): put the camera straight behind you
      if (!this.camAt || Math.hypot(this.camAt.x - p.pos.x, this.camAt.z - p.pos.z) > 12) this.camYaw = behind;
      this.camAt = { x: p.pos.x, z: p.pos.z };
      // the character creator: a three-quarter view of your face
      if (document.body.classList.contains('creating')) this.camYaw = p.facing + 0.55;
      const moving = Math.hypot(this.vel.x, this.vel.z) > 0.5;
      if (moving && Math.abs(dYaw) < 2.4) this.camYaw += dYaw * Math.min(1, dt * 1.6);
      // in a small room the walls pull the camera in: look down from higher up instead
      const cramped = inside && this.distCur > 0 && this.distCur < 1.6;
      // in a stairwell there is only room above: look down the flight from over your shoulder
      const onStairs = stairY(p.pos) > 0.05;
      const wantPitch = p.sleeping ? 0.75 : onStairs ? 0.85 : cramped ? 0.7 : inside ? 0.42 : 0.24;
      const wantDist = (p.sleeping ? 3.4 : inside ? 3.3 : 4.4) * this.zoom;
      this.camPitch += (wantPitch - this.camPitch) * Math.min(1, dt * 2);
      this.camDist += (wantDist - this.camDist) * Math.min(1, dt * 2);
      void dYaw;
    }
    // follow the drawn body (it may be acting out a multi-step action away from its sim spot)
    const climbing = (p.move?.climb ?? 0) > 0;
    const drawn = p.action || climbing ? this.views.people.get(p.id)?.rig.root.getWorldPosition(new THREE.Vector3()) : null;
    const sp = sceneOf(p.pos, stairY(p.pos));
    const pivot = new THREE.Vector3(drawn?.x ?? sp.x, (drawn ? drawn.y : sp.y) + (van ? (van.kind === 'forklift' ? 2.0 : van.kind === 'boat' ? 1.0 : van.kind === 'bike' ? 1.7 : 2.7) + (van.lift ?? 0) : p.sleeping ? 1.0 : 1.62), drawn?.z ?? p.pos.z);
    const pitch = this.camPitch;
    const dir = new THREE.Vector3(Math.sin(this.camYaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(this.camYaw) * Math.cos(pitch));
    // over-the-shoulder offset to the right of the view direction
    const right = new THREE.Vector3(-Math.cos(this.camYaw), 0, Math.sin(this.camYaw));
    const shoulder = document.body.classList.contains('creating') ? -0.9 : this.overview || van ? 0 : 0.42;
    const origin = pivot.clone().addScaledVector(right, -shoulder);
    let dist = this.camDist;
    // keep the camera out of walls: five rays (the middle and the corners of a small box round the
    // lens), so the edges of the view do not poke through a wall the middle ray just misses
    const near = this.world.occludersNear(origin.x, origin.z);
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();
    let blocked = false;
    for (const [a, b] of [[0, 0], [0.22, 0.16], [-0.22, 0.16], [0.22, -0.16], [-0.22, -0.16]]) {
      const o = origin.clone().addScaledVector(right, a).addScaledVector(up, b);
      this.raycaster.set(o, dir);
      this.raycaster.far = dist + 0.3;
      const h = this.raycaster.intersectObjects(near, false)[0];
      if (h) { dist = Math.max(0.3, Math.min(dist, h.distance - 0.22)); blocked = true; }
    }
    // the city's buildings (drawn by the city view, not the world) are solid to the camera too
    if (!this.overview) {
      const t = cityBlock(origin, dir, dist + 0.3);
      if (t < dist + 0.3) { dist = Math.max(0.3, t - 0.3); blocked = true; }
    }
    // indoors, keep under the ceiling and over the floor of the storey the head is in (on the stairs too)
    if (!van && !this.overview && shellAt(p.pos)) {
      const storey = Math.floor((origin.y - 0.2) / LEVEL_H);
      const ceil = storey * LEVEL_H + 3.2 - 0.22, floor = storey * LEVEL_H + 0.3;
      if (dir.y > 1e-3 && origin.y < ceil) { const t = (ceil - origin.y) / dir.y; if (t < dist) { dist = Math.max(0.3, t); blocked = true; } }
      if (dir.y < -1e-3 && origin.y > floor) { const t = (floor - origin.y) / dir.y; if (t < dist) { dist = Math.max(0.3, t); blocked = true; } }
    }
    const hits = blocked ? [true] : [];
    // indoors the camera stays indoors: never out through an open doorway behind you
    const shell = !van && !this.overview ? shellAt(p.pos) : null;
    if (shell) {
      const k = levelOf(shell.rect.x0), r = { x0: shell.rect.x0 - k * LEVEL_DX, x1: shell.rect.x1 - k * LEVEL_DX, z0: shell.rect.z0, z1: shell.rect.z1 };
      let t = Infinity;
      if (dir.x > 1e-4) t = Math.min(t, (r.x1 - origin.x) / dir.x); else if (dir.x < -1e-4) t = Math.min(t, (r.x0 - origin.x) / dir.x);
      if (dir.z > 1e-4) t = Math.min(t, (r.z1 - origin.z) / dir.z); else if (dir.z < -1e-4) t = Math.min(t, (r.z0 - origin.z) / dir.z);
      if (t < Infinity) dist = Math.max(0.35, Math.min(dist, t - 0.3));
    }
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
    this.sunAnchor.set(Math.round(sp.x / texel) * texel, 0, Math.round(sp.z / texel) * texel);
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
    this.sky.position.set(planX(p.pos.x), 0, p.pos.z);
    const day = new THREE.Color('#b9cfdf'), dusk = new THREE.Color('#e8a878'), night = new THREE.Color('#0d1626');
    const horizon = d > 0.5 ? dusk.clone().lerp(day, (d - 0.5) * 2) : night.clone().lerp(dusk, d * 2);
    if (r > 0) horizon.lerp(new THREE.Color(d > 0.3 ? '#8f979e' : '#1a1f26'), 0.75 * r);
    (this.scene.fog as THREE.Fog).color = horizon;
    (this.scene.fog as THREE.Fog).near = 200 - 140 * r;
    (this.scene.fog as THREE.Fog).far = 950 - 650 * r;
    const su = this.sky.material.uniforms;
    su.turbidity.value = 4 + 14 * r; su.rayleigh.value = 1.2 + 1.5 * r;
    // an overcast sky replaces the clear one as the rain sets in
    const overcast = r > 0.25;
    this.scene.background = d < 0.05 ? night : overcast ? horizon.clone() : null;
    this.sky.visible = d >= 0.05 && !overcast;
    // after dark the street is lit by the lamps and windows, not by the sky: the fill light falls away
    this.scene.environmentIntensity = (this.insideId ? 0.25 : 0.04 + 0.66 * d) * (1 - 0.45 * r);
    this.ambient.intensity = this.insideId ? 0.35 : 0.1 + 0.25 * d;
    this.hemi.intensity = (0.12 + 0.88 * d) * (this.insideId ? 0.45 : 1) * (1 - 0.25 * r);
    // a storm: in heavy rain, lightning now and then (a double flash over everything, the sky lit white),
    // and the thunder a second or two later, the further off the longer it takes
    if (r > 0.65 && !snowing(s) && !this.paused) {
      if (this.boltAt <= 0 && Math.random() < this.lastDt * 0.06 * r) { this.boltAt = 0.35; this.boltDist = 300 + Math.random() * 1500; setTimeout(() => this.audio.thunder(this.boltDist), this.boltDist / 0.343 * 0.25); }
    }
    if (this.boltAt > 0) {
      this.boltAt -= this.lastDt;
      const f = this.boltAt > 0.25 || (this.boltAt < 0.15 && this.boltAt > 0.08) ? 1 : 0;
      const k = f * Math.min(1, 900 / this.boltDist) * (this.insideId ? 0.35 : 1);
      this.hemi.intensity += 3.5 * k;
      if (f && !this.insideId) this.scene.background = new THREE.Color('#c9d3e8').lerp(horizon, 1 - k);
    }
    const lit = d < 0.45;
    this.nightLevel = Math.max(0, Math.min(1, (0.5 - d) / 0.35));
    this.world.lampBulbs.emissiveIntensity = lit ? 1.6 : 0;
    // buildings in a power cut stay dark
    const dark = new Set(Object.values(s.businesses).filter((b) => inOutage(b, s.minute)).map((b) => b.locationId));
    // the light pool goes to the room you are in first, then whatever lights are nearest (street lamps only at night)
    const inside = shellAt(p.pos)?.id ?? null;
    const ps = sceneOf(p.pos);
    const near = (x: number, z: number) => Math.hypot(x - ps.x, z - ps.z);
    const cands = [
      ...this.world.lightSpots.filter((l) => !dark.has(l.bid)).map((l) => ({ x: l.x, y: l.y, z: l.z, i: l.intensity, d: l.distance, c: '#fff1dc', score: near(l.x, l.z) - (l.bid === inside ? 1000 : 0) })),
      ...(lit ? getWorld().lamps.map((l) => ({ x: l.x, y: 4.6, z: l.z, i: 18, d: 18, c: '#ffcf80', score: near(l.x, l.z) + (inside ? 30 : 0) })) : []),
      ...(lit ? this.cityLampsNear(ps).map((l) => ({ x: l.x, y: 4.6, z: l.z, i: 18, d: 18, c: '#ffcf80', score: near(l.x, l.z) + (inside ? 30 : 0) })) : []),
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
