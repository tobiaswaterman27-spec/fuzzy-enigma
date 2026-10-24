// Harbour Bikes: docks of hire bikes round the city. Pay at the dock and ride off; get off anywhere and
// it waits for you where you left it; ride it into any dock to hand it back. Quicker than walking,
// slower than a car, and nobody calls the police about a bike.
import type { GameState, Id, Vehicle } from './types';
import { dist, fmtMoney } from './core';
import { transfer } from './ledger';
import { createContainer } from './inventory';
import { getWorld, locationOf } from './world/layout';
import { bikeDocksOf } from './world/spots';
import { resolveCircle } from './world/nav';

export const BIKE_FARE = 150;
export const bikeDocks = () => bikeDocksOf(getWorld().city);

export function hireBike(state: GameState, personId: Id): string {
  const p = state.people[personId];
  if (Object.values(state.vehicles).some((v) => v.kind === 'bike' && v.ownerId === personId)) return 'You already have a hire bike out.';
  const r = transfer(state, { from: p.accountId, to: state.externalId, amount: BIKE_FARE, reason: 'purchase', memo: 'Harbour Bikes hire', key: `bike:${personId}:${Math.floor(state.minute * 10)}` });
  if (!r.ok) return `A bike is ${fmtMoney(BIKE_FARE)}.`;
  const id = `bike_${personId}`;
  const box = state.containers[`${id}_basket`] ?? createContainer(state, 'van', 'bike', id, 4, undefined, `${id}_basket`);
  state.vehicles[id] = {
    id, name: 'Hire bike', ownerId: personId, kind: 'bike', pos: { ...p.pos }, heading: p.facing, route: [], routeIdx: 0, speed: 0,
    state: 'manual_out', driverId: personId, cargoId: box.id, shipmentId: null, waitUntil: 0, condition: 100, odometer: 0,
  };
  p.where = 'vehicle'; p.visible = false;
  return `${fmtMoney(BIKE_FARE)}. W/S to pedal and brake, A/D to steer, E to get off (ride into any dock to hand it back).`;
}

/** a little 50cc moped from the same docks: twice the pace of a bike, buzzing like a wasp */
export const MOPED_FARE = 800;
export function hireMoped(state: GameState, personId: Id): string {
  const p = state.people[personId];
  if (Object.values(state.vehicles).some((v) => v.kind === 'bike' && v.ownerId === personId)) return 'You already have one out.';
  const r = transfer(state, { from: p.accountId, to: state.externalId, amount: MOPED_FARE, reason: 'purchase', memo: 'Harbour Bikes moped hire', key: `moped:${personId}:${Math.floor(state.minute * 10)}` });
  if (!r.ok) return `A moped is ${fmtMoney(MOPED_FARE)}.`;
  const id = `bike_${personId}`;
  const box = state.containers[`${id}_basket`] ?? createContainer(state, 'van', 'bike', id, 4, undefined, `${id}_basket`);
  state.vehicles[id] = {
    id, name: 'Hire moped', ownerId: personId, kind: 'bike', model: 'moped', pos: { ...p.pos }, heading: p.facing, route: [], routeIdx: 0, speed: 0,
    state: 'manual_out', driverId: personId, cargoId: box.id, shipmentId: null, waitUntil: 0, condition: 100, odometer: 0,
  };
  p.where = 'vehicle'; p.visible = false;
  return `${fmtMoney(MOPED_FARE)}. W to go, S to brake, A/D to steer, E to get off (ride into any dock to hand it back).`;
}

/** off the bike: at a dock it goes back in the rack; anywhere else it waits for you */
export function leaveBike(state: GameState, personId: Id): string {
  const p = state.people[personId];
  const v = Object.values(state.vehicles).find((x) => x.kind === 'bike' && x.driverId === personId);
  if (!v) return '';
  v.driverId = null; v.state = 'parked';
  p.pos = resolveCircle({ x: v.pos.x + Math.sin(v.heading - Math.PI / 2) * 0.8, z: v.pos.z + Math.cos(v.heading - Math.PI / 2) * 0.8 }, 0.3);
  p.where = locationOf(p.pos); p.visible = true;
  if (bikeDocks().some((d) => dist(d, v.pos) < 4)) { delete state.vehicles[v.id]; return 'Bike docked. Thanks for riding Harbour Bikes.'; }
  return 'You lean the bike against the kerb.';
}

export function mountBike(state: GameState, personId: Id, v: Vehicle): string {
  const p = state.people[personId];
  if (v.ownerId !== personId) return 'Not your bike.';
  v.driverId = personId; v.state = 'manual_out';
  p.where = 'vehicle'; p.visible = false; p.pos = { ...v.pos };
  return 'Back on the bike.';
}
