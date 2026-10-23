// City buses. Every stop has the network map: pick where you are going, pay the fare, and the ride
// takes as long as the journey would (it passes quickly). You get off at the stop you chose.
import type { GameState, Id, Vec2 } from './types';
import { dist, fmtMoney } from './core';
import { transfer } from './ledger';
import { getWorld } from './world/layout';
import { districtAt, DISTRICT_NAMES, streetAt } from './world/city';

export interface BusStop { id: string; name: string; pos: Vec2 }
export const BUS_FARE = 250;

let stops: BusStop[] | null = null;
export function busStops(): BusStop[] {
  if (stops) return stops;
  const w = getWorld();
  const list: BusStop[] = [];
  for (const id of ['bus_w', 'bus_e']) { const n = w.nodes[id]; if (n) list.push({ id, name: `Harbourside, Main Street ${id === 'bus_w' ? 'West' : 'East'}`, pos: { x: n.x, z: n.z } }); }
  w.city.props.filter((p) => p.kind === 'bus_stop').forEach((p, i) => {
    // the stop is on the pavement; you wait just in front of the shelter
    list.push({ id: `bus_${i}`, name: `${DISTRICT_NAMES[districtAt(p.x, p.z)]}, ${streetAt(p.x, p.z + 7)}`, pos: { x: p.x, z: p.z + 1.2 } });
  });
  stops = list;
  return list;
}

export function busMinutes(from: Vec2, to: Vec2): number {
  // along the streets at about 25 km/h, with stops on the way
  return Math.round(4 + (Math.abs(from.x - to.x) + Math.abs(from.z - to.z)) / 330);
}

/** whether you could catch a bus from here to there right now (and why not) */
export function canRideBus(state: GameState, personId: Id, toId: string): string | null {
  const p = state.people[personId];
  const to = busStops().find((s) => s.id === toId);
  if (!to) return 'No such stop.';
  const from = busStops().reduce((a, b) => (dist(b.pos, p.pos) < dist(a.pos, p.pos) ? b : a));
  if (dist(from.pos, p.pos) > 6) return 'Wait at a bus stop.';
  if (from.id === to.id) return 'You are already here.';
  if ((state.ledger.accounts[p.accountId]?.balance ?? 0) < BUS_FARE) return `The fare is ${fmtMoney(BUS_FARE)}.`;
  return null;
}

/** get on: pay, and ride (hidden, time passing fast) until the bus reaches the stop */
export function rideBus(state: GameState, personId: Id, toId: string): { ok: boolean; msg: string } {
  const p = state.people[personId];
  const to = busStops().find((s) => s.id === toId);
  if (!to) return { ok: false, msg: 'No such stop.' };
  const from = busStops().reduce((a, b) => (dist(b.pos, p.pos) < dist(a.pos, p.pos) ? b : a));
  if (dist(from.pos, p.pos) > 6) return { ok: false, msg: 'Wait at a bus stop.' };
  if (from.id === to.id) return { ok: false, msg: 'You are already here.' };
  const r = transfer(state, { from: p.accountId, to: state.externalId, amount: BUS_FARE, reason: 'purchase', memo: `Bus fare to ${to.name}`, key: `bus:${personId}:${Math.floor(state.minute * 10)}` });
  if (!r.ok) return { ok: false, msg: `The fare is ${fmtMoney(BUS_FARE)}.` };
  const mins = busMinutes(from.pos, to.pos);
  p.away = { until: state.minute + mins, reason: `On the bus to ${to.name}`, place: 'bus', to: { ...to.pos } };
  p.visible = false; p.move = null; p.action = null; p.where = 'vehicle';
  return { ok: true, msg: `${fmtMoney(BUS_FARE)}, single to ${to.name}. About ${mins} minutes.` };
}
