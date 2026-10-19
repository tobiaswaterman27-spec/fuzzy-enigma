// PropertySystem (initial): residential leases with weekly rent, arrears,
// late fees and eviction, plus a recovery path (re-renting).
import type { GameState, Id, Lease } from './types';
import { at, dayIndex, dayOfWeek, fmtDate, minuteOfDay } from './clock';
import { fmtMoney, nextId } from './core';
import { transfer } from './ledger';
import { lifeEvent, news } from './events';
import { statsFor } from './employment';

export const LATE_FEE = 1500;

export function createLease(state: GameState, tenantId: Id, landlordId: Id, locationId: Id, label: string, weeklyRent: number, paidThroughDay: number): Lease {
  const l: Lease = {
    id: nextId(state, 'lease'), tenantId, landlordId, locationId, label, weeklyRent, dueDay: 0, dueMinute: 9 * 60,
    paidThroughDay, arrears: 0, missedPayments: 0, status: 'active',
  };
  state.leases[l.id] = l;
  return l;
}

export function activeLease(state: GameState, personId: Id): Lease | undefined {
  return Object.values(state.leases).find((l) => l.tenantId === personId && !l.tenantBusinessId && l.status === 'active');
}

export function hasHomeAccess(state: GameState, personId: Id, locationId: Id) {
  if (state.ownership?.[locationId]?.ownerId === personId) return true;
  const l = activeLease(state, personId);
  return !!l && l.locationId === locationId;
}

/** called every minute; idempotent per lease per day */
export function rentTick(state: GameState) {
  const now = state.minute;
  const day = dayIndex(now);
  for (const l of Object.values(state.leases)) {
    if (l.status !== 'active' || minuteOfDay(now) < l.dueMinute) continue;
    const key = `rent:${l.id}:${day}`;
    if (state.processed[key]) continue;
    state.processed[key] = now;
    const tenant = state.people[l.tenantId];
    const landlord = state.businesses[l.landlordId];
    const payer = l.tenantBusinessId ? state.businesses[l.tenantBusinessId] : null;
    const payAcc = payer ? payer.accountId : tenant.accountId;
    // collect arrears first, any day
    if (l.arrears > 0) {
      const amt = Math.min(l.arrears, state.ledger.accounts[payAcc].balance);
      if (amt > 0) {
        const r = transfer(state, { from: payAcc, to: landlord.accountId, amount: amt, reason: 'rent', memo: `Rent arrears ${l.label}`, ref: l.id });
        if (r.ok) {
          l.arrears -= amt;
          if (tenant.isPlayer) news(state, 'money', `Paid ${fmtMoney(amt)} rent arrears`, l.arrears > 0 ? `${fmtMoney(l.arrears)} still owed.` : 'Your rent account is clear.', true);
          if (l.arrears === 0) l.missedPayments = 0;
        }
      }
    }
    if (dayOfWeek(now) !== l.dueDay || l.paidThroughDay > day) continue;
    const r = transfer(state, { from: payAcc, to: landlord.accountId, amount: l.weeklyRent, reason: 'rent', memo: `Weekly rent ${l.label} ${fmtDate(now)}`, ref: l.id, key: `rentdue:${l.id}:${day}` });
    l.paidThroughDay = day + 7;
    if (r.ok) {
      if (payer) statsFor(state, payer).otherCosts += l.weeklyRent;
      if (tenant.isPlayer) news(state, 'money', `Rent paid: ${fmtMoney(l.weeklyRent)}`, `${l.label} is paid until ${fmtDate(at(l.paidThroughDay, 0))}.`, true);
    } else {
      l.arrears += l.weeklyRent + (l.missedPayments > 0 ? LATE_FEE : 0);
      l.missedPayments++;
      if (tenant.isPlayer) {
        news(state, 'bad', `Rent payment failed (${l.missedPayments}/3)`, `You owe ${fmtMoney(l.arrears)}. Arrears are collected automatically each morning at 09:00. Three missed payments lead to eviction.`, true);
      }
      lifeEvent(state, tenant, `Missed a rent payment on ${l.label}`);
      if (l.missedPayments >= 3) evict(state, l);
    }
  }
}

export function evict(state: GameState, l: Lease) {
  l.status = 'ended';
  if (l.tenantBusinessId) {
    const b = state.businesses[l.tenantBusinessId];
    if (b) b.manualClosed = true;
    news(state, 'bad', `${b?.name ?? 'Your business'} lost its premises`, 'The landlord ended the lease after three missed payments. The shop is closed.', true);
    return;
  }
  const tenant = state.people[l.tenantId];
  if (tenant.isPlayer) news(state, 'bad', 'You have been evicted', `${l.label} is no longer yours. You can sleep on a park bench, or re-rent once you can pay the arrears plus a week in advance.`, true);
  lifeEvent(state, tenant, `Evicted from ${l.label}`);
  if (tenant.homeId === l.locationId) tenant.homeId = null;
}

/** recovery path after eviction: settle what is owed and pay a week in advance */
export function reRent(state: GameState, personId: Id, leaseId: Id): { ok: boolean; msg: string } {
  const l = state.leases[leaseId];
  if (!l || l.status !== 'ended' || l.tenantId !== personId) return { ok: false, msg: 'Nothing to re-rent.' };
  const p = state.people[personId];
  const landlord = state.businesses[l.landlordId];
  const due = l.arrears + l.weeklyRent;
  const r = transfer(state, { from: p.accountId, to: landlord.accountId, amount: due, reason: 'rent', memo: `Re-rent ${l.label}`, ref: l.id });
  if (!r.ok) return { ok: false, msg: `You need ${fmtMoney(due)}.` };
  l.arrears = 0;
  l.missedPayments = 0;
  l.status = 'active';
  l.paidThroughDay = dayIndex(state.minute) + 7;
  p.homeId = l.locationId;
  lifeEvent(state, p, `Moved back into ${l.label}`);
  return { ok: true, msg: `Welcome home. Paid ${fmtMoney(due)}.` };
}
