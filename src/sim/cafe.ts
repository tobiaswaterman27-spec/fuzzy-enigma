// Tidewater Cafe kitchen: while you work as the cook, customers come in and queue at the counter;
// you cook each meal at the grill (a plate in your hands) and serve it at the counter, where they pay.
// When only NPC staff are on, the cafe's trade is simulated statistically (economy.ts).
import type { GameState, Id } from './types';
import { count, removeItems } from './inventory';
import { transfer } from './ledger';
import { ITEMS } from './items';
import { isOnShift, openAttendance, statsFor } from './employment';
import { fmtMoney } from './core';

export const CAFE = 'cafe';
/** patience at the counter before a customer gives up */
export const CAFE_PATIENCE = 14;

export const cafeQueueSlot = (i: number) => ({ x: -24 + (i % 4) * 1.0 - (i >= 4 ? 0.5 : 0), z: 18.8 - Math.floor(i / 4) * 1.0 });

/** the player is on shift in the cafe kitchen */
export function playerCooking(state: GameState): boolean {
  const p = state.people[state.playerId];
  return !!p?.contractId && state.contracts[p.contractId]?.businessId === CAFE && isOnShift(state, p.id, CAFE);
}

/** a meal is handed over: the customer pays (household money), the kitchen used a portion of supplies */
export function serveMeal(state: GameState, customerId: Id, staffId: Id | null): { ok: boolean; msg: string } {
  const cafe = state.businesses[CAFE];
  const d = state.districts.harbourside;
  const c = state.people[customerId];
  const price = cafe.prices.meal;
  const r = transfer(state, { from: d.accountId, to: cafe.accountId, amount: price, reason: 'sale', memo: 'Cafe meal (served)', key: `cafemeal:${customerId}:${Math.floor(state.minute)}` });
  cafe.queue = (cafe.queue ?? []).filter((id) => id !== customerId);
  if (c?.npc) c.npc.step = 'paid';
  if (!r.ok) return { ok: false, msg: `${c?.name ?? 'The customer'} could not pay.` };
  const tax = Math.round((price * state.policy.salesTax) / (1 + state.policy.salesTax));
  transfer(state, { from: cafe.accountId, to: state.businesses[state.governmentId].accountId, amount: tax, reason: 'sales_tax', memo: 'Sales tax Tidewater Cafe' });
  const st = statsFor(state, cafe);
  st.revenue += price - tax;
  st.cogs += Math.round(ITEMS.cafe_supplies.wholesale / ITEMS.cafe_supplies.caseSize);
  st.customers++;
  if (staffId) { const a = openAttendance(state, staffId); if (a) { a.served++; a.tasks++; } }
  return { ok: true, msg: `${c?.name.split(' ')[0] ?? 'Customer'} paid ${fmtMoney(price)} for their meal.` };
}

/** take one portion of supplies for a meal on the grill */
export function takePortion(state: GameState): boolean {
  const sup = state.containers[state.businesses[CAFE].stockContainers[0]];
  return count(sup, 'cafe_supplies') > 0 && !!removeItems(sup, 'cafe_supplies', 1);
}

/** customers who have waited too long give up; the NPC cook helps out when the queue is long */
export function cafeMinute(state: GameState) {
  const cafe = state.businesses[CAFE];
  if (!cafe) return;
  cafe.queue = (cafe.queue ?? []).filter((id) => { const p = state.people[id]; return p && p.visible && p.npc?.step === 'cafe_wait'; });
  const q = cafe.queue;
  if (q.length >= 3 || (q.length && !playerCooking(state))) {
    const head = state.people[q[0]];
    const npcCook = Object.values(state.people).find((p) => !p.isPlayer && isOnShift(state, p.id, CAFE));
    if (head?.npc && npcCook && state.minute - (head.npc.queuedAt ?? state.minute) >= 5 && takePortion(state)) serveMeal(state, head.id, npcCook.id);
  }
}
