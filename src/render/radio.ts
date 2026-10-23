// The car radio: four stations of music made up as it plays (Web Audio, no sample files). Each station
// has a tempo, a chord progression and its own band: drums, a bass line, chords and a lead that
// improvises over the chords but repeats its phrases, so it sounds like a song rather than noise.
// Notes are scheduled a fraction of a second ahead of the audio clock so the timing stays tight.

type Voice = { ctx: AudioContext; out: AudioNode; noise: AudioBuffer };
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function tone(v: Voice, midi: number, t: number, dur: number, type: OscillatorType, vol: number, cutoff = 4000, attack = 0.005) {
  const o = v.ctx.createOscillator(); o.type = type; o.frequency.value = mtof(midi);
  const f = v.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
  const g = v.ctx.createGain();
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(f).connect(g).connect(v.out); o.start(t); o.stop(t + dur + 0.05);
}
function kick(v: Voice, t: number, vol = 0.5) {
  const o = v.ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  const g = v.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  o.connect(g).connect(v.out); o.start(t); o.stop(t + 0.32);
}
function hiss(v: Voice, t: number, dur: number, freq: number, vol: number, type: BiquadFilterType = 'highpass') {
  const s = v.ctx.createBufferSource(); s.buffer = v.noise;
  const f = v.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
  const g = v.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(v.out); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
}
const snare = (v: Voice, t: number, vol = 0.18) => { hiss(v, t, 0.18, 1800, vol, 'bandpass'); tone(v, 50, t, 0.08, 'triangle', vol * 0.6); };
const hat = (v: Voice, t: number, vol = 0.05) => hiss(v, t, 0.04, 7000, vol);

/** the same few phrases for each bar of the cycle: seeded by the bar, so they come round again */
function phrase(seed: number, n: number): number[] {
  let h = (seed * 2654435761) >>> 0;
  const out: number[] = [];
  for (let i = 0; i < n; i++) { h = (h * 1103515245 + 12345) >>> 0; out.push((h >>> 8) % 1000 / 1000); }
  return out;
}

interface Station { name: string; tag: string; bpm: number; swing?: number; prog: number[][]; step(v: Voice, s: number, t: number, chord: number[], bar: number, beat: number): void }

const C = (root: number, q: 'maj' | 'min' | 'min7' | 'maj7' | 'dom7') => {
  const iv = { maj: [0, 4, 7], min: [0, 3, 7], min7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], dom7: [0, 4, 7, 10] }[q];
  return iv.map((i) => root + i);
};

export const STATIONS: Station[] = [
  {
    name: 'Harbour FM', tag: 'Hits all day', bpm: 116,
    prog: [C(60, 'maj'), C(67, 'maj'), C(69, 'min'), C(65, 'maj')],
    step(v, s, t, ch, bar, beat) {
      if (s % 8 === 0) kick(v, t);
      if (s % 8 === 4) snare(v, t);
      if (s % 2 === 0) hat(v, t, s % 4 === 2 ? 0.06 : 0.03);
      if (s % 2 === 0) tone(v, ch[0] - 24, t, beat * 0.45, 'triangle', 0.22, 600);
      if (s === 0 || s === 6 || s === 10) for (const n of ch) tone(v, n, t, beat * 0.9, 'square', 0.025, 1800);
      const r = phrase(bar % 4, 16);
      if (s % 2 === 0 && r[s] > 0.45) { const scale = [0, 2, 4, 7, 9]; tone(v, 72 + scale[Math.floor(r[(s + 3) % 16] * 5)] + (ch[0] % 12 === 9 ? -3 : 0), t, beat * 0.8, 'sawtooth', 0.045, 2400); }
    },
  },
  {
    name: 'Neon 88', tag: 'Synthwave after dark', bpm: 100,
    prog: [C(57, 'min'), C(53, 'maj'), C(60, 'maj'), C(55, 'maj')],
    step(v, s, t, ch, bar, beat) {
      if (s % 4 === 0) kick(v, t, 0.55);
      if (s % 8 === 4) { snare(v, t, 0.25); hiss(v, t, 0.6, 3000, 0.05); }
      if (s % 2 === 1) hat(v, t, 0.03);
      tone(v, ch[0] - 24 + (s % 2 ? 12 : 0), t, beat * 0.22, 'sawtooth', 0.09, 500);
      const arp = [ch[0], ch[1], ch[2], ch[0] + 12, ch[2], ch[1]];
      tone(v, arp[s % arp.length] + 12, t, beat * 0.3, 'sawtooth', 0.035, 1600 + 800 * Math.sin(bar + s / 4));
      if (s === 0) for (const n of ch) tone(v, n, t, beat * 4, 'sawtooth', 0.02, 900, 0.3);
    },
  },
  {
    name: 'Chill Waves', tag: 'Lo-fi beats to drive to', bpm: 78, swing: 0.18,
    prog: [C(62, 'min7'), C(55, 'dom7'), C(60, 'maj7'), C(57, 'min7')],
    step(v, s, t, ch, bar, beat) {
      if (s === 0 || s === 10) kick(v, t, 0.35);
      if (s === 8) snare(v, t, 0.1);
      if (s % 2 === 0) hat(v, t, 0.025);
      if (s % 4 === 0) hiss(v, t, 0.02, 3000, 0.012, 'bandpass'); // vinyl crackle
      if (s === 0 || s === 7) for (const n of ch) tone(v, n, t + (n % 3) * 0.012, beat * 3, 'triangle', 0.035, 1400, 0.02);
      if (s === 0 || s === 8) tone(v, ch[0] - 24, t, beat * 1.6, 'sine', 0.25, 400);
      const r = phrase(bar % 2 + 7, 16);
      if (r[s] > 0.72) tone(v, ch[r[(s + 5) % 16] > 0.5 ? 1 : 3] + 12, t, beat * 1.2, 'sine', 0.05, 3000);
    },
  },
  {
    name: 'Classic Harbour', tag: 'The great composers', bpm: 92,
    prog: [C(60, 'maj'), C(65, 'maj'), C(67, 'dom7'), C(60, 'maj')],
    step(v, s, t, ch, bar, beat) {
      // Alberti bass under a slow singing melody
      const alb = [ch[0], ch[2], ch[1], ch[2]];
      if (s % 2 === 0) tone(v, alb[(s / 2) % 4] - 12, t, beat * 0.6, 'sine', 0.07, 2500);
      const r = phrase(bar % 4 + 20, 16);
      if (s % 4 === 0) { const scale = [0, 2, 4, 5, 7, 9, 11, 12]; tone(v, 72 + scale[Math.floor(r[s] * 8)], t, beat * (r[s + 1] > 0.6 ? 1.9 : 0.95), 'triangle', 0.06, 3500, 0.02); }
      if (s === 0) tone(v, ch[0] - 24, t, beat * 4, 'sine', 0.08, 800, 0.05);
    },
  },
];

export class Radio {
  private v: Voice | null = null;
  private gain: GainNode | null = null;
  station = -1;
  private next = 0;
  private stepN = 0;
  private bar = 0;

  attach(ctx: AudioContext, master: AudioNode, noise: AudioBuffer) {
    if (this.v) return;
    // through a small car speaker: no deep bass, no sparkle
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 70;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6000;
    const g = ctx.createGain(); g.gain.value = 0;
    hp.connect(lp).connect(g).connect(master);
    this.gain = g;
    this.v = { ctx, out: hp, noise };
  }

  /** next station (off is one of them) */
  cycle(): string {
    this.station = this.station + 1 >= STATIONS.length ? -1 : this.station + 1;
    this.stepN = 0; this.bar = 0;
    if (this.v) this.next = this.v.ctx.currentTime + 0.08;
    return this.station < 0 ? 'Radio off' : `📻 ${STATIONS[this.station].name} · ${STATIONS[this.station].tag}`;
  }

  update(on: boolean) {
    const v = this.v;
    if (!v || !this.gain) return;
    const play = on && this.station >= 0;
    this.gain.gain.setTargetAtTime(play ? 0.55 : 0, v.ctx.currentTime, 0.15);
    if (!play) { this.next = v.ctx.currentTime + 0.08; return; }
    const st = STATIONS[this.station];
    const beat = 60 / st.bpm, six = beat / 4;
    if (this.next < v.ctx.currentTime) this.next = v.ctx.currentTime + 0.02;
    while (this.next < v.ctx.currentTime + 0.25) {
      const s = this.stepN % 16;
      const chord = st.prog[this.bar % st.prog.length];
      const t = this.next + (st.swing && s % 2 === 1 ? six * st.swing : 0);
      st.step(v, s, t, chord, this.bar, beat);
      this.next += six;
      this.stepN++;
      if (this.stepN % 16 === 0) this.bar++;
    }
  }
}
