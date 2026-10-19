// Weather: a deterministic forecast from the world seed (no stored state, so saves and replays agree).
// About a third of days have a spell of rain; rain keeps people indoors and soaks anyone outside.
import type { GameState } from './types';
import { MIN_PER_DAY } from './clock';

function hash(a: number, b: number) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** the day's rain spell, if any: start and end minute of the day, and how heavy (0..1) */
export function rainSpell(seed: number, day: number): { start: number; end: number; heavy: number } | null {
  if (hash(seed, day * 3) > 0.34) return null;
  const start = Math.floor(hash(seed, day * 3 + 1) * 20 * 60);
  const len = 90 + Math.floor(hash(seed, day * 3 + 2) * 6 * 60);
  return { start, end: Math.min(MIN_PER_DAY, start + len), heavy: 0.35 + hash(seed, day * 5 + 7) * 0.65 };
}

/** rain intensity at a minute: 0 dry .. 1 downpour, easing in and out over half an hour */
export function rainAt(seed: number, minute: number): number {
  const day = Math.floor(minute / MIN_PER_DAY), m = minute - day * MIN_PER_DAY;
  const s = rainSpell(seed, day);
  if (!s || m < s.start || m > s.end) return 0;
  const ramp = Math.min(1, (m - s.start) / 30, (s.end - m) / 30);
  return s.heavy * Math.max(0, ramp);
}

export const raining = (state: GameState, minute = state.minute) => rainAt(state.seed, minute);

/** how much rain cuts footfall at the shops (shown in the business report) */
export const rainDemandFactor = (state: GameState) => 1 - 0.25 * raining(state);

export function weatherLabel(state: GameState): string {
  const r = raining(state);
  if (r > 0.65) return 'Heavy rain';
  if (r > 0.05) return 'Rain';
  const s = rainSpell(state.seed, Math.floor(state.minute / MIN_PER_DAY));
  const m = state.minute % MIN_PER_DAY;
  if (s && m < s.start && s.start - m < 180) return 'Clouding over';
  return 'Dry';
}
