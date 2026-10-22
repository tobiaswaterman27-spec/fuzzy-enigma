// Harbourside Dog Rescue, east of the park past Unit 4. Go in, meet the dogs in the kennels, and adopt
// one there. New dogs come in each week. Dogs grow old, can fall ill, and can be run over: when one
// dies its owner grieves.
import type { GameState, Id, Person } from './types';
import { clamp, fmtMoney, rand, randInt } from './core';
import { dayIndex } from './clock';
import { lifeEvent, news } from './events';
import { transfer } from './ledger';
import { YEAR_DAYS } from './life';
import type { Dog } from './leisure';

export interface RescueDog { name: string; color: string; size: number; years: number; nature: string }
export const ADOPTION = 12000;
const NAMES = ['Biscuit', 'Bonnie', 'Max', 'Poppy', 'Alfie', 'Bella', 'Rolo', 'Teddy', 'Luna', 'Scout', 'Pickle', 'Murphy', 'Dexter', 'Hazel', 'Ziggy', 'Mabel'];
const COATS = ['#c8a06a', '#3b2a1e', '#f0e6d6', '#8a5a2b', '#1c1c1c', '#b9b2a6', '#d9b98a'];
const NATURES = ['playful', 'shy', 'gentle', 'boisterous', 'loyal', 'a bit nervous', 'cheeky', 'lazy'];

/** the dogs in the kennels this week (four, refreshed every Monday) */
export function rescueDogs(state: GameState): RescueDog[] {
  const week = Math.floor(dayIndex(state.minute) / 7);
  if (!state.rescue || state.rescue.week !== week) {
    const dogs: RescueDog[] = [];
    for (let i = 0; i < 4; i++) dogs.push({ name: NAMES[randInt(state, 0, NAMES.length - 1)], color: COATS[randInt(state, 0, COATS.length - 1)], size: 0.7 + rand(state) * 0.55, years: randInt(state, 1, 9), nature: NATURES[randInt(state, 0, NATURES.length - 1)] });
    state.rescue = { week, dogs };
  }
  return state.rescue.dogs;
}

export function adoptFromKennel(state: GameState, personId: Id, idx: number): { ok: boolean; msg: string } {
  const p = state.people[personId];
  const d = rescueDogs(state)[idx];
  if (!d) return { ok: false, msg: 'That kennel is empty now.' };
  if (p.dog) return { ok: false, msg: `You already have ${p.dog.name}.` };
  const r = transfer(state, { from: p.accountId, to: state.externalId, amount: ADOPTION, reason: 'purchase', memo: `Adopted ${d.name} from the rescue`, key: `adopt:${Math.floor(state.minute)}` });
  if (!r.ok) return { ok: false, msg: `The adoption fee is ${fmtMoney(ADOPTION)}.` };
  const dog: Dog = { name: d.name, color: d.color, size: d.size, since: state.minute, happy: 75, nextFood: state.minute + 7 * 1440, born: state.minute - d.years * YEAR_DAYS * 1440 };
  p.dog = dog;
  state.rescue!.dogs.splice(idx, 1);
  lifeEvent(state, p, `Adopted ${d.name} from Harbourside Dog Rescue`);
  news(state, 'good', `${d.name} is coming home with you`, `${d.years} years old and ${d.nature}. Walk them every day (half an hour out together); food is £12 a week.`, true);
  return { ok: true, msg: `${d.name} bounds out of the kennel to you.` };
}

/** a dog's death: old age, illness, or the road */
export function dogDies(state: GameState, owner: Person, cause: string) {
  const d = owner.dog;
  if (!d) return;
  owner.dog = undefined;
  owner.needs.mood = clamp(owner.needs.mood - 30, 0, 100);
  lifeEvent(state, owner, `Lost their dog ${d.name} (${cause})`);
  if (owner.isPlayer) news(state, 'bad', `${d.name} has died`, `${cause[0].toUpperCase()}${cause.slice(1)}. The flat feels very empty.`, true);
  else if ((state.people[state.playerId].relations[owner.id] ?? 0) >= 20) news(state, 'world', `${owner.name.split(' ')[0]}'s dog ${d.name} has died`, cause, false);
}

/** once a day: dogs age; the old ones and the unlucky ones die */
export function dogsDaily(state: GameState) {
  rescueDogs(state);
  for (const p of Object.values(state.people)) {
    const d = p.dog;
    if (!d || p.dead) continue;
    d.born ??= state.minute - randInt(state, 2, 8) * YEAR_DAYS * 1440;
    const years = (state.minute - d.born) / (YEAR_DAYS * 1440);
    if (years > 11 && rand(state) < (years - 10) * 0.012) { dogDies(state, p, 'old age, peacefully'); continue; }
    if (rand(state) < 0.0015) { dogDies(state, p, 'a sudden illness'); continue; }
    // a dog that is never walked or fed goes downhill
    if (p.isPlayer && d.happy < 10 && rand(state) < 0.05) dogDies(state, p, 'neglect');
  }
}
