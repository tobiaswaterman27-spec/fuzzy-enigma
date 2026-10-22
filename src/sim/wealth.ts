// Net worth: what you would have if you sold everything and paid off what you owe. Milestones are
// announced in the news as you pass them (the measure of a bigshot).
import type { GameState, Id } from './types';
import { fmtMoney } from './core';
import { lifeEvent, news } from './events';
import { ownedHome, redemption } from './property';
import { ownedBuilds, RESALE_SHARE } from './lettings';
import { holdings, portfolio, valuation } from './invest';
import { playerCar, RESALE } from './cars';
import { UNIT4 } from './enterprise';

export interface WealthLine { label: string; amount: number }

export function netWorth(state: GameState, personId: Id): { lines: WealthLine[]; total: number } {
  const p = state.people[personId];
  const lines: WealthLine[] = [];
  if (!p) return { lines, total: 0 };
  lines.push({ label: 'Current account', amount: state.ledger.accounts[p.accountId]?.balance ?? 0 });
  const home = ownedHome(state, personId);
  if (home) {
    lines.push({ label: `Home: ${home.label}`, amount: home.price });
    if (home.mortgage) lines.push({ label: 'Mortgage to repay', amount: -redemption(home) });
  }
  for (const b of ownedBuilds(state, personId)) lines.push({ label: `House to let (${b.plotId === 'plot_w' ? '15' : '14'} Harbour Road)`, amount: Math.round(b.price * RESALE_SHARE) });
  for (const s of portfolio(state, personId)) lines.push({ label: `Shares: ${s.pct}% of ${s.name}`, amount: s.value });
  for (const b of holdings(state, personId)) {
    const cash = state.ledger.accounts[b.accountId]?.balance ?? 0;
    lines.push({ label: `Company: ${b.name}`, amount: b.id === UNIT4 ? cash : valuation(state, b) });
  }
  const car = playerCar(state, personId);
  if (car) lines.push({ label: `Car: ${car.name}`, amount: Math.round((car.price ?? 0) * RESALE * (0.6 + 0.4 * car.condition / 100)) });
  for (const l of Object.values(state.loans ?? {})) if (l.personId === personId && l.status === 'active') lines.push({ label: 'Loan to repay', amount: -l.owed });
  return { lines, total: lines.reduce((a, l) => a + l.amount, 0) };
}

export const MILESTONES = [1000000, 2500000, 5000000, 10000000, 25000000, 50000000, 100000000];
const TITLES = ['Getting by', 'Comfortable', 'Doing well', 'Well off', 'Wealthy', 'Rich', 'A bigshot'];

export function wealthTitle(total: number): string {
  let t = 'Starting out';
  MILESTONES.forEach((m, i) => { if (total >= m) t = TITLES[i]; });
  return t;
}

/** daily: announce net-worth milestones the first time they are passed */
export function wealthDaily(state: GameState) {
  const p = state.people[state.playerId];
  if (!p) return;
  const { total } = netWorth(state, p.id);
  const passed = state.wealthMilestone ?? 0;
  for (let i = passed; i < MILESTONES.length && total >= MILESTONES[i]; i++) {
    state.wealthMilestone = i + 1;
    lifeEvent(state, p, `Net worth passed ${fmtMoney(MILESTONES[i])}`);
    news(state, 'good', `${TITLES[i]}: net worth over ${fmtMoney(MILESTONES[i])}`, i === MILESTONES.length - 1 ? 'Harbourside talks about you. You made it.' : `Next milestone: ${fmtMoney(MILESTONES[i + 1])}.`, true);
  }
}
