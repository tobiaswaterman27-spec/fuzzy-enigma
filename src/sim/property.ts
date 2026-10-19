// Home ownership: buy the flat you rent from Harbourside Estates, with a 10% deposit and a mortgage
// from Harbourside Savings. Mortgage payments are weekly; three missed payments and the home is
// repossessed (sold back to the landlord, the mortgage cleared, any equity left returned to you).
import type { GameState, Id } from './types';
import { at, dayIndex, fmtDate } from './clock';
import { fmtMoney } from './core';
import { transfer } from './ledger';
import { lifeEvent, news } from './events';
import { activeLease, createLease } from './housing';

export const HOME_PRICES: Record<Id, number> = { flat: 6000000 };
export const DEPOSIT_SHARE = 0.1;
export const MORTGAGE_WEEKS = 520;
export const MORTGAGE_INTEREST = 0.4; // total over the term
export const SERVICE_CHARGE = 1500; // weekly, to the building's managing agent
export const SELL_SHARE = 0.95;

export interface Ownership {
  locationId: Id;
  ownerId: Id;
  label: string;
  price: number;
  boughtAt: number;
  mortgage: { owed: number; weekly: number; nextDue: number; missed: number; borrowed: number } | null;
}

export const ownedHome = (state: GameState, personId: Id) => Object.values(state.ownership ?? {}).find((o) => o.ownerId === personId) ?? null;

export function mortgageTerms(price: number) {
  const deposit = Math.round(price * DEPOSIT_SHARE);
  const borrowed = price - deposit;
  const owed = Math.round(borrowed * (1 + MORTGAGE_INTEREST));
  return { deposit, borrowed, owed, weekly: Math.ceil(owed / MORTGAGE_WEEKS) };
}

/** can this person buy the home they rent? */
export function canBuyHome(state: GameState, personId: Id): { ok: boolean; reason: string; locationId?: Id; price?: number } {
  const p = state.people[personId];
  if (ownedHome(state, personId)) return { ok: false, reason: 'You already own your home.' };
  const l = activeLease(state, personId);
  if (!l || !HOME_PRICES[l.locationId]) return { ok: false, reason: 'Your landlord is not selling.' };
  if (l.arrears > 0) return { ok: false, reason: 'Clear your rent arrears first.' };
  const price = HOME_PRICES[l.locationId];
  const t = mortgageTerms(price);
  const bal = state.ledger.accounts[p.accountId].balance;
  if (bal < t.deposit) return { ok: false, reason: `You need a ${fmtMoney(t.deposit)} deposit (you have ${fmtMoney(bal)}).`, locationId: l.locationId, price };
  const since = state.minute - 14 * 1440;
  const earned = state.ledger.txns.filter((x) => x.to === p.accountId && x.reason === 'wage' && x.time >= since).reduce((a, x) => a + x.amount, 0);
  if (t.weekly > (earned / 2) * 0.45) return { ok: false, reason: `The bank needs repayments (${fmtMoney(t.weekly)}/week) to be under 45% of your income: earn about ${fmtMoney(Math.ceil(t.weekly / 0.45))} a week first.`, locationId: l.locationId, price };
  return { ok: true, reason: '', locationId: l.locationId, price };
}

export function buyProperty(state: GameState, personId: Id): { ok: boolean; msg: string } {
  const c = canBuyHome(state, personId);
  if (!c.ok) return { ok: false, msg: c.reason };
  const p = state.people[personId];
  const l = activeLease(state, personId)!;
  const estates = state.businesses[l.landlordId];
  const t = mortgageTerms(c.price!);
  const key = `homebuy:${personId}:${Math.floor(state.minute)}`;
  const r1 = transfer(state, { from: p.accountId, to: estates.accountId, amount: t.deposit, reason: 'property', memo: `Deposit on ${l.label}`, key: `${key}:dep` });
  if (!r1.ok) return { ok: false, msg: r1.error };
  // the mortgage lender pays the rest of the price to the seller
  transfer(state, { from: state.externalId, to: estates.accountId, amount: t.borrowed, reason: 'property', memo: `Mortgage advance for ${l.label}`, key: `${key}:adv` });
  l.status = 'ended';
  l.bought = true;
  (state.ownership ??= {})[l.locationId] = {
    locationId: l.locationId, ownerId: personId, label: l.label, price: c.price!, boughtAt: state.minute,
    mortgage: { owed: t.owed, weekly: t.weekly, nextDue: at(dayIndex(state.minute) + 7, 9, 0), missed: 0, borrowed: t.borrowed },
  };
  p.homeId = l.locationId;
  lifeEvent(state, p, `Bought ${l.label}`);
  news(state, 'good', `You own ${l.label}`, `${fmtMoney(t.deposit)} deposit paid; mortgage ${fmtMoney(t.weekly)} a week plus a ${fmtMoney(SERVICE_CHARGE)} service charge.`, p.isPlayer);
  return { ok: true, msg: `Bought ${l.label}.` };
}

/** paying a mortgage off early: what is owed less the interest for the weeks not yet run */
export function redemption(o: Ownership): number {
  const m = o.mortgage;
  if (!m) return 0;
  const interest = Math.round(m.owed > 0 ? (m.weekly * MORTGAGE_WEEKS - m.borrowed) : 0);
  const weeksLeft = Math.ceil(m.owed / m.weekly);
  return Math.max(0, m.owed - Math.round(interest * (weeksLeft / MORTGAGE_WEEKS)));
}

/** sell back to the landlord at 95% of the price, clear the mortgage, keep the rest and rent the place again */
export function sellHome(state: GameState, personId: Id, landlordId = 'estates'): { ok: boolean; msg: string } {
  const o = ownedHome(state, personId);
  if (!o) return { ok: false, msg: 'You do not own a home.' };
  const p = state.people[personId];
  const estates = state.businesses[landlordId];
  const sale = Math.round(o.price * SELL_SHARE);
  const key = `homesell:${personId}:${Math.floor(state.minute)}`;
  const owed = redemption(o);
  // the buyer pays the lender off first, then the seller gets what is left (or must make up a shortfall)
  const toLender = Math.min(sale, owed);
  if (toLender > 0) transfer(state, { from: estates.accountId, to: state.externalId, amount: toLender, reason: 'property', memo: `Mortgage redemption ${o.label}`, key: `${key}:redeem` });
  if (sale > owed) transfer(state, { from: estates.accountId, to: p.accountId, amount: sale - owed, reason: 'property', memo: `Sale of ${o.label}`, key: `${key}:equity` });
  else if (owed > sale) {
    const r = transfer(state, { from: p.accountId, to: state.externalId, amount: owed - sale, reason: 'property', memo: 'Mortgage shortfall', key: `${key}:short` });
    if (!r.ok) return { ok: false, msg: `The sale would not cover the mortgage: you need ${fmtMoney(owed - sale)} more.` };
  }
  delete state.ownership![o.locationId];
  createLease(state, personId, landlordId, o.locationId, o.label, 14000, dayIndex(state.minute) + 7);
  lifeEvent(state, p, `Sold ${o.label}`);
  news(state, 'money', `Sold ${o.label}`, `${fmtMoney(sale)} sale price; ${fmtMoney(Math.max(0, sale - owed))} to you after the mortgage. You now rent it.`, p.isPlayer);
  return { ok: true, msg: `Sold for ${fmtMoney(sale)}.` };
}

/** weekly mortgage payments and service charges */
export function propertyTick(state: GameState) {
  for (const o of Object.values(state.ownership ?? {})) {
    const m = o.mortgage;
    const p = state.people[o.ownerId];
    if (!m || state.minute < m.nextDue) continue;
    const due = m.nextDue;
    m.nextDue += 7 * 1440;
    transfer(state, { from: p.accountId, to: state.businesses.estates.accountId, amount: SERVICE_CHARGE, reason: 'property', memo: `Service charge ${o.label}`, key: `svc:${o.locationId}:${due}` });
    const amt = Math.min(m.weekly, m.owed);
    const r = transfer(state, { from: p.accountId, to: state.externalId, amount: amt, reason: 'property', memo: `Mortgage ${o.label}`, key: `mort:${o.locationId}:${due}` });
    if (r.ok) {
      m.owed -= amt; m.missed = 0;
      if (m.owed <= 0) { o.mortgage = null; news(state, 'good', 'Mortgage paid off', `${o.label} is yours outright.`, p.isPlayer); }
      continue;
    }
    m.missed++;
    news(state, 'bad', `Missed mortgage payment (${m.missed}/3)`, `Not enough money for ${fmtMoney(amt)}. Three missed payments and the home is repossessed.`, p.isPlayer);
    if (m.missed >= 3) {
      const r2 = sellHome(state, o.ownerId);
      if (!r2.ok) {
        // negative equity and no money: the debt is written off against your credit
        delete state.ownership![o.locationId];
        (state.creditBans ??= {})[o.ownerId] = true;
        createLease(state, o.ownerId, 'estates', o.locationId, o.label, 14000, dayIndex(state.minute) + 7);
      }
      p.reputation = Math.max(0, p.reputation - 10);
      news(state, 'bad', `${o.label} repossessed`, 'The lender sold your home to recover the mortgage. You can stay on as a tenant.', p.isPlayer);
      lifeEvent(state, p, `${o.label} was repossessed`);
    }
  }
}

export function ownershipLines(state: GameState, personId: Id): string[] {
  const o = ownedHome(state, personId);
  if (!o) return [];
  const out = [`Owner of ${o.label} since ${fmtDate(o.boughtAt)}`];
  if (o.mortgage) out.push(`Mortgage ${fmtMoney(o.mortgage.owed)} left · ${fmtMoney(o.mortgage.weekly)} a week`);
  return out;
}
