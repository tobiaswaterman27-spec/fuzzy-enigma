// Household bills for the player's home: energy is metered (showers, cooking, laundry, washing up,
// TV and the fridge and lights every day) and billed every four weeks together with council tax, by
// direct debit. If the account cannot cover it the bill is retried daily and the arrears are shown.
import type { GameState, Id, Person } from './types';
import { at, dayIndex, fmtDate } from './clock';
import { fmtMoney } from './core';
import { transfer } from './ledger';
import { news } from './events';
import { activeLease } from './housing';
import { ownedHome } from './property';

export const KWH_PRICE = 28; // cents per kWh
export const STANDING_PER_DAY = 55; // cents
export const COUNCIL_TAX = 12000; // per four weeks
export const BASE_KWH_PER_DAY = 3.5;
const PERIOD_DAYS = 28;
export const USAGE_KWH: Record<string, number> = { shower: 2.2, cook: 1.6, laundry: 1.4, wash_up: 0.4, watch_tv: 0.3 };

export interface BillAccount { kwh: number; days: number; nextBill: number; arrears: number }

function hasHome(state: GameState, p: Person) {
  return !!activeLease(state, p.id) || !!ownedHome(state, p.id);
}

export function billAccount(state: GameState, personId: Id): BillAccount {
  const b = (state.bills ??= {});
  return (b[personId] ??= { kwh: 0, days: 0, nextBill: at(dayIndex(state.minute) + PERIOD_DAYS, 9, 0), arrears: 0 });
}

/** a use of energy at home (only the player's household is metered) */
export function useEnergy(state: GameState, p: Person, kind: string, arg?: string) {
  if (!p.isPlayer || !hasHome(state, p)) return;
  const kwh = USAGE_KWH[kind];
  if (!kwh || (kind === 'laundry' && arg === 'unload')) return;
  billAccount(state, p.id).kwh += kwh;
}

export function billEstimate(state: GameState, personId: Id): { energy: number; council: number; total: number } {
  const a = billAccount(state, personId);
  const energy = Math.round(a.kwh * KWH_PRICE + a.days * STANDING_PER_DAY);
  return { energy, council: COUNCIL_TAX, total: energy + COUNCIL_TAX };
}

export function billsTick(state: GameState) {
  const p = state.people[state.playerId];
  if (!p || !hasHome(state, p)) return;
  const a = billAccount(state, p.id);
  const day = dayIndex(state.minute);
  // the fridge, lights and standby every day
  if (!state.processed[`bill_day:${day}`]) {
    state.processed[`bill_day:${day}`] = state.minute;
    a.kwh += BASE_KWH_PER_DAY;
    a.days++;
  }
  if (state.minute < a.nextBill) return;
  const { energy, council } = billEstimate(state, p.id);
  // all or nothing: the direct debit only goes through when the account covers the whole bill
  if (state.ledger.accounts[p.accountId].balance >= energy + council) {
    transfer(state, { from: p.accountId, to: state.externalId, amount: energy, reason: 'utilities', memo: `Energy bill: ${Math.round(a.kwh)} kWh`, key: `bill_energy:${a.nextBill}` });
    transfer(state, { from: p.accountId, to: state.businesses[state.governmentId].accountId, amount: council, reason: 'public_service', memo: 'Council tax (4 weeks)', key: `bill_ctax:${a.nextBill}` });
    news(state, 'money', 'Bills paid', `Energy ${fmtMoney(energy)} (${Math.round(a.kwh)} kWh) and council tax ${fmtMoney(council)} by direct debit.`, true);
    a.kwh = 0; a.days = 0; a.arrears = 0;
    a.nextBill = at(day + PERIOD_DAYS, 9, 0);
  } else {
    if (!a.arrears) news(state, 'bad', 'Bills unpaid', `The direct debit of ${fmtMoney(energy + council)} failed. It will be tried again tomorrow (${fmtDate(at(day + 1, 9, 0))}).`, true);
    a.arrears = energy + council;
    p.needs.mood = Math.max(0, (p.needs.mood ?? 60) - 4);
    a.nextBill = at(day + 1, 9, 0);
  }
}
