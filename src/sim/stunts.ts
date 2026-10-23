// Stunt jumps: ramps across the road on long straight streets. Hit one fast enough in a car and you are
// in the air; land a good one for the first time and there is a bonus for it.
import type { GameState, Id } from './types';
import { fmtMoney } from './core';
import { lifeEvent, news } from './events';
import { transfer } from './ledger';
import { RAMPS } from './world/spots';

/** a jump has been landed: the first decent one off each ramp pays */
export function landedJump(state: GameState, personId: Id, ramp: number, metres: number, seconds: number): string {
  const p = state.people[personId];
  const done = (state.stunts ??= []);
  const label = `${Math.round(metres)} m, ${seconds.toFixed(1)} s in the air`;
  if (metres < 14 || done.includes(ramp)) return `Jump: ${label}.`;
  done.push(ramp);
  const prize = 20000 + Math.round(metres) * 1000;
  transfer(state, { from: state.externalId, to: p.accountId, amount: prize, reason: 'transfer', memo: 'Unique stunt bonus', key: `stunt:${ramp}` });
  news(state, 'good', `UNIQUE STUNT BONUS (${done.length}/${RAMPS.length})`, `${label}. ${fmtMoney(prize)}.`, true);
  if (done.length === RAMPS.length) lifeEvent(state, p, 'Landed every stunt jump in the city');
  return `UNIQUE STUNT BONUS! ${label}. ${fmtMoney(prize)}.`;
}
