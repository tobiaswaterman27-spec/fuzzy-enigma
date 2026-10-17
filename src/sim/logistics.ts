// SupplyChainSystem + VehicleSystem: orders, allocation, loading, a delivery
// van that physically drives the route, unloading, verified receipt and invoicing.
import type { Business, GameState, Id, Shipment, Vec2 } from './types';
import { at, dayIndex, fmtClock, minuteOfDay } from './clock';
import { dist, fmtMoney, nextId } from './core';
import { transfer } from './ledger';
import { addItems, count, moveAll, moveItems, total } from './inventory';
import { ITEMS, itemName } from './items';
import { news } from './events';
import { isOnShift, statsFor } from './employment';
import { getWorld } from './world/layout';

export const VAN_SPEED = 15; // metres per game minute
export const DISPATCH_HOUR = 6.5;
export const ORDER_CUTOFF = 18 * 60;

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
  for (const [item, qty] of Object.entries(s.items)) s.loaded[item] = moveItems(state, wh, dest, item, qty);
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
        for (const [item, qty] of Object.entries(s.items)) {
          const n = moveItems(state, wh, v.cargoId, item, qty);
          s.loaded[item] = n;
          if (n < qty) short = true;
        }
        s.status = 'in_transit';
        s.vehicleId = v.id;
        s.note = short ? 'Short shipment: supplier stock was insufficient.' : '';
        v.shipmentId = s.id;
        v.state = 'driving_out';
        v.route = w.vanRouteOut.map((p) => ({ ...p }));
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
        } else {
          v.state = 'parked';
          v.route = [];
          v.pos = { ...w.depot };
          // driver goes back to work at the depot
          for (const p of Object.values(state.people)) if (p.where === 'vehicle') { p.where = 'wholesale'; }
        }
      }
    } else if (v.state === 'unloading' && state.minute >= v.waitUntil) {
      const s = v.shipmentId ? state.shipments[v.shipmentId] : null;
      if (s) {
        const buyer = state.businesses[s.buyerId];
        const bay = buyer.stockContainers.find((c) => state.containers[c].kind === 'loading_bay')!;
        moveAll(state, v.cargoId, bay);
        s.status = 'arrived';
        s.arrivedAt = state.minute;
        news(state, 'info', `Delivery arrived at ${buyer.name}`, `${total(state.containers[bay])} items waiting at the loading bay to be checked in.`, isStaffPlayer(state, buyer.id));
      }
      v.shipmentId = null;
      v.state = 'returning';
      v.route = w.vanRouteBack.map((p: Vec2) => ({ ...p }));
      v.routeIdx = 1;
    }
  }
}

function isStaffPlayer(state: GameState, bid: Id) {
  const p = state.people[state.playerId];
  return !!p.contractId && state.contracts[p.contractId]?.businessId === bid;
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
