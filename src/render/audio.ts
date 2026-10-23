// Sound, synthesised with the Web Audio API (no sample files): footsteps on the surface you walk on,
// till scanner beeps, the shop door chime, rain, distant traffic, the van's engine, birdsong by day.
// Everything is driven from the game state each frame; the audio context starts on the first key press.
import type { GameState } from '../sim/types';
import { buildingAt, getWorld } from '../sim/world/layout';
import { raining } from '../sim/weather';
import { daylight } from '../sim/clock';
import { Radio } from './radio';

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
    this.radio.update(drivingSpeed !== null);
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
