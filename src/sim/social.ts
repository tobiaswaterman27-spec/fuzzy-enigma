// Friendships: chatting builds familiarity; friends can be invited to meet at Tidewater Cafe, where you
// sit together over a coffee. Friendships fade when you never see each other; friends lift your mood.
import type { GameState, Id, Person } from './types';
import { at, dayIndex, fmtClock, minuteOfDay } from './clock';
import { clamp } from './core';
import { news } from './events';
import { currentShift, nextShift } from './employment';

export const FRIEND_AT = 30;
export const CLOSE_AT = 70;

export interface Meetup { friendId: Id; at: number; status: 'planned' | 'met' | 'missed' }

export function relationLabel(v: number): string {
  if (v >= CLOSE_AT) return 'Close friend';
  if (v >= FRIEND_AT) return 'Friend';
  if (v >= 10) return 'Acquaintance';
  return 'Stranger';
}

/** someone is free to meet at a time: not working then (or travelling to it) and awake */
function freeAt(state: GameState, p: Person, minute: number): boolean {
  if (p.isPlayer) return true;
  const c = p.contractId ? state.contracts[p.contractId] : null;
  if (c) {
    const s = currentShift(c, minute, 30) ?? nextShift(c, minute);
    if (s && s.start <= minute + 75 && s.end >= minute - 15) return false;
  }
  const m = minuteOfDay(minute);
  return m >= 9 * 60 && m <= 20 * 60;
}

/** invite a friend for a coffee: the next free hour, at least an hour from now */
export function inviteForCoffee(state: GameState, playerId: Id, friendId: Id): { ok: boolean; msg: string } {
  const p = state.people[playerId], f = state.people[friendId];
  if (!f || (p.relations[friendId] ?? 0) < FRIEND_AT) return { ok: false, msg: 'You need to know them better first.' };
  if (state.meetups?.some((m) => m.status === 'planned')) return { ok: false, msg: 'You already have a meet-up arranged.' };
  if (!state.businesses.cafe) return { ok: false, msg: 'Nowhere to meet.' };
  let t = Math.ceil((state.minute + 60) / 30) * 30;
  for (let k = 0; k < 48 && !(freeAt(state, f, t) && minuteOfDay(t) < 16 * 60 + 30 && minuteOfDay(t) >= 9 * 60 && ![2].includes(dayIndex(t) % 7)); k++) t += 30;
  if (!freeAt(state, f, t)) return { ok: false, msg: `${f.name.split(' ')[0]} is too busy this week.` };
  (state.meetups ??= []).push({ friendId, at: t, status: 'planned' });
  const day = dayIndex(t) === dayIndex(state.minute) ? 'today' : 'tomorrow';
  news(state, 'info', `Coffee with ${f.name.split(' ')[0]}`, `Meet at Tidewater Cafe ${day} at ${fmtClock(t)}. Sit at the corner table by the window.`, true);
  return { ok: true, msg: `${f.name.split(' ')[0]}: "Lovely - see you at the cafe ${day} at ${fmtClock(t)}."` };
}

/** the meet-up the player has arranged (if any) */
export const plannedMeetup = (state: GameState) => state.meetups?.find((m) => m.status === 'planned') ?? null;

/** daily: friendships you do not keep up slowly fade; friends lift your mood */
export function socialDaily(state: GameState) {
  const p = state.people[state.playerId];
  for (const [id, v] of Object.entries(p.relations)) {
    const seen = (p.lastSeen?.[id] ?? 0) > state.minute - 3 * 1440;
    if (!seen) p.relations[id] = Math.max(0, v - 1.5);
    const o = state.people[id];
    if (o) o.relations[p.id] = p.relations[id];
  }
}

export const friendCount = (p: Person) => Object.values(p.relations).filter((v) => v >= FRIEND_AT).length;

/** a met friend: both sit down together, chat, and the friendship grows */
export function meetUp(state: GameState, m: Meetup): string {
  const p = state.people[state.playerId], f = state.people[m.friendId];
  m.status = 'met';
  p.relations[f.id] = clamp((p.relations[f.id] ?? 0) + 12, 0, 100);
  f.relations[p.id] = p.relations[f.id];
  p.needs.mood = clamp(p.needs.mood + 15, 0, 100);
  (p.lastSeen ??= {})[f.id] = state.minute;
  return `Coffee with ${f.name.split(' ')[0]}: a good catch-up (friendship ${Math.round(p.relations[f.id])}).`;
}

/** a missed meet-up hurts the friendship */
export function missMeetup(state: GameState, m: Meetup) {
  const p = state.people[state.playerId], f = state.people[m.friendId];
  m.status = 'missed';
  p.relations[f.id] = Math.max(0, (p.relations[f.id] ?? 0) - 10);
  f.relations[p.id] = p.relations[f.id];
  news(state, 'bad', `You stood ${f.name.split(' ')[0]} up`, `${f.name.split(' ')[0]} waited at the cafe at ${fmtClock(m.at)}.`, true);
}

/** meet-ups happen when you are both sitting at the corner table; a no-show is a missed meet-up */
export function socialMinute(state: GameState) {
  const m = plannedMeetup(state);
  if (!m) return;
  const p = state.people[state.playerId], f = state.people[m.friendId];
  const together = p.action?.type === 'sit' && p.action.target === 'meet_chair' && f?.action?.type === 'sit' && f.action.target === 'meet_host';
  if (together && state.minute >= m.at - 20) news(state, 'good', 'Catching up', meetUp(state, m), true);
  else if (state.minute > m.at + 40) missMeetup(state, m);
}

export { at };
