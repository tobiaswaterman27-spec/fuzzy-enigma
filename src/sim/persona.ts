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
  const kids = (p.childrenIds ?? []).map((k) => state.people[k]).filter(Boolean) as Person[];
  const familyBits: string[] = [];
  if (partner) familyBits.push(`${p.relationship === 'married' ? 'married to' : 'seeing'} ${partner.name}`);
  else if (p.relationship === 'divorced') familyBits.push('divorced');
  else if (p.relationship === 'widowed') familyBits.push('widowed');
  else familyBits.push('single');
  if (kids.length) familyBits.push(`${kids.length === 1 ? 'one child' : `${kids.length} children`} (${kids.map((k) => `${k.name.split(' ')[0]}, ${ageOf(k)}`).join('; ')})`);
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

/** the brief given to a language model to play this person */
export function personaPrompt(state: GameState, id: Id): string {
  const q = personaOf(state, id);
  const you = state.people[state.playerId];
  const yc = you.contractId ? state.contracts[you.contractId] : null;
  return [
    `You are ${q.name}, a ${q.age}-year-old ${q.gender} living in Harbourside, a small British harbour town. Stay in character and speak naturally, in British English, in one to three short sentences.`,
    `Your job: ${q.job}. You live at ${q.home}. Money: you are ${q.money}. Family: ${q.family}. Health: ${q.health}.`,
    `Personality: ${q.personality.join('; ')}. Right now you are ${q.mood}, ${q.doing}. It is ${q.time}; weather: ${q.weather}.`,
    q.recent.length ? `Recent events in your life: ${q.recent.join('; ')}.` : '',
    `You are talking to ${you.name}, who ${yc ? `works as ${yc.title} at ${state.businesses[yc.businessId]?.name}` : 'is looking for work'}. To you they are ${q.relationToYou} (closeness ${q.relationScore}/100). Be warmer the closer you are; be cool or curt if they are rude.`,
    'Town: Corner Market (grocer), Harbour Wholesale (warehouse and depot), Tidewater Cafe, Harbour Home (furniture), the Job Centre, Marlow Court flats, the park (Saturday market), new houses going up on Harbour Road.',
    'Reply ONLY as JSON: {"reply": "<what you say>", "attitude": <integer -3 to 3: how this exchange changed how you feel about them>}.',
  ].filter(Boolean).join('\n');
}

export type Topic = 'hello' | 'work' | 'life' | 'gossip' | 'advice' | 'compliment' | 'joke' | 'insult' | 'flirt' | 'bye';

/** a reply without a language model, from what this person knows and how they feel */
export function scriptedReply(state: GameState, id: Id, topic: Topic): { reply: string; attitude: number } {
  const q = personaOf(state, id);
  const p = state.people[id];
  const warm = q.relationScore >= FRIEND_AT;
  const pick = <T,>(xs: T[]) => xs[(Math.floor(state.minute) + id.length) % xs.length];
  const others = Object.values(state.people).filter((o) => o.id !== id && !o.isPlayer && !o.npc?.ambient && o.history.length);
  switch (topic) {
    case 'hello':
      return { reply: warm ? pick([`${state.people[state.playerId].name.split(' ')[0]}! Good to see you.`, 'Hey you! How are things?']) : pick(['Hello there.', 'Alright?', `Morning. I'm ${q.first}, by the way.`]), attitude: 1 };
    case 'work':
      if (!p.contractId) return { reply: pick(["I'm between jobs. The Job Centre board's worth a look most mornings.", "Still looking for work, if I'm honest. It gets you down."]), attitude: 1 };
      return { reply: pick([`I'm ${q.job}. ${p.traits.conscientiousness > 0.6 ? 'Busy, but I like keeping on top of it.' : "It pays the rent, that's about all I'll say."}`, `Work's ${p.needs.energy < 40 ? 'wearing me out' : 'alright'}. ${q.workplace} always needs a hand.`]), attitude: 1 };
    case 'life':
      return { reply: `${q.mood[0].toUpperCase()}${q.mood.slice(1)}, honestly. ${q.recent.length ? `${q.recent[q.recent.length - 1]}, you know.` : 'Not much happens to me.'} ${q.family.startsWith('single') ? '' : `Family's ${q.family}.`}`.trim(), attitude: 2 };
    case 'gossip': {
      const o = others.length ? pick(others) : null;
      return { reply: o ? `Did you hear? ${o.name.split(' ')[0]}... ${o.history[o.history.length - 1].text.toLowerCase()}.` : 'Nothing much to tell. Quiet town, this.', attitude: warm ? 2 : 0 };
    }
    case 'advice':
      return { reply: pick(['Keep your rent covered before anything else. Mondays come round fast.', 'Courses at the Job Centre are worth it. A forklift licence pays more at the warehouse.', 'If you want to get on, own something. Rent pays somebody else.', 'Turn up on time and they remember it.']), attitude: 1 };
    case 'compliment':
      return { reply: p.traits.sociability > 0.5 ? pick(["Aw, that's kind of you.", 'Ha, flattery will get you everywhere.']) : pick(['Oh. Er, thanks.', "That's... nice of you."]), attitude: 2 };
    case 'joke':
      return { reply: p.traits.patience > 0.5 || warm ? pick(['Ha! Good one.', "Stop, you'll set me off."]) : 'Hm. Right.', attitude: p.traits.sociability > 0.4 ? 2 : 0 };
    case 'flirt': {
      const taken = !!p.partnerId;
      if (taken) return { reply: `Ha, I'm ${p.relationship === 'married' ? 'married' : 'seeing someone'}, love. But thanks.`, attitude: -1 };
      if (q.relationScore >= 45) return { reply: pick(['Is that so? Maybe you should take me for a drink sometime.', "You're not so bad yourself."]), attitude: 3 };
      return { reply: pick(["We've only just met!", 'Steady on.']), attitude: -1 };
    }
    case 'insult':
      return { reply: p.traits.patience < 0.4 ? pick(['Say that again and see what happens.', 'Who do you think you are?']) : pick(["Wow. Okay. I'll leave you to it.", "That's out of order."]), attitude: -3 };
    case 'bye':
      return { reply: warm ? 'See you soon, yeah?' : 'Bye then.', attitude: 0 };
  }
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

/** a greeting worth starting with, when someone stops you in the street */
export function openingLine(state: GameState, id: Id): string {
  const q = personaOf(state, id);
  const warm = q.relationScore >= FRIEND_AT;
  if (warm) return `Hey! Got a minute?`;
  if (q.relationScore > 0) return `Oh, hello again. How's it going?`;
  return `Hi, you're new round here, aren't you? I'm ${q.first}.`;
}

export const fmtWealth = (n: number) => fmtMoney(n);
void hourOfDay;
