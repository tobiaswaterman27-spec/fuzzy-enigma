// Life events people actually turn up to: weddings, funerals and big birthdays are held in the park.
// Family and friends walk there and stand together; the couple are cheered, the dead are mourned.
// You are invited if you know them, and going (being there) brings you closer to everyone present.
import type { GameState, Id, Person, Vec2 } from './types';
import { clamp, nextId, rand } from './core';
import { lifeEvent, news } from './events';
import { at, dayIndex, fmtClock } from './clock';
import { goTo } from './npc';
import { openAttendance } from './employment';
import { gesture } from './talk';

export type GatheringKind = 'wedding' | 'funeral' | 'birthday';
export interface Gathering { id: Id; kind: GatheringKind; title: string; at: number; until: number; hosts: Id[]; guests: Id[]; invited: boolean; done?: boolean }

/** the lawn by the north path of the park */
export const GATHER_SPOT: Vec2 = { x: 56, z: 33.5 };
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const alive = (p?: Person | null): p is Person => !!p && !p.dead && !p.left && !p.away;

/** where each person stands: hosts at the front facing everyone, guests in a curve facing them */
export function placeFor(g: Gathering, id: Id): { pos: Vec2; facing: number } {
  const h = g.hosts.indexOf(id);
  if (h >= 0) return { pos: { x: GATHER_SPOT.x - 0.5 + h * 1.0, z: GATHER_SPOT.z + 1.6 }, facing: Math.PI };
  const i = Math.max(0, g.guests.indexOf(id));
  const row = Math.floor(i / 6), k = i % 6;
  const a = -0.9 + (k / 5) * 1.8;
  const r = 3 + row * 1.1;
  return { pos: { x: GATHER_SPOT.x + Math.sin(a) * r, z: GATHER_SPOT.z + 1.6 - Math.cos(a) * r }, facing: 0 };
}

/** arrange one: guests are the hosts' family and the people who are close to them */
export function scheduleGathering(state: GameState, kind: GatheringKind, hosts: Person[], title: string, inDays: number, hour: number) {
  const day = dayIndex(state.minute) + inDays;
  const start = at(day, hour, 0);
  const you = state.people[state.playerId];
  const hostIds = hosts.map((h) => h.id);
  const guests = Object.values(state.people)
    .filter((p) => !p.isPlayer && alive(p) && p.npc && !p.npc.ambient && !p.police && !hostIds.includes(p.id))
    .filter((p) => hosts.some((h) => (p.relations[h.id] ?? 0) >= 25 || h.partnerId === p.id))
    .slice(0, 14).map((p) => p.id);
  // a funeral's "hosts" are the family left behind
  const shown = kind === 'funeral' ? hosts.filter(alive) : hosts;
  const invited = hosts.some((h) => (you.relations[h.id] ?? 0) >= 20 || h.partnerId === you.id);
  const g: Gathering = { id: nextId(state, 'gath'), kind, title, at: start, until: start + (kind === 'funeral' ? 60 : 120), hosts: shown.map((h) => h.id), guests, invited };
  (state.gatherings ??= []).push(g);
  if (invited) news(state, 'info', kind === 'wedding' ? `Invited: ${title}` : kind === 'funeral' ? title : `Invited: ${title}`, `${DAYS[day % 7]} at ${fmtClock(start)} in the park (the lawn by the north path).${kind === 'funeral' ? ' Wear something smart.' : ''}`, true);
  return g;
}

export const activeGathering = (state: GameState) => state.gatherings?.find((g) => !g.done && state.minute >= g.at - 30 && state.minute < g.until) ?? null;

/** every minute: guests set off in time, stand in their places, and the event plays out */
export function gatheringsTick(state: GameState) {
  const list = state.gatherings;
  if (!list?.length) return;
  for (const g of list) {
    if (g.done) continue;
    if (state.minute >= g.until) {
      g.done = true;
      for (const id of [...g.hosts, ...g.guests]) { const p = state.people[id]; if (p?.npc) { p.npc.plan = []; p.npc.nextDecision = state.minute; (p.npc as any).gathering = undefined; } }
      const you = state.people[state.playerId];
      const there = Math.hypot(you.pos.x - GATHER_SPOT.x, you.pos.z - GATHER_SPOT.z) < 14 && you.visible;
      if (there) {
        for (const id of [...g.hosts, ...g.guests]) { const p = state.people[id]; if (!p) continue; p.relations[you.id] = clamp((p.relations[you.id] ?? 0) + (g.hosts.includes(id) ? 10 : 4), 0, 100); you.relations[id] = p.relations[you.id]; }
        you.needs.mood = clamp(you.needs.mood + (g.kind === 'funeral' ? -5 : 12), 0, 100);
        lifeEvent(state, you, `Went to ${g.title}`);
        for (const id of g.hosts) { const p = state.people[id]; if (p) lifeEvent(state, p, `${you.name} came to ${g.title}`); }
      }
      continue;
    }
    if (state.minute < g.at - 30) continue;
    const live = state.minute >= g.at;
    for (const id of [...g.hosts, ...g.guests]) {
      const p = state.people[id];
      if (!p || !alive(p) || !p.npc || p.down != null || p.combat || p.following) continue;
      if (openAttendance(state, p.id)) continue; // at work: can't come
      const { pos, facing } = placeFor(g, id);
      const d = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
      if ((p.npc as any).gathering !== g.id) {
        (p.npc as any).gathering = g.id;
        p.sleeping = false; p.action = null;
        if (g.kind === 'funeral' || g.kind === 'wedding') p.appearance.outfit = 'outfit_smart';
        p.npc.plan = [{ kind: 'move', to: pos, label: g.title }, { kind: 'wait', until: g.until }];
        p.npc.goal = 'leisure';
        continue;
      }
      if (d < 0.6 && !p.move) {
        p.facing = facing;
        // the event itself: cheering for the couple, tears at the graveside, singing for the birthday
        if (live && rand(state) < 0.12) {
          const host = g.hosts.includes(id);
          const clip = g.kind === 'funeral' ? (host || rand(state) < 0.3 ? 'cry' : 'sad') : g.kind === 'wedding' ? (host ? 'happy' : rand(state) < 0.5 ? 'laugh' : 'happy') : rand(state) < 0.5 ? 'laugh' : 'happy';
          gesture(state, p, clip, 3);
        }
      } else if (!p.move && p.npc.plan[0]?.kind !== 'move' && d >= 0.6) {
        goTo(state, p, pos, g.title);
      }
    }
  }
  if (list.length > 20) state.gatherings = list.filter((g) => !g.done || state.minute - g.until < 1440).slice(-20);
}

/** big days that call for a get-together */
export function lifeGatherings(state: GameState, kind: GatheringKind, people: Person[]) {
  const first = (p: Person) => p.name.split(' ')[0];
  if (kind === 'wedding') return scheduleGathering(state, 'wedding', people, `the wedding of ${first(people[0])} and ${first(people[1])}`, 2, 14);
  if (kind === 'funeral') {
    const dead = people[0];
    const family = Object.values(state.people).filter((p) => alive(p) && !p.isPlayer && (p.partnerId === dead.id || (p.homeId && p.homeId === dead.homeId)));
    const g = scheduleGathering(state, 'funeral', [dead, ...family], `the funeral of ${dead.name}`, 2, 11);
    g.hosts = family.map((p) => p.id);
    return g;
  }
  return scheduleGathering(state, 'birthday', people, `${first(people[0])}'s ${people[0].age}th birthday party`, 1, 15);
}
