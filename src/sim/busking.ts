// Busking: a guitar from the pawnbroker and a busy pavement. Passers-by stop to listen for a bit and
// drop a coin or two in the case; the better you get (and the busier the street), the more they give.
import type { GameState, Id } from './types';
import { clamp, fmtMoney } from './core';
import { transfer } from './ledger';
import { lifeEvent } from './events';

export const canBusk = (state: GameState, id: Id) => (state.containers[state.people[id].bagId]?.items.guitar ?? 0) > 0;

/** a minute of playing: who is listening, and what they drop (pence) */
export function buskMinute(state: GameState, id: Id, listeners: number, roll: number): number {
  const p = state.people[id];
  const skill = p.skills.music ?? 0;
  p.skills.music = clamp(skill + 0.6, 0, 100);
  p.needs.mood = clamp(p.needs.mood + 0.4, 0, 100);
  if (!listeners || roll > 0.35 + Math.min(0.4, listeners * 0.05)) return 0;
  const coin = Math.round((20 + roll * 180) * (0.6 + skill / 100) / 10) * 10;
  transfer(state, { from: state.externalId, to: p.accountId, amount: coin, reason: 'transfer', memo: 'Busking', key: `busk:${Math.floor(state.minute)}` });
  (p as { buskTotal?: number }).buskTotal = ((p as { buskTotal?: number }).buskTotal ?? 0) + coin;
  if (!(p as { busked?: boolean }).busked) { (p as { busked?: boolean }).busked = true; lifeEvent(state, p, 'Busked in the street for the first time'); }
  return coin;
}
export const coinText = (pence: number) => `+${fmtMoney(pence)} in the guitar case`;
