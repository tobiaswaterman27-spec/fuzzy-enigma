// Crime on the street: pick a pocket (quick fingers, and they may feel it), threaten someone for their
// wallet (with a weapon out), and sell a stolen car to the man at the back of Eastgate Motors.
import type { GameState, Id, Person } from './types';
import { clamp, dist, fmtMoney, rand } from './core';
import { lifeEvent, news } from './events';
import { crime, flee } from './health';
import { transfer } from './ledger';
import { CAR_MODELS } from './cars';

const first = (p: Person) => p.name.split(' ')[0];

/** how much someone has on them: a little of what they have, more for the well-off */
function walletOf(state: GameState, v: Person, cap: number): number {
  const bal = state.ledger.accounts[v.accountId]?.balance ?? 0;
  return Math.max(0, Math.min(cap, Math.round(bal * (v.npc?.ambient ? 0.0008 : 0.03))));
}

/** you dip their pocket. Distracted people (walking, busy, drunk) notice less; the wary notice more */
export function pickpocket(state: GameState, thiefId: Id, victimId: Id): string {
  const me = state.people[thiefId], v = state.people[victimId];
  if (!v || v.dead) return '';
  const key = `pocket:${victimId}:${Math.floor(state.minute / 1440)}`;
  if (state.processed[key] !== undefined) return `${first(v)}'s pockets are empty now.`;
  const distracted = (v.move ? 0.15 : 0) + (v.action ? 0.15 : 0) + ((v.drunk ?? 0) > 40 ? 0.2 : 0);
  const wary = v.traits.patience < 0.4 ? 0.1 : 0;
  if (rand(state) < 0.55 + distracted - wary) {
    state.processed[key] = state.minute;
    const take = walletOf(state, v, 6000);
    if (take > 0) transfer(state, { from: v.accountId, to: me.accountId, amount: take, reason: 'transfer', memo: 'Lifted from a pocket', key });
    if (!v.npc?.ambient) lifeEvent(state, v, 'Had their wallet lightened (they did not notice)');
    return take > 0 ? `Nobody notices. ${fmtMoney(take)} lighter, ${first(v)} walks on.` : `Nothing worth having. ${first(v)} never knew.`;
  }
  // caught
  v.relations[me.id] = 0;
  v.facing = Math.atan2(me.pos.x - v.pos.x, me.pos.z - v.pos.z);
  v.move = null;
  v.gesture = { clip: 'argue', until: state.minute + 1.2 };
  if (v.npc) v.npc.plan = [{ kind: 'wait', until: state.minute + 1.3 }];
  if (!v.npc?.ambient) lifeEvent(state, v, `Caught ${me.name} with a hand in their pocket`);
  if (v.traits.patience < 0.35 && (v.health ?? 100) > 60) v.combat = { target: me.id, until: state.minute + 2.5, next: state.minute + 0.4 };
  crime(state, 'attempted theft', 1, v.id);
  return `${first(v)} feels it and grabs your wrist: "Oi! Thief!"`;
}

/** weapon out, wallet please. Most hand it over; the brave ones fight */
export function mug(state: GameState, thiefId: Id, victimId: Id): string {
  const me = state.people[thiefId], v = state.people[victimId];
  if (!v || v.dead) return '';
  v.relations[me.id] = 0;
  v.needs.mood = clamp(v.needs.mood - 30, 0, 100);
  if (v.traits.patience < 0.3 && (v.health ?? 100) > 70 && rand(state) < 0.5) {
    v.combat = { target: me.id, until: state.minute + 3, next: state.minute + 0.3 };
    crime(state, 'attempted robbery', 3, v.id);
    return `${first(v)} won't have it and goes for you!`;
  }
  const take = walletOf(state, v, 15000);
  if (take > 0) transfer(state, { from: v.accountId, to: me.accountId, amount: take, reason: 'transfer', memo: 'Wallet handed over', key: `mug:${victimId}:${Math.floor(state.minute)}` });
  v.gesture = { clip: 'scared', until: state.minute + 1 };
  if (!v.npc?.ambient) { lifeEvent(state, v, `Mugged by ${me.name}`); news(state, 'bad', `Mugging in Harbourside`, `${v.name} was threatened with a ${me.weapon === 'knife' ? 'knife' : 'bat'} and robbed.`, false); }
  flee(state, v, me.pos);
  crime(state, 'robbery', 3, v.id);
  return take > 0 ? `${first(v)} shakes as they hand it over: ${fmtMoney(take)}.` : `${first(v)} turns out empty pockets and runs.`;
}

/** Eastgate Motors' back yard: no questions asked about a car you drive in */
export const CHOP_SHOP = { x: 84, z: -10.4 };
export function chopCandidate(state: GameState, near: { x: number; z: number }) {
  return Object.values(state.vehicles).find((v) => v.kind === 'car' && v.stolen && !v.driverId && dist(v.pos, near) < 9) ?? null;
}
export function chopPrice(state: GameState, carId: Id): number {
  const v = state.vehicles[carId];
  const price = v?.price ?? CAR_MODELS.find((m) => m.id === v?.model)?.price ?? 600000;
  return Math.round(price * 0.12 * (0.6 + 0.4 * (v?.condition ?? 80) / 100));
}
export function sellToChop(state: GameState, sellerId: Id, carId: Id): string {
  const v = state.vehicles[carId], me = state.people[sellerId];
  if (!v || !v.stolen) return 'Nothing to sell.';
  const amount = chopPrice(state, carId);
  transfer(state, { from: state.externalId, to: me.accountId, amount, reason: 'sale', memo: 'Cash for a car, no questions', key: `chop:${carId}` });
  const owner = state.people[v.ownerId];
  if (owner) news(state, 'bad', `${owner.name.split(' ')[0]}'s ${v.name} is gone for good`, 'Stripped for parts, by the sound of it.', false);
  delete state.containers[v.cargoId];
  delete state.vehicles[carId];
  lifeEvent(state, me, `Sold a stolen ${v.name} for parts`);
  return `A man in overalls looks it over, peels off ${fmtMoney(amount)} in notes, and it is in the back before you have turned round.`;
}
