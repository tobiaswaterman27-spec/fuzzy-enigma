// HMP Harbourside. A prison sentence is served inside, where you can see it: a cell with a bunk, the
// wing with the other prisoners, meals at the canteen hatch at set times, the weights corner, and the
// laundry, where a shift of work takes time off your sentence. Lie on your bunk to let the days go by.
// Or try the loose vent cover on the side wall: at night, with the officers looking the other way, it
// leads out; caught, you lose a few teeth and gain a few days.
import type { GameState, Id, Person, Vec2 } from './types';
import { clamp, fmtMoney, rand, randInt } from './core';
import { fmtClock, minuteOfDay } from './clock';
import { lifeEvent, news } from './events';
import { transfer } from './ledger';
import { ambientName, makePerson } from './newgame';
import { goTo } from './npc';
import { getWorld } from './world/layout';
import { planVenues, type Venue } from './world/venues';
import { planX } from './world/levels';

export const prisonVenue = (): Venue | null => planVenues(getWorld().city).find((v) => v.kind === 'prison') ?? null;
const spotOf = (v: Venue, s: string) => v.spots.find((x) => x.id === `${v.id}_${s}`) ?? null;
export const inPrison = (p: Person) => p.away?.place === 'prison' && p.visible;

const MEALS: [number, number, string][] = [[7 * 60 + 30, 8 * 60 + 30, 'breakfast'], [12 * 60, 13 * 60, 'lunch'], [17 * 60, 18 * 60, 'tea']];
export function mealNow(minute: number): string | null {
  const m = minuteOfDay(minute);
  return MEALS.find(([a, b]) => m >= a && m < b)?.[2] ?? null;
}
export function nextMeal(minute: number): string {
  const m = minuteOfDay(minute);
  const n = MEALS.find(([a]) => a > m) ?? MEALS[0];
  return `${n[2]} at ${fmtClock(n[0])}`;
}

/** taken through the gate: prison clothes, your cell, the door shut behind you */
export function lockUp(state: GameState, p: Person) {
  const v = prisonVenue();
  const bunk = v && spotOf(v, 'bunk');
  if (!v || !bunk || !p.away) return;
  p.visible = true; p.where = v.id; p.pos = { ...bunk.pos }; p.facing = bunk.facing;
  if (p.appearance.outfit !== 'outfit_prison') { p.ownOutfit = p.appearance.outfit; p.appearance.outfit = 'outfit_prison'; }
  state.serving = false;
}

/** back out of the gate in your own clothes */
export function releaseFromPrison(state: GameState, p: Person) {
  const v = prisonVenue();
  if (p.ownOutfit) { p.appearance.outfit = p.ownOutfit; delete p.ownOutfit; }
  state.serving = false;
  if (v) { p.pos = { ...v.outside }; p.where = 'outside'; p.visible = true; }
}

export function prisonMeal(state: GameState, personId: Id): string {
  const p = state.people[personId];
  const meal = mealNow(state.minute);
  if (!meal) return `The hatch is shut. Next: ${nextMeal(state.minute)}.`;
  p.needs.satiety = clamp(p.needs.satiety + 50, 0, 100);
  p.needs.mood = clamp(p.needs.mood + 2, 0, 100);
  return ['Grey stew and a slice of bread.', 'Something beige, with chips.', 'Porridge. Of course it is porridge.'][randInt(state, 0, 2)];
}

/** a shift in the laundry: a little pay, and good behaviour knocks time off */
export function laundryShift(state: GameState, personId: Id): string {
  const p = state.people[personId];
  if (!p.away || p.away.place !== 'prison') return '';
  const off = 240;
  p.away.until = Math.max(state.minute + 30, p.away.until - off);
  transfer(state, { from: state.externalId, to: p.accountId, amount: 500, reason: 'wage', memo: 'Prison laundry', key: `laundry:${Math.floor(state.minute)}` });
  p.needs.energy = clamp(p.needs.energy - 10, 0, 100);
  return `An hour folding sheets: ${fmtMoney(500)}, and four hours off your sentence for good behaviour. Out ${fmtClock(p.away.until)}.`;
}

/** through the vent: best at night, when the officers are not on the wing */
export function tryEscape(state: GameState, personId: Id): string {
  const p = state.people[personId];
  const v = prisonVenue();
  if (!v || !p.away || p.away.place !== 'prison') return '';
  const m = minuteOfDay(state.minute);
  const night = m >= 22 * 60 || m < 5 * 60;
  const guard = Object.values(state.people).find((o) => o.id.startsWith('guard_') && o.visible && Math.hypot(o.pos.x - p.pos.x, o.pos.z - p.pos.z) < 9);
  const chance = (night ? 0.55 : 0.15) * (guard ? 0.3 : 1);
  if (rand(state) < chance) {
    p.away = null;
    releaseFromPrison(state, p);
    // out through the duct to the yard wall, over, and down on the far side
    const vent = spotOf(v, 'vent');
    if (vent) p.pos = { x: vent.obj.x + (vent.obj.x < (v.rect.x0 + v.rect.x1) / 2 ? -2 : 2), z: vent.obj.z };
    lifeEvent(state, p, 'Escaped from HMP Harbourside');
    state.wanted = { level: 5, unseen: 0, crime: 'escaping from prison' };
    news(state, 'bad', 'Prisoner escapes from HMP Harbourside', 'Police are searching the city. Do not approach.', true);
    return 'You squeeze through the duct, drop into the yard and get over the wall. RUN.';
  }
  p.away.until += 2 * 1440;
  p.health = Math.max(20, (p.health ?? 100) - 15);
  const bunk = spotOf(v, 'bunk');
  if (bunk) p.pos = { ...bunk.pos };
  news(state, 'bad', 'Caught at the vent', 'The officers drag you back to your cell. Two days added to your sentence.', true);
  return '"Going somewhere?" An officer has you by the collar. Two days added.';
}

/** every minute: the wing (other prisoners, the officer on the landing), and keeping you inside */
export function prisonTick(state: GameState) {
  const me = state.people[state.playerId];
  const v = prisonVenue();
  if (!v) return;
  const here = me && inPrison(me);
  if (here) {
    // the walls hold you
    const x = planX(me.pos.x);
    if (x < v.rect.x0 || x > v.rect.x1 || me.pos.z < v.rect.z0 || me.pos.z > v.rect.z1) { const b = spotOf(v, 'bunk'); if (b) me.pos = { ...b.pos }; }
    // a fight on the wing: no stars on the street, but days on your sentence
    if (state.wanted) {
      state.wanted = null;
      me.away!.until += 1440;
      news(state, 'bad', 'Fighting on the wing', 'A day added to your sentence.', true);
    }
    // doing your time on the bunk: meals come round, you are fed and rested
    if (state.serving) { me.needs.satiety = Math.max(me.needs.satiety, 55); me.needs.energy = Math.max(me.needs.energy, 60); me.needs.hygiene = Math.max(me.needs.hygiene, 50); }
  }
  // the other prisoners and an officer on the wing, while you are there to see them
  const want = here ? 6 : 0;
  for (let i = 0; i < 7; i++) {
    const guard = i === 6;
    const id = guard ? 'guard_1' : `inmate_${i}`;
    let o = state.people[id];
    if (!o && !here) continue;
    if (!o) {
      o = makePerson(state, id, ambientName(state), { homeId: null, cash: 0 });
      o.npc!.ambient = true; o.fixedJob = 'prison'; o.age = 19 + randInt(state, 0, 45);
      o.appearance.outfit = guard ? 'uniform_police' : 'outfit_prison';
      o.visible = false; o.where = 'offsite';
    }
    if (o.dead || o.away || o.down != null || o.combat) continue;
    if (!here || (!guard && i >= want)) { if (o.visible) { o.visible = false; o.where = 'offsite'; o.move = null; o.action = null; } continue; }
    if (!o.visible) {
      const n = v.nodes[randInt(state, 0, v.nodes.length - 1)];
      o.pos = { ...n }; o.visible = true; o.where = v.id; o.move = null;
    }
    // wander the wing: the canteen at mealtimes, otherwise the cells, the weights, the corners
    if (!o.move && !o.action && rand(state) < 0.25) {
      const meal = mealNow(state.minute) && !guard;
      const food = spotOf(v, 'food');
      const to: Vec2 = meal && food ? { x: food.pos.x + (rand(state) - 0.5) * 6, z: food.pos.z + (rand(state) - 0.5) * 3 } : v.nodes[randInt(state, 0, v.nodes.length - 1)];
      goTo(state, o, to, 'the wing');
    } else if (!o.move && (!o.gesture || state.minute > o.gesture.until + 1) && !guard) o.gesture = { clip: ['talk', 'idle', 'laugh', 'shrug', 'argue'][randInt(state, 0, 4)], until: state.minute + 1 + rand(state) * 2 };
  }
}
