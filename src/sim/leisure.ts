// Everyday life beyond work: dogs (townspeople walk theirs; adopt your own), fitness and jogging,
// scratchcards and the Saturday lottery at Corner Market, and 999 calls from your phone.
import type { GameState, Id, Person } from './types';
import { clamp, dist, fmtMoney, rand, randInt } from './core';
import { lifeEvent, news } from './events';
import { dayIndex, minuteOfDay, at } from './clock';
import { transfer } from './ledger';
import { FISH_SPOTS, getWorld } from './world/layout';
import { openAttendance } from './employment';
import { crime } from './health';
import { temperature } from './weather';

// ------------------------------------------------------------ dogs
export interface Dog { name: string; color: string; size: number; since: number; walkedDay?: number; happy: number; nextFood?: number; born?: number }
export const DOG_NAMES = ['Biscuit', 'Bonnie', 'Max', 'Poppy', 'Alfie', 'Bella', 'Rolo', 'Teddy', 'Luna', 'Scout', 'Pickle', 'Murphy'];
export const DOG_COATS = ['#c8a06a', '#3b2a1e', '#f0e6d6', '#8a5a2b', '#1c1c1c', '#b9b2a6', '#d9b98a'];
export const ADOPTION_FEE = 12000;
export const DOG_FOOD_WEEK = 1200;

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h; };

/** about a third of households have a dog (fixed per person) */
export function initDogs(state: GameState) {
  if (state.dogsInit) return;
  state.dogsInit = true;
  for (const p of Object.values(state.people)) {
    if (p.isPlayer || !p.npc || p.npc.ambient || p.police || !p.homeId?.startsWith('house_')) continue;
    const h = hash(p.id + 'dog');
    if (h % 3 !== 0) continue;
    if (p.partnerId && state.people[p.partnerId]?.dog) continue;
    p.dog = { name: DOG_NAMES[h % DOG_NAMES.length], color: DOG_COATS[(h >> 4) % DOG_COATS.length], size: 0.75 + ((h >> 8) % 50) / 100, since: state.minute, happy: 80 };
  }
}

export function adoptDog(state: GameState, personId: Id, name: string): { ok: boolean; msg: string } {
  const p = state.people[personId];
  if (p.dog) return { ok: false, msg: `You already have ${p.dog.name}.` };
  const r = transfer(state, { from: p.accountId, to: state.externalId, amount: ADOPTION_FEE, reason: 'purchase', memo: 'Harbourside Dog Rescue adoption fee', key: `adopt:${Math.floor(state.minute)}` });
  if (!r.ok) return { ok: false, msg: `The adoption fee is ${fmtMoney(ADOPTION_FEE)}.` };
  const h = hash(name + state.minute);
  p.dog = { name: name.trim().slice(0, 16) || DOG_NAMES[h % DOG_NAMES.length], color: DOG_COATS[h % DOG_COATS.length], size: 0.8 + (h % 40) / 100, since: state.minute, happy: 75, nextFood: state.minute + 7 * 1440 };
  lifeEvent(state, p, `Adopted ${p.dog.name} from the rescue`);
  news(state, 'good', `${p.dog.name} is yours`, `Walk them every day (be out and about together for half an hour). Food is ${fmtMoney(DOG_FOOD_WEEK)} a week.`, true);
  return { ok: true, msg: `${p.dog.name} wags their tail. Welcome home.` };
}

/** every minute: your dog notices whether it is out with you; food is bought weekly */
export function dogTick(state: GameState) {
  const me = state.people[state.playerId];
  const d = me.dog;
  if (!d) return;
  const day = dayIndex(state.minute);
  if (me.visible && me.where !== 'vehicle' && !me.homeId?.startsWith(me.where) && me.where !== me.homeId) {
    d.walkedDay = d.walkedDay === day ? day : d.walkedDay;
    (d as any).outMins = ((d as any).outDay === day ? (d as any).outMins ?? 0 : 0) + 1;
    (d as any).outDay = day;
    if ((d as any).outMins === 30) { d.walkedDay = day; d.happy = clamp(d.happy + 15, 0, 100); me.needs.mood = clamp(me.needs.mood + 4, 0, 100); }
  }
  if (minuteOfDay(state.minute) === 23 * 60 && d.walkedDay !== day) {
    d.happy = clamp(d.happy - 12, 0, 100);
    if (d.happy < 30) news(state, 'bad', `${d.name} is fed up`, 'They have not had a proper walk. Take them out for half an hour.', true);
  }
  if (d.nextFood !== undefined && state.minute >= d.nextFood) {
    const r = transfer(state, { from: me.accountId, to: state.externalId, amount: DOG_FOOD_WEEK, reason: 'purchase', memo: `Dog food for ${d.name}`, key: `dogfood:${d.nextFood}` });
    d.nextFood += r.ok ? 7 * 1440 : 1440;
    if (!r.ok) { d.happy = clamp(d.happy - 20, 0, 100); news(state, 'bad', `No food for ${d.name}`, `You could not pay ${fmtMoney(DOG_FOOD_WEEK)} for dog food.`, true); }
  }
  if (d.happy >= 60) me.needs.mood = clamp(me.needs.mood + 0.003, 0, 100);
}

// ------------------------------------------------------------ fitness and jogging
/** the player covered `metres` at a run */
export function trainRun(p: Person, metres: number) {
  p.fitness = clamp((p.fitness ?? 40) + metres / 1000 * 1.2, 0, 100);
}
/** how fitness changes you: running speed, punches, tiring */
export const fitnessFactor = (p: Person) => 0.85 + (p.fitness ?? 40) / 330;

/** early mornings: the fitter townspeople go for a jog round the park */
export function joggersTick(state: GameState) {
  const mod = minuteOfDay(state.minute);
  if (mod < 6 * 60 + 20 || mod > 8 * 60 + 30 || Math.floor(state.minute) % 5 !== 0) return;
  const day = dayIndex(state.minute);
  const w = getWorld().nodes;
  const loop = ['pk_gate', 'pk_a', 'pk_c', 'pk_b', 'pk_gate', 'pk_a', 'pk_c', 'pk_b', 'pk_gate'].map((id) => w[id]).filter(Boolean);
  if (loop.length < 5) return;
  for (const p of Object.values(state.people)) {
    const n = p.npc;
    if (!n || p.isPlayer || n.ambient || p.police || p.dead || p.away || p.sleeping || p.action || p.move || n.goal !== 'idle_home') continue;
    if ((n as any).jogDay === day || openAttendance(state, p.id)) continue;
    const keen = (hash(p.id + 'jog') % 100) / 100;
    if (keen < 0.6 || (p.age ?? 40) > 62 || rand(state) > 0.15) continue;
    (n as any).jogDay = day;
    p.jogging = state.minute + 45;
    p.fitness = clamp((p.fitness ?? 50) + 0.5, 0, 100);
    n.goal = 'leisure';
    n.plan = [...loop.map((x) => ({ kind: 'move' as const, to: { x: x.x, z: x.z }, label: 'jog' })), { kind: 'call' as const, fn: 'goHomeNow' }];
    n.nextDecision = state.minute + 45;
    return;
  }
}

// ------------------------------------------------------------ scratchcards and the lottery
export const SCRATCH_PRICE = 200;
export const LOTTO_PRICE = 200;
export function scratchcard(state: GameState, personId: Id): { ok: boolean; msg: string } {
  const p = state.people[personId];
  const r = transfer(state, { from: p.accountId, to: state.externalId, amount: SCRATCH_PRICE, reason: 'purchase', memo: 'Scratchcard', key: `scratch:${state.minute}:${p.id}` });
  if (!r.ok) return { ok: false, msg: 'Not enough money.' };
  const x = rand(state);
  const win = x < 0.0002 ? 1000000 : x < 0.005 ? 10000 : x < 0.05 ? 1000 : x < 0.25 ? 200 : 0;
  if (win) {
    transfer(state, { from: state.externalId, to: p.accountId, amount: win, reason: 'transfer', memo: 'Scratchcard win', key: `scratchwin:${state.minute}:${p.id}` });
    if (win >= 10000) { lifeEvent(state, p, `Won ${fmtMoney(win)} on a scratchcard`); news(state, 'good', `Scratchcard win: ${fmtMoney(win)}!`, win >= 1000000 ? 'Life-changing money.' : 'Not bad for two quid.', true); }
  }
  return { ok: true, msg: win ? `You scratch it off... ${fmtMoney(win)}!` : 'You scratch it off... nothing. Better luck next time.' };
}

export function buyLotto(state: GameState, personId: Id): { ok: boolean; msg: string } {
  const p = state.people[personId];
  const draw = nextDraw(state.minute);
  if ((state.lotto ?? []).some((t) => t.draw === draw && t.owner === personId)) return { ok: false, msg: 'You already have a ticket for Saturday.' };
  const r = transfer(state, { from: p.accountId, to: state.externalId, amount: LOTTO_PRICE, reason: 'purchase', memo: 'Lottery ticket', key: `lotto:${draw}:${p.id}` });
  if (!r.ok) return { ok: false, msg: 'Not enough money.' };
  const nums = new Set<number>();
  while (nums.size < 6) nums.add(randInt(state, 1, 49));
  (state.lotto ??= []).push({ owner: personId, draw, numbers: [...nums].sort((a, b) => a - b) });
  return { ok: true, msg: `Lucky dip: ${[...nums].sort((a, b) => a - b).join(' ')}. Draw Saturday 20:00.` };
}

/** Saturday 20:00 */
export function nextDraw(minute: number): number {
  let d = dayIndex(minute);
  while (d % 7 !== 5 || at(d, 20, 0) <= minute) d++;
  return at(d, 20, 0);
}

export function lottoTick(state: GameState) {
  const tickets = state.lotto;
  if (!tickets?.length) return;
  const due = tickets.filter((t) => t.draw <= state.minute && !t.checked);
  if (!due.length) return;
  const draws = new Map<number, number[]>();
  for (const t of due) {
    if (!draws.has(t.draw)) { const n = new Set<number>(); while (n.size < 6) n.add(randInt(state, 1, 49)); draws.set(t.draw, [...n].sort((a, b) => a - b)); }
    const drawn = draws.get(t.draw)!;
    const hits = t.numbers.filter((x) => drawn.includes(x)).length;
    const prize = [0, 0, 0, 3000, 14000, 175000, 200000000][hits];
    t.checked = true;
    const p = state.people[t.owner];
    if (!p) continue;
    if (prize) transfer(state, { from: state.externalId, to: p.accountId, amount: prize, reason: 'transfer', memo: `Lottery: ${hits} numbers`, key: `lottowin:${t.draw}:${t.owner}` });
    if (p.isPlayer) news(state, prize ? 'good' : 'info', prize ? `Lottery: ${hits} numbers! ${fmtMoney(prize)}` : 'Lottery: no luck this week', `Drawn: ${drawn.join(' ')}. Yours: ${t.numbers.join(' ')}.`, true);
    if (prize >= 175000) lifeEvent(state, p, `Won ${fmtMoney(prize)} on the lottery`);
  }
  state.lotto = tickets.filter((t) => !t.checked || state.minute - t.draw < 7 * 1440);
}

// ------------------------------------------------------------ 999
/** an emergency call: an ambulance for whoever is down nearby, the police for whoever is fighting */
export function call999(state: GameState, callerId: Id, service: 'ambulance' | 'police'): string {
  const me = state.people[callerId];
  if (service === 'ambulance') {
    const hurt = Object.values(state.people).filter((p) => p.down != null && !p.dead && !p.away && dist(p.pos, me.pos) < 40);
    if (!hurt.length && (me.health ?? 100) > 60) { me.reputation = clamp(me.reputation - 2, 0, 100); return 'The operator finds no emergency. Hoax calls waste ambulances.'; }
    // arriving sooner: they are seen within a couple of minutes
    for (const p of hurt) p.down = Math.min(p.down!, state.minute - (p.isPlayer ? 1.4 : 7));
    if (!hurt.length) { me.down = state.minute - 1.2; }
    return hurt.length ? `An ambulance is on its way for ${hurt.map((p) => p.name).join(', ')}.` : 'An ambulance is coming for you.';
  }
  const inc = state.incident;
  const fighting = Object.values(state.people).filter((p) => p.combat && dist(p.pos, me.pos) < 40 && !p.isPlayer);
  if (inc && inc.stage === 'fight') { inc.at = Math.min(inc.at, state.minute - 4); return 'Police are on the way to the fight.'; }
  if (fighting.length) { for (const p of fighting) p.combat = null; return 'Police are on the way.'; }
  if (state.wanted) return 'You are put through... and it is you they are looking for. You hang up.';
  crime(state, 'wasting police time', 1);
  return 'There is nothing to report. Wasting police time is an offence.';
}

/** early mornings and evenings: a few townspeople fish off the quay */
export function anglersTick(state: GameState) {
  const mod = minuteOfDay(state.minute);
  if (!((mod > 6 * 60 && mod < 9 * 60) || (mod > 17 * 60 && mod < 20 * 60)) || Math.floor(state.minute) % 7 !== 0) return;
  const day = dayIndex(state.minute);
  const taken = new Set(Object.values(state.people).filter((q) => q.action?.type === 'fish' || (q.npc?.plan ?? []).some((s) => s.kind === 'act' && s.type === 'fish')).map((q) => q.action?.target ?? (q.npc?.plan.find((s) => s.kind === 'act' && s.type === 'fish') as { it?: string } | undefined)?.it));
  if (state.fishing) taken.add(Object.values(state.people).find((q) => q.id === state.fishing!.by)?.action?.target);
  const spot = FISH_SPOTS.find((f) => !taken.has(f.id));
  if (!spot) return;
  for (const p of Object.values(state.people)) {
    const n = p.npc;
    if (!n || p.isPlayer || n.ambient || p.police || p.dead || p.away || p.sleeping || p.action || p.move || n.goal !== 'idle_home') continue;
    if ((n as any).fishDay === day || openAttendance(state, p.id)) continue;
    const keen = (hash(p.id + 'fish') % 100) / 100;
    if (keen < 0.7 || rand(state) > 0.2) continue;
    (n as any).fishDay = day;
    const w = getWorld();
    const it = w.interactables[spot.id];
    n.goal = 'leisure';
    n.plan = [{ kind: 'move', to: it.pos, label: 'the quay' }, { kind: 'act', it: spot.id, type: 'fish' }, { kind: 'call', fn: 'goHomeNow' }];
    n.nextDecision = state.minute + 90;
    return;
  }
}

/** dress for the weather: coats on in winter (and on cold autumn days), off again in spring */
export function seasonalWardrobe(state: GameState) {
  const cold = temperature(state, Math.floor(state.minute / 1440) * 1440 + 13 * 60) < 9;
  for (const p of Object.values(state.people)) {
    if (p.dead || p.left || p.police) continue;
    if (!!p.appearance.coat !== cold) p.appearance.coat = cold || undefined;
  }
}
