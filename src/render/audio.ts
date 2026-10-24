// Sound, synthesised with the Web Audio API (no sample files): footsteps on the surface you walk on,
// till scanner beeps, the shop door chime, rain, distant traffic, the van's engine, birdsong by day.
// Everything is driven from the game state each frame; the audio context starts on the first key press.
import type { GameState } from '../sim/types';
import { buildingAt, getWorld } from '../sim/world/layout';
import { raining } from '../sim/weather';
import { daylight } from '../sim/clock';
import { Radio } from './radio';
import { Theme } from './theme';
import { voice } from './voice';

export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private rainGain!: GainNode;
  private trafficGain!: GainNode;
  private engine: { osc: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private noise!: AudioBuffer;
  private stepPhase = 0;
  private lastScan = new Map<string, number>();
  private lastWhere = '';
  private birdAt = 0;
  volume = 0.6;
  readonly radio = new Radio();
  readonly theme = new Theme();
  muted = false;

  /** browsers only allow sound after a user gesture */
  start() {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
    } catch { return; }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(c.destination);
    // a second of white noise, reused for rain, steps and traffic
    this.noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const loopNoise = (filterType: BiquadFilterType, freq: number, q: number) => {
      const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
      const f = c.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master); src.start();
      return g;
    };
    this.rainGain = loopNoise('highpass', 900, 0.4);
    this.trafficGain = loopNoise('lowpass', 220, 0.7);
    this.radio.attach(c, this.master, this.noise);
    this.theme.attach(c, this.master, this.noise);
  }

  private blip(freq: number, dur: number, type: OscillatorType, vol: number, when = 0) {
    const c = this.ctx!;
    const t = c.currentTime + when;
    const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }

  /** a firework going off, quieter and more muffled the further away it is */
  bang(dist: number) {
    if (!this.ctx || this.muted) return;
    const v = Math.min(0.9, 30 / Math.max(10, dist));
    setTimeout(() => { this.thud(180, 0.9, v); this.thud(900, 0.25, v * 0.4); }, Math.min(400, dist * 3));
  }
  /** a car window going in, then the alarm whooping for a few seconds */
  smash() {
    if (!this.ctx || this.muted) return;
    this.thud(4200, 0.35, 0.7); this.thud(2600, 0.5, 0.4);
    const c = this.ctx, t = c.currentTime + 0.25;
    const o = c.createOscillator(); o.type = 'square';
    const g = c.createGain(); g.gain.value = 0;
    for (let i = 0; i < 12; i++) { o.frequency.setValueAtTime(880, t + i * 0.5); o.frequency.linearRampToValueAtTime(1320, t + i * 0.5 + 0.25); o.frequency.linearRampToValueAtTime(880, t + i * 0.5 + 0.5); }
    g.gain.setValueAtTime(0.05, t); g.gain.setValueAtTime(0.05, t + 5.8); g.gain.linearRampToValueAtTime(0, t + 6);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 6.05);
  }
  /** metal on metal: a crunch, louder the faster you were going */
  crash(speed: number) {
    if (!this.ctx || this.muted) return;
    const v = Math.min(0.9, 0.2 + speed / 18);
    this.thud(160, 0.35, v); this.thud(1200, 0.25, v * 0.6); this.thud(3200, 0.15, v * 0.35);
  }
  /** the ice cream van's chime: the opening of Greensleeves on a tinny music box */
  chime(dist: number) {
    if (!this.ctx || this.muted) return;
    const v = Math.min(0.08, 3 / Math.max(5, dist));
    const notes: [number, number][] = [[57, 0.5], [60, 1], [62, 0.5], [64, 0.75], [65, 0.25], [64, 0.5], [62, 1], [59, 0.5], [55, 0.75], [57, 0.25], [59, 0.5], [60, 1], [57, 0.5]];
    let t = 0;
    for (const [m, d] of notes) { const f = 440 * Math.pow(2, (m + 12 - 69) / 12); this.blip(f, d * 0.42, 'triangle', v, t); this.blip(f * 2, d * 0.3, 'sine', v * 0.4, t); t += d * 0.42; }
  }
  /** a car horn, a short double beep (two notes a third apart, like most cars) */
  horn(dist: number) {
    if (!this.ctx || this.muted) return;
    const v = Math.min(0.12, 4 / Math.max(6, dist));
    for (const [w, d] of [[0, 0.22], [0.3, 0.4]]) { this.blip(392, d, 'sawtooth', v, w); this.blip(494, d, 'sawtooth', v * 0.8, w); }
  }
  private screechNode: { g: GainNode; f: BiquadFilterNode } | null = null;
  /** tyres howling in a slide or a locked-wheel stop (0..1) */
  screech(level: number) {
    const c = this.ctx;
    if (!c) return;
    if (!this.screechNode && level > 0) {
      const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2200; f.Q.value = 6;
      const g = c.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master); src.start();
      this.screechNode = { g, f };
    }
    if (!this.screechNode) return;
    const t = c.currentTime;
    this.screechNode.g.gain.setTargetAtTime(this.muted ? 0 : level * 0.5, t, level > 0 ? 0.03 : 0.12);
    this.screechNode.f.frequency.setTargetAtTime(1900 + level * 900 + Math.sin(t * 23) * 120, t, 0.05);
  }
  private sirenOsc: { o: OscillatorNode; g: GainNode } | null = null;
  /** the two-tone siren of an emergency vehicle on its way, louder the closer it is (Infinity: none) */
  siren(dist: number) {
    const c = this.ctx;
    if (!c) return;
    const on = isFinite(dist) && !this.muted;
    if (on && !this.sirenOsc) {
      const o = c.createOscillator(); o.type = 'triangle';
      const g = c.createGain(); g.gain.value = 0;
      o.connect(g).connect(this.master); o.start();
      this.sirenOsc = { o, g };
    }
    if (!this.sirenOsc) return;
    const t = c.currentTime;
    // nee-naw: two notes, half a second each
    this.sirenOsc.o.frequency.setTargetAtTime(Math.floor(t * 2) % 2 ? 610 : 460, t, 0.01);
    this.sirenOsc.g.gain.setTargetAtTime(on ? Math.min(0.12, 4 / Math.max(10, dist)) : 0, t, 0.3);
  }
  /** thunder: a crack close by, a long low roll further off */
  thunder(dist: number) {
    if (!this.ctx || this.muted) return;
    const near = dist < 600;
    if (near) this.thud(1800, 0.25, 0.5);
    this.thud(70, 2.5 + dist / 600, Math.min(0.9, 500 / dist));
    this.thud(140, 1.8, Math.min(0.6, 300 / dist));
  }
  /** a flock of pigeons going up: a quick clatter of wingbeats */
  wings(n: number) {
    if (!this.ctx || this.muted) return;
    for (let k = 0; k < Math.min(10, n * 2); k++) setTimeout(() => this.thud(900 + Math.random() * 900, 0.06, 0.07), k * 45 + Math.random() * 30);
  }
  /** a punch thrown: the swish, and the smack if it lands */
  punch(hit: boolean, dist = 1) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t = c.currentTime, v = Math.min(1, 6 / Math.max(2, dist));
    const src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(600, t); f.frequency.exponentialRampToValueAtTime(2600, t + 0.14);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18 * v, t + 0.06); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(f).connect(g).connect(this.master); src.start(t, Math.random() * 0.5); src.stop(t + 0.2);
    if (hit) setTimeout(() => { this.thud(110, 0.18, 0.7 * v); this.thud(700, 0.07, 0.35 * v); }, 110);
  }
  /** car doors and the engine catching */
  car(what: 'open' | 'slam' | 'engine') {
    if (!this.ctx || this.muted) return;
    if (what === 'open') { this.thud(2200, 0.05, 0.25); this.thud(500, 0.08, 0.2); }
    else if (what === 'slam') { this.thud(90, 0.25, 0.8); this.thud(1400, 0.06, 0.3); }
    else {
      // the starter whirring, then the engine catching
      const c = this.ctx, t = c.currentTime;
      const o = c.createOscillator(); o.type = 'sawtooth';
      for (let i = 0; i < 5; i++) { o.frequency.setValueAtTime(38, t + i * 0.11); o.frequency.linearRampToValueAtTime(52, t + i * 0.11 + 0.08); }
      o.frequency.linearRampToValueAtTime(90, t + 0.75); o.frequency.exponentialRampToValueAtTime(44, t + 1.3);
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.18, t + 0.05); g.gain.setValueAtTime(0.18, t + 0.6); g.gain.linearRampToValueAtTime(0.3, t + 0.75); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
      o.connect(f).connect(g).connect(this.master); o.start(t); o.stop(t + 1.45);
    }
  }
  /** money in: the till's ka-ching */
  cash() {
    if (!this.ctx || this.muted) return;
    this.blip(2093, 0.12, 'triangle', 0.06); this.blip(2637, 0.4, 'triangle', 0.07, 0.08); this.thud(5000, 0.05, 0.08);
  }
  /** a blow landing on someone (heavier for a bat or a car) */
  smack(dist: number, heavy: boolean) {
    if (!this.ctx || this.muted) return;
    const v = Math.min(1, 8 / Math.max(2, dist));
    this.thud(heavy ? 80 : 120, heavy ? 0.3 : 0.18, 0.75 * v); this.thud(heavy ? 400 : 800, 0.08, 0.35 * v);
  }
  /** a moped's two-stroke buzz, rising with speed (null: engine off) */
  private scoot: { osc: OscillatorNode; osc2: OscillatorNode; g: GainNode } | null = null;
  scooter(speed: number | null) {
    const c = this.ctx;
    if (!c) return;
    if (speed === null) { if (this.scoot) { this.scoot.g.gain.setTargetAtTime(0, c.currentTime, 0.1); } return; }
    if (!this.scoot) {
      const osc = c.createOscillator(); osc.type = 'sawtooth';
      const osc2 = c.createOscillator(); osc2.type = 'square';
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      const g = c.createGain(); g.gain.value = 0;
      osc.connect(lp); osc2.connect(lp); lp.connect(g).connect(this.master); osc.start(); osc2.start();
      this.scoot = { osc, osc2, g };
    }
    const f = 70 + speed * 13;
    this.scoot.osc.frequency.setTargetAtTime(f, c.currentTime, 0.08);
    this.scoot.osc2.frequency.setTargetAtTime(f * 0.5 + 3, c.currentTime, 0.08);
    this.scoot.g.gain.setTargetAtTime(this.muted ? 0 : 0.05 + Math.min(1, speed / 13) * 0.05, c.currentTime, 0.1);
  }
  /** an empty stomach: a low gurgling rumble that rises and falls */
  growl() {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(140, t); lp.Q.value = 8;
    for (let k = 0; k < 6; k++) lp.frequency.linearRampToValueAtTime(90 + Math.random() * 160, t + 0.15 + k * 0.17);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.55, t + 0.2); g.gain.linearRampToValueAtTime(0.35, t + 0.6); g.gain.linearRampToValueAtTime(0.0001, t + 1.15);
    src.connect(lp).connect(g).connect(this.master); src.start(t, Math.random() * 0.5); src.stop(t + 1.2);
  }
  /** a strummed chord on an acoustic guitar: six plucked strings a few ms apart, ringing out */
  strum(root: number, minor: boolean, down = true) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t0 = c.currentTime;
    const ivs = [0, 7, 12, minor ? 15 : 16, 19, 24];
    (down ? ivs : [...ivs].reverse()).forEach((iv, k) => {
      const t = t0 + k * 0.014, f = root * Math.pow(2, iv / 12);
      for (const [type, mul, vol] of [['triangle', 1, 0.05], ['sine', 2, 0.02]] as const) {
        const o = c.createOscillator(); o.type = type; o.frequency.value = f * mul;
        const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4 - k * 0.08);
        o.connect(g).connect(this.master); o.start(t); o.stop(t + 1.5);
      }
    });
  }
  /** a camera shutter: two quick clicks of filtered noise */
  shutter() {
    if (!this.ctx || this.muted) return;
    const c = this.ctx;
    for (const [at, f] of [[0, 3200], [0.07, 2400]] as const) {
      const t = c.currentTime + at;
      const src = c.createBufferSource(); src.buffer = this.noise;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 2;
      const g = c.createGain(); g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
      src.connect(bp).connect(g).connect(this.master); src.start(t, Math.random() * 0.5); src.stop(t + 0.05);
    }
  }
  /** feet back on the ground */
  land() { if (this.ctx && !this.muted) this.thud(120, 0.12, 0.35); }
  /** the phone: two soft bleeps up (out) or down (away) */
  phone(open: boolean) {
    if (!this.ctx || this.muted) return;
    const [a, b] = open ? [880, 1320] : [1320, 880];
    this.blip(a, 0.07, 'sine', 0.05); this.blip(b, 0.09, 'sine', 0.05, 0.08);
  }
  /** a car going up */
  boom(dist: number) {
    if (!this.ctx || this.muted) return;
    const v = Math.min(1, 40 / Math.max(8, dist));
    this.thud(90, 1.4, v); this.thud(300, 0.9, v * 0.7); this.thud(2400, 0.4, v * 0.3);
  }
  private thud(freq: number, dur: number, vol: number) {
    const c = this.ctx!;
    const t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise;
    src.playbackRate.value = 0.5 + Math.random() * 0.3;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master); src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  }

  update(state: GameState, dt: number, speed: number, drivingSpeed: number | null) {
    const c = this.ctx;
    if (!c) return;
    this.master.gain.value = this.muted ? 0 : this.volume;
    const p = state.people[state.playerId];
    const inside = buildingAt(p.pos)?.id ?? null;
    const t = c.currentTime;
    // rain: loud outdoors, a muffled patter indoors
    const r = raining(state);
    this.rainGain.gain.setTargetAtTime(r * (inside ? 0.05 : 0.22), t, 0.5);
    // traffic hum near the roads, quieter indoors and at night
    const nearRoad = Math.max(0, 1 - Math.min(Math.abs(p.pos.z), Math.abs(p.pos.x)) / 30);
    this.trafficGain.gain.setTargetAtTime((inside ? 0.02 : 0.09) * nearRoad * (0.4 + 0.6 * daylight(state.minute)), t, 0.6);
    // footsteps: one per stride, a sharper click on hard floors indoors
    if (drivingSpeed === null && speed > 0.4) {
      this.stepPhase += dt * Math.min(2.6, 1.0 + speed * 0.45);
      if (this.stepPhase >= 1) {
        this.stepPhase -= 1;
        if (inside) this.thud(1400, 0.07, 0.12); else this.thud(700 + Math.random() * 200, 0.09, 0.14);
      }
    } else this.stepPhase = 0.6;
    this.radio.update(drivingSpeed !== null && !this.theme.on);
    if (drivingSpeed !== null && !this.theme.on) { const dj = this.radio.ident(c.currentTime); if (dj) voice.dj(dj.text, dj.female, this.muted); }
    this.theme.update();
    // the van's engine, pitch with road speed
    if (drivingSpeed !== null) {
      if (!this.engine) {
        const osc = c.createOscillator(); osc.type = 'sawtooth';
        const filter = c.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 380;
        const gain = c.createGain(); gain.gain.value = 0;
        osc.connect(filter).connect(gain).connect(this.master); osc.start();
        this.engine = { osc, gain, filter };
      }
      const s = Math.abs(drivingSpeed);
      this.engine.osc.frequency.setTargetAtTime(38 + s * 7, t, 0.15);
      this.engine.gain.gain.setTargetAtTime(0.07 + s * 0.006, t, 0.2);
    } else if (this.engine) {
      this.engine.gain.gain.setTargetAtTime(0, t, 0.2);
      const e = this.engine; this.engine = null;
      setTimeout(() => e.osc.stop(), 800);
    }
    // till scanner beeps near you
    for (const till of Object.values(state.tills)) {
      const it = getWorld().interactables[till.id];
      if (!it || Math.hypot(it.pos.x - p.pos.x, it.pos.z - p.pos.z) > 14) continue;
      const n = Object.values(till.scanned).reduce((a, b) => a + b, 0);
      const prev = this.lastScan.get(till.id) ?? 0;
      if (n > prev) this.blip(2600, 0.09, 'square', 0.05);
      this.lastScan.set(till.id, n);
    }
    // a two-tone chime when you walk into a shop
    if (inside !== this.lastWhere) {
      if (inside && ['market', 'unit4', 'homestore', 'cafe'].includes(inside)) { this.blip(1318, 0.35, 'sine', 0.07); this.blip(1046, 0.5, 'sine', 0.07, 0.18); }
      this.lastWhere = inside ?? '';
    }
    // birdsong on dry days outdoors
    const day = daylight(state.minute);
    if (!inside && r < 0.05 && day > 0.5 && performance.now() > this.birdAt) {
      this.birdAt = performance.now() + 2500 + Math.random() * 7000;
      const base = 2400 + Math.random() * 1600;
      for (let k = 0; k < 2 + Math.floor(Math.random() * 4); k++) this.blip(base * (1 + (k % 2) * 0.18), 0.08, 'sine', 0.025, k * 0.11);
    }
  }
}
