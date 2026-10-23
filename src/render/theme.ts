// The title theme and the stings: music for the loading screen and the character creator (a slow
// minor-key hip-hop groove with a hook you can hum), and the short jingles for a job done, getting
// wasted or busted. Synthesised like the radio, at full range (not through a car speaker).
import { hat, hiss, kick, snare, tone, type Voice } from './radio';

const AM = [57, 60, 64], F = [53, 57, 60], DM = [50, 53, 57], E = [52, 56, 59];
const PROG = [AM, F, DM, E];
// the hook: two bars, sixteenth-note steps -> [step, midi, length in sixteenths]
const HOOK: [number, number, number][] = [
  [0, 76, 3], [3, 74, 1], [4, 72, 2], [6, 71, 2], [8, 69, 4], [12, 72, 2], [14, 74, 2],
  [16, 76, 3], [19, 77, 1], [20, 76, 2], [22, 74, 2], [24, 71, 6], [30, 68, 2],
];

export class Theme {
  private v: Voice | null = null;
  private gain: GainNode | null = null;
  private next = 0;
  private stepN = 0;
  private playing = false;

  attach(ctx: AudioContext, master: AudioNode, noise: AudioBuffer) {
    if (this.v) return;
    const g = ctx.createGain(); g.gain.value = 0; g.connect(master);
    // a touch of echo on everything
    const d = ctx.createDelay(1); d.delayTime.value = (60 / 92) * 0.75;
    const fb = ctx.createGain(); fb.gain.value = 0.28;
    const wet = ctx.createGain(); wet.gain.value = 0.22;
    const bus = ctx.createGain();
    bus.connect(g); bus.connect(d); d.connect(fb).connect(d); d.connect(wet).connect(g);
    this.gain = g;
    this.v = { ctx, out: bus, noise };
  }

  play(on: boolean) {
    if (!this.v || !this.gain) return;
    if (on && !this.playing) { this.stepN = 0; this.next = this.v.ctx.currentTime + 0.1; }
    this.playing = on;
    this.gain.gain.setTargetAtTime(on ? 0.7 : 0, this.v.ctx.currentTime, on ? 0.4 : 0.8);
  }
  get on() { return this.playing; }

  update() {
    const v = this.v;
    if (!v || !this.playing) return;
    const beat = 60 / 92, six = beat / 4;
    if (this.next < v.ctx.currentTime) this.next = v.ctx.currentTime + 0.02;
    while (this.next < v.ctx.currentTime + 0.3) {
      const s = this.stepN % 16, bar = Math.floor(this.stepN / 16), ch = PROG[bar % 4];
      const t = this.next + (s % 2 === 1 ? six * 0.12 : 0);
      const intro = bar < 4;
      // pads, always
      if (s === 0) for (const n of ch) tone(v, n, t, beat * 4.2, 'sawtooth', 0.018, 700 + (intro ? bar * 250 : 1400), 0.6);
      if (s === 0) tone(v, ch[0] - 24, t, beat * 4, 'sine', intro ? 0.08 : 0.0, 300);
      // a plucked arpeggio, opening up through the intro
      const arp = [ch[0], ch[2], ch[1] + 12, ch[2]];
      if (s % 2 === 0) tone(v, arp[(s / 2) % 4] + 12, t, beat * 0.4, 'triangle', 0.035, intro ? 900 + bar * 500 : 3000);
      if (intro) {
        if (bar === 3 && s >= 8 && s % 2 === 0) snare(v, t, 0.04 + (s - 8) * 0.02);
        if (bar === 3 && s === 15) hiss(v, t, 0.6, 2500, 0.12);
      } else {
        // the beat: lazy kick, fat snare on two and four, swung hats
        if (s === 0 || s === 7 || s === 10) kick(v, t, 0.6);
        if (s === 4 || s === 12) { snare(v, t, 0.26); hiss(v, t, 0.25, 900, 0.05, 'bandpass'); }
        if (s % 2 === 0 || s === 15) hat(v, t, s % 4 === 2 ? 0.05 : 0.025);
        // sub bass follows the kick
        if (s === 0 || s === 7 || s === 10) tone(v, ch[0] - 24, t, beat * (s === 0 ? 1.6 : 0.7), 'sine', 0.32, 260);
        if (s === 14) tone(v, ch[0] - 12 - (bar % 2 ? 2 : 0), t, beat * 0.4, 'triangle', 0.12, 600);
        // the hook, every other pair of bars; a counter-line in between
        const phase = (bar - 4) % 8;
        if (phase < 4) {
          const at = (phase % 2) * 16 + s;
          for (const [st, m, len] of HOOK) if (st === at) { tone(v, m, t, six * len * 1.1, 'square', 0.05, 2600, 0.01); tone(v, m - 12, t, six * len, 'sawtooth', 0.02, 1500); }
        } else if (s % 4 === 0) tone(v, ch[(s / 4 + phase) % 3] + 24, t, beat * 0.9, 'sine', 0.03, 4000);
        // a fill at the end of every eight bars
        if ((bar - 4) % 8 === 7 && s >= 12) snare(v, t, 0.15);
      }
      this.next += six;
      this.stepN++;
    }
  }

  /** a job done: a bright rising fanfare */
  passed() {
    const v = this.v; if (!v) return;
    const t = v.ctx.currentTime + 0.05;
    [[60, 0], [64, 0.12], [67, 0.24], [72, 0.36]].forEach(([m, w]) => tone(v, m, t + w, 0.5, 'square', 0.06, 3000));
    for (const m of [72, 76, 79]) tone(v, m, t + 0.5, 1.4, 'sawtooth', 0.035, 2600, 0.02);
    kick(v, t + 0.5, 0.5); hiss(v, t + 0.5, 1.2, 4000, 0.06);
  }
  /** wasted: everything slows and sinks */
  wasted() {
    const v = this.v; if (!v) return;
    const t = v.ctx.currentTime + 0.05;
    const o = v.ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(55, t + 2.4);
    const g = v.ctx.createGain(); g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    o.connect(g).connect(v.out); o.start(t); o.stop(t + 2.7);
    kick(v, t, 0.8); kick(v, t + 0.9, 0.5);
    for (const m of [45, 48, 52]) tone(v, m, t + 0.9, 2.5, 'sine', 0.08, 500, 0.2);
  }
  /** busted: a stab and the cell door */
  busted() {
    const v = this.v; if (!v) return;
    const t = v.ctx.currentTime + 0.05;
    for (const m of [50, 53, 56, 59]) tone(v, m, t, 0.9, 'square', 0.04, 1800);
    kick(v, t, 0.7); hiss(v, t + 0.6, 0.5, 300, 0.4, 'lowpass'); tone(v, 31, t + 0.6, 0.6, 'square', 0.15, 200);
  }
}
