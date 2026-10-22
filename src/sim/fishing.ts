// Fishing off the quay: buy a rod and bait at the Bait & Tackle hut, cast at a fishing spot, wait for
// the float to go under and strike (E) before the fish spits the hook. Dawn and dusk are best. Keep
// the catch to cook at home or sell it back at the hut.
import type { GameState, Id, Person } from './types';
import { dayIndex, minuteOfDay } from './clock';
import { addItems, count, removeItems } from './inventory';
import { fmtMoney, rand } from './core';
import { lifeEvent, news } from './events';
import { transfer } from './ledger';

export const ROD_PRICE = 2500;
export const BAIT_PRICE = 250; // a tub of ten
export interface Fish { id: string; name: string; weight: [number, number]; price: number; chance: number }
export const CATCH: Fish[] = [
  { id: 'fish_mackerel', name: 'mackerel', weight: [0.3, 0.8], price: 300, chance: 0.42 },
  { id: 'fish_pollock', name: 'pollock', weight: [0.6, 2.5], price: 500, chance: 0.2 },
  { id: 'fish_bass', name: 'sea bass', weight: [1, 4.5], price: 1400, chance: 0.1 },
  { id: 'fish_cod', name: 'cod', weight: [1.2, 6], price: 1100, chance: 0.08 },
  { id: 'crab', name: 'crab', weight: [0.3, 1.2], price: 400, chance: 0.1 },
  { id: 'old_boot', name: 'old boot', weight: [0.6, 0.6], price: 0, chance: 0.1 },
];

const rodIn = (state: GameState, p: Person) => count(state.containers[p.bagId], 'fishing_rod') > 0;
const baitIn = (state: GameState, p: Person) => count(state.containers[p.bagId], 'bait');

export function fishingBlocker(state: GameState, p: Person): string | undefined {
  if (!rodIn(state, p)) return 'You need a rod (Bait & Tackle hut)';
  if (!baitIn(state, p)) return 'Out of bait (Bait & Tackle hut)';
  return undefined;
}

/** cast: bait on, line out; the bite comes some time in the next few minutes (sooner at dawn and dusk) */
export function castFromBoat(state: GameState, p: Person) {
  cast(state, p);
  p.action = { type: 'fish', target: 'boat', started: state.minute, progress: 0, unitTime: 0, duration: 999, units: 0 };
}

export function cast(state: GameState, p: Person) {
  removeItems(state.containers[p.bagId], 'bait', 1);
  const mod = minuteOfDay(state.minute);
  const golden = (mod > 5 * 60 && mod < 8 * 60) || (mod > 18 * 60 && mod < 21 * 60);
  const wait = (golden ? 0.5 : 1) * (0.6 + rand(state) * 3.2);
  state.fishing = { by: p.id, biteAt: state.minute + wait, window: 0.45, struck: false };
}

/** the float has gone under */
export const biting = (state: GameState) => !!state.fishing && state.minute >= state.fishing.biteAt && state.minute < state.fishing.biteAt + state.fishing.window;

function landFish(state: GameState, p: Person): string {
  // out on the water the mackerel shoals give way to bigger fish
  let r = p.where === 'vehicle' ? 0.42 + rand(state) * 0.58 : rand(state), f = CATCH[0];
  for (const c of CATCH) { if (r < c.chance) { f = c; break; } r -= c.chance; }
  const kg = Math.round((f.weight[0] + rand(state) * (f.weight[1] - f.weight[0])) * 100) / 100;
  if (f.id === 'old_boot') return 'You reel in... an old boot. You throw it back.';
  addItems(state.containers[p.bagId], f.id, 1);
  const best = (p.fishingBest ??= {});
  const pb = kg > (best[f.id] ?? 0);
  if (pb) best[f.id] = kg;
  p.fishCaught = (p.fishCaught ?? 0) + 1;
  if (f.id === 'fish_bass' && kg > 4) { lifeEvent(state, p, `Landed a ${kg} kg sea bass off the quay`); news(state, 'good', `A monster bass: ${kg} kg!`, 'The talk of the quay.', true); }
  return `You land a ${f.name}, ${kg} kg${pb && p.fishCaught > 1 ? ' - your best yet!' : ''}`;
}

/** E while fishing: strike. Too early scares the fish; in time lands it; too late it is gone */
export function strike(state: GameState, p: Person): string {
  const f = state.fishing;
  if (!f || f.by !== p.id) return '';
  state.fishing = null;
  p.action = null;
  if (state.minute < f.biteAt) return 'Too soon: nothing there, and the bait is gone.';
  if (state.minute > f.biteAt + f.window) return 'Too late: it took the bait and swam off.';
  return landFish(state, p);
}

/** while the line is out: a fish that is not struck in time gets away */
export function fishingTick(state: GameState, p: Person): string | null {
  const f = state.fishing;
  if (!f || f.by !== p.id) return null;
  if (state.minute > f.biteAt + f.window) { state.fishing = null; p.action = null; return 'It got away. Strike (E) as soon as the float goes under.'; }
  return null;
}

/** townspeople who fish just catch something (or not) after a while */
export function npcCatch(state: GameState, p: Person) {
  if (rand(state) < 0.6) { const f = CATCH[Math.floor(rand(state) * 4)]; addItems(state.containers[p.bagId], f.id, 1); }
}

export function buyTackle(state: GameState, p: Person, what: 'rod' | 'bait'): { ok: boolean; msg: string } {
  const price = what === 'rod' ? ROD_PRICE : BAIT_PRICE;
  if (what === 'rod' && rodIn(state, p)) return { ok: false, msg: 'You already have a rod.' };
  const r = transfer(state, { from: p.accountId, to: state.externalId, amount: price, reason: 'purchase', memo: what === 'rod' ? 'Fishing rod' : 'Bait (10)', key: `tackle:${what}:${Math.floor(state.minute * 4)}` });
  if (!r.ok) return { ok: false, msg: 'Not enough money.' };
  addItems(state.containers[p.bagId], what === 'rod' ? 'fishing_rod' : 'bait', what === 'rod' ? 1 : 10);
  return { ok: true, msg: what === 'rod' ? 'A rod, reel and line. Cast off a fishing spot on the quay.' : 'Ten lots of bait.' };
}

export function sellCatch(state: GameState, p: Person): { ok: boolean; msg: string } {
  const bag = state.containers[p.bagId];
  let total = 0, n = 0;
  for (const f of CATCH) { const k = count(bag, f.id); if (k && f.price) { removeItems(bag, f.id, k); total += k * f.price; n += k; } }
  if (!total) return { ok: false, msg: 'Nothing to sell.' };
  transfer(state, { from: state.externalId, to: p.accountId, amount: total, reason: 'sale', memo: `Sold ${n} fish at the quay`, key: `fishsale:${Math.floor(state.minute * 4)}:${dayIndex(state.minute)}` });
  return { ok: true, msg: `Sold ${n} for ${fmtMoney(total)}.` };
}

export const hasCatch = (state: GameState, p: Person) => CATCH.some((f) => f.price && count(state.containers[p.bagId], f.id) > 0);
void ({} as Id);
