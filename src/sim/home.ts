// Home upkeep for the player: washing up, laundry and tidying. Neglect shows up in
// mood at home, in shift grooming (a grubby uniform) and at interviews.
import type { GameState, Person } from './types';
import { clamp } from './core';
import { isOnShift } from './employment';
import { itemName } from './items';
import { fmtClock } from './clock';

/** an outfit this worn is dirty: it counts against you at work and at interviews */
export const DIRTY_AT = 70;
/** cooking needs a clean pan: at this many dirty dishes you must wash up first */
export const DISHES_BLOCK = 8;
export const WASH_MINUTES = 75;

export interface Chores {
  dishes: number;
  /** untidiness of the home, 0 tidy .. 100 a tip */
  mess: number;
  /** outfit id -> wear 0 clean .. 100 filthy */
  wear: Record<string, number>;
  washer: { items: string[]; until: number } | null;
}

export function choresOf(p: Person): Chores {
  if (!p.chores) p.chores = { dishes: 0, mess: 10, wear: {}, washer: null };
  return p.chores;
}

export const wearOf = (p: Person, outfit: string) => Math.round(p.chores?.wear[outfit] ?? 0);
export const isDirty = (p: Person, outfit = p.appearance.outfit) => wearOf(p, outfit) >= DIRTY_AT;
export const inWash = (p: Person, outfit: string) => !!p.chores?.washer?.items.includes(outfit);

/** per-minute upkeep: clothes wear while worn, the flat slowly gets untidy */
export function tickChores(state: GameState, p: Person, dt: number) {
  if (!p.isPlayer) return;
  const c = choresOf(p);
  if (!p.sleeping) {
    const a = p.action?.type;
    const working = !!p.contractId && isOnShift(state, p.id, state.contracts[p.contractId]?.businessId ?? '');
    const sweaty = a === 'stock_shelf' || a === 'clean' || a === 'take_case' || a === 'check_in_delivery' || a === 'bale_cardboard' || a === 'empty_bin';
    const rate = sweaty ? 0.3 : working ? 0.12 : 0.045;
    const o = p.appearance.outfit;
    c.wear[o] = clamp((c.wear[o] ?? 0) + rate * dt, 0, 100);
  }
  c.mess = clamp(c.mess + 0.0045 * dt, 0, 100);
}

/** what eating, cooking and changing do to the flat */
export function homeMess(p: Person, kind: 'eat' | 'cook' | 'shopping' | 'change') {
  if (!p.isPlayer) return;
  const c = choresOf(p);
  if (kind === 'eat') { c.dishes += 1; c.mess += 1.5; }
  if (kind === 'cook') { c.dishes += 3; c.mess += 2; }
  if (kind === 'shopping') c.mess += 1;
  if (kind === 'change') c.mess += 2;
  c.mess = clamp(c.mess, 0, 100);
}

/** mood pressure from a neglected home (only felt while you are in it) */
export function homeMoodPenalty(p: Person): number {
  const c = p.chores;
  if (!c || !p.homeId || p.where !== p.homeId) return 0;
  return (c.dishes >= 6 ? 5 : 0) + (c.mess >= 60 ? 8 : c.mess >= 35 ? 3 : 0);
}

export const messLabel = (m: number) => (m < 15 ? 'tidy' : m < 35 ? 'a bit cluttered' : m < 60 ? 'messy' : 'a tip');

/** short status lines for the UI */
export function choreStatus(state: GameState, p: Person): string[] {
  const c = p.chores;
  if (!c) return [];
  const out: string[] = [];
  if (c.dishes > 0) out.push(`${c.dishes} dirty dish${c.dishes === 1 ? '' : 'es'}${c.dishes >= DISHES_BLOCK ? ' - wash up before cooking' : ''}`);
  if (c.mess >= 15) out.push(`Flat is ${messLabel(c.mess)}`);
  for (const [o, w] of Object.entries(c.wear)) if (w >= DIRTY_AT && !inWash(p, o)) out.push(`${itemName(o)} needs washing`);
  if (c.washer) out.push(state.minute >= c.washer.until ? 'Washing is done - unload the machine' : `Washing machine running until ${fmtClock(c.washer.until)}`);
  return out;
}
