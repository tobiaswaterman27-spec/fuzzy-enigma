// The railway. Central Station has the city's only real platform; the line runs out to two halts, one
// on the seafront at Westbay and one up in Northfield. Buy a ticket (or just get on at a halt and pay
// on the train), and the ride passes like the bus: you step off on the platform you chose.
import type { GameState, Id, Vec2 } from './types';
import { dist, fmtMoney } from './core';
import { transfer } from './ledger';
import { ESPLANADE_Z, ROAD_HALF, WALK_W } from './world/city';
import { planVenues } from './world/venues';
import { getWorld } from './world/layout';

export interface TrainStop { id: string; name: string; pos: Vec2 }
export const TRAIN_FARE = 420;
const C = ROAD_HALF + WALK_W / 2;
/** the halts, on the pavement by the line's footbridge */
export const HALTS: TrainStop[] = [
  { id: 'halt_west', name: 'Westbay (seafront)', pos: { x: -630, z: ESPLANADE_Z - C } },
  { id: 'halt_north', name: 'Northfield Parkway', pos: { x: -200, z: -1040 - C } },
];

let stops: TrainStop[] | null = null;
export function trainStops(): TrainStop[] {
  if (stops) return stops;
  const list: TrainStop[] = [];
  const st = planVenues(getWorld().city).find((v) => v.kind === 'station');
  const plat = st && getWorld().interactables[`${st.id}_platform`];
  if (plat) list.push({ id: 'central', name: 'Central Station', pos: { ...plat.pos } });
  stops = [...list, ...HALTS];
  return stops;
}

export const trainMinutes = (from: Vec2, to: Vec2) => Math.round(3 + Math.hypot(from.x - to.x, from.z - to.z) / 900);

export function rideTrain(state: GameState, personId: Id, toId: string): { ok: boolean; msg: string } {
  const p = state.people[personId];
  const to = trainStops().find((s) => s.id === toId);
  if (!to) return { ok: false, msg: 'No such stop.' };
  const from = trainStops().reduce((a, b) => (dist(b.pos, p.pos) < dist(a.pos, p.pos) ? b : a));
  // at the station you can buy at the machines in the concourse too
  if (dist(from.pos, p.pos) > (from.id === 'central' ? 30 : 6)) return { ok: false, msg: 'Go to a platform.' };
  if (from.id === to.id) return { ok: false, msg: 'You are already here.' };
  const r = transfer(state, { from: p.accountId, to: state.externalId, amount: TRAIN_FARE, reason: 'purchase', memo: `Train ticket to ${to.name}`, key: `train:${personId}:${Math.floor(state.minute * 10)}` });
  if (!r.ok) return { ok: false, msg: `A ticket is ${fmtMoney(TRAIN_FARE)}.` };
  const mins = trainMinutes(from.pos, to.pos);
  p.away = { until: state.minute + mins, reason: `On the train to ${to.name}`, place: 'train', to: { ...to.pos } };
  p.visible = false; p.move = null; p.action = null; p.where = 'vehicle';
  return { ok: true, msg: `${fmtMoney(TRAIN_FARE)}, single to ${to.name}. About ${mins} minutes.` };
}
