// Owning a car: buy one from Harbour Motors on your phone, it is delivered to the kerb outside
// Marlow Court, and you can drive it anywhere and park it where you like. Insurance and road tax
// are taken weekly; fuel is paid at the end of each drive.
import type { GameState, Id, Vehicle } from './types';
import { at, dayIndex } from './clock';
import { fmtMoney, rand } from './core';
import { transfer } from './ledger';
import { news, lifeEvent } from './events';
import { createContainer } from './inventory';
import { getWorld, locationOf } from './world/layout';
import { resolveCircle } from './world/nav';
import { crime, floor, hurt } from './health';

export interface CarModel { id: string; name: string; price: number; topSpeed: number; colors: string[]; blurb: string; body: string }

export const CAR_MODELS: CarModel[] = [
  { id: 'hatch', name: 'Used hatchback (12 years old)', price: 280000, topSpeed: 12, colors: ['#8a8f94', '#7b2d26', '#2b4a6f'], blurb: 'High mileage, but it starts every morning.', body: 'car' },
  { id: 'saloon', name: 'Family saloon (5 years old)', price: 720000, topSpeed: 14, colors: ['#1b2631', '#e5e7e9', '#5d6d7e'], blurb: 'Comfortable, economical, one careful owner.', body: 'saloon' },
  { id: 'new', name: 'Brand-new compact', price: 1650000, topSpeed: 16, colors: ['#c0392b', '#1e8449', '#f0f3f4', '#d4ac0d'], blurb: 'Straight from the factory with a full warranty.', body: 'car' },
  { id: 'suv', name: 'Family SUV (3 years old)', price: 2400000, topSpeed: 15, colors: ['#2c3e50', '#f2f3f4', '#6e2c00', '#566573'], blurb: 'Room for the whole family and the dog. Sits up high.', body: 'suv' },
  { id: 'coupe', name: 'Sports coupe (2 years old)', price: 4800000, topSpeed: 20, colors: ['#c0392b', '#f1c40f', '#17202a', '#2e86c1'], blurb: 'Two doors, low and very quick. Turns heads on Harbour Road.', body: 'sports' },
];
/** weekly insurance and road tax */
export const CAR_WEEKLY = 3500;
/** fuel, per kilometre driven */
export const FUEL_PER_KM = 25;
/** a car sells for this share of what you paid */
export const RESALE = 0.6;
/** delivered to and shown parked at the kerb outside Marlow Court */
export const HOME_SPOT = { x: 19.5, z: 4 };

export function playerCar(state: GameState, personId: Id): Vehicle | null {
  return Object.values(state.vehicles).find((v) => v.kind === 'car' && v.ownerId === personId && !v.stolen) ?? null;
}

export function buyCar(state: GameState, personId: Id, modelId: string, color: string): { ok: boolean; msg: string } {
  const p = state.people[personId];
  const m = CAR_MODELS.find((x) => x.id === modelId);
  if (!p || !m) return { ok: false, msg: 'No such car.' };
  if (playerCar(state, personId)) return { ok: false, msg: 'You already have a car. Sell it first.' };
  const r = transfer(state, { from: p.accountId, to: state.externalId, amount: m.price, reason: 'purchase', memo: `Harbour Motors: ${m.name}`, key: `car_buy:${personId}:${state.minute}` });
  if (!r.ok) return { ok: false, msg: `You need ${fmtMoney(m.price)}.` };
  const id = `car_${personId}`;
  const boot = createContainer(state, 'van', personId, id, 40, undefined, `${id}_boot`);
  state.vehicles[id] = {
    id, name: m.name.replace(/ \(.*\)$/, ''), ownerId: personId, kind: 'car', model: m.id, color: color || m.colors[0], price: m.price,
    pos: { ...HOME_SPOT }, heading: Math.PI / 2, route: [], routeIdx: 0, speed: 0, state: 'parked', driverId: null,
    cargoId: boot.id, shipmentId: null, waitUntil: 0, condition: 100, odometer: 0, billedOdo: 0,
    nextCharge: at(dayIndex(state.minute) + 7, 9, 0),
  };
  lifeEvent(state, p, `Bought a car: ${m.name}`);
  news(state, 'good', 'Your car has been delivered', `${m.name} is parked at the kerb outside Marlow Court. Walk up to it to get in. Insurance and road tax: ${fmtMoney(CAR_WEEKLY)} a week.`, p.isPlayer);
  return { ok: true, msg: `Bought the ${m.name} for ${fmtMoney(m.price)}.` };
}

export function sellCar(state: GameState, personId: Id): { ok: boolean; msg: string } {
  const v = playerCar(state, personId);
  const p = state.people[personId];
  if (!v || !p) return { ok: false, msg: 'You have no car.' };
  if (v.state !== 'parked') return { ok: false, msg: 'Park it first.' };
  const amount = Math.round((v.price ?? 0) * RESALE * (0.6 + 0.4 * v.condition / 100));
  const r = transfer(state, { from: state.externalId, to: p.accountId, amount, reason: 'sale', memo: `Sold ${v.name} to Harbour Motors`, key: `car_sell:${v.id}:${state.minute}` });
  if (!r.ok) return { ok: false, msg: r.error };
  delete state.containers[v.cargoId];
  delete state.vehicles[v.id];
  return { ok: true, msg: `Sold the ${v.name} for ${fmtMoney(amount)}.` };
}

/** take a car from the street: the driver is pulled out and runs; the police are called */
export function stealCar(state: GameState, personId: Id, pos: { x: number; z: number }, heading: number, color: string, body = 'car'): string {
  const p = state.people[personId];
  const id = `stolen_${Math.floor(state.minute)}_${Object.keys(state.vehicles).length}`;
  const boot = createContainer(state, 'van', 'traffic', id, 20, undefined, `${id}_boot`);
  const model = CAR_MODELS.find((m) => m.body === body && m.id !== 'new') ?? CAR_MODELS[0];
  state.vehicles[id] = {
    id, name: model.name.replace(/ \(.*\)$/, ''), ownerId: 'traffic', kind: 'car', model: model.id, color, price: model.price,
    pos: { ...pos }, heading, route: [], routeIdx: 0, speed: 0, state: 'manual_out', driverId: personId,
    cargoId: boot.id, shipmentId: null, waitUntil: 0, condition: 85, odometer: 0, billedOdo: 0, stolen: state.minute,
  };
  p.where = 'vehicle'; p.visible = false; p.pos = { ...pos };
  lifeEvent(state, p, `Stole a ${model.name.replace(/ \(.*\)$/, '').toLowerCase()}`);
  crime(state, 'taking a vehicle without consent', 2);
  return 'You drag the driver out and take the car. W/S to drive, A/D to steer, E to get out.';
}

export const PARKED_BODIES = ['car', 'saloon', 'suv', 'car', 'sports'];
/** smash the window of a car parked at the kerb and drive it away (the alarm goes off) */
export function stealParked(state: GameState, personId: Id, idx: number): string {
  const w = getWorld();
  const c = w.parked[idx];
  if (!c || (state.takenParked ?? []).includes(idx)) return 'That car has gone.';
  (state.takenParked ??= []).push(idx);
  stealCar(state, personId, { ...c.pos }, c.rot, c.color, PARKED_BODIES[idx % PARKED_BODIES.length]);
  return 'The glass goes in and the alarm wails. You reach in, get it started and go. W/S to drive, A/D to steer, E to get out.';
}

/** someone's own car, parked: break in and take it. They will know it was you if anyone saw */
export function stealOwnedCar(state: GameState, personId: Id, carId: Id): string {
  const v = state.vehicles[carId];
  const p = state.people[personId];
  if (!v || v.kind !== 'car' || v.state !== 'parked' || v.ownerId === personId) return 'You cannot take that.';
  const owner = state.people[v.ownerId];
  v.stolen = state.minute; v.state = 'manual_out'; v.driverId = personId;
  p.where = 'vehicle'; p.visible = false; p.pos = { ...v.pos };
  lifeEvent(state, p, `Stole ${owner ? `${owner.name}'s` : 'a'} ${v.name}`);
  if (owner) { lifeEvent(state, owner, `Had their ${v.name} stolen`); owner.needs.mood = Math.max(0, owner.needs.mood - 20); }
  const seen = Object.values(state.people).some((o) => !o.isPlayer && o.visible && !o.dead && Math.hypot(o.pos.x - v.pos.x, o.pos.z - v.pos.z) < 25);
  if (seen && owner) owner.relations[personId] = 0;
  crime(state, 'taking a vehicle without consent', 2);
  return `You break into ${owner ? `${owner.name.split(' ')[0]}'s` : 'the'} ${v.name} and hot-wire it. W/S to drive, A/D to steer, E to get out.`;
}

/** abandoned stolen cars are recovered by the police after a day */
export function stolenTick(state: GameState) {
  for (const v of Object.values(state.vehicles)) {
    if (!v.stolen || v.driverId || state.minute - v.stolen < 1440) continue;
    // someone's own car is found and handed back to them where it was left
    if (state.people[v.ownerId]) { v.stolen = undefined; v.state = 'parked'; continue; }
    delete state.containers[v.cargoId];
    delete state.vehicles[v.id];
  }
}

export function canDriveCar(state: GameState, v: Vehicle): string | undefined {
  if (v.stolen) return undefined;
  if (!state.people[v.ownerId]?.quals?.includes('driving')) return 'You need a driving licence (course and test at the Job Centre)';
  if (v.uninsured) return 'Uninsured: pay the overdue insurance first (keep money in your account)';
  return undefined;
}

export function enterCar(state: GameState, personId: Id, carId: Id): string {
  const v = state.vehicles[carId];
  const p = state.people[personId];
  if (!v || v.kind !== 'car' || (v.ownerId !== personId && !v.stolen) || v.state !== 'parked') return 'You cannot drive that.';
  const why = canDriveCar(state, v);
  if (why) return why;
  v.state = 'manual_out';
  v.driverId = personId;
  p.where = 'vehicle';
  p.visible = false;
  p.pos = { ...v.pos };
  return 'W/S to drive, A/D to steer, E to park and get out.';
}

/** park where it is and step out on the kerb side */
export function exitCar(state: GameState, personId: Id): { ok: boolean; msg: string } {
  const v = Object.values(state.vehicles).find((c) => c.kind === 'car' && c.driverId === personId) ?? playerCar(state, personId);
  const p = state.people[personId];
  if (!v || !p || v.driverId !== personId) return { ok: false, msg: 'You are not driving.' };
  v.state = 'parked';
  v.driverId = null;
  // out of the driver's door if there is room, else the passenger side, else behind the car
  const spots = [v.heading - Math.PI / 2, v.heading + Math.PI / 2, v.heading + Math.PI].map((a) => ({ x: v.pos.x + Math.sin(a) * 1.7, z: v.pos.z + Math.cos(a) * 1.7 }));
  const free = spots.find((q) => { const r = resolveCircle(q, 0.35); return Math.hypot(r.x - q.x, r.z - q.z) < 0.02; });
  p.pos = free ?? resolveCircle(spots[0], 0.35);
  p.where = locationOf(p.pos);
  p.visible = true;
  if (v.stolen) return { ok: true, msg: 'You leave the stolen car where it is.' };
  const km = Math.max(0, (v.odometer - (v.billedOdo ?? 0)) / 1000);
  const fuel = Math.round(km * FUEL_PER_KM);
  v.billedOdo = v.odometer;
  if (fuel > 0) transfer(state, { from: p.accountId, to: state.externalId, amount: fuel, reason: 'purchase', memo: `Fuel (${km.toFixed(1)} km)`, key: `fuel:${v.id}:${Math.round(v.odometer)}` });
  return { ok: true, msg: `Parked.${fuel > 0 ? ` Fuel ${fmtMoney(fuel)} for ${km.toFixed(1)} km.` : ''}` };
}

/** weekly insurance and road tax; unpaid, the car is off the road until it is paid */
export function carsTick(state: GameState) {
  for (const v of Object.values(state.vehicles)) {
    if (v.kind !== 'car' || v.nextCharge === undefined || state.minute < v.nextCharge) continue;
    const p = state.people[v.ownerId];
    if (!p) continue;
    const r = transfer(state, { from: p.accountId, to: state.externalId, amount: CAR_WEEKLY, reason: 'services', memo: `Car insurance & road tax (${v.name})`, key: `carins:${v.id}:${v.nextCharge}` });
    if (r.ok) {
      v.uninsured = false;
      v.nextCharge += 7 * 1440;
    } else {
      if (!v.uninsured) news(state, 'bad', 'Car insurance unpaid', `Your ${v.name} is off the road until ${fmtMoney(CAR_WEEKLY)} can be taken. We will try again tomorrow.`, p.isPlayer);
      v.uninsured = true;
      v.nextCharge += 1440;
    }
  }
}

// ---------------------------------------------------------------- damage
/** a knock: the side that hit takes the dents, and the engine suffers with it */
export function damageCar(state: GameState, v: Vehicle, impact: number, side: 0 | 1 | 2 | 3) {
  if (impact < 2.2 || v.wrecked) return;
  const d = (v.dmg ??= [0, 0, 0, 0]);
  d[side] = Math.min(1, d[side] + impact * impact * 0.004);
  v.condition = Math.max(0, v.condition - impact * impact * 0.12);
  // smashed beyond saving: it catches fire
  if (v.condition <= 0 && v.burning == null) v.burning = state.minute;
}

/** burning cars go up after a few seconds: anyone close by is caught in the blast */
export function carFireTick(state: GameState): Vehicle | null {
  for (const v of Object.values(state.vehicles)) {
    if (v.burning == null || v.wrecked || state.minute - v.burning < 1.6) continue;
    v.wrecked = true;
    v.state = 'parked';
    for (const o of Object.values(state.people)) {
      if (o.dead || o.away || (!o.visible && o.id !== v.driverId)) continue;
      const d = Math.hypot(o.pos.x - v.pos.x, o.pos.z - v.pos.z);
      if (d > 6) continue;
      if (o.id === v.driverId) { o.where = 'outside'; o.visible = true; }
      o.hit = { at: state.minute, dir: Math.atan2(o.pos.x - v.pos.x, o.pos.z - v.pos.z), heavy: true, by: v.driverId ?? o.id, force: 9 };
      hurt(state, o, (6 - d) * 14, 'caught in a car explosion', v.driverId ?? null, 0.05);
      if (!o.dead && o.down == null) floor(state, o, 1.6);
    }
    v.driverId = null;
    return v;
  }
  return null;
}

export const REPAIR_PER_POINT = 1500;
/** Eastgate Motors' yard: dents knocked out and, for a car the police are after, a quick respray */
export function garageJob(state: GameState, personId: Id, v: Vehicle): string {
  const p = state.people[personId];
  if (v.wrecked) return 'That is a burnt-out shell: nothing to fix.';
  const repair = Math.round((100 - v.condition) * REPAIR_PER_POINT / 100) * 100;
  const hot = !!state.wanted && state.wanted.level > 0;
  const cost = repair + (hot ? 50000 : 0);
  if (cost <= 0) return 'Nothing needs doing to it.';
  const r = transfer(state, { from: p.accountId, to: state.externalId, amount: cost, reason: 'purchase', memo: hot ? 'Respray and repairs (no questions)' : 'Car repairs', key: `garage:${v.id}:${Math.floor(state.minute)}` });
  if (!r.ok) return `That will be ${fmtMoney(cost)}. You can't cover it.`;
  v.condition = 100; v.dmg = [0, 0, 0, 0]; v.burning = null;
  if (hot) {
    const cols = ['#1b2631', '#c0392b', '#f0f3f4', '#2e86c1', '#1e8449', '#d4ac0d', '#6e2c00'];
    v.color = cols[(cols.indexOf(v.color ?? '') + 1 + Math.floor(rand(state) * (cols.length - 1))) % cols.length];
    state.wanted = null;
    return `A fresh coat of paint and new plates: ${fmtMoney(cost)}. The police are looking for a different car now.`;
  }
  return `Good as new: ${fmtMoney(cost)}.`;
}
