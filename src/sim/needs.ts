// Physical condition: energy and satiety with observable effects on
// movement speed, action speed and work performance.
import type { GameState, Person } from './types';
import { clamp } from './core';

export const ENERGY_DECAY = 0.075; // per awake minute (100 -> 0 in ~22h)
export const WORK_EXTRA = 0.035; // extra drain while doing physical work
export const SATIETY_DECAY = 0.07; // per minute
export const SLEEP_GAIN = 0.21; // per minute asleep in a bed

export function tickNeeds(state: GameState, p: Person, dt: number) {
  const n = p.needs;
  if (p.sleeping) {
    const quality = p.action?.target === 'bed' || !p.isPlayer ? 1 : 0.45; // benches are poor beds
    n.energy += SLEEP_GAIN * quality * dt;
    n.satiety -= SATIETY_DECAY * 0.5 * dt;
  } else {
    let drain = ENERGY_DECAY;
    const a = p.action?.type;
    if (a === 'stock_shelf' || a === 'clean' || a === 'check_in_delivery' || a === 'take_case') drain += WORK_EXTRA;
    if (a === 'sit') drain = -0.04;
    if (n.satiety < 15) drain *= 1.5;
    n.energy -= drain * dt;
    n.satiety -= SATIETY_DECAY * dt;
  }
  n.energy = clamp(n.energy, 0, 100);
  n.satiety = clamp(n.satiety, 0, 100);
  void state;
}

/** multipliers derived from condition; shown in the UI so they are never hidden */
export function capability(p: Person) {
  const e = p.needs.energy;
  const s = p.needs.satiety;
  let move = 1, act = 1;
  if (e < 25) { move *= 0.8; act *= 0.8; }
  if (e < 10) { move *= 0.8; act *= 0.8; }
  if (s < 10) act *= 0.85;
  return { move, act };
}

export function conditionLabel(p: Person): string[] {
  const out: string[] = [];
  if (p.needs.energy < 10) out.push('Exhausted: much slower');
  else if (p.needs.energy < 25) out.push('Tired: slower');
  if (p.needs.satiety < 10) out.push('Starving: work slower, tire faster');
  else if (p.needs.satiety < 25) out.push('Hungry');
  return out;
}

export const skillLevel = (xp: number) => Math.floor(Math.sqrt(Math.max(0, xp) / 12));
export function addXp(p: Person, skill: string, xp: number) {
  p.skills[skill] = (p.skills[skill] ?? 0) + xp;
}
