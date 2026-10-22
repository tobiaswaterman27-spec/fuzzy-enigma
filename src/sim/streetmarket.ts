// Harbourside Saturday Market: traders' stalls in the park from 09:00 to 15:00 on Saturdays (not in the
// rain). Fresh produce costs a little more than in the shops but people enjoy the outing.
import type { GameState, Id } from './types';
import { dayIndex, minuteOfDay } from './clock';
import { clamp, fmtMoney } from './core';
import { transfer } from './ledger';
import { addItems } from './inventory';
import { ITEMS, itemName } from './items';
import { raining } from './weather';

export interface Stall { id: Id; label: string; product: string; pos: { x: number; z: number }; obj: { x: number; z: number }; awning: string }

export const STALLS: Stall[] = [
  { id: 'stall_veg', label: 'Fruit & veg stall', product: 'apples', pos: { x: 49, z: 16.9 }, obj: { x: 49, z: 18.4 }, awning: '#2e8b57' },
  { id: 'stall_bread', label: 'Artisan bakery stall', product: 'bread', pos: { x: 64, z: 16.9 }, obj: { x: 64, z: 18.4 }, awning: '#c0392b' },
  { id: 'stall_coffee', label: 'Coffee roaster', product: 'coffee', pos: { x: 67.5, z: 19.9 }, obj: { x: 67.5, z: 21.4 }, awning: '#34495e' },
];
export const MARKET_PREMIUM = 1.15;
const OPEN = 9 * 60, CLOSE = 15 * 60;

/** Saturdays (day 5 of the week, counting Monday as 0), 09:00-15:00, dry */
export function marketOn(state: GameState, minute = state.minute): boolean {
  const m = minuteOfDay(minute);
  return dayIndex(minute) % 7 === 5 && m >= OPEN && m < CLOSE && raining(state) < 0.3;
}

export const stallPrice = (product: string) => Math.round(ITEMS[product].retail * MARKET_PREMIUM / 5) * 5;

export function buyAtStall(state: GameState, personId: Id, stallId: Id): { ok: boolean; msg: string } {
  const s = STALLS.find((x) => x.id === stallId);
  const p = state.people[personId];
  if (!s || !p) return { ok: false, msg: 'No such stall.' };
  if (!marketOn(state)) return { ok: false, msg: 'The market is not on.' };
  const price = stallPrice(s.product);
  const r = transfer(state, { from: p.accountId, to: state.externalId, amount: price, reason: 'purchase', memo: `${s.label}: ${itemName(s.product)}`, key: `stall:${personId}:${state.minute}:${s.id}` });
  if (!r.ok) return { ok: false, msg: `It costs ${fmtMoney(price)}.` };
  if (p.pantryId && !p.isPlayer) addItems(state.containers[p.pantryId], s.product, 1);
  else addItems(state.containers[p.bagId], s.product, 1);
  p.needs.mood = clamp((p.needs.mood ?? 60) + 4, 0, 100);
  return { ok: true, msg: `Bought ${itemName(s.product)} for ${fmtMoney(price)}.` };
}
