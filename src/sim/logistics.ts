// SupplyChainSystem + VehicleSystem: orders, allocation, loading, a delivery
// van that physically drives the route, unloading, verified receipt and invoicing.
import type { Business, GameState, Id, Shipment, Task, Vec2 } from './types';
import { at, dayIndex, fmtClock, minuteOfDay } from './clock';
import { dist, fmtMoney, nextId } from './core';
import { transfer } from './ledger';
import { addItems, count, moveAll, moveItems, total } from './inventory';
import { ITEMS, itemName } from './items';
import { news } from './events';
import { isOnShift, statsFor } from './employment';
import { getWorld, SHOPS } from './world/layout';

export const VAN_SPEED = 15; // metres per game minute
export const DISPATCH_HOUR = 6.5;
export const ORDER_CUTOFF = 18 * 60;

// ---------------------------------------------------------------- picking
/** picked order lines wait here (by the loading door) until the van is loaded */
export const STAGING = 'wholesale_staging';

/** units of an item still to be picked for one shipment */
export const pickNeed = (s: Shipment, item: string) => Math.max(0, (s.items[item] ?? 0) - (s.picked?.[item] ?? 0));

/** shipments waiting for dispatch from a supplier, oldest dispatch first */
export function pickQueue(state: GameState, supplierId: Id): Shipment[] {
  return Object.values(state.shipments).filter((s) => s.supplierId === supplierId && s.status === 'ordered').sort((a, b) => a.dispatchAt - b.dispatchAt || a.orderedAt - b.orderedAt);
}

/** units of an item the open orders still need picked, minus what pickers are already carrying */
export function pickDemand(state: GameState, supplierId: Id, item: string): number {
  let n = 0;
  for (const s of pickQueue(state, supplierId)) n += pickNeed(s, item);
  for (const p of Object.values(state.people)) {
    const c = p.contractId ? state.contracts[p.contractId] : null;
    if (c?.businessId === supplierId) n -= count(state.containers[p.handsId], item);
  }
  return Math.max(0, n);
}

/** a picker puts what they carry into the staging lanes: it is allocated to the oldest orders that need it */
export function stageFromHands(state: GameState, personId: Id, supplierId: Id): { units: number; orders: string[] } {
  const p = state.people[personId];
  const hands = state.containers[p.handsId];
  const orders: string[] = [];
  let units = 0;
  for (const [item, have] of Object.entries({ ...hands.items })) {
    let left = have;
    for (const s of pickQueue(state, supplierId)) {
      if (left <= 0) break;
      const k = Math.min(left, pickNeed(s, item));
      if (k <= 0) continue;
      const moved = moveItems(state, p.handsId, STAGING, item, k);
      (s.picked ??= {})[item] = (s.picked[item] ?? 0) + moved;
      left -= moved;
      units += moved;
      const name = state.businesses[s.buyerId]?.name ?? s.buyerId;
      if (!orders.includes(name)) orders.push(name);
    }
  }
  return { units, orders };
}

/** loading: picked units come out of the staging lanes, anything not picked in time straight off the racking */
function loadLine(state: GameState, s: Shipment, wh: Id, dest: Id, item: string, qty: number): number {
  let n = 0;
  const staged = Math.min(qty, s.picked?.[item] ?? 0);
  if (staged > 0 && state.containers[STAGING]) {
    n += moveItems(state, STAGING, dest, item, staged);
    s.picked![item] -= n;
  }
  if (n < qty) n += moveItems(state, wh, dest, item, qty - n);
  return n;
}

/** keep a pick task for each order line still to be picked */
export function warehouseTick(state: GameState, supplierId: Id) {
  const open = new Map<string, Task>();
  for (const t of Object.values(state.tasks)) if (t.businessId === supplierId && t.kind === 'pick' && (t.status === 'open' || t.status === 'claimed')) open.set(t.target, t);
  const live = new Set<string>();
  for (const s of pickQueue(state, supplierId)) for (const item of Object.keys(s.items)) {
    if (pickNeed(s, item) <= 0) continue;
    const key = `${s.id}|${item}`;
    live.add(key);
    if (!open.has(key)) {
      const t: Task = { id: nextId(state, 'task'), businessId: supplierId, kind: 'pick', target: key, product: item, status: 'open', claimedBy: null, createdAt: state.minute, doneAt: null, doneBy: null };
      state.tasks[t.id] = t;
    }
  }
  for (const [key, t] of open) if (!live.has(key)) { t.status = 'done'; t.doneAt = state.minute; t.doneBy = t.claimedBy; }
  // staged stock no order is waiting for any more (a split or cancelled order) goes back on the racking
  const stage = state.containers[STAGING];
  const back = state.businesses[supplierId]?.stockContainers[0];
  if (stage && back) for (const [item, have] of Object.entries({ ...stage.items })) {
    const reserved = pickQueue(state, supplierId).reduce((n, s) => n + (s.picked?.[item] ?? 0), 0);
    if (have > reserved) moveItems(state, STAGING, back, item, have - reserved);
  }
  // claims held by people no longer on shift are released
  for (const t of open.values()) if (t.claimedBy && !isOnShift(state, t.claimedBy, supplierId)) { t.claimedBy = null; t.status = 'open'; }
}

export function placeOrder(state: GameState, buyerId: Id, supplierId: Id, items: Record<string, number>): Shipment | null {
  const supplier = state.businesses[supplierId];
  if (!supplier) return null;
  const now = state.minute;
  const day = dayIndex(now);
  const dispatchDay = minuteOfDay(now) < ORDER_CUTOFF && minuteOfDay(now) < DISPATCH_HOUR * 60 ? day : day + 1;
  const unitPrices: Record<string, number> = {};
  for (const k of Object.keys(items)) unitPrices[k] = supplier.prices[k] ?? ITEMS[k].wholesale;
  const s: Shipment = {
    id: nextId(state, 'ship'), supplierId, buyerId, items: { ...items }, loaded: {}, unitPrices, status: 'ordered', orderedAt: now,
    dispatchAt: at(dispatchDay, 6, 30), arrivedAt: null, receivedAt: null, receivedBy: null, vehicleId: null, invoiced: 0, paid: false, note: '',
  };
  state.shipments[s.id] = s;
  return s;
}

/** Wholesaler keeps its warehouse stocked by importing from the rest of the country. */
export function wholesaleImports(state: GameState, w: Business) {
  const wh = state.containers[w.stockContainers[0]];
  for (const [item, rule] of Object.entries(w.reorder)) {
    const have = count(wh, item);
    if (have >= rule.min) continue;
    if (state.flags[`disrupt_${item}`]) {
      news(state, 'bad', `Supply problem: ${itemName(item)}`, `${w.name} could not import ${itemName(item)} - national shortage.`);
      continue;
    }
    const qty = rule.target - have;
    const cost = qty * ITEMS[item].importCost;
    const r = transfer(state, { from: w.accountId, to: state.externalId, amount: cost, reason: 'import', memo: `Import ${qty} ${itemName(item)}`, key: `import:${w.id}:${item}:${dayIndex(state.minute)}` });
    if (!r.ok) continue;
    addItems(wh, item, qty);
    const prevN = have;
    const prevC = w.unitCost[item] ?? ITEMS[item].importCost;
    w.unitCost[item] = Math.round((prevN * prevC + qty * ITEMS[item].importCost) / Math.max(1, prevN + qty));
    statsFor(state, w).otherCosts += cost;
  }
}

function driverOnDuty(state: GameState, supplierId: Id): Id | null {
  // a player on shift as a driver takes the van out themselves
  const pl = state.people[state.playerId];
  if (pl?.contractId && state.contracts[pl.contractId]?.businessId === supplierId && state.contracts[pl.contractId].positionId === 'driver' && isOnShift(state, pl.id, supplierId)) return pl.id;
  for (const p of Object.values(state.people)) {
    if (!p.contractId) continue;
    const c = state.contracts[p.contractId];
    if (c.businessId === supplierId && c.positionId === 'driver' && isOnShift(state, p.id, supplierId)) return p.id;
  }
  return null;
}

/** Simplified customers (the cafe) collect their goods: allocated and invoiced at dispatch time. */
function collectAtDepot(state: GameState, s: Shipment) {
  const supplier = state.businesses[s.supplierId];
  const buyer = state.businesses[s.buyerId];
  const wh = supplier.stockContainers[0];
  const dest = buyer.stockContainers[0];
  for (const [item, qty] of Object.entries(s.items)) s.loaded[item] = loadLine(state, s, wh, dest, item, qty);
  s.status = 'received';
  s.receivedAt = state.minute;
  settleInvoice(state, s);
}

export function logisticsTick(state: GameState, dt: number) {
  const w = getWorld();
  for (const v of Object.values(state.vehicles)) {
    if (v.state === 'parked') {
      const due = Object.values(state.shipments)
        .filter((s) => s.supplierId === v.ownerId && s.status === 'ordered' && s.dispatchAt <= state.minute)
        .sort((a, b) => a.orderedAt - b.orderedAt);
      for (const s of due) {
        const buyer = state.businesses[s.buyerId];
        if (buyer.kind !== 'retail') { collectAtDepot(state, s); continue; }
        const driver = driverOnDuty(state, v.ownerId);
        if (!driver) break; // no driver - the delivery waits (a real disruption)
        const supplier = state.businesses[v.ownerId];
        const wh = supplier.stockContainers[0];
        let short = false;
        const rest: Record<string, number> = {};
        const cargo = state.containers[v.cargoId];
        for (const [item, qty] of Object.entries(s.items)) {
          // the van only holds so much: what does not fit goes out on the next run
          const room = Math.max(0, cargo.capacity - total(cargo));
          const want = Math.min(qty, room);
          const n = want > 0 ? loadLine(state, s, wh, v.cargoId, item, want) : 0;
          s.loaded[item] = n;
          if (n < want) short = true;
          if (want < qty) rest[item] = qty - want;
        }
        s.status = 'in_transit';
        s.vehicleId = v.id;
        s.note = short ? 'Short shipment: supplier stock was insufficient.' : '';
        if (Object.keys(rest).length) {
          // split delivery: the remainder is a new order dispatched as soon as the van is back
          const r: Shipment = { ...s, id: nextId(state, 'ship'), items: rest, loaded: {}, picked: {}, status: 'ordered', dispatchAt: state.minute, vehicleId: null, invoiced: 0, paid: false, note: `Second part of ${s.id} (van was full).` };
          state.shipments[r.id] = r;
          s.items = Object.fromEntries(Object.entries(s.items).map(([k, q]) => [k, q - (rest[k] ?? 0)]).filter(([, q]) => (q as number) > 0));
          s.note = `${s.note} Split: the van was full.`.trim();
        }
        v.shipmentId = s.id;
        v.route = (SHOPS[s.buyerId]?.vanOut?.length ? SHOPS[s.buyerId].vanOut : w.vanRouteOut).map((p) => ({ ...p }));
        if (driver === state.playerId) {
          // loaded and waiting at the depot for you to drive it
          v.state = 'loaded';
          v.driverId = driver;
          news(state, 'info', `Van loaded for ${buyer.name}`, 'Get in the van at the Harbour Wholesale depot and drive it to their loading bay.', true);
          break;
        }
        v.state = 'driving_out';
        v.pos = { ...v.route[0] };
        v.routeIdx = 1;
        const dp = state.people[driver];
        dp.where = 'vehicle';
        dp.visible = false;
        if (short) news(state, 'bad', `Short delivery to ${buyer.name}`, `${supplier.name} could not supply everything ordered.`);
        break;
      }
    } else if (v.state === 'driving_out' || v.state === 'returning') {
      let step = v.speed * dt;
      while (step > 0 && v.routeIdx < v.route.length) {
        const tgt = v.route[v.routeIdx];
        const d = dist(v.pos, tgt);
        if (d < 1e-6) { v.routeIdx++; continue; }
        const mv = Math.min(step, d);
        const dx = (tgt.x - v.pos.x) / d, dz = (tgt.z - v.pos.z) / d;
        v.pos = { x: v.pos.x + dx * mv, z: v.pos.z + dz * mv };
        v.heading = Math.atan2(dx, dz);
        v.odometer += mv;
        step -= mv;
        if (mv >= d - 1e-6) v.routeIdx++;
      }
      if (v.routeIdx >= v.route.length) {
        if (v.state === 'driving_out') {
          v.state = 'unloading';
          v.waitUntil = state.minute + 6;
        } else parkAtDepot(state, v);
      }
    } else if (v.state === 'manual_out') {
      // the player drives; it unloads once parked at the buyer's bay
      const dest = v.route[v.route.length - 1];
      if (dest && dist(v.pos, dest) < 7) { v.state = 'unloading'; v.waitUntil = state.minute + 6; }
    } else if (v.state === 'manual_back') {
      if (dist(v.pos, w.depot) < 7) parkAtDepot(state, v);
    } else if (v.state === 'unloading' && state.minute >= v.waitUntil) {
      const s = v.shipmentId ? state.shipments[v.shipmentId] : null;
      if (s) {
        const buyer = state.businesses[s.buyerId];
        const bay = buyer.stockContainers.find((c) => state.containers[c].kind === 'loading_bay')!;
        const cargo = state.containers[v.cargoId];
        moveAll(state, v.cargoId, bay);
        // anything the bay had no room for goes back to the depot and is not invoiced
        for (const [item, left] of Object.entries(cargo.items)) {
          if (!left) continue;
          s.loaded[item] = Math.max(0, (s.loaded[item] ?? 0) - left);
          s.note = `${s.note} ${left} ${itemName(item)} taken back (loading bay full).`.trim();
        }
        s.status = 'arrived';
        s.arrivedAt = state.minute;
        news(state, 'info', `Delivery arrived at ${buyer.name}`, `${total(state.containers[bay])} items waiting at the loading bay to be checked in.`, isStaffPlayer(state, buyer.id));
      }
      v.shipmentId = null;
      if (v.driverId) {
        v.state = 'manual_back';
        if (v.driverId === state.playerId) news(state, 'good', 'Unloaded', 'Drive the van back to the depot and park it.', true);
      } else {
        v.state = 'returning';
        v.route = ((s && SHOPS[s.buyerId]?.vanBack?.length ? SHOPS[s.buyerId].vanBack : null) || w.vanRouteBack).map((p: Vec2) => ({ ...p }));
        v.routeIdx = 1;
      }
    }
  }
}

/** back at the depot: undelivered cargo returns to the warehouse, the driver gets out */
function parkAtDepot(state: GameState, v: GameState['vehicles'][string]) {
  const w = getWorld();
  v.state = 'parked';
  v.route = [];
  v.pos = { ...w.depot };
  v.heading = Math.PI;
  const back = state.businesses[v.ownerId]?.stockContainers[0];
  if (back) moveAll(state, v.cargoId, back);
  if (v.driverId) {
    const p = state.people[v.driverId];
    if (p) { p.where = 'outside'; p.visible = true; p.pos = { x: w.depot.x + 2.2, z: w.depot.z }; if (p.isPlayer) news(state, 'good', 'Delivery run complete', 'Van parked at the depot.', true); }
    v.driverId = null;
  }
  // NPC drivers go back to work at the depot
  for (const p of Object.values(state.people)) if (p.where === 'vehicle') { p.where = 'wholesale'; }
}

function isStaffPlayer(state: GameState, bid: Id) {
  const p = state.people[state.playerId];
  return state.businesses[bid]?.ownerId === p.id || (!!p.contractId && state.contracts[p.contractId]?.businessId === bid);
}

/** Verified receipt: arrived cargo is counted into the store room and the invoice is paid. */
export function checkInDeliveries(state: GameState, buyerId: Id, by: Id | null): { ok: boolean; msg: string; units: number } {
  const buyer = state.businesses[buyerId];
  const bay = buyer.stockContainers.find((c) => state.containers[c].kind === 'loading_bay')!;
  const backroom = buyer.stockContainers[0];
  const arrived = Object.values(state.shipments).filter((s) => s.buyerId === buyerId && s.status === 'arrived');
  if (!arrived.length) return { ok: false, msg: 'No delivery waiting.', units: 0 };
  let units = 0;
  for (const s of arrived) {
    for (const [item, qty] of Object.entries(s.loaded)) {
      const before = count(state.containers[backroom], item);
      const n = moveItems(state, bay, backroom, item, qty);
      units += n;
      // weighted average cost
      const prevC = buyer.unitCost[item] ?? s.unitPrices[item];
      buyer.unitCost[item] = Math.round((before * prevC + n * s.unitPrices[item]) / Math.max(1, before + n));
      if (n < qty) s.note = `${s.note} Discrepancy: ${qty - n} ${itemName(item)} missing at check-in.`.trim();
    }
    s.status = 'received';
    s.receivedAt = state.minute;
    s.receivedBy = by;
    settleInvoice(state, s);
  }
  return { ok: true, msg: `Checked in ${units} items.`, units };
}

export function settleInvoice(state: GameState, s: Shipment) {
  if (s.paid) return;
  const buyer = state.businesses[s.buyerId];
  const supplier = state.businesses[s.supplierId];
  let amount = 0;
  for (const [item, n] of Object.entries(s.loaded)) amount += n * s.unitPrices[item];
  s.invoiced = amount;
  if (amount <= 0) { s.paid = true; return; }
  const r = transfer(state, { from: buyer.accountId, to: supplier.accountId, amount, reason: 'supplier_invoice', memo: `Invoice ${s.id} ${supplier.name}`, ref: s.id, key: `invoice:${s.id}` });
  if (r.ok) {
    s.paid = true;
    let cogs = 0;
    for (const [item, n] of Object.entries(s.loaded)) cogs += n * (supplier.unitCost[item] ?? ITEMS[item].importCost);
    const st = statsFor(state, supplier);
    st.revenue += amount;
    st.cogs += cogs;
    st.customers++;
  } else if (state.people[state.playerId].contractId) {
    news(state, 'bad', `${buyer.name} could not pay ${supplier.name}`, `Invoice of ${fmtMoney(amount)} is outstanding.`);
  }
}

/** retry unpaid invoices each morning */
export function retryInvoices(state: GameState) {
  for (const s of Object.values(state.shipments)) if (s.status === 'received' && !s.paid) settleInvoice(state, s);
  // forget old closed shipments
  for (const [id, s] of Object.entries(state.shipments)) if (s.status === 'received' && s.paid && state.minute - (s.receivedAt ?? 0) > 3 * 1440) delete state.shipments[id];
}

export const shipmentEta = (s: Shipment) => (s.status === 'ordered' ? `dispatch ${fmtClock(s.dispatchAt)}` : s.status);
