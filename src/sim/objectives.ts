// Early-game guidance. Each objective is checked against authoritative state.
import type { GameState, Objective } from './types';
import { activeLease } from './housing';

export const OBJECTIVES: { id: string; text: string; done: (s: GameState) => boolean }[] = [
  { id: 'find_job', text: 'Find work: check the vacancy board at the Job Centre (or Phone > Jobs)', done: (s) => !!s.flags.viewedJobs },
  { id: 'apply', text: 'Apply for the Retail Assistant job at Corner Market', done: (s) => Object.values(s.applications).some((a) => a.personId === s.playerId) },
  { id: 'accept', text: 'Wait for a reply and accept the job offer (Phone > Jobs)', done: (s) => Object.values(s.contracts).some((c) => c.personId === s.playerId) },
  { id: 'uniform', text: 'Put on your uniform at the wardrobe in your flat', done: (s) => s.people[s.playerId].appearance.outfit === 'uniform_market' || !!s.flags.clockedInOnce },
  { id: 'clock_in', text: 'Go to Corner Market for your shift and clock in at the staff terminal (store room)', done: (s) => !!s.flags.clockedInOnce },
  { id: 'work', text: 'Work your shift: serve customers, restock shelves, clean spills, then clock out', done: (s) => Object.values(s.attendance).some((a) => s.contracts[a.contractId].personId === s.playerId && a.closed && !a.absent) },
  { id: 'wage', text: 'Receive your wages (paid at 22:00 after each shift)', done: (s) => s.ledger.txns.some((t) => t.reason === 'wage' && t.to === s.people[s.playerId].accountId) || !!s.flags.paidOnce },
  { id: 'food', text: 'Buy groceries at Corner Market and eat at home', done: (s) => !!s.flags.ateHome },
  { id: 'rent', text: 'Keep enough money for Monday\'s rent (Phone > Bank shows obligations)', done: (s) => { const l = activeLease(s, s.playerId); return !!l && l.paidThroughDay > 7; } },
];

export function initObjectives(): Objective[] {
  return OBJECTIVES.map((o) => ({ id: o.id, text: o.text, done: false }));
}

export function tickObjectives(state: GameState) {
  for (const o of state.objectives) {
    if (o.done) continue;
    const def = OBJECTIVES.find((d) => d.id === o.id);
    if (def?.done(state)) o.done = true;
  }
  if (state.ledger.txns.some((t) => t.reason === 'wage' && t.to === state.people[state.playerId].accountId)) state.flags.paidOnce = true;
}

export function currentObjective(state: GameState): Objective | null {
  return state.objectives.find((o) => !o.done) ?? null;
}
