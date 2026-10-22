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

/** the year is 28 days long: a week each of spring, summer, autumn and winter */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export function seasonOf(minute: number): Season {
  const d = Math.floor(minute / MIN_PER_DAY) % 28;
  return d < 7 ? 'spring' : d < 14 ? 'summer' : d < 21 ? 'autumn' : 'winter';
}
const BASE_TEMP: Record<Season, number> = { spring: 12, summer: 21, autumn: 11, winter: 2 };

/** air temperature (°C): the season, the time of day, a little day-to-day variation, cooler in rain */
export function temperature(state: GameState, minute = state.minute): number {
  const day = Math.floor(minute / MIN_PER_DAY);
  const m = minute - day * MIN_PER_DAY;
  const daily = -Math.cos(((m - 3 * 60) / MIN_PER_DAY) * Math.PI * 2) * 4.5; // coldest before dawn, warmest mid-afternoon
  const wobble = (hash(state.seed, day * 11 + 3) - 0.5) * 6;
  return Math.round((BASE_TEMP[seasonOf(minute)] + daily + wobble - raining(state, minute) * 2.5) * 10) / 10;
}

/** rain falls as snow when it is cold enough */
export const snowing = (state: GameState, minute = state.minute) => raining(state, minute) > 0.02 && temperature(state, minute) <= 1.5;

/** how much snow is lying (0..1): builds while it snows, thaws when it is above freezing */
export function snowCover(state: GameState): number {
  if (seasonOf(state.minute) !== 'winter') return 0;
  let cover = 0;
  for (let t = state.minute - 36 * 60; t <= state.minute; t += 30) {
    if (snowing(state, t)) cover = Math.min(1, cover + 0.08 * raining(state, t) * 2);
    else cover = Math.max(0, cover - (temperature(state, t) > 3 ? 0.04 : 0.005));
  }
  return cover;
}

/** how much rain cuts footfall at the shops (shown in the business report) */
export const rainDemandFactor = (state: GameState) => 1 - 0.25 * raining(state);

export function weatherLabel(state: GameState): string {
  const r = raining(state);
  const t = `${Math.round(temperature(state))}°C`;
  if (snowing(state)) return `${r > 0.65 ? 'Heavy snow' : 'Snow'}, ${t}`;
  if (r > 0.65) return `Heavy rain, ${t}`;
  if (r > 0.05) return `Rain, ${t}`;
  return `${weatherWord(state)}, ${t}`;
}
function weatherWord(state: GameState): string {
  const s = rainSpell(state.seed, Math.floor(state.minute / MIN_PER_DAY));
  const m = state.minute % MIN_PER_DAY;
  if (s && m < s.start && s.start - m < 180) return 'Clouding over';
  if (snowCover(state) > 0.3) return 'Snow lying';
  const sea = seasonOf(state.minute);
  return sea === 'summer' && m > 9 * 60 && m < 19 * 60 ? 'Sunny' : sea === 'winter' ? 'Cold and dry' : 'Dry';
}
