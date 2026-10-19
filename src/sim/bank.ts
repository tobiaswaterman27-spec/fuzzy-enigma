// Harbourside Savings: personal loans. You can borrow against your earnings and repay in weekly
// instalments with interest; missed instalments damage your credit and three in a row default the loan.
import type { GameState, Id } from './types';
import { at, dayIndex, fmtDate } from './clock';
import { fmtMoney, nextId } from './core';
import { transfer } from './ledger';
import { news } from './events';

export const LOAN_WEEKS = 12;
export const LOAN_APR_FLAT = 0.12; // total interest over the term
export const LOAN_SIZES = [50000, 100000, 250000, 500000];

export interface Loan {
  id: Id;
  personId: Id;
  principal: number;
  owed: number;
  weekly: number;
  takenAt: number;
  /** game minute the next instalment is taken */
  nextDue: number;
  missed: number;
  status: 'active' | 'repaid' | 'defaulted';
}

/** what the bank will lend: based on your wages over the last fortnight, nothing if you defaulted */
export function creditLimit(state: GameState, personId: Id): { limit: number; reason: string } {
  const p = state.people[personId];
  if ((state.creditBans ?? {})[personId]) return { limit: 0, reason: 'You defaulted on a loan: no further credit.' };
  if (Object.values(state.loans ?? {}).some((l) => l.personId === personId && l.status === 'active')) return { limit: 0, reason: 'Repay your current loan first.' };
  const since = state.minute - 14 * 1440;
  const earned = state.ledger.txns.filter((t) => t.to === p.accountId && t.reason === 'wage' && t.time >= since).reduce((a, t) => a + t.amount, 0);
  if (earned <= 0) return { limit: 0, reason: 'No wages in the last two weeks: the bank needs proof of income.' };
  // repayments may take up to a third of weekly income
  const weeklyIncome = earned / 2;
  const limit = Math.floor(((weeklyIncome / 3) * LOAN_WEEKS) / (1 + LOAN_APR_FLAT) / 1000) * 1000;
  return { limit, reason: limit ? `Up to ${fmtMoney(limit)} on your recent earnings.` : 'Your income is too low for a loan yet.' };
}

export function takeLoan(state: GameState, personId: Id, amount: number): { ok: boolean; msg: string } {
  const p = state.people[personId];
  const { limit, reason } = creditLimit(state, personId);
  if (amount > limit) return { ok: false, msg: limit ? `The bank will lend at most ${fmtMoney(limit)}.` : reason };
  const owed = Math.round(amount * (1 + LOAN_APR_FLAT));
  const loan: Loan = {
    id: nextId(state, 'loan'), personId, principal: amount, owed, weekly: Math.ceil(owed / LOAN_WEEKS), takenAt: state.minute,
    nextDue: at(dayIndex(state.minute) + 7, 9, 0), missed: 0, status: 'active',
  };
  const r = transfer(state, { from: state.externalId, to: p.accountId, amount, reason: 'loan', memo: `Loan from Harbourside Savings (${LOAN_WEEKS} weekly payments of ${fmtMoney(loan.weekly)})`, key: `loan:${loan.id}` });
  if (!r.ok) return { ok: false, msg: r.error };
  (state.loans ??= {})[loan.id] = loan;
  news(state, 'info', 'Loan approved', `${fmtMoney(amount)} paid into your account. ${LOAN_WEEKS} weekly repayments of ${fmtMoney(loan.weekly)} from ${fmtDate(loan.nextDue)}.`, p.isPlayer);
  return { ok: true, msg: `Borrowed ${fmtMoney(amount)}.` };
}

/** pay off what is left early, with a rebate on most of the interest not yet earned */
export function repayLoan(state: GameState, loanId: Id): { ok: boolean; msg: string } {
  const l = state.loans?.[loanId];
  if (!l || l.status !== 'active') return { ok: false, msg: 'No such loan.' };
  const p = state.people[l.personId];
  // what is still owed, less most of the interest for the weeks you no longer need the money
  const interest = Math.round(l.principal * LOAN_APR_FLAT);
  const weeksLeft = Math.ceil(l.owed / l.weekly);
  const settle = Math.max(0, l.owed - Math.round(interest * (weeksLeft / LOAN_WEEKS) * 0.75));
  const r = transfer(state, { from: p.accountId, to: state.externalId, amount: settle, reason: 'loan_repayment', memo: 'Loan settled early', key: `loanset:${l.id}` });
  if (!r.ok) return { ok: false, msg: r.error };
  l.owed = 0; l.status = 'repaid';
  return { ok: true, msg: `Loan settled for ${fmtMoney(settle)}.` };
}

/** weekly instalments */
export function loansTick(state: GameState) {
  for (const l of Object.values(state.loans ?? {})) {
    if (l.status !== 'active' || state.minute < l.nextDue) continue;
    const p = state.people[l.personId];
    const amt = Math.min(l.weekly, l.owed);
    const r = transfer(state, { from: p.accountId, to: state.externalId, amount: amt, reason: 'loan_repayment', memo: 'Loan repayment, Harbourside Savings', key: `loanpay:${l.id}:${l.nextDue}` });
    if (r.ok) {
      l.owed -= amt;
      l.missed = 0;
      if (l.owed <= 0) { l.status = 'repaid'; news(state, 'good', 'Loan repaid', 'Your loan with Harbourside Savings is paid off.', p.isPlayer); }
    } else {
      l.missed++;
      p.reputation = Math.max(0, p.reputation - 3);
      news(state, 'bad', `Missed loan repayment (${l.missed}/3)`, `Not enough money for the ${fmtMoney(amt)} instalment.`, p.isPlayer);
      if (l.missed >= 3) {
        l.status = 'defaulted';
        (state.creditBans ??= {})[l.personId] = true;
        p.reputation = Math.max(0, p.reputation - 10);
        news(state, 'bad', 'Loan defaulted', 'Harbourside Savings has passed the debt to collectors. No further credit.', p.isPlayer);
      }
    }
    l.nextDue += 7 * 1440;
  }
}
