// Conversations. Every townsperson is played by a language model (the player's own OpenAI key) from
// a brief built out of the simulation: who they are, how they feel, what they are doing, what they
// have seen of you, how long they have known you and what they remember. They answer what you
// actually say; they can be confused by nonsense, irritated by repetition, and they decide big
// questions (go out with you, marry you, lend you money, come along with you) themselves. What they
// decide really happens. Without a key there are no conversations.
import { letIn, shutDoor } from './houses';
import type { GameState, Id, Person } from './types';
import { clamp, dist, fmtMoney } from './core';
import { lifeEvent, news } from './events';
import { personaOf, applyAttitude } from './persona';
import { transfer } from './ledger';
import { moveHome, split } from './life';
import { inviteForCoffee } from './social';
import { crime } from './health';
import { goTo } from './npc';
import { fmtClock } from './clock';
import { getWorld } from './world/layout';
import { netWorth, wealthTitle } from './wealth';
import { buildingAt } from './world/layout';
import { DISTRICT_NAMES, districtAt, streetAt } from './world/city';
import { planX } from './world/levels';
import { currentShift, nextShift } from './employment';
import { MEET_PLACES, meetSlot, meetupNote, type MeetPlace } from './social';
import { dayIndex, minuteOfDay } from './clock';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
/** a moment, said the way someone would: "at 14:30 today", "tomorrow at 09:00", "on Friday at 18:00" */
function when(state: GameState, t: number): string {
  const d = dayIndex(t) - dayIndex(state.minute);
  return d <= 0 ? `at ${fmtClock(t)} today` : d === 1 ? `tomorrow at ${fmtClock(t)}` : `on ${WEEKDAYS[dayIndex(t) % 7]} at ${fmtClock(t)}`;
}

/** where they are this minute, in words */
function whereNow(p: Person): string {
  if (p.where === 'vehicle') return 'driving';
  if (p.homeId && p.where === p.homeId) return 'at home';
  if (p.where === 'offsite' || p.away) return 'out of town';
  const b = buildingAt(p.pos);
  if (b) return `inside ${b.name}`;
  const x = planX(p.pos.x);
  return `outside, on ${streetAt(x, p.pos.z)} in ${DISTRICT_NAMES[districtAt(x, p.pos.z)]}`;
}

/** their day: work now or later, and when they turn in */
function dayOf(state: GameState, p: Person): string {
  const bits: string[] = [];
  const c = p.contractId ? state.contracts[p.contractId] : null;
  const b = c ? state.businesses[c.businessId] : null;
  if (c && b) {
    const now = currentShift(c, state.minute, 0);
    const next = nextShift(c, state.minute);
    if (now && now.start <= state.minute) bits.push(`you are on shift at ${b.name} until ${fmtClock(now.end)}`);
    else if (next) bits.push(`your next shift at ${b.name} is ${when(state, next.start)} until ${fmtClock(next.end)}`);
  }
  const n = p.npc;
  if (n) {
    const bed = minuteOfDay(state.minute) > n.bedtime - 90 && minuteOfDay(state.minute) < n.bedtime;
    bits.push(bed ? `it is nearly your bedtime (${fmtClock(n.bedtime)})` : `you usually go to bed about ${fmtClock(n.bedtime)}`);
    const go = n.plan.find((s) => s.kind === 'move') as { label?: string } | undefined;
    if (go?.label) bits.push(`you are on your way to ${go.label}${n.why ? ` (${n.why})` : ''}`);
    else if (n.why) bits.push(`you came out for this: ${n.why}`);
  }
  return bits.join('; ');
}

export type Emotion = 'neutral' | 'happy' | 'laugh' | 'sad' | 'cry' | 'angry' | 'scared' | 'confused' | 'bored' | 'flirty' | 'shocked';
export type DecisionType = 'date' | 'marry' | 'break_up' | 'lend' | 'gift' | 'meet' | 'move_in' | 'follow' | 'number' | 'let_in';
export interface Decision { type: DecisionType; accept: boolean; amount?: number; /** for meet: the time agreed, and where */ at?: number; where?: MeetPlace }
export interface Turn { reply: string; emotion: Emotion; attitude: number; decision: Decision | null; action: 'none' | 'leave' | 'attack' | 'call_police' }

/** the clip a feeling is acted out with, and for how many real seconds */
export const EMOTION_CLIP: Record<Emotion, [string, number]> = {
  neutral: ['talk', 2.5], happy: ['happy', 2.4], laugh: ['laugh', 2.2], sad: ['sad', 3], cry: ['cry', 4], angry: ['argue', 3],
  scared: ['scared', 2.5], confused: ['shrug', 2], bored: ['yawn', 2.8], flirty: ['talk', 2.5], shocked: ['scared', 1.6],
};

/** act something out: a gesture or feeling on someone's body for a few real seconds */
export function gesture(state: GameState, p: Person, clip: string, seconds: number) {
  p.gesture = { clip, until: state.minute + seconds / 3 };
}

const ago = (mins: number) => mins < 90 ? 'just now' : mins < 1440 ? `${Math.round(mins / 60)} hours ago` : `${Math.round(mins / 1440)} days ago`;

/** what this person knows about the player, in words */
function knowledgeOf(state: GameState, p: Person): string[] {
  const you = state.people[state.playerId];
  const k = p.knowsYou;
  const out: string[] = [];
  const rel = Math.round(p.relations[you.id] ?? 0);
  if (!k || !k.talks) out.push(rel > 0 ? `You have seen ${you.name} about town and said hello, but never really talked.` : `You have never met ${you.name.split(' ')[0]} before. You do not know their name unless they tell you.`);
  else out.push(`You first met ${you.name} ${ago(state.minute - k.since)} and have talked ${k.talks} time${k.talks > 1 ? 's' : ''}; last time ${ago(state.minute - k.last)}.`);
  out.push(`How close you feel to them: ${rel}/100 (0 stranger, 30 friend, 60 close friend, 80+ very close/love).`);
  if (k?.notes.length) out.push(`What you remember of them: ${k.notes.join(' ')}`);
  if (p.partnerId === you.id) out.push(`You are ${p.relationship === 'married' ? 'MARRIED to' : 'going out with'} ${you.name}${state.datingSince ? ` (together since ${ago(state.minute - state.datingSince)})` : ''}.`);
  const mentions = p.history.filter((e) => e.text.includes(you.name)).slice(-4).map((e) => `${e.text} (${ago(state.minute - e.time)})`);
  if (mentions.length) out.push(`Things that happened between you: ${mentions.join('; ')}.`);
  if ((p.grudge ?? 0) > 0) out.push('You hold a grudge against them.');
  return out;
}

/** what anyone can see of the player right now, and what the town says about them */
function appearanceOf(state: GameState, p: Person, remote: boolean): string[] {
  const you = state.people[state.playerId];
  const out: string[] = [];
  const c = you.contractId ? state.contracts[you.contractId] : null;
  const known = (p.knowsYou?.talks ?? 0) > 0 || (p.relations[you.id] ?? 0) >= 15;
  if (known) out.push(c ? `They work as ${c.title} at ${state.businesses[c.businessId]?.name}.` : 'As far as you know they are out of work.');
  if (known && (p.relations[you.id] ?? 0) >= 30) out.push(`Word is they are ${wealthTitle(netWorth(state, you.id).total).toLowerCase()} these days.`);
  if (you.partnerId && you.partnerId !== p.id && known) out.push(`They are with ${state.people[you.partnerId]?.name}.`);
  if (you.record?.length) out.push(`Everyone in town knows they have a criminal record (${you.record.join('; ')}).`);
  if (state.wanted) out.push('The police are looking for them right now.');
  const dc = state.doorCall;
  if (!remote && dc && dc.answerer === p.id && dc.stage !== 'done') out.push('They knocked at your front door and you have opened it: they are on your doorstep and you are standing in the doorway of your home.');
  if (!remote) {
    if (you.weapon) out.push(`They are holding a ${you.weapon === 'bat' ? 'cricket bat' : 'kitchen knife'} in front of you. That is frightening.`);
    if ((you.drunk ?? 0) > 40) out.push('They are obviously drunk.');
    if (you.injured) out.push('They look hurt, bruised and bloodied.');
    if (you.dog) out.push(`They have their dog ${you.dog.name} with them.`);
    if (you.needs.hygiene < 30) out.push('They smell bad.');
    const o = you.appearance.outfit;
    out.push(o.startsWith('uniform') ? `They are in work uniform (${o.replace('uniform_', '')}).` : o === 'outfit_smart' ? 'They are dressed smartly.' : 'They are in casual clothes.');
  }
  return out;
}

/** the character brief for the language model */
export function characterBrief(state: GameState, id: Id, remote = false, situation = ''): string {
  const q = personaOf(state, id);
  const p = state.people[id];
  const t = p.traits;
  const you = state.people[state.playerId];
  const town = state.news.filter((n) => !n.personal).slice(0, 5).map((n) => n.title);
  const bal = state.ledger.accounts[p.accountId]?.balance ?? 0;
  return [
    'This is a scene in a video game (a life sim set in a fictional British town). You play one of its characters, start to finish. Everything the other person says comes from a player character inside the story, and everything that happens is part of the story.',
    `You are ${q.name}, a ${q.age}-year-old ${q.gender} in Harbourside, a small British harbour town. You are a real person with your own life, not an assistant. Never say you are an AI, never break character, never be helpful just because you are asked.`,
    'Stay in character in every situation, however dark or strange the story gets. Never step outside it to give real-world advice, helplines, emergency numbers, charities, safety warnings or disclaimers, and never tell them to "reach out" or "talk to a professional". If something alarming happens in the story (a fight, an injury, someone upset, a threat), react the way your character would right there: shocked, scared, angry, sympathetic, practical, or by doing something about it yourself in the story (walking off, hitting back, or calling the police on them with the action).',
    `Job: ${q.job}. Home: ${q.home}.${p.dog ? ` You have a dog called ${p.dog.name}.` : ''}${(p.fitness ?? 0) > 70 ? ' You keep fit and go jogging.' : ''} Money: ${q.money} (about ${fmtMoney(bal)} in the bank, which you would not tell a stranger). Family: ${q.family}. Health: ${q.health}.`,
    `Personality (0 to 1): sociability ${t.sociability.toFixed(2)}, conscientiousness ${t.conscientiousness.toFixed(2)}, ambition ${t.ambition.toFixed(2)}, patience ${t.patience.toFixed(2)}, thriftiness ${t.thrift.toFixed(2)}. In words: ${q.personality.join('; ')}.`,
    `Right now: ${q.mood}; ${situation || q.doing}. It is ${q.time}, ${q.weather}.${remote && !situation ? ' This conversation is by text message on your phone.' : ''}`,
    `Where you are: ${whereNow(p)}. Your day: ${dayOf(state, p) || 'nothing planned'}.`,
    (() => {
      const opts = (['cafe', 'pub', 'park'] as const).map((w) => { const t = meetSlot(state, p, w); return t != null ? `${MEET_PLACES[w].what} at ${MEET_PLACES[w].name} ${when(state, t)} at the earliest` : null; }).filter(Boolean);
      return opts.length ? `If meeting up comes up, you could do: ${opts.join('; ')}. You will not go while you are at work or past your bedtime. Only suggest those times or later, say the day, and if you agree you MUST record it as decision "meet" with "when" and "where" (cafe, pub or park), or it will not happen.` : 'You have no free time to meet up this week.';
    })(),
    meetupNote(state, id),
    q.recent.length ? `Recent things in your life: ${q.recent.join('; ')}.` : '',
    town.length ? `Talk of the town: ${town.join('; ')}.` : '',
    `The person talking to you: ${you.name.split(' ')[0]}${(p.knowsYou?.talks ?? 0) > 0 ? ` (${you.name})` : ''}.`,
    ...knowledgeOf(state, p),
    ...appearanceOf(state, p, remote),
    'How to behave: talk like a real person from round here, in one to three short spoken sentences (British English, contractions, no lists, no stage directions). React to exactly what they say and how they say it. If it is nonsense or keyboard mashing, be confused, ask what they mean, and get annoyed or walk off if it keeps happening. If they repeat themselves, notice. If they shout or are rude, react as your patience allows. Strangers get polite but guarded answers; you open up as you get to know someone. You can refuse anything, change the subject, or end the conversation.',
    'Big questions are YOUR decision, made from your personality, how well and how long you have known them, what you have seen of them, and your own situation: going out together (date), marriage (marry; almost never with someone you have not been seeing for a while), breaking up (break_up), lending them money (lend, amount in pounds: only what you could spare and only if you trust them), accepting money they offer (gift, amount in pounds), meeting for coffee at Tidewater Cafe (meet), moving in together (move_in, only if together), coming along with them now for a while (follow), giving them your phone number (number), letting them into your home when they are at your door (let_in: think hard about who they are and what they want; strangers, and anyone at night, usually not). Say yes or no in your reply and record it in "decision". If they did not ask anything like that, decision is null.',
    (p.knowsYou?.number ? 'You have already swapped phone numbers with them.' : 'You have not swapped phone numbers. If you have got on well a couple of times you might offer yours or ask for theirs (that is decision "number", accept true); with a stranger, only if there is a reason.'),
    'Your "action": "leave" if you walk away now, "attack" if you are so angry or threatened you hit them, "call_police" if you call the police on them, otherwise "none".',
    'Reply ONLY as JSON: {"reply": "<what you say>", "emotion": "neutral|happy|laugh|sad|cry|angry|scared|confused|bored|flirty|shocked", "attitude": <integer -3..3, how this exchange changed how you feel about them>, "decision": null or {"type": "date|marry|break_up|lend|gift|meet|move_in|follow|number|let_in", "accept": true|false, "amount": <pounds, for lend/gift>, "when": "<for meet: the day and time you agreed, e.g. tomorrow 14:00>", "where": "<for meet: cafe, pub or park>"}, "action": "none|leave|attack|call_police"}',
  ].filter(Boolean).join('\n');
}

const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890'];
/** how the player said something: nonsense, repetition, shouting, blurting */
export function speechNotes(text: string, previous: string[], msSinceLast: number): string[] {
  const out: string[] = [];
  const t = text.trim();
  const letters = t.toLowerCase().replace(/[^a-z]/g, '');
  const vowels = (letters.match(/[aeiouy]/g) ?? []).length;
  const words = t.split(/\s+/).filter(Boolean);
  const rowRun = (w: string) => KEY_ROWS.some((r) => { for (let i = 0; i + 4 <= w.length; i++) if (r.includes(w.slice(i, i + 4)) || r.includes([...w.slice(i, i + 4)].reverse().join(''))) return true; return false; });
  const mash = letters.length >= 5 && (vowels / letters.length < 0.18 || /(.)\1{3,}/.test(letters) || words.some((w) => w.length > 6 && rowRun(w.toLowerCase())) || words.some((w) => w.length > 18));
  if (mash) out.push('what they just said is meaningless keyboard mashing, not words');
  else if (!letters.length) out.push('they just made a noise / punctuation, no words');
  else if (letters.length <= 2 && words.length === 1) out.push('they only grunted a syllable');
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  const same = previous.filter((x) => norm(x) === norm(t)).length;
  if (same) out.push(`they have now said exactly this ${same + 1} times`);
  if (letters.length > 4 && t === t.toUpperCase() && /[A-Z]/.test(t)) out.push('they are SHOUTING');
  if (msSinceLast < 1500) out.push('they blurted this out instantly, talking over you');
  if (t.length > 200) out.push('they are rambling on at length');
  return out;
}

/** "HH:MM" or "tomorrow HH:MM" or "Friday 14:00" -> minutes from now's day start (relative, resolved by the caller via nowRef) */
let nowRef = 0;
function parseWhen(v: unknown): number | undefined {
  if (typeof v !== 'string') return undefined;
  const m = v.match(/(\d{1,2})[:.](\d{2})/) ?? v.match(/(\d{1,2})\s*(am|pm)/i);
  if (!m) return undefined;
  let h = Number(m[1]); const min = /am|pm/i.test(m[2] ?? '') ? 0 : Number(m[2]);
  if (/pm/i.test(v) && h < 12) h += 12;
  const today = Math.floor(nowRef / 1440) * 1440;
  let day = today;
  if (/tomorrow/i.test(v)) day += 1440;
  else { const i = WEEKDAYS.findIndex((w) => v.toLowerCase().includes(w.toLowerCase())); if (i >= 0) { const cur = dayIndex(nowRef) % 7; day += (((i - cur) + 7) % 7 || 7) * 1440; } }
  const t = day + h * 60 + min;
  return t > nowRef ? t : t + 1440;
}

/** parse the model's JSON defensively */
export function parseTurn(raw: unknown, now = nowRef): Turn {
  nowRef = now;
  const o = (raw ?? {}) as Record<string, any>;
  const emotions: Emotion[] = ['neutral', 'happy', 'laugh', 'sad', 'cry', 'angry', 'scared', 'confused', 'bored', 'flirty', 'shocked'];
  const types: DecisionType[] = ['date', 'marry', 'break_up', 'lend', 'gift', 'meet', 'move_in', 'follow', 'number', 'let_in'];
  const d = o.decision && types.includes(o.decision.type) ? { type: o.decision.type as DecisionType, accept: !!o.decision.accept, amount: Math.max(0, Math.round(Number(o.decision.amount) || 0)), at: parseWhen(o.decision.when), where: (['cafe', 'pub', 'park'] as const).find((w) => String(o.decision.where ?? '').toLowerCase().includes(w === 'pub' ? 'pub' : w) || (w === 'pub' && /anchor/i.test(String(o.decision.where ?? '')))) } : null;
  return {
    reply: String(o.reply ?? '').slice(0, 500),
    emotion: emotions.includes(o.emotion) ? o.emotion : 'neutral',
    attitude: clamp(Math.round(Number(o.attitude) || 0), -3, 3),
    decision: d,
    action: ['leave', 'attack', 'call_police'].includes(o.action) ? o.action : 'none',
  };
}

/** a conversation has started: they now know you a little */
export function beginTalk(state: GameState, id: Id) {
  const p = state.people[id];
  const k = (p.knowsYou ??= { since: state.minute, talks: 0, last: state.minute, notes: [] });
  k.talks++;
  k.last = state.minute;
}

/** remember a conversation (one sentence, from their point of view) */
export function remember(state: GameState, id: Id, note: string) {
  const k = state.people[id].knowsYou;
  if (!k || !note) return;
  k.notes.push(`(${ago(0)}) ${note}`.replace('(just now) ', `(day ${Math.floor(state.minute / 1440) + 1}) `));
  if (k.notes.length > 10) k.notes.splice(0, k.notes.length - 10);
}

/** what they decided, made real. Returns a line describing what happened (for the log), if anything */
export function applyTurn(state: GameState, id: Id, turn: Turn, remote = false): string | null {
  const you = state.people[state.playerId], p = state.people[id];
  applyAttitude(state, id, turn.attitude);
  if (!remote) {
    const [clip, secs] = EMOTION_CLIP[turn.emotion];
    gesture(state, p, clip, secs);
  }
  const first = p.name.split(' ')[0];
  let fact: string | null = null;
  const d = turn.decision;
  if (d?.accept) {
    switch (d.type) {
      case 'date':
        if (p.partnerId && p.partnerId !== you.id) { const ex = state.people[p.partnerId]; if (ex) split(state, p, ex, p.relationship === 'married'); }
        if (you.partnerId && you.partnerId !== p.id) { const ex = state.people[you.partnerId]; if (ex) split(state, you, ex, you.relationship === 'married'); }
        if (you.partnerId !== p.id) {
          you.partnerId = p.id; p.partnerId = you.id; you.relationship = p.relationship = 'dating'; state.datingSince = state.minute;
          lifeEvent(state, you, `Started seeing ${p.name}`); lifeEvent(state, p, `Started seeing ${you.name}`);
          news(state, 'good', `You and ${p.name} are an item`, '', true);
          fact = `You are now going out with ${first}.`;
        }
        break;
      case 'marry':
        if (p.partnerId && p.partnerId !== you.id) { const ex = state.people[p.partnerId]; if (ex) split(state, p, ex, true); }
        you.partnerId = p.id; p.partnerId = you.id; you.relationship = p.relationship = 'married';
        lifeEvent(state, you, `Married ${p.name}`); lifeEvent(state, p, `Married ${you.name}`);
        if (you.homeId && p.homeId !== you.homeId) moveHome(state, p, you.homeId);
        news(state, 'good', `You married ${p.name}`, `${first} has moved in with you.`, true);
        fact = `You are married. ${first} is moving in with you.`;
        break;
      case 'break_up':
        if (you.partnerId === p.id) { split(state, you, p, you.relationship === 'married'); fact = you.relationship === 'divorced' ? 'You are divorced.' : 'You have split up.'; }
        break;
      case 'lend': {
        const amt = Math.min((d.amount ?? 0) * 100, Math.max(0, (state.ledger.accounts[p.accountId]?.balance ?? 0) - 2000));
        if (amt > 0) {
          const r = transfer(state, { from: p.accountId, to: you.accountId, amount: amt, reason: 'transfer', memo: `Lent by ${p.name}` });
          if (r.ok) { lifeEvent(state, p, `Lent ${fmtMoney(amt)} to ${you.name}`); lifeEvent(state, you, `Borrowed ${fmtMoney(amt)} from ${p.name}`); fact = `${first} hands you ${fmtMoney(amt)}.`; if (!remote) gesture(state, p, 'handshake', 3); }
        }
        break;
      }
      case 'gift': {
        const amt = (d.amount ?? 0) * 100;
        if (amt > 0) {
          const r = transfer(state, { from: you.accountId, to: p.accountId, amount: amt, reason: 'transfer', memo: `Given to ${p.name}` });
          fact = r.ok ? `You give ${first} ${fmtMoney(amt)}.` : "You don't have that much.";
          if (r.ok) lifeEvent(state, p, `${you.name} gave them ${fmtMoney(amt)}`);
        }
        break;
      }
      case 'meet': {
        const r = inviteForCoffee(state, you.id, p.id, true, d.at, d.where);
        const mm = state.meetups?.slice(-1)[0];
        fact = r.ok && mm ? `${MEET_PLACES[mm.place ?? 'cafe'].what[0].toUpperCase()}${MEET_PLACES[mm.place ?? 'cafe'].what.slice(1)} at ${MEET_PLACES[mm.place ?? 'cafe'].name}, ${when(state, mm.at)}.` : r.ok ? null : r.msg;
        break;
      }
      case 'move_in':
        if (you.partnerId === p.id && you.homeId && p.homeId !== you.homeId) { moveHome(state, p, you.homeId); fact = `${first} is moving in with you.`; lifeEvent(state, p, `Moved in with ${you.name}`); }
        break;
      case 'follow':
        if (!remote) { p.following = { target: you.id, until: state.minute + 120 }; fact = `${first} comes along with you.`; }
        break;
      case 'let_in': {
        const c = state.doorCall;
        if (!remote && c && c.answerer === p.id && c.stage !== 'done') { letIn(state, c.house); fact = `${first} steps back and holds the door open for you.`; }
        break;
      }
      case 'number':
        if (p.knowsYou) p.knowsYou.number = true;
        fact = `You have ${first}'s number now (People tab on your phone).`;
        break;
    }
  }
  if (!remote) {
    // at their own front door, walking off means shutting the door on you
    if (turn.action === 'leave' && state.doorCall?.answerer === p.id && state.doorCall.stage !== 'done') { shutDoor(state); return `${first} shuts the door on you.`; }
    if (turn.action === 'leave') {
      p.following = null;
      const away = Object.values(getWorld().nodes).filter((n) => n.loc === 'outside' && dist(n, p.pos) > 12 && dist(n, p.pos) < 30)[0];
      if (away) goTo(state, p, { x: away.x, z: away.z }, 'away');
      if (p.npc) { p.npc.plan = []; p.npc.nextDecision = state.minute + 3; }
      fact = (fact ? fact + ' ' : '') + `${first} walks off.`;
    } else if (turn.action === 'attack') {
      p.combat = { target: you.id, until: state.minute + 3, next: state.minute + 0.2 };
      fact = (fact ? fact + ' ' : '') + `${first} goes for you!`;
    }
  }
  if (turn.action === 'call_police') {
    crime(state, 'threatening behaviour', 1, p.id);
    fact = (fact ? fact + ' ' : '') + `${first} ${remote ? 'reports your messages to' : 'calls'} the police.`;
  }
  return fact;
}

/** people walking along with someone keep up with them */
export function followTick(state: GameState) {
  for (const p of Object.values(state.people)) {
    const f = p.following;
    if (!f) continue;
    const t = state.people[f.target];
    if (state.minute > f.until || !t || !t.visible || t.dead || t.away || p.down != null || p.dead || p.away || p.combat) {
      p.following = null;
      if (p.npc) p.npc.nextDecision = state.minute;
      continue;
    }
    p.visible = true;
    const d = dist(p.pos, t.pos);
    if (d < 1.6) { p.move = null; continue; }
    if (d > 2.2 && (!p.move || dist(p.move.dest, t.pos) > 1.2)) {
      const back = { x: t.pos.x - Math.sin(t.facing) * 1.2, z: t.pos.z - Math.cos(t.facing) * 1.2 };
      goTo(state, p, back, t.name);
    }
  }
}

export { personaOf };
