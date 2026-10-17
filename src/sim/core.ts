import type { GameState, Id, Vec2 } from './types';

// ------------------------------------------------------------------ ids
export function nextId(state: GameState, prefix: string): Id {
  const n = (state.counters[prefix] ?? 0) + 1;
  state.counters[prefix] = n;
  return `${prefix}_${n}`;
}

// ------------------------------------------------------------------ rng
// mulberry32 - small, fast, deterministic; state lives in GameState.rng
export function rand(state: GameState): number {
  let t = (state.rng = (state.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randInt(state: GameState, min: number, max: number): number {
  return min + Math.floor(rand(state) * (max - min + 1));
}

export function pick<T>(state: GameState, arr: readonly T[]): T {
  return arr[Math.floor(rand(state) * arr.length)];
}

/** stand-alone seeded generator for building static data */
export function seeded(seed: number): () => number {
  let s = seed | 0;
  return () => {
    let t = (s = (s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --------------------------------------------------------------- vectors
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ------------------------------------------------------------------ money
export function fmtMoney(cents: number): string {
  const neg = cents < 0;
  const v = Math.abs(cents) / 100;
  return `${neg ? '-' : ''}Cr ${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
