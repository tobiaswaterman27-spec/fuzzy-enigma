// Street races: time trials round the city's streets against the local legends. Drive into the start
// ring in any car, make every checkpoint in order and beat the time on the board for the prize.
import type { GameState, Id, Vec2 } from './types';
import { fmtMoney } from './core';
import { lifeEvent, news } from './events';
import { transfer } from './ledger';

export interface Race { id: string; name: string; rival: string; target: number; prize: number; points: Vec2[] }
const J = (x: number, z: number): Vec2 => ({ x, z });
export const RACES: Race[] = [
  { id: 'docks', name: 'The Docklands Dash', rival: 'Dazza', target: 95, prize: 40000, points: [J(390, 70), J(650, 70), J(650, -130), J(390, -130), J(390, 0), J(260, 0)] },
  { id: 'centre', name: 'Round the Towers', rival: 'Kayla', target: 110, prize: 60000, points: [J(-130, -260), J(260, -260), J(260, -520), J(-260, -520), J(-260, -260), J(-130, -260)] },
  { id: 'north', name: 'Northfield Night Run', rival: 'The Ghost', target: 150, prize: 100000, points: [J(-520, -650), J(-520, -1040), J(520, -1040), J(520, -780), J(0, -780), J(0, -650)] },
];

/** the race is over: beat the time and the prize is yours (once a day per race) */
export function finishRace(state: GameState, personId: Id, raceId: string, seconds: number): string {
  const r = RACES.find((x) => x.id === raceId);
  const p = state.people[personId];
  if (!r) return '';
  const best = (state.raceBest ??= {});
  const pb = best[raceId];
  if (!pb || seconds < pb) best[raceId] = seconds;
  const t = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${Math.floor((s % 1) * 10)}`;
  if (seconds > r.target) return `${t(seconds)}. ${r.rival}'s ${t(r.target)} still stands.${pb ? ` Your best: ${t(Math.min(pb, seconds))}.` : ''}`;
  const day = Math.floor(state.minute / 1440);
  const key = `race:${raceId}:${day}`;
  if (state.processed[key] !== undefined) return `${t(seconds)}: faster than ${r.rival}! (The prize has already been paid today.)`;
  state.processed[key] = state.minute;
  transfer(state, { from: state.externalId, to: p.accountId, amount: r.prize, reason: 'transfer', memo: `Street race winnings: ${r.name}`, key });
  lifeEvent(state, p, `Won ${r.name} in ${t(seconds)}`);
  news(state, 'good', `You won ${r.name}`, `${t(seconds)}, beating ${r.rival}'s ${t(r.target)}. ${fmtMoney(r.prize)} in your pocket.`, true);
  return `${t(seconds)}! You beat ${r.rival}. ${fmtMoney(r.prize)}.`;
}
