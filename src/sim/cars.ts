// Owning a car: buy one from Harbour Motors on your phone, it is delivered to the kerb outside
// Marlow Court, and you can drive it anywhere and park it where you like. Insurance and road tax
// are taken weekly; fuel is paid at the end of each drive.
import type { GameState, Id, Vehicle } from './types';
import { at, dayIndex } from './clock';
import { fmtMoney } from './core';
import { transfer } from './ledger';
import { news, lifeEvent } from './events';
import { createContainer } from './inventory';
import { locationOf } from './world/layout';
import { resolveCircle } from './world/nav';

export interface CarModel { id: string; name: string; price: number; topSpeed: number; colors: string[]; blurb: string }

export const CAR_MODELS: CarModel[] = [
  { id: 'hatch', name: 'Used hatchback (12 years old)', price: 280000, topSpeed: 12, colors: ['#8a8f94', '#7b2d26', '#2b4a6f'], blurb: 'High mileage, but it starts every morning.' },
  { id: 'saloon', name: 'Family saloon (5 years old)', price: 720000, topSpeed: 14, colors: ['#1b2631', '#e5e7e9', '#5d6d7e'], blurb: 'Comfortable, economical, one careful owner.' },
  { id: 'new', name: 'Brand-new compact', price: 1650000, topSpeed: 16, colors: ['#c0392b', '#1e8449', '#f0f3f4', '#d4ac0d'], blurb: 'Straight from the factory with a full warranty.' },
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
  return Object.values(state.vehicles).find((v) => v.kind === 'car' && v.ownerId === personId) ?? null;
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

export function canDriveCar(state: GameState, v: Vehicle): string | undefined {
  if (!state.people[v.ownerId]?.quals?.includes('driving')) return 'You need a driving licence (course and test at the Job Centre)';
  if (v.uninsured) return 'Uninsured: pay the overdue insurance first (keep money in your account)';
  return undefined;
}

export function enterCar(state: GameState, personId: Id, carId: Id): string {
  const v = state.vehicles[carId];
  const p = state.people[personId];
  if (!v || v.kind !== 'car' || v.ownerId !== personId || v.state !== 'parked') return 'You cannot drive that.';
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
  const v = playerCar(state, personId);
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
