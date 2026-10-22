// After hours the shops lock their doors. Force one and the alarm goes off; inside, the till can be
// prised open for whatever float was left in it. Every break-in is a crime, seen or not (the alarm).
import type { GameState, Id } from './types';
import { dayIndex } from './clock';
import { fmtMoney } from './core';
import { lifeEvent, news } from './events';
import { crime } from './health';
import { houseOpen } from './houses';
import { transfer } from './ledger';
import { pubOpen } from './pub';
import { isOpen } from './retail';
import { getWorld, SHOP_IDS } from './world/layout';

export { SHOP_IDS };
export const shopOf = (interactableId: string) => interactableId.replace(/_door\d*$/, '');

const businessAt = (state: GameState, id: string) => Object.values(state.businesses).find((b) => b.locationId === id);

export function shopOpenNow(state: GameState, id: string): boolean {
  if (id === 'pub') return pubOpen(state.minute);
  if (id === 'jobcentre') { const m = state.minute % 1440, dow = dayIndex(state.minute) % 7; return dow < 5 && m >= 9 * 60 && m < 17 * 60; }
  const b = businessAt(state, id);
  return !!b && isOpen(b, state.minute);
}

/** shut for the night and not (yet) forced */
export const shopLocked = (state: GameState, id: string) => SHOP_IDS.includes(id) && !shopOpenNow(state, id) && !houseOpen(state, id);

export function forceShop(state: GameState, personId: Id, id: string): string {
  const me = state.people[personId];
  (state.houseOpen ??= {})[id] = state.minute + 60;
  const name = getWorld().buildings.find((b) => b.id === id)?.name ?? 'the shop';
  lifeEvent(state, me, `Broke into ${name}`);
  news(state, 'bad', `Break-in at ${name}`, 'The alarm went off in the night. Police are attending.', false);
  crime(state, 'breaking and entering', 2);
  return `The door gives. The alarm at ${name} starts ringing: be quick.`;
}

/** an after-hours till: prise it open for the float */
export function lootTill(state: GameState, personId: Id, businessId: Id): string {
  const me = state.people[personId], b = state.businesses[businessId];
  if (!b) return 'Nothing in it.';
  const key = `till_loot:${businessId}:${dayIndex(state.minute)}`;
  if (state.processed[key] !== undefined) return 'Already empty.';
  state.processed[key] = state.minute;
  const take = Math.max(0, Math.min(25000, Math.round((state.ledger.accounts[b.accountId]?.balance ?? 0) * 0.05)));
  if (take > 0) transfer(state, { from: b.accountId, to: me.accountId, amount: take, reason: 'transfer', memo: 'Cash from a till', key });
  crime(state, 'burglary', 3);
  return take > 0 ? `You lever the drawer open: ${fmtMoney(take)} in notes and coins.` : 'The drawer is empty: they banked it.';
}
