// Boat hire at the pontoon on the quay: take a little motor boat out on the harbour for half an hour.
// Out on the water you can stop and fish (the big ones are further out), then bring it back.
import type { GameState, Id } from './types';
import { dist, fmtMoney } from './core';
import { transfer } from './ledger';
import { createContainer } from './inventory';
import { QUAY_EDGE } from './world/layout';
import { news } from './events';

export const BOAT_ID = 'boat_hire';
export const PONTOON = { x: 24, z: QUAY_EDGE - 1.2 };
export const BOAT_PRICE = 2000;
export const BOAT_MINUTES = 30;
/** where the boat waits for you, just off the pontoon */
const MOORING = { x: 24, z: QUAY_EDGE + 4 };

export function hireBoat(state: GameState, personId: Id): { ok: boolean; msg: string } {
  const p = state.people[personId];
  if (state.vehicles[BOAT_ID]) return { ok: false, msg: 'The hire boat is out.' };
  const r = transfer(state, { from: p.accountId, to: state.externalId, amount: BOAT_PRICE, reason: 'purchase', memo: 'Harbour boat hire (30 min)', key: `boat:${Math.floor(state.minute)}` });
  if (!r.ok) return { ok: false, msg: `Boat hire is ${fmtMoney(BOAT_PRICE)} for half an hour.` };
  const boot = state.containers[`${BOAT_ID}_hold`] ?? createContainer(state, 'van', 'harbour', BOAT_ID, 10, undefined, `${BOAT_ID}_hold`);
  state.vehicles[BOAT_ID] = {
    id: BOAT_ID, name: 'Hire boat', ownerId: personId, kind: 'boat', pos: { ...MOORING }, heading: 0, route: [], routeIdx: 0, speed: 0,
    state: 'manual_out', driverId: personId, cargoId: boot.id, shipmentId: null, waitUntil: state.minute + BOAT_MINUTES, condition: 100, odometer: 0,
  };
  p.where = 'vehicle'; p.visible = false; p.pos = { ...MOORING };
  return { ok: true, msg: `Half an hour on the water. W/S throttle, A/D steer. Stop out at sea and press E to fish; bring it back to the pontoon and press E to get off.` };
}

/** back at the pontoon: off the boat, and any time over is charged */
export function returnBoat(state: GameState, personId: Id): { ok: boolean; msg: string } {
  const v = state.vehicles[BOAT_ID], p = state.people[personId];
  if (!v || v.driverId !== personId) return { ok: false, msg: '' };
  if (dist(v.pos, MOORING) > 8) return { ok: false, msg: 'Bring the boat back to the pontoon (the ladder by the hire sign) to get off.' };
  const over = Math.max(0, Math.ceil((state.minute - v.waitUntil) / 15));
  if (over) transfer(state, { from: p.accountId, to: state.externalId, amount: over * 500, reason: 'purchase', memo: 'Boat hire: extra time', key: `boatover:${Math.floor(state.minute)}` });
  delete state.vehicles[BOAT_ID];
  p.where = 'outside'; p.visible = true; p.pos = { ...PONTOON };
  return { ok: true, msg: over ? `Back on dry land. ${over * 15} minutes over: ${fmtMoney(over * 500)} extra.` : 'Back on dry land.' };
}

/** time's up: a reminder; well over and the hire firm sends someone out for it */
export function boatTick(state: GameState) {
  const v = state.vehicles[BOAT_ID];
  if (!v) return;
  if (Math.floor(state.minute) === Math.floor(v.waitUntil)) news(state, 'info', "Time's up on the boat", 'Bring it back to the pontoon (extra time is charged).', true);
}

/** the water you can steer about in: the harbour beyond the quay wall */
export const WATER = { x0: -140, z0: QUAY_EDGE + 1.6, x1: 140, z1: QUAY_EDGE + 150 };
