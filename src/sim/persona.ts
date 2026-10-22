// What a townsperson knows about themselves and about you: used to make conversations specific to
// them, both for the built-in replies and (when the player has given an AI key) as the character
// brief for a language model.
import type { GameState, Id, Person } from './types';
import { dayIndex, fmtClock, hourOfDay } from './clock';
import { clamp, fmtMoney } from './core';
import { news } from './events';
import { FRIEND_AT, relationLabel } from './social';
import { weatherLabel } from './weather';
import { activeLease } from './housing';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** age in years: set for people created with one, otherwise fixed per person from their id */
export function ageOf(p: Person): number {
  if (p.age !== undefined) return Math.floor(p.age);
  let h = 7;
  for (let i = 0; i < p.id.length; i++) h = (h * 31 + p.id.charCodeAt(i)) >>> 0;
  return 20 + (h % 46);
}

function traitWords(p: Person): string[] {
  const t = p.traits, out: string[] = [];
  out.push(t.sociability > 0.65 ? 'chatty and warm' : t.sociability < 0.35 ? 'reserved, a bit shy' : 'friendly enough');
  out.push(t.conscientiousness > 0.65 ? 'hard-working and tidy' : t.conscientiousness < 0.35 ? 'easy-going, a bit lazy' : 'reliable');
  out.push(t.ambition > 0.65 ? 'ambitious, wants to get on' : t.ambition < 0.35 ? 'content with a quiet life' : 'quietly hopeful about the future');
  out.push(t.patience < 0.35 ? 'short-tempered' : t.patience > 0.7 ? 'very patient' : 'even-tempered');
  out.push(t.thrift > 0.65 ? 'careful with money' : t.thrift < 0.35 ? 'a spender' : 'sensible with money');
  return out;
}

export interface Persona {
  name: string; first: string; age: number; gender: string;
  job: string; workplace: string | null; home: string;
  personality: string[]; mood: string; money: string;
  relationToYou: string; relationScore: number;
  family: string; health: string;
  doing: string; recent: string[];
  time: string; weather: string;
}

export function personaOf(state: GameState, id: Id, viewerId: Id = state.playerId): Persona {
  const p = state.people[id];
  const c = p.contractId ? state.contracts[p.contractId] : null;
  const b = c ? state.businesses[c.businessId] : null;
  const bal = state.ledger.accounts[p.accountId]?.balance ?? 0;
  const lease = activeLease(state, p.id);
  const rel = p.relations[viewerId] ?? 0;
  const partner = p.partnerId ? state.people[p.partnerId] : null;
  const kids = p.children ?? [];
  const familyBits: string[] = [];
  if (partner) familyBits.push(`${p.relationship === 'married' ? 'married to' : 'seeing'} ${partner.name}`);
  else if (p.relationship === 'divorced') familyBits.push('divorced');
  else if (p.relationship === 'widowed') familyBits.push('widowed');
  else familyBits.push('single');
  if (kids.length) familyBits.push(`${kids.length === 1 ? 'one child' : `${kids.length} children`} (${kids.map((k) => `${k.name}, ${Math.max(0, Math.floor((state.minute - k.born) / (28 * 1440)))}`).join('; ')})`);
  const goal = p.npc?.goal ?? 'idle_home';
  const doing = p.action?.type === 'talk' ? 'chatting' : goal === 'work' || goal === 'go_work' ? `on the way to or at work${b ? ` at ${b.name}` : ''}` : goal === 'shop' ? 'out doing the food shopping' : goal === 'leisure' ? 'out and about, enjoying some free time' : goal === 'go_home' ? 'heading home' : 'at a loose end';
  const h = p.needs;
  const mood = h.mood > 75 ? 'in a great mood' : h.mood > 50 ? 'in a decent mood' : h.mood > 30 ? 'a bit fed up' : 'having a really rough time';
  const tired = h.energy < 30 ? ', and very tired' : '';
  const hungry = h.satiety < 25 ? ', and hungry' : '';
  return {
    name: p.name, first: p.name.split(' ')[0], age: ageOf(p), gender: (p.appearance.frame ?? 'm') === 'f' ? 'woman' : 'man',
    job: c && b ? `${c.title} at ${b.name}` : 'out of work at the moment', workplace: b?.name ?? null,
    home: lease ? lease.label : p.homeId ?? 'no fixed home',
    personality: traitWords(p), mood: mood + tired + hungry,
    money: bal > 300000 ? 'comfortably off' : bal > 80000 ? 'getting by' : bal > 20000 ? 'counting every penny' : 'skint',
    relationToYou: relationLabel(rel).toLowerCase(), relationScore: Math.round(rel),
    family: familyBits.join(', '),
    health: (p.health ?? 100) < 50 ? 'unwell / injured' : (p.health ?? 100) < 80 ? 'a bit under the weather' : 'healthy',
    doing,
    recent: p.history.slice(-5).map((e) => e.text),
    time: `${DAYS[dayIndex(state.minute) % 7]} ${fmtClock(state.minute)}`,
    weather: weatherLabel(state),
  };
}

/** the effect of an exchange on how both of you feel */
export function applyAttitude(state: GameState, id: Id, attitude: number) {
  const p = state.people[id], you = state.people[state.playerId];
  const a = clamp(Math.round(attitude), -3, 3);
  const before = p.relations[you.id] ?? 0;
  p.relations[you.id] = clamp(before + a * 2, 0, 100);
  you.relations[p.id] = clamp((you.relations[p.id] ?? 0) + a * 2, 0, 100);
  (you.lastSeen ??= {})[p.id] = state.minute;
  p.needs.mood = clamp(p.needs.mood + a, 0, 100);
  you.needs.mood = clamp(you.needs.mood + (a > 0 ? 1 : a < 0 ? -1 : 0), 0, 100);
  if (before < FRIEND_AT && p.relations[you.id] >= FRIEND_AT) news(state, 'good', `${p.name} is now a friend`, 'Invite them for a coffee at Tidewater Cafe to keep in touch.', true);
  if (a <= -3 && p.traits.patience < 0.3) p.grudge = (p.grudge ?? 0) + 1;
}

export const fmtWealth = (n: number) => fmtMoney(n);
void hourOfDay;
