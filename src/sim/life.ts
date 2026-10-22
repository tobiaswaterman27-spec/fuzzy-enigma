// Life in Harbourside goes on around you: people have birthdays and grow older, fall for each other,
// date, marry and move in together; some break up or divorce and move out or leave town; babies are
// born; the very old die. Newcomers move into the homes that come free. You can date and marry too.
// A year passes every 28 days (so a life plays out over a long game).
import type { GameState, Id, Person } from './types';
import { dayIndex } from './clock';
import { clamp, rand } from './core';
import { lifeEvent, news } from './events';
import { activeLease } from './housing';
import { endContract } from './employment';
import { ageOf } from './persona';
import { HOUSE_IDS } from './world/layout';
import { spawnResident } from './newgame';

export const YEAR_DAYS = 28;
const BABY_NAMES = ['Ava', 'Leo', 'Isla', 'Noah', 'Mia', 'Oscar', 'Freya', 'Arlo', 'Ruby', 'Theo', 'Esme', 'Finn', 'Zara', 'Jude'];

/** the townspeople who live their lives here (not passers-by from elsewhere) */
export const residents = (state: GameState) => Object.values(state.people).filter((p) => !p.isPlayer && p.npc && !p.npc.ambient && !p.dead && !p.left);
const alive = (p?: Person | null): p is Person => !!p && !p.dead && !p.left;
const single = (p: Person) => !p.partnerId;
export const childAge = (state: GameState, born: number) => Math.max(0, Math.floor((state.minute - born) / (YEAR_DAYS * 1440)));

function birthday(p: Person) {
  let h = 3;
  for (let i = 0; i < p.id.length; i++) h = (h * 33 + p.id.charCodeAt(i)) >>> 0;
  return h % YEAR_DAYS;
}

/** first time: ages, couples who already live together, a few children; once per game */
export function initLife(state: GameState) {
  if (state.lifeInit) return;
  state.lifeInit = true;
  const people = residents(state);
  for (const p of people) { p.age = ageOf(p); p.relationship ??= 'single'; p.health ??= 100; }
  const pl = state.people[state.playerId];
  if (pl) { pl.age ??= 26; pl.relationship ??= 'single'; pl.health ??= 100; }
  // people sharing a house who are close in age are a couple
  const byHome = new Map<string, Person[]>();
  for (const p of people) if (p.homeId && p.homeId.startsWith('house_')) byHome.set(p.homeId, [...(byHome.get(p.homeId) ?? []), p]);
  for (const group of byHome.values()) {
    const free = group.filter((p) => !p.npc?.retired);
    for (let i = 0; i + 1 < free.length; i += 2) {
      const a = free[i], b = free[i + 1];
      if (Math.abs(ageOf(a) - ageOf(b)) > 15) continue;
      a.partnerId = b.id; b.partnerId = a.id;
      a.relationship = b.relationship = Math.min(ageOf(a), ageOf(b)) > 27 ? 'married' : 'dating';
      a.relations[b.id] = b.relations[a.id] = 85;
      if (a.relationship === 'married' && Math.min(ageOf(a), ageOf(b)) > 30 && (a.id.length + b.id.length) % 2 === 0) {
        const kid = { name: BABY_NAMES[(a.id.length * 7 + b.id.length) % BABY_NAMES.length], born: state.minute - (3 + (a.id.length % 9)) * YEAR_DAYS * 1440 };
        a.children = [kid]; b.children = [kid];
      }
    }
  }
  for (const p of people) if (p.npc?.retired && !p.partnerId) p.relationship = 'widowed';
}

/** move a person into another home (their old tenancy ends) */
export function moveHome(state: GameState, p: Person, homeId: Id) {
  const l = activeLease(state, p.id);
  if (l && l.locationId !== homeId) l.status = 'ended';
  p.homeId = homeId;
  for (const c of [p.pantryId, p.wardrobeId]) if (c && state.containers[c]) state.containers[c].locationId = homeId;
}

/** leave Harbourside for good: job and tenancy end, they are no longer simulated */
export function leaveTown(state: GameState, p: Person, why: string) {
  if (p.contractId) endContract(state, p.contractId, 'resigned', `${p.name} moved away`);
  const l = activeLease(state, p.id);
  if (l) l.status = 'ended';
  p.left = true;
  p.visible = false;
  p.where = 'offsite';
  p.action = null; p.move = null;
  if (p.npc) { p.npc.retired = true; p.npc.plan = []; p.npc.goal = 'offsite'; }
  news(state, 'world', `${p.name} has left Harbourside`, why);
}

function split(state: GameState, a: Person, b: Person, divorce: boolean) {
  a.partnerId = b.partnerId = null;
  a.relationship = b.relationship = divorce ? 'divorced' : 'single';
  a.relations[b.id] = Math.min(a.relations[b.id] ?? 0, 15);
  b.relations[a.id] = Math.min(b.relations[a.id] ?? 0, 15);
  a.needs.mood = clamp(a.needs.mood - 25, 0, 100);
  b.needs.mood = clamp(b.needs.mood - 25, 0, 100);
  lifeEvent(state, a, divorce ? `Divorced ${b.name}` : `Split up with ${b.name}`);
  lifeEvent(state, b, divorce ? `Divorced ${a.name}` : `Split up with ${a.name}`);
  // whoever moved in moves out again: into a free home if there is one, otherwise away
  if (a.homeId && a.homeId === b.homeId) {
    const mover = b.isPlayer ? a : a.isPlayer ? b : (activeLease(state, a.id) ? b : a);
    if (mover.isPlayer) return;
    const free = freeHome(state);
    if (free) { moveHome(state, mover, free); news(state, 'world', `${mover.name} moves to ${free.replace('house_', 'No. ')}`, divorce ? 'After the divorce.' : 'After the break-up.'); }
    else leaveTown(state, mover, divorce ? 'Moved away after the divorce.' : 'Moved away after the break-up.');
  }
}

/** a house nobody lives in, if any */
export function freeHome(state: GameState): Id | null {
  const lived = new Set(Object.values(state.people).filter(alive).map((p) => p.homeId));
  return (HOUSE_IDS as readonly string[]).find((h) => !lived.has(h)) ?? null;
}

export function die(state: GameState, p: Person, cause: string, keepBody = false) {
  if (p.dead) return;
  p.dead = { at: state.minute, cause };
  if (p.contractId) endContract(state, p.contractId, 'closed', `${p.name} died`);
  const l = activeLease(state, p.id);
  if (l && !(p.partnerId && state.people[p.partnerId]?.homeId === p.homeId)) l.status = 'ended';
  if (!keepBody) { p.visible = false; p.where = 'offsite'; }
  p.action = null; p.move = null; p.combat = null; p.bleeding = 0;
  if (p.npc) { p.npc.retired = true; p.npc.plan = []; p.npc.goal = 'offsite'; }
  const partner = p.partnerId ? state.people[p.partnerId] : null;
  if (partner && alive(partner)) {
    partner.partnerId = null;
    partner.relationship = 'widowed';
    partner.needs.mood = clamp(partner.needs.mood - 40, 0, 100);
    lifeEvent(state, partner, `Lost ${p.name}`);
  }
  for (const o of Object.values(state.people)) if (alive(o) && (o.relations[p.id] ?? 0) >= 30) o.needs.mood = clamp(o.needs.mood - 10, 0, 100);
  const you = state.people[state.playerId];
  news(state, 'bad', `${p.name} has died`, `${p.name}, ${ageOf(p)}, died (${cause}). The funeral is at St Mary's on ${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][(dayIndex(state.minute) + 3) % 7]}.`, (you?.relations[p.id] ?? 0) >= 20 || p.isPlayer);
}

/** the player asks someone out (they must be single and like you a lot) */
export function askOut(state: GameState, id: Id): { ok: boolean; msg: string } {
  const me = state.people[state.playerId], o = state.people[id];
  if (!o || !alive(o)) return { ok: false, msg: 'They are not here.' };
  if (me.partnerId) return { ok: false, msg: `You are with ${state.people[me.partnerId]?.name}.` };
  if (o.partnerId) return { ok: false, msg: `${o.name.split(' ')[0]} is with someone.` };
  if ((o.relations[me.id] ?? 0) < 55) return { ok: false, msg: `${o.name.split(' ')[0]} likes you, but not like that (yet).` };
  me.partnerId = o.id; o.partnerId = me.id;
  me.relationship = o.relationship = 'dating';
  state.datingSince = state.minute;
  lifeEvent(state, me, `Started seeing ${o.name}`); lifeEvent(state, o, `Started seeing ${me.name}`);
  news(state, 'good', `You and ${o.name} are an item`, 'Spend time together and, one day, maybe more.', true);
  return { ok: true, msg: `${o.name.split(' ')[0]} said yes!` };
}

/** the player proposes: after a week together and if they are very close, they move in with you */
export function propose(state: GameState, id: Id): { ok: boolean; msg: string } {
  const me = state.people[state.playerId], o = state.people[id];
  if (!o || me.partnerId !== id || me.relationship !== 'dating') return { ok: false, msg: 'You are not together.' };
  if (state.minute - (state.datingSince ?? state.minute) < 7 * 1440) return { ok: false, msg: 'Too soon: give it at least a week.' };
  if ((o.relations[me.id] ?? 0) < 80) return { ok: false, msg: `${o.name.split(' ')[0]} isn't ready for that.` };
  me.relationship = o.relationship = 'married';
  lifeEvent(state, me, `Married ${o.name}`); lifeEvent(state, o, `Married ${me.name}`);
  if (me.homeId && o.homeId !== me.homeId) moveHome(state, o, me.homeId);
  news(state, 'good', `You married ${o.name}`, `${o.name.split(' ')[0]} has moved in with you.`, true);
  return { ok: true, msg: 'Yes!' };
}

export function breakUp(state: GameState, id: Id): { ok: boolean; msg: string } {
  const me = state.people[state.playerId], o = state.people[id];
  if (!o || me.partnerId !== id) return { ok: false, msg: 'You are not together.' };
  split(state, me, o, me.relationship === 'married');
  return { ok: true, msg: me.relationship === 'divorced' ? 'You are divorced.' : 'You split up.' };
}

/** once a day */
export function lifeDaily(state: GameState) {
  initLife(state);
  const day = dayIndex(state.minute);
  const people = residents(state);
  const you = state.people[state.playerId];
  // birthdays
  for (const p of [...people, you]) {
    if (!p || birthday(p) !== day % YEAR_DAYS) continue;
    p.age = ageOf(p) + 1;
    if (p.isPlayer) news(state, 'good', 'Happy birthday!', `You are ${p.age} today.`, true);
    else if (p.age % 10 === 0 && (you.relations[p.id] ?? 0) >= 20) news(state, 'world', `${p.name} turns ${p.age}`, 'A big birthday.');
    // old age
    if (!p.isPlayer && p.age >= 76 && rand(state) < (p.age - 74) * 0.05) die(state, p, 'old age');
  }
  // people who work or live together, or have met, grow closer (or not)
  for (const a of people) for (const b of people) {
    if (a.id >= b.id) continue;
    const together = (a.contractId && b.contractId && state.contracts[a.contractId]?.businessId === state.contracts[b.contractId]?.businessId) || (a.homeId && a.homeId === b.homeId);
    if (!together) continue;
    const k = 0.4 + (a.traits.sociability + b.traits.sociability) * 0.4;
    a.relations[b.id] = clamp((a.relations[b.id] ?? 0) + k, 0, 100);
    b.relations[a.id] = clamp((b.relations[a.id] ?? 0) + k, 0, 100);
  }
  // romance among singles who like each other
  const singles = people.filter((p) => single(p) && ageOf(p) >= 18 && ageOf(p) < 70);
  for (const a of singles) for (const b of singles) {
    if (a.id >= b.id || a.partnerId || b.partnerId) continue;
    if ((a.relations[b.id] ?? 0) < 45 || (b.relations[a.id] ?? 0) < 45 || Math.abs(ageOf(a) - ageOf(b)) > 15) continue;
    if (rand(state) < 0.08) {
      a.partnerId = b.id; b.partnerId = a.id;
      a.relationship = b.relationship = 'dating';
      (a.dating ??= {})[b.id] = state.minute;
      lifeEvent(state, a, `Started seeing ${b.name}`); lifeEvent(state, b, `Started seeing ${a.name}`);
      news(state, 'world', `${a.name.split(' ')[0]} and ${b.name.split(' ')[0]} are seeing each other`, 'Harbourside gossip.');
    }
  }
  // couples: marriage, babies, break-ups
  for (const a of people) {
    const b = a.partnerId ? state.people[a.partnerId] : null;
    if (!b || !alive(b) || b.isPlayer || a.id > b.id) continue;
    const close = Math.min(a.relations[b.id] ?? 0, b.relations[a.id] ?? 0);
    const stressed = a.needs.mood < 30 || b.needs.mood < 30;
    if (a.relationship === 'dating') {
      const since = a.dating?.[b.id] ?? 0;
      if (state.minute - since > 10 * 1440 && close >= 70 && rand(state) < 0.06) {
        a.relationship = b.relationship = 'married';
        lifeEvent(state, a, `Married ${b.name}`); lifeEvent(state, b, `Married ${a.name}`);
        // move in together: into a house if either has one
        const home = a.homeId?.startsWith('house_') ? a.homeId : b.homeId?.startsWith('house_') ? b.homeId : a.homeId;
        if (home) { if (a.homeId !== home) moveHome(state, a, home); if (b.homeId !== home) moveHome(state, b, home); }
        news(state, 'good', `Wedding: ${a.name} and ${b.name}`, 'They married at St Mary\'s and have moved in together.', (you.relations[a.id] ?? 0) >= 20 || (you.relations[b.id] ?? 0) >= 20);
        continue;
      }
      if (stressed && rand(state) < 0.05) { split(state, a, b, false); news(state, 'world', `${a.name.split(' ')[0]} and ${b.name.split(' ')[0]} have split up`, 'Harbourside gossip.'); continue; }
    }
    if (a.relationship === 'married') {
      const young = ageOf(a) < 43 && ageOf(b) < 43;
      if (young && (a.children?.length ?? 0) < 3 && rand(state) < 0.012) {
        const kid = { name: BABY_NAMES[Math.floor(rand(state) * BABY_NAMES.length)], born: state.minute };
        (a.children ??= []).push(kid);
        if (b.children !== a.children) (b.children ??= []).push(kid);
        a.needs.mood = clamp(a.needs.mood + 25, 0, 100); b.needs.mood = clamp(b.needs.mood + 25, 0, 100);
        lifeEvent(state, a, `Baby ${kid.name} was born`); lifeEvent(state, b, `Baby ${kid.name} was born`);
        news(state, 'good', `A baby for ${a.name.split(' ')[0]} and ${b.name.split(' ')[0]}`, `Welcome to the world, ${kid.name}.`, (you.relations[a.id] ?? 0) >= 20 || (you.relations[b.id] ?? 0) >= 20);
        continue;
      }
      if ((stressed || close < 30) && rand(state) < 0.015) { split(state, a, b, true); news(state, 'world', `${a.name} and ${b.name} are divorcing`, 'Harbourside gossip.'); }
    }
  }
  // the player's own relationship cools if neglected
  if (you?.partnerId) {
    const o = state.people[you.partnerId];
    if (alive(o)) {
      const seen = you.lastSeen?.[o.id] ?? 0;
      if (state.minute - seen > 3 * 1440 && you.homeId !== o.homeId) o.relations[you.id] = clamp((o.relations[you.id] ?? 0) - 3, 0, 100);
      if ((o.relations[you.id] ?? 0) < 20) { split(state, you, o, you.relationship === 'married'); news(state, 'bad', `${o.name} has left you`, 'You drifted apart.', true); }
    }
  }
  // newcomers move into empty homes
  const free = freeHome(state);
  if (free && rand(state) < 0.25) {
    const p = spawnResident(state, free);
    lifeEvent(state, p, 'Moved to Harbourside');
    news(state, 'world', `New neighbours: ${p.name}`, `${p.name} has moved into ${free.replace('house_', 'No. ')} and is looking for work.`);
  }
}
