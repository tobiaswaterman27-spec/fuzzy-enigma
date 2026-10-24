// Life in the city's venues: whoever works there behind the counter in opening hours, what you can
// buy (and eat, and drink), and what you can get away with: pocketing things off the shelves, holding
// up the till, and the vault at Harbour City Bank. Money goes through the ledger like everything else:
// what you spend goes to the trade outside Harbourside, and a till holds the day's takings until it
// is emptied (by the owner at closing, or by you).
import type { GameState, Id, Person } from './types';
import { clamp, dist, fmtMoney, rand, randInt } from './core';
import { dayIndex } from './clock';
import { lifeEvent, news } from './events';
import { crime, flee } from './health';
import { addItems, count, removeItems } from './inventory';
import { transfer } from './ledger';
import { ambientName, makePerson } from './newgame';
import { trainRun } from './leisure';
import { moveHome } from './life';
import { getWorld } from './world/layout';
import { planVenues, venueOpen, type Venue } from './world/venues';
import { planX } from './world/levels';

export const venues = (): Venue[] => planVenues(getWorld().city);
export const venueById = (id: string) => venues().find((v) => v.id === id) ?? null;
/** the venue an interactable belongs to (ids are `<venue>_<spot>`) */
export const venueOfSpot = (spotId: string) => venueById(spotId.split('_').slice(0, 2).join('_'));

interface VenueState { till: number; day: number; robbedDay?: number; vaultDay?: number; casesDay?: number }
function vs(state: GameState, id: string): VenueState {
  const all = (state.venueState ??= {});
  const day = dayIndex(state.minute);
  let v = all[id];
  // a new day starts with a float in the till
  if (!v || v.day !== day) { v = all[id] = { till: 15000, day, robbedDay: v?.robbedDay, vaultDay: v?.vaultDay, casesDay: v?.casesDay }; }
  return v;
}

// ---------------------------------------------------------------- the staff
const staffId = (v: Venue) => `staff_${v.id}`;
export function staffOf(state: GameState, v: Venue): Person | null {
  const p = state.people[staffId(v)];
  return p && p.visible && !p.dead && !p.away && p.down == null ? p : null;
}

/** every minute: whoever works there is behind the counter while it is open and you are about */
export function venuesTick(state: GameState) {
  const me = state.people[state.playerId];
  const mx = planX(me.pos.x);
  for (const v of venues()) {
    const near = Math.abs(mx - v.staff.x) < 90 && Math.abs(me.pos.z - v.staff.z) < 90;
    const id = staffId(v);
    let p = state.people[id];
    if (!p && !near) continue;
    if (!p) {
      p = makePerson(state, id, ambientName(state), { homeId: null, cash: 3000 + randInt(state, 0, 20000) });
      p.npc!.ambient = true;
      p.fixedJob = 'venue';
      p.age = 19 + randInt(state, 0, 40);
      p.appearance.outfit = v.kind === 'gym' || v.kind === 'nightclub' || v.kind === 'arcade' ? 'outfit_casual' : 'outfit_smart';
      p.visible = false; p.where = 'offsite';
    }
    if (p.dead || p.away || p.down != null || p.combat || (p.fleeing ?? 0) > state.minute) continue;
    const want = near && venueOpen(v, state.minute);
    if (want && !p.visible) { p.visible = true; p.where = v.id; p.pos = { ...v.staff }; p.facing = v.staffFacing; p.move = null; }
    else if (!want && p.visible && !p.move) { p.visible = false; p.where = 'offsite'; }
    else if (want && p.visible && !p.move && !p.action && dist(p.pos, v.staff) > 1.5) p.pos = { ...v.staff };
  }
}

// ---------------------------------------------------------------- buying
export interface Offer { key: string; label: string; price: number; eat?: number; drink?: number; item?: string; energy?: number; mood?: number; /** something worn as soon as it is bought (an appearance extra) */ wear?: string }
/** glasses on the rail at the clothes shops */
export const EYEWEAR: Offer[] = [{ key: 'sunglasses', label: 'Sunglasses (wear them)', price: 2900, wear: 'sunglasses', mood: 4 }, { key: 'glasses', label: 'Glasses with clear lenses (wear them)', price: 3900, wear: 'glasses', mood: 2 }];
const TAKEAWAY: Record<string, Offer[]> = {
  'Golden Dragon': [{ key: 'chowmein', label: 'Chicken chow mein', price: 850, eat: 60, mood: 6 }, { key: 'ribs', label: 'Salt and pepper ribs', price: 790, eat: 50, mood: 6 }],
  'The Codfather': [{ key: 'fish', label: 'Cod and chips', price: 920, eat: 65, mood: 8 }, { key: 'chips', label: 'Bag of chips', price: 350, eat: 30, mood: 4 }],
  "Mario's Pizza": [{ key: 'pizza', label: 'Large pepperoni pizza', price: 1150, eat: 70, mood: 8 }, { key: 'slice', label: 'A slice', price: 300, eat: 25, mood: 3 }],
  'Kebab King': [{ key: 'kebab', label: 'Doner kebab', price: 750, eat: 60, mood: 7 }, { key: 'fries', label: 'Cheesy chips', price: 400, eat: 35, mood: 5 }],
  'Curry Corner': [{ key: 'curry', label: 'Chicken tikka masala', price: 1050, eat: 65, mood: 7 }, { key: 'naan', label: 'Garlic naan', price: 280, eat: 20, mood: 3 }],
};
export function offersAt(v: Venue, spotKind: string): Offer[] {
  switch (v.kind) {
    case 'shop':
      if (spotKind === 'venue_fridge') return [{ key: 'drink', label: 'A cold drink', price: 150, drink: 1, energy: 4, mood: 2 }, { key: 'milk', label: 'Milk', price: 125, item: 'milk' }];
      if (spotKind === 'venue_shelf') return [{ key: 'snacks', label: 'Crisps', price: 135, item: 'snacks' }, { key: 'bread', label: 'Bread', price: 240, item: 'bread' }, { key: 'pasta', label: 'Pasta', price: 180, item: 'pasta' }, { key: 'soap', label: 'Soap', price: 150, item: 'soap' }];
      return [{ key: 'sandwich', label: 'A meal deal (sandwich, crisps, drink)', price: 399, eat: 40, mood: 3 }];
    case 'cafe': return [{ key: 'coffee', label: 'Coffee and a pastry', price: 450, eat: 20, energy: 15, mood: 5 }, { key: 'breakfast', label: 'Full English breakfast', price: 895, eat: 65, mood: 8 }];
    case 'takeaway': return TAKEAWAY[v.name] ?? [{ key: 'chips', label: 'Chips', price: 350, eat: 30, mood: 4 }];
    case 'pub': return [{ key: 'pint', label: 'A pint', price: 460, drink: 18, mood: 4 }, { key: 'lunch', label: 'Pie and mash', price: 1100, eat: 60, mood: 6 }];
    case 'nightclub': return [{ key: 'shot', label: 'A round of shots', price: 600, drink: 25, mood: 6 }, { key: 'water', label: 'Bottle of water', price: 250, energy: 3 }];
    case 'gym': return [{ key: 'pass', label: 'Day pass', price: 600 }];
    case 'bakery': return [{ key: 'roll', label: 'A sausage roll', price: 140, eat: 25, mood: 3 }, { key: 'pasty', label: 'A Cornish pasty', price: 360, eat: 45, mood: 4 }, { key: 'bun', label: 'An iced bun', price: 120, eat: 15, mood: 5 }, { key: 'loaf', label: 'A crusty loaf', price: 260, item: 'bread' }];
    case 'florist': return [{ key: 'bouquet', label: 'A bouquet (to give someone)', price: 2500, item: 'flowers' }, { key: 'rose', label: 'A single red rose (to give someone)', price: 400, item: 'flowers' }];
    case 'bookshop': return spotKind === 'venue_shelf' ? [{ key: 'novel', label: 'A paperback novel', price: 899, item: 'book', mood: 4 }, { key: 'howto', label: 'A how-to book (good for interviews)', price: 1499, item: 'book', mood: 2 }] : [{ key: 'card', label: 'A greetings card', price: 350, mood: 1 }];
    case 'mall':
      if (spotKind === 'food_court') return [{ key: 'burger', label: 'Burger and fries', price: 799, eat: 55, mood: 5 }, { key: 'noodles', label: 'Noodle box', price: 650, eat: 45, mood: 4 }, { key: 'shake', label: 'Milkshake', price: 399, eat: 10, energy: 6, mood: 6 }];
      if (spotKind === 'jeweller') return [
        { key: 'chain', label: 'A gold chain (wear it)', price: 39900, wear: 'chain', mood: 8 }, { key: 'watch', label: 'A watch (wear it)', price: 24900, wear: 'watch', mood: 6 },
        { key: 'hoops', label: 'Gold hoop earrings (wear them)', price: 14900, wear: 'hoops', mood: 5 }, { key: 'studs', label: 'Silver ear studs (wear them)', price: 7900, wear: 'studs', mood: 4 },
        { key: 'ring', label: 'A gold ring', price: 89900, item: 'jewellery', mood: 10 },
      ];
      return [];
    case 'station': return [{ key: 'coffee', label: 'Coffee to go', price: 320, energy: 15, mood: 2 }];
    case 'hospital': return [{ key: 'vending', label: 'Vending machine snack', price: 180, eat: 15, mood: 1 }];
    default: return [];
  }
}

export function buyAt(state: GameState, personId: Id, v: Venue, o: Offer): string {
  const p = state.people[personId];
  if (!venueOpen(v, state.minute)) return `${v.name} is closed.`;
  if (!staffOf(state, v)) return 'Nobody is serving.';
  const r = transfer(state, { from: p.accountId, to: state.externalId, amount: o.price, reason: 'purchase', memo: `${o.label} at ${v.name}`, key: `buy:${v.id}:${o.key}:${Math.floor(state.minute * 10)}` });
  if (!r.ok) return `That's ${fmtMoney(o.price)}: you can't afford it.`;
  vs(state, v.id).till += o.price;
  if (o.item) addItems(state.containers[p.bagId], o.item, 1);
  // put on there and then (glasses swap for sunglasses and back)
  if (o.wear) {
    const set = new Set(p.appearance.extras ?? []);
    set.add(o.wear);
    if (o.wear === 'glasses') set.delete('sunglasses'); if (o.wear === 'sunglasses') set.delete('glasses');
    p.appearance = { ...p.appearance, extras: [...set] };
    p.gesture = { clip: 'dress', until: state.minute + 1 };
  }
  if (o.eat) p.needs.satiety = clamp(p.needs.satiety + o.eat, 0, 100);
  if (o.energy) p.needs.energy = clamp(p.needs.energy + o.energy, 0, 100);
  if (o.mood) p.needs.mood = clamp(p.needs.mood + o.mood, 0, 100);
  if (o.drink && o.drink > 2) p.drunk = Math.min(100, (p.drunk ?? 0) + o.drink);
  if (o.key === 'pass') (p as any).gymPass = dayIndex(state.minute);
  // what you buy to have there and then, you eat or drink there and then
  if (!o.item && o.eat && o.eat >= 15) p.gesture = { clip: 'eat', until: state.minute + 2.5 };
  else if (!o.item && (o.drink || o.energy)) p.gesture = { clip: 'drink', until: state.minute + 1.6 };
  return o.wear ? `${o.label.replace(/ \(wear (it|them)\)/, '')}: ${fmtMoney(o.price)}. You put ${o.wear === 'hoops' || o.wear === 'studs' || o.wear.includes('glasses') ? 'them' : 'it'} on.` : o.item ? `${o.label}: ${fmtMoney(o.price)}. In your bag.` : o.key === 'pass' ? `Day pass: ${fmtMoney(o.price)}. Get to it.` : `${o.label}: ${fmtMoney(o.price)}.`;
}

// ---------------------------------------------------------------- crime
/** slip something into your pocket: whoever is serving may see */
export function shoplift(state: GameState, personId: Id, v: Venue, item: string): string {
  const p = state.people[personId];
  const s = staffOf(state, v);
  const seen = s && rand(state) < 0.35 + (dist(s.pos, p.pos) < 4 ? 0.2 : 0);
  if (!seen) { addItems(state.containers[p.bagId], item, 1); return 'Into your pocket. Nobody saw.'; }
  s.relations[p.id] = 0;
  s.gesture = { clip: 'argue', until: state.minute + 1.2 };
  crime(state, 'shoplifting', 1, s.id);
  if (s.traits.patience < 0.35 && (s.health ?? 100) > 60) s.combat = { target: p.id, until: state.minute + 2, next: state.minute + 0.4 };
  return `"Oi! Put that back!" ${s.name.split(' ')[0]} saw you.`;
}

/** hold up the till: with a weapon they hand it over; without, they might, or they hit the alarm */
export function robVenue(state: GameState, personId: Id, v: Venue): string {
  const p = state.people[personId];
  const s = staffOf(state, v);
  if (!s) return 'There is nobody at the counter.';
  const st = vs(state, v.id);
  s.relations[p.id] = 0;
  for (const o of Object.values(state.people)) if (!o.isPlayer && o !== s && o.visible && dist(o.pos, p.pos) < 12 && !o.police) flee(state, o, p.pos);
  if (!p.weapon && (s.traits.patience < 0.5 || rand(state) < 0.5)) {
    s.gesture = { clip: 'argue', until: state.minute + 1 };
    crime(state, 'attempted robbery', 2, s.id);
    if (s.traits.patience < 0.35) { s.combat = { target: p.id, until: state.minute + 3, next: state.minute + 0.3 }; return `${s.name.split(' ')[0]} comes over the counter at you!`; }
    return `${s.name.split(' ')[0]} laughs at you and hits the alarm.`;
  }
  const big = v.kind === 'bank';
  const take = big ? 80000 + randInt(state, 0, 220000) : Math.min(st.till, 45000);
  st.till -= Math.min(st.till, take);
  st.robbedDay = dayIndex(state.minute);
  if (take > 0) transfer(state, { from: state.externalId, to: p.accountId, amount: take, reason: 'transfer', memo: `Cash from ${v.name}`, key: `robv:${v.id}:${Math.floor(state.minute)}` });
  s.gesture = { clip: 'scared', until: state.minute + 2 };
  lifeEvent(state, s, `Held up at ${v.name}`);
  lifeEvent(state, p, `Robbed ${v.name}`);
  news(state, 'bad', `${big ? 'Bank raid' : 'Armed robbery'} at ${v.name}`, `${fmtMoney(take)} taken. Police are hunting the robber.`, false);
  crime(state, big ? 'armed robbery of a bank' : 'armed robbery', big ? 5 : 4, s.id);
  return big ? `The cashier stuffs ${fmtMoney(take)} into a bag with shaking hands. The alarm is screaming. RUN.` : `${s.name.split(' ')[0]} empties the till for you: ${fmtMoney(take)}. Now go.`;
}

/** smash the jeweller's display cases and grab what you can: loud, and the alarm goes straight off */
export function smashCases(state: GameState, personId: Id, v: Venue): string {
  const p = state.people[personId];
  const st = vs(state, v.id);
  const day = dayIndex(state.minute);
  for (const o of Object.values(state.people)) if (!o.isPlayer && o.visible && dist(o.pos, p.pos) < 15 && !o.police) flee(state, o, p.pos);
  crime(state, 'smash-and-grab at a jewellers', 3);
  if (st.casesDay === day) return 'The cases are empty: someone already cleaned them out today.';
  st.casesDay = day;
  // a bat or a knife handle breaks the glass first time; bare fists, not so much
  if (!p.weapon && rand(state) < 0.5) { p.health = Math.max(5, (p.health ?? 100) - 8); return 'The glass holds and your hand does not. The alarm is going.'; }
  const rings = randInt(state, 1, 3), watches = randInt(state, 0, 2);
  addItems(state.containers[p.bagId], 'jewellery', rings);
  if (watches) addItems(state.containers[p.bagId], 'watch', watches);
  lifeEvent(state, p, `Smash-and-grab at ${v.name}`);
  news(state, 'bad', `Smash-and-grab at ${v.name}`, 'Display cases smashed, jewellery taken.', false);
  return `Glass everywhere. You scoop ${rings} ring${rings > 1 ? 's' : ''}${watches ? ` and ${watches} watch${watches > 1 ? 'es' : ''}` : ''} into your bag. Pawn them somewhere quiet.`;
}

/** a film at the cinema: a couple of hours off your feet */
export function watchFilm(state: GameState, personId: Id, v: Venue): string {
  const p = state.people[personId];
  const r = transfer(state, { from: p.accountId, to: state.externalId, amount: 1150, reason: 'purchase', memo: `Cinema ticket at ${v.name}`, key: `film:${personId}:${Math.floor(state.minute)}` });
  if (!r.ok) return `A ticket is ${fmtMoney(1150)}: you can't afford it.`;
  p.needs.mood = clamp(p.needs.mood + 25, 0, 100);
  p.needs.energy = clamp(p.needs.energy + 5, 0, 100);
  const films = ['a heist film that gets the vault scenes all wrong', 'a romcom set in a seaside town not unlike this one', 'a superhero sequel nobody asked for', 'a horror film: you jump twice', 'a car chase film: you drive home a little faster'];
  return `You watched ${films[randInt(state, 0, films.length - 1)]}.`;
}

/** the council desk at City Hall */
export const RECORD_FEE = 25000;
export const WEDDING_FEE = 12000;
export function clearRecord(state: GameState, personId: Id): string {
  const p = state.people[personId];
  const n = p.record?.length ?? 0;
  if (!n) return 'Your record is already clean.';
  const fee = RECORD_FEE * n;
  const r = transfer(state, { from: p.accountId, to: state.externalId, amount: fee, reason: 'purchase', memo: 'Record expungement (City Hall)', key: `expunge:${personId}:${Math.floor(state.minute)}` });
  if (!r.ok) return `It is ${fmtMoney(RECORD_FEE)} an offence: ${fmtMoney(fee)}. You can't afford it.`;
  p.record = [];
  lifeEvent(state, p, 'Had criminal record expunged');
  return `${fmtMoney(fee)} and a lot of forms later, your record is wiped clean.`;
}
export function wedding(state: GameState, personId: Id): string {
  const p = state.people[personId];
  const o = p.partnerId ? state.people[p.partnerId] : null;
  if (!o || p.relationship !== 'dating') return 'You need someone to marry (you have to be going out first).';
  if (dist(o.pos, p.pos) > 12 || !o.visible) return `Bring ${o.name.split(' ')[0]} along: you both have to be here.`;
  if ((o.relations[p.id] ?? 0) < 70) return `${o.name.split(' ')[0]} shakes their head. Not yet.`;
  const r = transfer(state, { from: p.accountId, to: state.externalId, amount: WEDDING_FEE, reason: 'purchase', memo: 'Civil ceremony (City Hall)', key: `wed:${personId}:${Math.floor(state.minute)}` });
  if (!r.ok) return `The ceremony is ${fmtMoney(WEDDING_FEE)}.`;
  p.relationship = o.relationship = 'married';
  lifeEvent(state, p, `Married ${o.name}`); lifeEvent(state, o, `Married ${p.name}`);
  p.needs.mood = 100; o.needs.mood = 100;
  if (p.homeId && o.homeId !== p.homeId) moveHome(state, o, p.homeId);
  news(state, 'good', `You married ${o.name}`, 'A small ceremony at City Hall.', true);
  return `"I do." You and ${o.name.split(' ')[0]} are married.`;
}

/** the vault: it takes time, and the police are coming the moment you start */
export function crackVault(state: GameState, personId: Id, v: Venue): string {
  const p = state.people[personId];
  const st = vs(state, v.id);
  const day = dayIndex(state.minute);
  if (st.vaultDay === day) return 'Empty. Someone beat you to it (you).';
  st.vaultDay = day;
  const take = 1500000 + randInt(state, 0, 2500000);
  transfer(state, { from: state.externalId, to: p.accountId, amount: take, reason: 'transfer', memo: 'The contents of a bank vault', key: `vault:${v.id}:${day}` });
  lifeEvent(state, p, `Cracked the vault at ${v.name}`);
  news(state, 'bad', `The vault at ${v.name} has been emptied`, `${fmtMoney(take)} gone. The biggest robbery the city has ever seen.`, false);
  crime(state, 'robbing a bank vault', 5);
  return `The wheel spins free and the door swings open: ${fmtMoney(take)} in used notes. Every police officer in the city is on their way.`;
}

// ---------------------------------------------------------------- looks
const CASUAL_STYLES = 12;
export function newOutfit(state: GameState, personId: Id, v: Venue, smart: boolean): string {
  const p = state.people[personId];
  const price = smart ? 9500 : 4500;
  if (!venueOpen(v, state.minute)) return `${v.name} is closed.`;
  const r = transfer(state, { from: p.accountId, to: state.externalId, amount: price, reason: 'purchase', memo: `Clothes from ${v.name}`, key: `clothes:${Math.floor(state.minute * 10)}` });
  if (!r.ok) return `That's ${fmtMoney(price)}.`;
  vs(state, v.id).till += price;
  p.appearance = { ...p.appearance, outfit: smart ? 'outfit_smart' : 'outfit_casual', style: randInt(state, 0, CASUAL_STYLES * 13) };
  p.needs.mood = clamp(p.needs.mood + 8, 0, 100);
  return smart ? `Looking sharp. ${fmtMoney(price)}.` : `New clothes on. ${fmtMoney(price)}.`;
}

const HAIR_COLOURS = ['#1c1410', '#3b2416', '#6b4423', '#a0703a', '#d8b26a', '#e8d9b0', '#8a2d1c', '#c0c0c0', '#2b4cff', '#ff3fa4'];
export function haircut(state: GameState, personId: Id, v: Venue, style: 'short' | 'long' | 'bun' | 'curly' | 'bald' | 'dye'): string {
  const p = state.people[personId];
  if (!staffOf(state, v)) return 'The barber is not in.';
  const price = style === 'dye' ? 2500 : 1400;
  const r = transfer(state, { from: p.accountId, to: state.externalId, amount: price, reason: 'purchase', memo: `Haircut at ${v.name}`, key: `hair:${Math.floor(state.minute * 10)}` });
  if (!r.ok) return `That's ${fmtMoney(price)}.`;
  vs(state, v.id).till += price;
  if (style === 'dye') p.appearance = { ...p.appearance, hairColor: HAIR_COLOURS[randInt(state, 0, HAIR_COLOURS.length - 1)] };
  else p.appearance = { ...p.appearance, hair: style };
  p.needs.mood = clamp(p.needs.mood + 6, 0, 100);
  return style === 'dye' ? 'A new colour. Bold.' : style === 'bald' ? 'All off. Breezy.' : 'Fresh cut. Looking good.';
}

// ---------------------------------------------------------------- fun
/** a workout: fitter, hungrier, happier (needs the day pass) */
export function workout(state: GameState, personId: Id, kind: 'treadmill' | 'weights') {
  const p = state.people[personId];
  if (kind === 'treadmill') trainRun(p, 2500);
  else p.fitness = clamp((p.fitness ?? 40) + 2, 0, 100);
  (p as any).strength = clamp(((p as any).strength ?? 30) + (kind === 'weights' ? 3 : 0.5), 0, 100);
  p.needs.energy = clamp(p.needs.energy - 12, 0, 100);
  p.needs.satiety = clamp(p.needs.satiety - 8, 0, 100);
  p.needs.mood = clamp(p.needs.mood + 7, 0, 100);
  p.needs.hygiene = clamp(p.needs.hygiene - 15, 0, 100);
  return kind === 'treadmill' ? `Twenty minutes on the treadmill. Fitness ${Math.round(p.fitness ?? 0)}.` : `Sets done. Strength ${Math.round((p as any).strength)}, fitness ${Math.round(p.fitness ?? 0)}.`;
}
// ------------------------------------------------- cash-in-hand shifts
/** an afternoon behind the counter, paid in cash at the end: per hour, by the kind of place */
export const SHIFT_PAY: Partial<Record<Venue['kind'], { role: string; hourly: number }>> = {
  bakery: { role: 'on the bakery counter', hourly: 1150 }, florist: { role: 'making up bouquets', hourly: 1150 }, bookshop: { role: 'on the bookshop till', hourly: 1100 },
  cafe: { role: 'pulling coffees', hourly: 1150 }, takeaway: { role: 'on the fryer', hourly: 1100 }, shop: { role: 'on the till', hourly: 1100 },
  clothes: { role: 'folding and on the till', hourly: 1200 }, mall: { role: 'on the jewellery counter', hourly: 1400 }, pub: { role: 'behind the bar', hourly: 1200 },
};
export const SHIFT_HOURS = 2;
/** why they will not have you today, or null */
export function shiftBlocker(state: GameState, p: Person, v: Venue): string | null {
  if (!SHIFT_PAY[v.kind]) return 'No shifts going here';
  if (!venueOpen(v, state.minute) || !staffOf(state, v)) return 'Nobody here to ask';
  if ((p as any).shiftDay === dayIndex(state.minute)) return 'You have already done a shift today';
  if (state.wanted) return 'Not with the police after you';
  if ((p.needs.hygiene ?? 100) < 30) return '"Not smelling like that, love - have a wash first"';
  if (p.needs.energy < 20) return 'You are too tired';
  if (v.kind === 'mall' && (p.record?.length ?? 0) > 0) return 'No criminal records on the jewellery counter';
  return null;
}
export function finishShift(state: GameState, personId: Id, v: Venue): string {
  const p = state.people[personId], job = SHIFT_PAY[v.kind]!;
  const pay = job.hourly * SHIFT_HOURS;
  (p as any).shiftDay = dayIndex(state.minute);
  transfer(state, { from: state.externalId, to: p.accountId, amount: pay, reason: 'transfer', memo: `Cash shift at ${v.name}`, key: `shift:${v.id}:${dayIndex(state.minute)}` });
  p.needs.energy = clamp(p.needs.energy - 14, 0, 100);
  p.needs.satiety = clamp(p.needs.satiety - 10, 0, 100);
  const shifts = (p as any).shifts = ((p as any).shifts ?? 0) + 1;
  if (shifts === 1) lifeEvent(state, p, `First cash shift, ${job.role} at ${v.name}`);
  const boss = staffOf(state, v)?.name.split(' ')[0] ?? 'The manager';
  return `${SHIFT_HOURS} hours ${job.role}. ${boss} hands you ${fmtMoney(pay)} in cash. "Same again tomorrow if you want it."`;
}

export const hasGymPass = (state: GameState, p: Person) => (p as any).gymPass === dayIndex(state.minute);

/** one go on the slots: three reels */
export function slots(state: GameState, personId: Id, stake: number): { msg: string; reels: string[] } {
  const p = state.people[personId];
  const r = transfer(state, { from: p.accountId, to: state.externalId, amount: stake, reason: 'purchase', memo: 'Slot machine', key: `slot:${Math.floor(state.minute * 100)}:${stake}` });
  if (!r.ok) return { msg: 'Not enough money.', reels: [] };
  const SYMS = ['🍒', '🍋', '🔔', '⭐', '7️⃣', '💎'];
  const reels = [0, 1, 2].map(() => SYMS[Math.floor(Math.pow(rand(state), 1.6) * SYMS.length)]);
  const same = reels[0] === reels[1] && reels[1] === reels[2];
  const pair = !same && (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]);
  const mult = same ? ({ '🍒': 5, '🍋': 8, '🔔': 12, '⭐': 20, '7️⃣': 50, '💎': 100 } as Record<string, number>)[reels[0]] : pair && reels.includes('🍒') ? 2 : 0;
  if (mult) transfer(state, { from: state.externalId, to: p.accountId, amount: stake * mult, reason: 'transfer', memo: 'Slot machine win', key: `slotw:${Math.floor(state.minute * 100)}:${stake}` });
  if (mult >= 50) { lifeEvent(state, p, `Hit the jackpot on the slots (${fmtMoney(stake * mult)})`); p.needs.mood = 100; }
  return { msg: mult ? `${reels.join(' ')}  WIN ${fmtMoney(stake * mult)}!` : `${reels.join(' ')}  Nothing.`, reels };
}

/** roulette: red/black/odd/even pay evens, a single number pays 35 to 1 */
export function roulette(state: GameState, personId: Id, stake: number, bet: string): string {
  const p = state.people[personId];
  const r = transfer(state, { from: p.accountId, to: state.externalId, amount: stake, reason: 'purchase', memo: 'Roulette stake', key: `rou:${Math.floor(state.minute * 100)}:${bet}` });
  if (!r.ok) return 'Not enough money for that stake.';
  const n = randInt(state, 0, 36);
  const RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
  const colour = n === 0 ? 'green' : RED.includes(n) ? 'red' : 'black';
  const win = bet === 'red' ? colour === 'red' : bet === 'black' ? colour === 'black' : bet === 'odd' ? n % 2 === 1 : bet === 'even' ? n > 0 && n % 2 === 0 : Number(bet) === n;
  const mult = win ? (/^\d+$/.test(bet) ? 36 : 2) : 0;
  if (mult) transfer(state, { from: state.externalId, to: p.accountId, amount: stake * mult, reason: 'transfer', memo: 'Roulette win', key: `rouw:${Math.floor(state.minute * 100)}:${bet}` });
  if (mult === 36) lifeEvent(state, p, `Won ${fmtMoney(stake * 36)} on number ${n} at roulette`);
  return `The ball drops in ${n} ${colour}. ${mult ? `You win ${fmtMoney(stake * mult)}!` : 'The croupier takes your chips.'}`;
}

/** the arcade: a go on a machine, tickets out, and now and then a cash prize from the pusher */
export function arcadeGo(state: GameState, personId: Id): string {
  const p = state.people[personId];
  const r = transfer(state, { from: p.accountId, to: state.externalId, amount: 100, reason: 'purchase', memo: 'Arcade', key: `arc:${Math.floor(state.minute * 100)}` });
  if (!r.ok) return 'You need a pound.';
  p.needs.mood = clamp(p.needs.mood + 3, 0, 100);
  const x = rand(state);
  if (x < 0.06) { transfer(state, { from: state.externalId, to: p.accountId, amount: 1000, reason: 'transfer', memo: 'Coin pusher', key: `arcw:${Math.floor(state.minute * 100)}` }); return 'The coins cascade off the shelf: £10!'; }
  const games = ['You crash on the last lap of Turbo Racer.', 'Space invaders get you on level 4.', 'The claw drops the teddy. Again.', 'High score on Whack-a-Mole! The machine prints tickets.', 'You beat the boss on Street Brawler II.', 'Air hockey: you lose 7-5 to a kid.'];
  return games[Math.floor(x * games.length)];
}

/** sell things at the pawnbroker */
export const PAWN: Record<string, { label: string; price: number }> = {
  jewellery: { label: 'jewellery', price: 6000 }, watch: { label: 'a watch', price: 4500 }, laptop: { label: 'a laptop', price: 9000 }, phone_s: { label: 'a phone', price: 3500 },
};
export function pawnSell(state: GameState, personId: Id, item: string): string {
  const p = state.people[personId];
  const it = PAWN[item];
  if (!it || !count(state.containers[p.bagId], item)) return 'You have nothing like that.';
  removeItems(state.containers[p.bagId], item, 1);
  transfer(state, { from: state.externalId, to: p.accountId, amount: it.price, reason: 'sale', memo: `Pawned ${it.label}`, key: `pawn:${item}:${Math.floor(state.minute * 10)}` });
  return `No questions asked: ${fmtMoney(it.price)} for ${it.label}.`;
}

// ---------------------------------------------------------------- the regulars
const PATRONS = 8;
/** when you walk into a venue that is open, there are people in it doing what people do there */
export function patronsTick(state: GameState) {
  const me = state.people[state.playerId];
  const here = venues().find((v) => me.pos.x > v.rect.x0 && me.pos.x < v.rect.x1 && me.pos.z > v.rect.z0 && me.pos.z < v.rect.z1) ?? null;
  const live = here && venueOpen(here, state.minute) && ['pub', 'cafe', 'nightclub', 'casino', 'gym', 'arcade', 'takeaway', 'shop'].includes(here.kind) ? here : null;
  const want = !live ? 0 : live.kind === 'nightclub' ? 8 : live.kind === 'pub' || live.kind === 'casino' ? 6 : live.kind === 'shop' || live.kind === 'takeaway' ? 2 : 4;
  for (let i = 0; i < PATRONS; i++) {
    const id = `patron_${i}`;
    let p = state.people[id];
    if (!p && i >= want) continue;
    if (!p) {
      p = makePerson(state, id, ambientName(state), { homeId: null, cash: 5000 + randInt(state, 0, 60000) });
      p.npc!.ambient = true; p.fixedJob = 'patron'; p.age = 18 + randInt(state, 0, 50);
      p.visible = false; p.where = 'offsite';
    }
    if (p.dead || p.away || p.down != null || p.combat || (p.fleeing ?? 0) > state.minute) continue;
    const inPlace = (p.npc as any).at === live?.id;
    if (i >= want || !live) { if (p.visible && (p.npc as any).at) { p.visible = false; p.where = 'offsite'; p.action = null; (p.npc as any).at = null; } continue; }
    if (!inPlace) {
      // a spot that suits the place
      const r = live.obstacles.find((o) => o.kind === (live.kind === 'nightclub' ? 'dancefloor' : live.kind === 'gym' ? 'treadmill' : live.kind === 'casino' || live.kind === 'arcade' ? 'kiosk' : 'table'))?.rect;
      const pick = live.obstacles.filter((o) => o.kind === (live.kind === 'nightclub' ? 'dancefloor' : live.kind === 'gym' ? 'treadmill' : live.kind === 'casino' || live.kind === 'arcade' ? 'kiosk' : 'table'));
      const o = pick[i % Math.max(1, pick.length)]?.rect ?? r ?? { x0: live.inside.x - 1, x1: live.inside.x + 1, z0: live.inside.z, z1: live.inside.z + 1 };
      const into = live.front === 'n' ? 1 : -1;
      let pos: { x: number; z: number };
      if (live.kind === 'nightclub') pos = { x: o.x0 + 0.6 + rand(state) * (o.x1 - o.x0 - 1.2), z: o.z0 + 0.6 + rand(state) * (o.z1 - o.z0 - 1.2) };
      else if (live.kind === 'gym') pos = { x: (o.x0 + o.x1) / 2, z: (o.z0 + o.z1) / 2 };
      else if (live.kind === 'shop' || live.kind === 'takeaway') pos = { x: live.inside.x + (i ? 1.2 : -1.2), z: live.inside.z + into * 2.2 };
      else pos = { x: (o.x0 + o.x1) / 2 + (i % 2 ? 0.9 : -0.9), z: (live.kind === 'casino' || live.kind === 'arcade' ? (into > 0 ? o.z0 - 0.7 : o.z1 + 0.7) : (o.z0 + o.z1) / 2 + (i % 4 < 2 ? -1.0 : 1.0)) };
      p.pos = pos; p.visible = true; p.where = live.id; p.move = null; p.action = null;
      p.facing = live.kind === 'casino' || live.kind === 'arcade' ? (into > 0 ? 0 : Math.PI) : Math.atan2(((o.x0 + o.x1) / 2) - pos.x, ((o.z0 + o.z1) / 2) - pos.z);
      (p.npc as any).at = live.id;
    }
    // what they do: dance, run, play, drink and chat
    if (!p.action) {
      if (live.kind === 'nightclub') p.action = { type: 'dance', target: `${live.id}_floor`, started: state.minute, progress: 0, unitTime: 0, duration: 999, units: 0 };
      else if (live.kind === 'gym') p.action = { type: 'workout', target: `${live.id}_treadmill`, started: state.minute, progress: 0, unitTime: 0, duration: 999, units: 0, arg: 'treadmill' };
      else if (!p.gesture || state.minute > p.gesture.until + 0.5) p.gesture = { clip: live.kind === 'casino' || live.kind === 'arcade' ? 'type' : ['drink', 'talk', 'laugh', 'talk', 'idle'][randInt(state, 0, 4)], until: state.minute + 1 + rand(state) * 2 };
    }
  }
}

// ---------------------------------------------------------------- blackjack
export interface Hand { stake: number; you: number[]; dealer: number[]; done: boolean; result?: string }
const card = (state: GameState) => Math.min(10, randInt(state, 1, 13));
export const handValue = (cards: number[]) => { let t = cards.reduce((a, b) => a + b, 0); if (cards.includes(1) && t + 10 <= 21) t += 10; return t; };
export function dealBlackjack(state: GameState, personId: Id, stake: number): Hand | string {
  const p = state.people[personId];
  const r = transfer(state, { from: p.accountId, to: state.externalId, amount: stake, reason: 'purchase', memo: 'Blackjack stake', key: `bj:${Math.floor(state.minute * 100)}:${stake}` });
  if (!r.ok) return 'Not enough money for that stake.';
  const h: Hand = { stake, you: [card(state), card(state)], dealer: [card(state)], done: false };
  (state as any).blackjack = h;
  if (handValue(h.you) === 21) return finishBlackjack(state, personId, true);
  return h;
}
export function hitBlackjack(state: GameState, personId: Id): Hand {
  const h = (state as any).blackjack as Hand;
  h.you.push(card(state));
  if (handValue(h.you) > 21) { h.done = true; h.result = `Bust with ${handValue(h.you)}. The dealer takes it.`; }
  else if (handValue(h.you) === 21) return finishBlackjack(state, personId);
  return h;
}
/** you stand: the dealer draws to 17, then the best hand wins (blackjack pays 3 to 2) */
export function finishBlackjack(state: GameState, personId: Id, natural = false): Hand {
  const h = (state as any).blackjack as Hand;
  const p = state.people[personId];
  while (handValue(h.dealer) < 17) h.dealer.push(card(state));
  const y = handValue(h.you), d = handValue(h.dealer);
  const pay = natural ? Math.round(h.stake * 2.5) : d > 21 || y > d ? h.stake * 2 : y === d ? h.stake : 0;
  if (pay) transfer(state, { from: state.externalId, to: p.accountId, amount: pay, reason: 'transfer', memo: 'Blackjack', key: `bjw:${Math.floor(state.minute * 100)}` });
  h.done = true;
  h.result = natural ? `Blackjack! You win ${fmtMoney(pay)}.` : d > 21 ? `The dealer busts on ${d}. You win ${fmtMoney(pay)}.` : y > d ? `${y} beats ${d}. You win ${fmtMoney(pay)}.` : y === d ? `${y} each: a push, your stake back.` : `The dealer's ${d} beats your ${y}.`;
  return h;
}
