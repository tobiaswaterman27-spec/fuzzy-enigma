// Goods-in at Harbour Wholesale: imported stock arrives on pallets at the goods-in bay and has to be
// put away into the racking before it can be picked. A Forklift Driver does it: get on the truck,
// lift a pallet, drive it to its product's bay and set it down. A townsperson in the job works through
// the pallets at a steady rate; anything still waiting at 13:00 is put away by the shift supervisor.
import type { GameState, Id, Person, Vehicle } from './types';
import { dayIndex, minuteOfDay } from './clock';
import { dist } from './core';
import { count, moveItems, total } from './inventory';
import { ITEMS, itemName } from './items';
import { isOnShift } from './employment';
import { getWorld, locationOf } from './world/layout';

export const GOODS_IN = 'wholesale_goodsin';
export const FORKLIFT_ID = 'forklift_1';
/** where pallets wait (the east side of the warehouse) and where the truck is parked */
export const GOODS_IN_SPOT = { x: -42.6, z: 36.6 };
export const FORKLIFT_PARK = { x: -43.0, z: 31.2 };
/** a pallet holds ten cases */
export const palletUnits = (product: string) => (ITEMS[product]?.caseSize ?? 10) * 10;
const NPC_MINUTES_PER_PALLET = 5;

export function forklift(state: GameState): Vehicle | undefined {
  return state.vehicles[FORKLIFT_ID];
}

/** a person working the forklift position right now */
export function forkliftOperator(state: GameState): Person | null {
  for (const p of Object.values(state.people)) {
    const c = p.contractId ? state.contracts[p.contractId] : null;
    if (c?.businessId === 'wholesale' && c.positionId === 'forklift' && isOnShift(state, p.id, 'wholesale')) return p;
  }
  return null;
}

export function palletsWaiting(state: GameState): number {
  const g = state.containers[GOODS_IN];
  if (!g) return 0;
  return Object.entries(g.items).reduce((n, [k, q]) => n + Math.ceil(q / palletUnits(k)), 0);
}

/** the product with the most stock waiting (the next pallet to lift) */
function nextPallet(state: GameState): string | null {
  const g = state.containers[GOODS_IN];
  if (!g) return null;
  let best: string | null = null;
  for (const [k, q] of Object.entries(g.items)) if (q > 0 && (!best || q > (g.items[best] ?? 0))) best = k;
  return best;
}

function rackFor(product: string) {
  return getWorld().interactables[`wh_rack_${product}`];
}

export function canDriveForklift(state: GameState, personId: Id): string | undefined {
  const p = state.people[personId];
  const c = p?.contractId ? state.contracts[p.contractId] : null;
  if (c?.businessId !== 'wholesale' || c.positionId !== 'forklift') return 'Only the forklift driver may use the truck';
  if (!isOnShift(state, personId, 'wholesale')) return 'Clock in at the staff terminal first';
  if (!p.quals?.includes('forklift')) return 'You need a forklift licence';
  return undefined;
}

export function mountForklift(state: GameState, personId: Id): string {
  const v = forklift(state);
  const p = state.people[personId];
  if (!v || v.state !== 'parked') return 'The forklift is in use.';
  const why = canDriveForklift(state, personId);
  if (why) return why;
  v.state = 'manual_out';
  v.driverId = personId;
  p.where = 'vehicle';
  p.visible = false;
  p.pos = { ...v.pos };
  return 'Drive to goods-in (W/S, A/D), press E by a pallet to lift it, then E at its bay in the racking.';
}

/** E while on the truck: lift a pallet at goods-in, set it down at its bay, or get off */
export function forkliftAction(state: GameState, personId: Id): { ok: boolean; msg: string } {
  const v = forklift(state);
  const p = state.people[personId];
  if (!v || !p || v.driverId !== personId) return { ok: false, msg: 'You are not on the forklift.' };
  const cargo = state.containers[v.cargoId];
  const carrying = Object.keys(cargo.items).find((k) => (cargo.items[k] ?? 0) > 0);
  if (!carrying && dist(v.pos, GOODS_IN_SPOT) < 3.2) {
    const k = nextPallet(state);
    if (!k) return { ok: false, msg: 'No pallets waiting at goods-in.' };
    const n = moveItems(state, GOODS_IN, v.cargoId, k, Math.min(palletUnits(k), count(state.containers[GOODS_IN], k)));
    return { ok: true, msg: `Lifted a pallet of ${n} ${itemName(k)}: take it to the ${itemName(k)} bay.` };
  }
  if (carrying) {
    const rack = rackFor(carrying);
    if (rack && dist(v.pos, rack.pos) < 2.0) {
      const n = moveItems(state, v.cargoId, rack.container!, carrying, cargo.items[carrying]!);
      (p.skills.warehouse = (p.skills.warehouse ?? 0) + 2);
      return { ok: true, msg: `Put away ${n} ${itemName(carrying)}. ${palletsWaiting(state)} pallet(s) left at goods-in.` };
    }
    const near = Object.values(getWorld().interactables).find((it) => it.kind === 'rack' && dist(v.pos, it.pos) < 2.0);
    if (near) return { ok: false, msg: `Wrong bay: this pallet is ${itemName(carrying)}.` };
  }
  return dismount(state, personId);
}

export function dismount(state: GameState, personId: Id): { ok: boolean; msg: string } {
  const v = forklift(state);
  const p = state.people[personId];
  if (!v || !p || v.driverId !== personId) return { ok: false, msg: 'You are not on the forklift.' };
  const cargo = state.containers[v.cargoId];
  if (total(cargo) > 0) return { ok: false, msg: 'Set the pallet down at its bay first.' };
  v.state = 'parked';
  v.driverId = null;
  const side = v.heading - Math.PI / 2;
  p.pos = { x: v.pos.x + Math.sin(side) * 1.2, z: v.pos.z + Math.cos(side) * 1.2 };
  p.where = locationOf(p.pos);
  p.visible = true;
  return { ok: true, msg: 'Off the forklift.' };
}

/** every minute: a townsperson on the truck puts pallets away; the supervisor clears the rest at 13:00 */
export function goodsInTick(state: GameState) {
  const g = state.containers[GOODS_IN];
  if (!g || total(g) === 0) return;
  const stock = 'wholesale_stock';
  const op = forkliftOperator(state);
  const now = Math.floor(state.minute);
  if (op && !op.isPlayer && now % NPC_MINUTES_PER_PALLET === 0) {
    const k = nextPallet(state);
    if (k) moveItems(state, GOODS_IN, stock, k, Math.min(palletUnits(k), count(g, k)));
  }
  const v = forklift(state);
  // the supervisor waits while the player is still on the truck
  if (minuteOfDay(now) >= 13 * 60 && !(v && v.driverId && state.people[v.driverId]?.isPlayer) && !state.processed[`goodsin_sweep:${dayIndex(now)}`]) {
    state.processed[`goodsin_sweep:${dayIndex(now)}`] = now;
    for (const k of Object.keys(g.items)) moveItems(state, GOODS_IN, stock, k, g.items[k] ?? 0);
    if (v && v.driverId === null && total(state.containers[v.cargoId]) > 0) for (const k of Object.keys(state.containers[v.cargoId].items)) moveItems(state, v.cargoId, stock, k, state.containers[v.cargoId].items[k] ?? 0);
  }
}
