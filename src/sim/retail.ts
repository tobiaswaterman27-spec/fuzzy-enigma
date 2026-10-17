// BusinessSimulation (retail): shelves, till queue, sales, workplace tasks,
// cleanliness, reputation, reordering and daily accounts.
import type { Business, DirtSpot, GameState, Id, Person, Task, TaskKind } from './types';
import { dayIndex, fmtDate, minuteOfDay, MIN_PER_DAY } from './clock';
import { clamp, fmtMoney, nextId, pick, rand } from './core';
import { transfer } from './ledger';
import { count, moveAll, moveItems, total } from './inventory';
import { ITEMS, PRODUCTS, itemName } from './items';
import { news } from './events';
import { filledCount, isOnShift, openAttendance, statsFor } from './employment';
import { placeOrder } from './logistics';
import { QUEUE_SLOTS } from './world/layout';

export const SHELF_CAPACITY = 30;
export const RESTOCK_BELOW = 13;
export const RESTOCK_DONE = 24;

export const shelfId = (p: string) => `shelf_${p}`;

export function isOpen(b: Business, minute: number): boolean {
  const dow = dayIndex(minute) % 7;
  const m = minuteOfDay(minute);
  return b.open.some((s) => s.days.includes(dow) && m >= s.start && m < s.end);
}

export function staffOnDuty(state: GameState, businessId: Id): Person[] {
  return Object.values(state.people).filter((p) => isOnShift(state, p.id, businessId));
}

/** price including sales tax */
export const priceOf = (b: Business, item: string) => b.prices[item] ?? ITEMS[item]?.retail ?? 0;

export function basketValue(state: GameState, b: Business, basketId: Id): number {
  const c = state.containers[basketId];
  let v = 0;
  for (const [k, n] of Object.entries(c.items)) v += priceOf(b, k) * n;
  return v;
}

// ------------------------------------------------------------------ sales
export interface SaleResult {
  ok: boolean;
  total: number;
  units: number;
  msg: string;
}

/** Customer pays for everything in their basket; goods move basket -> bag. */
export function completeSale(state: GameState, businessId: Id, customerId: Id, staffId: Id | null): SaleResult {
  const b = state.businesses[businessId];
  const cust = state.people[customerId];
  const basket = state.containers[cust.basketId];
  const backroom = b.stockContainers[0];
  const acc = state.ledger.accounts[cust.accountId];
  let value = basketValue(state, b, basket.id);
  // drop the most expensive items until the customer can afford the rest
  while (value > 0 && !acc.allowNegative && value > acc.balance) {
    const dear = Object.keys(basket.items).sort((x, y) => priceOf(b, y) - priceOf(b, x))[0];
    moveItems(state, basket.id, backroom, dear, 1);
    value = basketValue(state, b, basket.id);
  }
  const units = total(basket);
  if (units === 0 || value <= 0) return { ok: false, total: 0, units: 0, msg: 'Nothing to pay for.' };
  const saleId = nextId(state, 'sale');
  const t = transfer(state, { from: cust.accountId, to: b.accountId, amount: value, reason: 'sale', memo: `${b.name}: ${units} items`, ref: saleId, key: saleId });
  if (!t.ok) return { ok: false, total: 0, units: 0, msg: t.error };
  const taxRate = state.policy.salesTax;
  const tax = Math.round((value * taxRate) / (1 + taxRate));
  if (tax > 0) transfer(state, { from: b.accountId, to: state.businesses[state.governmentId].accountId, amount: tax, reason: 'sales_tax', memo: `Sales tax ${b.name}`, ref: saleId, key: `${saleId}:tax` });
  const s = statsFor(state, b);
  let cogs = 0;
  for (const [k, n] of Object.entries(basket.items)) cogs += (b.unitCost[k] ?? ITEMS[k].wholesale) * n;
  s.revenue += value - tax;
  s.cogs += cogs;
  s.customers++;
  moveAll(state, basket.id, cust.bagId);
  if (staffId) {
    const a = openAttendance(state, staffId);
    if (a) { a.served++; a.tasks++; }
  }
  // a small chance that a visit leaves a mess behind
  if (rand(state) < 0.05) spawnDirt(state, b.id);
  return { ok: true, total: value, units, msg: `Paid ${fmtMoney(value)} for ${units} item${units > 1 ? 's' : ''}.` };
}

// ------------------------------------------------------------------ queue
export function joinQueue(state: GameState, tillId: Id, personId: Id): number {
  const till = state.tills[tillId];
  if (!till.queue.includes(personId)) till.queue.push(personId);
  return till.queue.indexOf(personId);
}

export function leaveQueue(state: GameState, tillId: Id, personId: Id) {
  const till = state.tills[tillId];
  const i = till.queue.indexOf(personId);
  if (i >= 0) till.queue.splice(i, 1);
  if (i === 0) till.scanned = {};
}

export const queueSlot = (i: number) => QUEUE_SLOTS[Math.min(i, QUEUE_SLOTS.length - 1)];

/** customer gives up: their basket goes back to the store room for restocking */
export function walkout(state: GameState, businessId: Id, tillId: Id, personId: Id) {
  const b = state.businesses[businessId];
  const p = state.people[personId];
  leaveQueue(state, tillId, personId);
  moveAll(state, p.basketId, b.stockContainers[0]);
  statsFor(state, b).walkouts++;
  for (const staff of staffOnDuty(state, businessId)) {
    const a = openAttendance(state, staff.id);
    if (a) a.waitPenalty += 6;
  }
  if (staffOnDuty(state, businessId).some((s) => s.isPlayer)) news(state, 'bad', 'A customer walked out', `${p.name} gave up waiting at the till.`, true);
}

// ------------------------------------------------------------------ dirt
const DIRT_SPOTS = [
  { x: 14.5, z: -19.5 }, { x: 19.5, z: -20.5 }, { x: 24.5, z: -23 }, { x: 29.5, z: -19 },
  { x: 34.3, z: -22 }, { x: 19.5, z: -15.6 }, { x: 27, z: -15.6 }, { x: 17.5, z: -12.6 },
];

export function spawnDirt(state: GameState, businessId: Id): DirtSpot | null {
  const used = new Set(Object.values(state.dirt).map((d) => `${d.pos.x},${d.pos.z}`));
  const free = DIRT_SPOTS.filter((p) => !used.has(`${p.x},${p.z}`));
  if (!free.length) return null;
  const pos = pick(state, free);
  const d: DirtSpot = { id: nextId(state, 'spill'), locationId: businessId, pos: { ...pos }, dirt: 60 + Math.floor(rand(state) * 40), createdAt: state.minute };
  state.dirt[d.id] = d;
  return d;
}

export function cleanliness(state: GameState, businessId: Id): number {
  const dirt = Object.values(state.dirt).filter((d) => d.locationId === businessId).reduce((s, d) => s + d.dirt, 0);
  return clamp(100 - dirt / 4, 0, 100);
}

// ------------------------------------------------------------------ tasks
function findTask(state: GameState, bid: Id, kind: TaskKind, target: Id): Task | undefined {
  return Object.values(state.tasks).find((t) => t.businessId === bid && t.kind === kind && t.target === target && (t.status === 'open' || t.status === 'claimed'));
}

function createTask(state: GameState, bid: Id, kind: TaskKind, target: Id, product?: string) {
  const t: Task = { id: nextId(state, 'task'), businessId: bid, kind, target, product, status: 'open', claimedBy: null, createdAt: state.minute, doneAt: null, doneBy: null };
  state.tasks[t.id] = t;
  return t;
}

export function completeTask(state: GameState, bid: Id, kind: TaskKind, target: Id, by: Id | null) {
  const t = findTask(state, bid, kind, target);
  if (!t) return;
  t.status = 'done';
  t.doneAt = state.minute;
  t.doneBy = by;
}

function cancelTask(t: Task) {
  t.status = 'cancelled';
  t.claimedBy = null;
}

export function openTasks(state: GameState, bid: Id): Task[] {
  return Object.values(state.tasks).filter((t) => t.businessId === bid && (t.status === 'open' || t.status === 'claimed'));
}

const carriedBy = (state: GameState, product: string) =>
  Object.values(state.people).some((p) => count(state.containers[p.handsId], product) > 0);

export function retailTick(state: GameState, b: Business) {
  const backroom = state.containers[b.stockContainers[0]];
  for (const p of PRODUCTS) {
    const shelf = state.containers[shelfId(p)];
    const t = findTask(state, b.id, 'restock', shelf.id);
    const n = count(shelf, p);
    const supply = count(backroom, p) > 0 || carriedBy(state, p);
    if (!t && n < RESTOCK_BELOW && supply) createTask(state, b.id, 'restock', shelf.id, p);
    else if (t && n >= RESTOCK_DONE) { t.status = 'done'; t.doneAt = state.minute; }
    else if (t && !supply) cancelTask(t);
  }
  for (const d of Object.values(state.dirt)) if (d.locationId === b.id && !findTask(state, b.id, 'clean', d.id)) createTask(state, b.id, 'clean', d.id);
  for (const t of openTasks(state, b.id)) if (t.kind === 'clean' && !state.dirt[t.target]) cancelTask(t);
  for (const s of Object.values(state.shipments)) if (s.buyerId === b.id && s.status === 'arrived' && !findTask(state, b.id, 'receive', s.id)) createTask(state, b.id, 'receive', s.id);
  const till = state.tills.till;
  if (till.businessId === b.id) {
    const head = till.queue[0];
    if (head && !findTask(state, b.id, 'serve', head)) createTask(state, b.id, 'serve', head);
    for (const t of openTasks(state, b.id)) if (t.kind === 'serve' && !till.queue.includes(t.target)) cancelTask(t);
    // waiting customers count against everyone on duty
    if (head) {
      const staff = staffOnDuty(state, b.id);
      const serving = staff.some((s) => s.action?.type === 'serve_customer');
      if (!serving) for (const s of staff) { const a = openAttendance(state, s.id); if (a) a.waitPenalty += 1 / staff.length; }
    }
  }
  // claims held by people who are no longer on shift are released
  for (const t of openTasks(state, b.id)) if (t.claimedBy && !isOnShift(state, t.claimedBy, b.id)) { t.claimedBy = null; t.status = 'open'; }
  b.cleanliness = cleanliness(state, b.id);
  // prune old finished tasks
  if (state.minute % 60 === 0) {
    for (const [id, t] of Object.entries(state.tasks)) if ((t.status === 'done' || t.status === 'cancelled') && state.minute - (t.doneAt ?? t.createdAt) > MIN_PER_DAY) delete state.tasks[id];
  }
}

// --------------------------------------------------------------- ordering
/** stock currently owned by the business, on order or in transit */
export function stockPosition(state: GameState, b: Business, item: string): number {
  let n = 0;
  for (const cid of b.stockContainers) if (state.containers[cid].kind !== 'loading_bay') n += count(state.containers[cid], item);
  for (const p of Object.values(state.people)) if (p.handsId) n += count(state.containers[p.handsId], item);
  for (const s of Object.values(state.shipments)) {
    if (s.buyerId !== b.id) continue;
    if (s.status === 'ordered') n += s.items[item] ?? 0;
    if (s.status === 'loaded' || s.status === 'in_transit' || s.status === 'arrived') n += s.loaded[item] ?? 0;
  }
  return n;
}

export function hasManager(state: GameState, b: Business): boolean {
  return b.positions.some((p) => p.id === 'manager' && filledCount(state, b.id, p.id) > 0);
}

/** The manager's daily purchasing routine. Without a manager nobody reorders (delegation matters). */
export function autoReorder(state: GameState, b: Business): string {
  if (!b.supplierId) return 'No supplier.';
  if (!hasManager(state, b)) return 'No manager to place orders.';
  const supplier = state.businesses[b.supplierId];
  const items: Record<string, number> = {};
  let cost = 0;
  for (const [item, rule] of Object.entries(b.reorder)) {
    const pos = stockPosition(state, b, item);
    if (pos < rule.min) {
      const cs = ITEMS[item].caseSize;
      const qty = Math.ceil((rule.target - pos) / cs) * cs;
      items[item] = qty;
      cost += qty * (supplier.prices[item] ?? ITEMS[item].wholesale);
    }
  }
  if (!Object.keys(items).length) return 'Stock levels fine.';
  // keep a cash buffer for wages: scale the order down if needed
  const cash = state.ledger.accounts[b.accountId].balance;
  const budget = Math.max(0, cash - 30000);
  if (cost > budget) {
    const f = budget / cost;
    for (const k of Object.keys(items)) {
      const cs = ITEMS[k].caseSize;
      items[k] = Math.floor((items[k] * f) / cs) * cs;
      if (items[k] <= 0) delete items[k];
    }
    news(state, 'world', `${b.name} cuts back its stock order`, 'Cash is tight, so the manager ordered less than usual.');
  }
  if (!Object.keys(items).length) return 'Could not afford an order.';
  const s = placeOrder(state, b.id, supplier.id, items);
  return s ? `Ordered ${Object.entries(items).map(([k, n]) => `${n} ${itemName(k)}`).join(', ')}` : 'Order failed.';
}

// ------------------------------------------------------------ daily close
export function dailyClose(state: GameState, b: Business) {
  const s = statsFor(state, b);
  const ext = state.externalId;
  if (b.utilitiesPerDay > 0) {
    const r = transfer(state, { from: b.accountId, to: ext, amount: b.utilitiesPerDay, reason: 'utilities', memo: `Utilities ${fmtDate(state.minute)}`, key: `util:${b.id}:${dayIndex(state.minute)}` });
    if (r.ok) s.otherCosts += b.utilitiesPerDay;
  }
  if (b.kind === 'retail') {
    // reputation drifts with the day's service quality (each factor is visible in the reports)
    const served = s.customers / Math.max(1, s.customers + s.walkouts);
    const unitsSold = Math.max(1, Math.round(s.cogs / 100));
    const inStock = unitsSold / (unitsSold + s.lostSales);
    let d = (served - 0.85) * 8 + (inStock - 0.7) * 5 + (b.cleanliness >= 70 ? 0.4 : -1);
    d = clamp(d, -4, 3);
    b.reputation = clamp(b.reputation + d, 5, 100);
  }
}

/** units of stock value at cost (for the balance sheet) */
export function inventoryValue(state: GameState, b: Business): number {
  let v = 0;
  for (const cid of b.stockContainers) if (state.containers[cid].kind !== 'loading_bay') for (const [k, n] of Object.entries(state.containers[cid].items)) v += (b.unitCost[k] ?? ITEMS[k]?.wholesale ?? 0) * n;
  return v;
}
