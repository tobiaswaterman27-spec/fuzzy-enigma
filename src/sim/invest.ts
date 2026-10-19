// Shares in local businesses. Owners will sell a minority stake for cash; shareholders receive their
// share of the weekly owner's draw as a dividend and can sell back at the current valuation.
import type { Business, GameState, Id } from './types';
import { dayIndex } from './clock';
import { fmtMoney } from './core';
import { transfer } from './ledger';
import { news } from './events';

/** a stake is bought in blocks of this many percent; outsiders can hold at most MAX_STAKE in total */
export const BLOCK = 5;
export const MAX_STAKE = 49;
/** the business's weekly profit is valued at this many weeks, plus its cash */
export const EARNINGS_WEEKS = 26;
const FLOOR = 2000000; // Cr 20,000: going-concern value of the premises, fittings and trade
const INVESTABLE: ReadonlySet<string> = new Set(['retail', 'wholesale', 'cafe', 'store', 'construction']);

export function canInvestIn(b: Business): boolean {
  return INVESTABLE.has(b.kind);
}

/** average weekly profit over the last fortnight of trading stats */
export function weeklyProfit(state: GameState, b: Business): number {
  const today = dayIndex(state.minute);
  const recent = b.stats.filter((s) => s.day < today && s.day >= today - 14);
  if (!recent.length) return 0;
  const sum = recent.reduce((a, s) => a + s.revenue - s.cogs - s.wages - s.otherCosts, 0);
  return Math.round((sum / recent.length) * 7);
}

/** what the whole business is worth now */
export function valuation(state: GameState, b: Business): number {
  const cash = Math.max(0, state.ledger.accounts[b.accountId]?.balance ?? 0);
  const earnings = Math.max(0, weeklyProfit(state, b)) * EARNINGS_WEEKS;
  return Math.max(FLOOR, earnings + cash);
}

export function blockPrice(state: GameState, b: Business): number {
  return Math.round((valuation(state, b) * BLOCK) / 100);
}

export function stakeOf(b: Business, personId: Id): number {
  return b.shares?.[personId] ?? 0;
}

function outsideStake(b: Business): number {
  return Object.values(b.shares ?? {}).reduce((a, n) => a + n, 0);
}

/** the owner's account receives the sale price (for external owners, the outside world) */
function ownerAccount(state: GameState, b: Business): Id {
  const o = state.people[b.ownerId];
  return o ? o.accountId : state.externalId;
}

export function buyStake(state: GameState, personId: Id, businessId: Id): { ok: boolean; msg: string } {
  const b = state.businesses[businessId];
  const p = state.people[personId];
  if (!b || !p || !canInvestIn(b)) return { ok: false, msg: 'Not open to investors.' };
  if (b.ownerId === personId) return { ok: false, msg: 'You already own it.' };
  if (outsideStake(b) + BLOCK > MAX_STAKE) return { ok: false, msg: `The owner keeps control: outside investors may hold at most ${MAX_STAKE}%.` };
  const price = blockPrice(state, b);
  const r = transfer(state, { from: p.accountId, to: ownerAccount(state, b), amount: price, reason: 'investment', memo: `${BLOCK}% stake in ${b.name}`, key: `stake_buy:${b.id}:${personId}:${state.minute}` });
  if (!r.ok) return { ok: false, msg: r.error };
  (b.shares ??= {})[personId] = stakeOf(b, personId) + BLOCK;
  news(state, 'money', `Shares bought: ${b.name}`, `You paid ${fmtMoney(price)} for ${BLOCK}% and now hold ${b.shares[personId]}%. Dividends are paid from the owner's draw on Sundays.`, p.isPlayer);
  return { ok: true, msg: `Bought ${BLOCK}% of ${b.name} for ${fmtMoney(price)}.` };
}

/** sell one block back to the owner (or to an outside buyer at a 10% discount if the owner can't pay) */
export function sellStake(state: GameState, personId: Id, businessId: Id): { ok: boolean; msg: string } {
  const b = state.businesses[businessId];
  const p = state.people[personId];
  if (!b || !p || stakeOf(b, personId) < BLOCK) return { ok: false, msg: 'You hold no shares to sell.' };
  const full = blockPrice(state, b);
  const ownerAcc = ownerAccount(state, b);
  const ownerCanPay = (state.ledger.accounts[ownerAcc]?.balance ?? 0) >= full || ownerAcc === state.externalId;
  const price = ownerCanPay ? full : Math.round(full * 0.9);
  const from = ownerCanPay ? ownerAcc : state.externalId;
  const r = transfer(state, { from, to: p.accountId, amount: price, reason: 'investment', memo: `Sold ${BLOCK}% of ${b.name}`, key: `stake_sell:${b.id}:${personId}:${state.minute}` });
  if (!r.ok) return { ok: false, msg: r.error };
  b.shares![personId] -= BLOCK;
  if (b.shares![personId] <= 0) delete b.shares![personId];
  return { ok: true, msg: `Sold ${BLOCK}% of ${b.name} for ${fmtMoney(price)}${ownerCanPay ? '' : ' (to an outside buyer, at a discount)'}.` };
}

/** split a weekly owner's draw between the owner and the shareholders; returns what is left for the owner */
export function payDividends(state: GameState, b: Business, draw: number, day: number): number {
  let left = draw;
  for (const [pid, pct] of Object.entries(b.shares ?? {})) {
    const holder = state.people[pid];
    if (!holder || pct <= 0) continue;
    const amt = Math.floor((draw * pct) / 100);
    if (amt <= 0) continue;
    const r = transfer(state, { from: b.accountId, to: holder.accountId, amount: amt, reason: 'dividend', memo: `Dividend: ${pct}% of ${b.name}`, key: `div:${b.id}:${pid}:${day}` });
    if (r.ok) {
      left -= amt;
      news(state, 'money', `Dividend from ${b.name}`, `${fmtMoney(amt)} for your ${pct}% stake.`, holder.isPlayer);
    }
  }
  return left;
}

/** dividends received by a person, all time */
export function dividendsReceived(state: GameState, personId: Id): number {
  const acc = state.people[personId]?.accountId;
  return state.ledger.txns.filter((t) => t.to === acc && t.reason === 'dividend').reduce((a, t) => a + t.amount, 0);
}

export function portfolio(state: GameState, personId: Id) {
  return Object.values(state.businesses)
    .filter((b) => stakeOf(b, personId) > 0)
    .map((b) => ({ id: b.id, name: b.name, pct: stakeOf(b, personId), value: Math.round((valuation(state, b) * stakeOf(b, personId)) / 100) }));
}
