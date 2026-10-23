// Friendships: chatting builds familiarity; friends can be invited to meet at Tidewater Cafe, where you
// sit together over a coffee. Friendships fade when you never see each other; friends lift your mood.
import type { GameState, Id, Person, Vec2 } from './types';
import { at, dayIndex, fmtClock, minuteOfDay } from './clock';
import { clamp } from './core';
import { news } from './events';
import { currentShift, nextShift } from './employment';

export const FRIEND_AT = 30;
export const CLOSE_AT = 70;

/** where friends meet: the cafe for a coffee, The Anchor for a drink, the park for a walk */
export type MeetPlace = 'cafe' | 'pub' | 'park';
export const MEET_PLACES: Record<MeetPlace, { name: string; spot: Vec2; seat?: Id; open: number; close: number; shutDay?: number; what: string }> = {
  cafe: { name: 'Tidewater Cafe', spot: { x: -31, z: 15.75 }, seat: 'meet_host', open: 9 * 60, close: 16 * 60 + 30, shutDay: 2, what: 'a coffee' },
  pub: { name: 'The Anchor', spot: { x: 67.5, z: 76.3 }, open: 12 * 60, close: 22 * 60 + 30, what: 'a drink' },
  park: { name: 'the park', spot: { x: 50, z: 22.9 }, seat: 'bench_1', open: 8 * 60, close: 19 * 60 + 30, what: 'a walk and a chat' },
};
/** how near the spot counts as being there */
export const MEET_RADIUS = 7;

export interface Meetup { friendId: Id; at: number; status: 'planned' | 'met' | 'missed'; place?: MeetPlace; friendArrived?: number; youArrived?: number }

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
  // awake and not about to turn in
  const m = minuteOfDay(minute);
  const n = p.npc;
  return n ? m >= Math.max(8 * 60, n.wake + 30) && m <= Math.min(23 * 60, n.bedtime - 45) : m >= 9 * 60 && m <= 20 * 60;
}

/** a time that suits for coffee at the cafe: it is open (09:00-16:30, not Wednesdays), they are not at
 * work, and there is time to get there (an hour from now at the soonest). A time asked for is kept when
 * it works; otherwise the nearest one that does after it. */
export const coffeeSlot = (state: GameState, f: Person, want?: number) => meetSlot(state, f, 'cafe', want);
/** a time that suits for meeting at a place: open, they are free and awake, an hour off at the soonest */
export function meetSlot(state: GameState, f: Person, place: MeetPlace, want?: number): number | null {
  const P = MEET_PLACES[place];
  const ok = (t: number) => freeAt(state, f, t) && minuteOfDay(t) < P.close && minuteOfDay(t) >= P.open && dayIndex(t) % 7 !== P.shutDay;
  let t = Math.ceil(Math.max(state.minute + 60, want ?? 0) / 30) * 30;
  for (let k = 0; k < 96 && !ok(t); k++) t += 30;
  return ok(t) ? t : null;
}

/** invite a friend for a coffee: the next free half hour (or the time asked for, if it suits) */
export function inviteForCoffee(state: GameState, playerId: Id, friendId: Id, agreed = false, want?: number, place: MeetPlace = 'cafe'): { ok: boolean; msg: string } {
  const p = state.people[playerId], f = state.people[friendId];
  if (!f || (!agreed && (p.relations[friendId] ?? 0) < FRIEND_AT)) return { ok: false, msg: 'You need to know them better first.' };
  if (state.meetups?.some((m) => m.status === 'planned')) return { ok: false, msg: 'You already have a meet-up arranged.' };
  if (!state.businesses.cafe) return { ok: false, msg: 'Nowhere to meet.' };
  const P = MEET_PLACES[place];
  const t = meetSlot(state, f, place, want);
  if (t == null) return { ok: false, msg: `${f.name.split(' ')[0]} is too busy this week.` };
  (state.meetups ??= []).push({ friendId, at: t, status: 'planned', place });
  const day = dayIndex(t) === dayIndex(state.minute) ? 'today' : dayIndex(t) === dayIndex(state.minute) + 1 ? 'tomorrow' : ['on Monday', 'on Tuesday', 'on Wednesday', 'on Thursday', 'on Friday', 'on Saturday', 'on Sunday'][dayIndex(t) % 7];
  const first = f.name.split(' ')[0];
  news(state, 'info', `${P.what[0].toUpperCase()}${P.what.slice(1)} with ${first}`, `Meet at ${P.name} ${day} at ${fmtClock(t)}.${place === 'cafe' ? ' Sit at the corner table by the window.' : place === 'park' ? ' By the benches.' : ' At the tables by the window.'}`, true);
  return { ok: true, msg: `${first}: "Lovely - see you at ${P.name === 'the park' ? 'the park' : P.name} ${day} at ${fmtClock(t)}."` };
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

/** a meet-up happens when you are both there (anywhere near the spot, not one exact chair). Who got
 * there when is noted, so lateness can come up when you talk; you not showing up is a missed meet-up,
 * and so is them not showing (it happens) */
export function socialMinute(state: GameState) {
  const m = plannedMeetup(state);
  if (!m) return;
  const p = state.people[state.playerId], f = state.people[m.friendId];
  const P = MEET_PLACES[m.place ?? 'cafe'];
  const near = (q: Person | undefined, r: number) => !!q && q.where !== 'vehicle' && Math.hypot(q.pos.x - P.spot.x, q.pos.z - P.spot.z) < r;
  if (state.minute >= m.at - 30) {
    if (!m.youArrived && near(p, MEET_RADIUS)) m.youArrived = state.minute;
    if (!m.friendArrived && near(f, 3)) m.friendArrived = state.minute;
  }
  if (m.youArrived && m.friendArrived && near(p, MEET_RADIUS) && near(f, MEET_RADIUS)) { news(state, 'good', 'Catching up', meetUp(state, m), true); return; }
  if (state.minute > m.at + 40 && !m.youArrived) { missMeetup(state, m); return; }
  if (state.minute > m.at + 50 && !m.friendArrived && f) {
    m.status = 'missed';
    p.needs.mood = clamp(p.needs.mood - 5, 0, 100);
    news(state, 'bad', `${f.name.split(' ')[0]} never turned up`, `You waited at ${P.name} from ${fmtClock(m.youArrived ?? m.at)}.`, true);
  }
}

/** what to say about a meet-up that is on now or just happened: who was late, by how much */
export function meetupNote(state: GameState, friendId: Id): string {
  const m = state.meetups?.slice().reverse().find((x) => x.friendId === friendId && Math.abs(state.minute - x.at) < 120);
  if (!m) return '';
  const P = MEET_PLACES[m.place ?? 'cafe'];
  const you = state.people[state.playerId].name.split(' ')[0];
  const late = (t?: number) => t == null ? 'not there yet' : t > m.at + 4 ? `${Math.round(t - m.at)} minutes late` : t < m.at - 8 ? `${Math.round(m.at - t)} minutes early` : 'on time';
  return `You arranged to meet ${you} at ${P.name} at ${fmtClock(m.at)} for ${P.what}. You got there ${late(m.friendArrived)}; ${you} got there ${late(m.youArrived)}. If either of you was late, it is natural to mention it (an apology, a dig, a joke, depending on who you are).`;
}

export { at };
