// Harbour City FC at the stadium. There is a match every Saturday at 15:00 and every Wednesday at
// 19:45: turn up at the turnstiles from an hour before kick-off, pay at the gate, and maybe put a
// little on the result with the bookie's kiosk. The match passes quickly; the score is fixed by the
// day (so everyone in the city saw the same game), and you come out of the gate at full time.
import type { GameState, Id, Vec2 } from './types';
import { clamp, fmtMoney } from './core';
import { dayIndex, dayOfWeek, minuteOfDay } from './clock';
import { lifeEvent, news } from './events';
import { transfer } from './ledger';
import { getWorld } from './world/layout';

export const TICKET = 3500;
export const STAKE = 2000;
export const ODDS = { H: 2.1, D: 3.3, A: 3.6 } as const;
export type Pick = keyof typeof ODDS;
const RIVALS = ['Northfield Rovers', 'Westbay Athletic', 'Eastgate United', 'Saltmarsh Town', 'Port Ellis City', 'Kingsmoor Albion', 'Docklands Wanderers', 'Ashby Vale'];

/** the turnstiles: in front of the south stand, facing the street */
export function turnstiles(city: { buildings: { style: string; rect: { x0: number; z0: number; x1: number; z1: number } }[] } = getWorld().city): Vec2 {
  const st = city.buildings.filter((b) => b.style === 'stadium');
  const s = st.reduce((a, b) => (b.rect.z1 > a.rect.z1 ? b : a), st[0]);
  return { x: (s.rect.x0 + s.rect.x1) / 2, z: s.rect.z1 + 1.4 };
}

/** today's kick-off (minute of the day), or null if there is no match today */
export function kickOff(minute: number): number | null {
  const d = dayOfWeek(minute);
  return d === 5 ? 15 * 60 : d === 2 ? 19 * 60 + 45 : null;
}

/** the game on a given day: the same for everyone */
export function fixture(day: number) {
  let h = (day * 2654435761) >>> 0;
  const r = () => { h = (h * 1103515245 + 12345) >>> 0; return (h >>> 8) / 16777216; };
  const goals = (strength: number) => { let g = 0; for (let i = 0; i < 6; i++) if (r() < strength) g++; return g; };
  const rival = RIVALS[Math.floor(r() * RIVALS.length)];
  const home = goals(0.27), away = goals(0.2);
  return { rival, home, away, result: (home > away ? 'H' : home === away ? 'D' : 'A') as Pick };
}

export function gateOpen(minute: number): { open: boolean; reason?: string; ko?: number } {
  const ko = kickOff(minute);
  const m = minuteOfDay(minute);
  if (ko == null) return { open: false, reason: 'No match today (Saturdays 15:00, Wednesdays 19:45)' };
  if (m < ko - 60) return { open: false, reason: `Gates open at ${String(Math.floor((ko - 60) / 60)).padStart(2, '0')}:${String((ko - 60) % 60).padStart(2, '0')}`, ko };
  if (m > ko + 30) return { open: false, reason: 'Too late: the gates are shut', ko };
  return { open: true, ko };
}

/** through the turnstile: you are in the stands until full time */
export function goToMatch(state: GameState, personId: Id, pick?: Pick): { ok: boolean; msg: string } {
  const p = state.people[personId];
  const g = gateOpen(state.minute);
  if (!g.open) return { ok: false, msg: g.reason! };
  const cost = TICKET + (pick ? STAKE : 0);
  const r = transfer(state, { from: p.accountId, to: state.externalId, amount: cost, reason: 'purchase', memo: pick ? 'Match ticket and a bet' : 'Match ticket', key: `match:${personId}:${dayIndex(state.minute)}` });
  if (!r.ok) return { ok: false, msg: `That's ${fmtMoney(cost)}.` };
  const day = dayIndex(state.minute);
  const f = fixture(day);
  state.matchBet = { day, pick: pick ?? null };
  const end = day * 1440 + g.ko! + 110;
  p.away = { until: Math.max(end, state.minute + 20), reason: `Harbour City v ${f.rival}`, place: 'stadium', to: turnstiles() };
  p.visible = false; p.move = null; p.action = null; p.where = 'stadium';
  return { ok: true, msg: `Through the turnstile. Harbour City v ${f.rival}${pick ? `, ${fmtMoney(STAKE)} on ${pick === 'H' ? 'a home win' : pick === 'D' ? 'a draw' : `${f.rival} to win`}` : ''}.` };
}

/** full time: how it went, and the bet paid out */
export function settleMatch(state: GameState, personId: Id): string {
  const p = state.people[personId];
  const mb = state.matchBet;
  state.matchBet = null;
  if (!mb) return '';
  const f = fixture(mb.day);
  const score = `Harbour City ${f.home}-${f.away} ${f.rival}`;
  p.needs.mood = clamp(p.needs.mood + (f.result === 'H' ? 25 : f.result === 'D' ? 8 : -6), 0, 100);
  p.needs.satiety = clamp(p.needs.satiety + 15, 0, 100); // a pie at half time
  let bet = '';
  if (mb.pick) {
    if (mb.pick === f.result) {
      const win = Math.round(STAKE * ODDS[mb.pick]);
      transfer(state, { from: state.externalId, to: p.accountId, amount: win, reason: 'transfer', memo: 'Winning bet', key: `matchwin:${personId}:${mb.day}` });
      bet = ` Your bet came in: ${fmtMoney(win)}!`;
    } else bet = ' Your bet lost.';
  }
  lifeEvent(state, p, `Watched ${score}`);
  const how = f.result === 'H' ? (f.home - f.away >= 3 ? 'A thrashing! The whole ground is singing.' : 'A win! You sing all the way out.') : f.result === 'D' ? 'Honours even.' : 'A defeat. The walk out is quiet.';
  news(state, f.result === 'H' ? 'good' : 'info', `Full time: ${score}`, `${how}${bet}`, true);
  return `Full time: ${score}. ${how}${bet}`;
}
