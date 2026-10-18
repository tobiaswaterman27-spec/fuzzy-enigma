// Physical condition: energy and satiety with observable effects on
// movement speed, action speed and work performance.
import type { GameState, Person } from './types';
import { CLOTHING } from './items';
import { clamp } from './core';
import { DIRTY_AT, homeMoodPenalty } from './home';

export const ENERGY_DECAY = 0.075; // per awake minute (100 -> 0 in ~22h)
export const WORK_EXTRA = 0.035; // extra drain while doing physical work
export const SATIETY_DECAY = 0.07; // per minute
export const SLEEP_GAIN = 0.21; // per minute asleep in a bed

export const HYGIENE_DECAY = 0.035;

export function tickNeeds(_state: GameState, p: Person, dt: number) {
  const n = p.needs;
  if (n.hygiene === undefined) n.hygiene = 80;
  if (n.mood === undefined) n.mood = 60;
  const a0 = p.action?.type;
  // hygiene: physical work makes you sweat; NPC routines (shower at home) are abstracted
  if (p.isPlayer) {
    n.hygiene -= HYGIENE_DECAY * dt * (a0 === 'stock_shelf' || a0 === 'clean' || a0 === 'take_case' ? 2 : 1);
    // mood drifts toward a baseline set by how your basic needs are going
    const base = 55 - (n.satiety < 20 ? 20 : 0) - (n.energy < 20 ? 15 : 0) - (n.hygiene < 25 ? 10 : 0) - homeMoodPenalty(p);
    n.mood += (base - n.mood) * 0.002 * dt;
    if (a0 === 'watch_tv') n.mood += 0.45 * dt;
    if (a0 === 'sit') n.mood += 0.12 * dt;
    if (a0 === 'buy_meal') n.mood += 0.35 * dt;
    if (a0 === 'shower') { n.hygiene += 14 * dt; n.mood += 0.3 * dt; }
    if (a0 === 'tidy') n.mood += 0.15 * dt;
  } else {
    if (!p.visible) n.hygiene = Math.min(100, n.hygiene + 0.2 * dt); else n.hygiene -= HYGIENE_DECAY * dt;
    n.mood += (60 - n.mood) * 0.003 * dt;
  }
  n.hygiene = clamp(n.hygiene, 0, 100);
  n.mood = clamp(n.mood, 0, 100);
  if (p.sleeping) {
    const quality = p.action?.target === 'bed' || !p.isPlayer ? 1 : 0.45; // benches are poor beds
    n.energy += SLEEP_GAIN * quality * dt;
    n.satiety -= SATIETY_DECAY * 0.5 * dt;
  } else {
    const working = a0 === 'stock_shelf' || a0 === 'clean' || a0 === 'take_case' || a0 === 'serve_customer' || a0 === 'check_in_delivery';
    let drain = ENERGY_DECAY * (1 - (working ? 0 : CLOTHING[p.appearance.outfit]?.comfort ?? 0));
    const a = p.action?.type;
    if (a === 'stock_shelf' || a === 'clean' || a === 'check_in_delivery' || a === 'take_case') drain += WORK_EXTRA;
    if (a === 'sit') drain = -0.04;
    if (n.satiety < 15) drain *= 1.5;
    n.energy -= drain * dt;
    n.satiety -= SATIETY_DECAY * dt;
  }
  n.energy = clamp(n.energy, 0, 100);
  n.satiety = clamp(n.satiety, 0, 100);
}

/** multipliers derived from condition; shown in the UI so they are never hidden */
export function capability(p: Person) {
  const e = p.needs.energy;
  const s = p.needs.satiety;
  let move = 1, act = 1;
  if (e < 25) { move *= 0.8; act *= 0.8; }
  if (e < 10) { move *= 0.8; act *= 0.8; }
  if (s < 10) act *= 0.85;
  if ((p.needs.mood ?? 60) < 25) act *= 0.9;
  return { move, act };
}

export function conditionLabel(p: Person): string[] {
  const out: string[] = [];
  if (p.needs.energy < 10) out.push('Exhausted: much slower');
  else if (p.needs.energy < 25) out.push('Tired: slower');
  if (p.needs.satiety < 10) out.push('Starving: work slower, tire faster');
  else if (p.needs.satiety < 25) out.push('Hungry');
  if ((p.needs.hygiene ?? 80) < 30) out.push('Smelly: -10 at interviews & work');
  if ((p.needs.mood ?? 60) < 25) out.push('Low mood: work 10% slower');
  if (p.isPlayer && (p.chores?.wear[p.appearance.outfit] ?? 0) >= DIRTY_AT) out.push('Dirty clothes: -10 at work, worse at interviews');
  return out;
}

export const skillLevel = (xp: number) => Math.floor(Math.sqrt(Math.max(0, xp) / 12));
export function addXp(p: Person, skill: string, xp: number) {
  p.skills[skill] = (p.skills[skill] ?? 0) + xp;
}
