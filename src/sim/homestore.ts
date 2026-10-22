// Harbour Home: the furniture & decor store. Every change to your home is bought here, in person at the
// counter while it is staffed or online with a delivery charge, and fitted at your flat a little later.
import type { GameState, Id } from './types';
import type { HomeDesign } from './world/homes';
import { EXTRAS, FLOORS, WALLPAPERS } from './world/homes';
import { at, dayIndex, fmtClock, minuteOfDay } from './clock';
import { fmtMoney } from './core';
import { transfer } from './ledger';
import { news } from './events';
import { isOpen, staffOnDuty } from './retail';
import { openAttendance, statsFor } from './employment';
import { setHomeDesign } from './world/layout';

export const HOME_STORE = 'homestore';
/** delivery & fitting when you order online */
export const ONLINE_DELIVERY = 1500;
/** share of the price that is the store's cost of the goods */
const COST_SHARE = 0.55;

const EXTRA_PRICE: Record<string, number> = { armchair: 24900, bookcase: 11900, plant_big: 3900, sideboard: 19900, desk: 14900, plant_bed: 2900, art: 6900 };

const wallpaperPrice = (k: string) => (WALLPAPERS[k]?.pattern === 'plain' ? 3500 : 6500);
const floorPrice = (k: string) => (FLOORS[k]?.kind === 'carpet' ? 12500 : FLOORS[k]?.kind === 'tiles' ? 15500 : 18500);

/** what a change costs, line by line */
export function quoteHome(from: HomeDesign, to: HomeDesign): { lines: { what: string; price: number }[]; total: number } {
  const lines: { what: string; price: number }[] = [];
  if (from.sofa !== to.sofa) lines.push({ what: 'Sofa & armchairs reupholstered', price: 39900 });
  if (from.bedding !== to.bedding) lines.push({ what: 'New bedding set', price: 5900 });
  for (const room of Object.keys({ ...from.wallpaper, ...to.wallpaper })) if (to.wallpaper[room] && from.wallpaper[room] !== to.wallpaper[room]) lines.push({ what: `${WALLPAPERS[to.wallpaper[room]]?.name ?? to.wallpaper[room]} (${room})`, price: wallpaperPrice(to.wallpaper[room]) });
  for (const room of Object.keys({ ...from.floor, ...to.floor })) if (to.floor[room] && from.floor[room] !== to.floor[room]) lines.push({ what: `${FLOORS[to.floor[room]]?.name ?? to.floor[room]} (${room})`, price: floorPrice(to.floor[room]) });
  for (const room of Object.keys({ ...from.rug, ...to.rug })) if (to.rug[room] && from.rug[room] !== to.rug[room]) lines.push({ what: `Rug (${room})`, price: 8900 });
  for (const x of to.extras) if (!from.extras.includes(x)) lines.push({ what: EXTRAS[x]?.name ?? x, price: EXTRA_PRICE[x] ?? 9900 });
  return { lines, total: lines.reduce((a, l) => a + l.price, 0) };
}

/** can the counter take an order right now (open and staffed)? */
export function storeStaffed(state: GameState): boolean {
  const b = state.businesses[HOME_STORE];
  return !!b && isOpen(b, state.minute) && staffOnDuty(state, HOME_STORE).length > 0;
}

/** Pay for a new design. In person it is fitted in two hours; online, the next morning (or two hours later before 16:00). */
export function buyHome(state: GameState, buyerId: Id, to: HomeDesign, inPerson: boolean): { ok: boolean; msg: string } {
  const b = state.businesses[HOME_STORE];
  const p = state.people[buyerId];
  const from = state.homeDesigns.flat;
  if (!b || !p || !from) return { ok: false, msg: 'The store is not trading.' };
  if (state.pendingHome) return { ok: false, msg: 'You already have an order waiting to be fitted.' };
  const q = quoteHome(from, to);
  if (q.total === 0) return { ok: false, msg: 'Nothing to buy.' };
  if (inPerson && !storeStaffed(state)) return { ok: false, msg: 'Nobody is at the counter - order online instead.' };
  const amount = q.total + (inPerson ? 0 : ONLINE_DELIVERY);
  const key = `home:${buyerId}:${state.minute}`;
  const r = transfer(state, { from: p.accountId, to: b.accountId, amount, reason: 'purchase', memo: `Harbour Home order (${q.lines.length} item${q.lines.length === 1 ? '' : 's'})`, key });
  if (!r.ok) return { ok: false, msg: r.error };
  settleSale(state, amount, `${key}:`);
  const m = minuteOfDay(state.minute);
  const fitAt = m < 16 * 60 ? state.minute + 120 : at(dayIndex(state.minute) + 1, 9, 0);
  state.pendingHome = { design: JSON.parse(JSON.stringify(to)), fitAt };
  news(state, 'good', 'Harbour Home order placed', `${fmtMoney(amount)} paid. Delivery and fitting at your flat ${fitAt - state.minute <= 120 ? `at ${fmtClock(fitAt)}` : `tomorrow at ${fmtClock(fitAt)}`}.`, true);
  return { ok: true, msg: `Ordered - fitted at ${fmtClock(fitAt)}.` };
}

/** sales tax to the council, cost of the goods to the store's suppliers, the day's stats */
function settleSale(state: GameState, amount: number, key: string) {
  const b = state.businesses[HOME_STORE];
  const tax = Math.round((amount * state.policy.salesTax) / (1 + state.policy.salesTax));
  transfer(state, { from: b.accountId, to: state.businesses[state.governmentId].accountId, amount: tax, reason: 'sales_tax', memo: 'Sales tax Harbour Home', key: `${key}tax` });
  const cogs = Math.round((amount - tax) * COST_SHARE);
  transfer(state, { from: b.accountId, to: state.externalId, amount: cogs, reason: 'purchase', memo: 'Furniture & decor from suppliers', key: `${key}cogs` });
  const st = statsFor(state, b);
  st.revenue += amount - tax;
  st.cogs += cogs;
  st.customers++;
}

/** the fitters arrive: the flat changes */
export function homeStoreTick(state: GameState) {
  const o = state.pendingHome;
  if (o && state.minute >= o.fitAt) {
    state.homeDesigns.flat = o.design;
    setHomeDesign(o.design);
    state.pendingHome = undefined;
    news(state, 'good', 'Your new things are in', 'Harbour Home delivered and fitted your order at Flat 5.', true);
  }
}

/** walk-in trade from the rest of the district, once a day if the counter was staffed */
export function homeStoreDaily(state: GameState) {
  const b = state.businesses[HOME_STORE];
  const d = state.districts.harbourside;
  if (!b || !d || !b.flags?.staffedToday) { if (b?.flags) b.flags.staffedToday = false; return; }
  b.flags.staffedToday = false;
  // online orders from the rest of the district (the in-store customers are served one by one)
  const amount = Math.round(d.households * 50 * Math.max(0.3, Math.min(1.5, d.confidence)));
  const key = `homewalkin:${dayIndex(state.minute)}`;
  const r = transfer(state, { from: d.accountId, to: b.accountId, amount, reason: 'sale', memo: 'Furniture & decor (walk-in trade)', key });
  if (r.ok) settleSale(state, amount, `${key}:`);
}

/** remember whether anyone served at the counter today; NPC assistants serve the queue */
export function homeStoreMinute(state: GameState) {
  const b = state.businesses[HOME_STORE];
  if (!b) return;
  if (storeStaffed(state)) (b.flags ??= {}).staffedToday = true;
  const q = (b.queue ??= []);
  // customers who left or gave up drop out of the queue
  b.queue = q.filter((id) => { const p = state.people[id]; return p && p.visible && p.npc?.step === 'home_wait'; });
  const head = b.queue[0] ? state.people[b.queue[0]] : null;
  if (!head?.npc) return;
  const staff = staffOnDuty(state, HOME_STORE);
  if (staff.some((s) => s.isPlayer)) return; // you are on the counter: you take the orders
  if (!staff.length) return;
  // an NPC assistant takes the order after a few minutes of talking it through
  if (state.minute - (head.npc.queuedAt ?? state.minute) >= 4) {
    const att = staff.map((s) => s.id);
    completeHomeOrder(state, head.id, att[0]);
  }
}

/** what a customer's order comes to (sofas are dear, a lamp is not) */
export function orderValue(customerId: Id, minute: number): number {
  let h = Math.floor(minute);
  for (const ch of customerId) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const bands = [3900, 6900, 8900, 12900, 19900, 24900, 39900, 54900];
  return bands[Math.abs(h) % bands.length];
}

/** the customer pays for their order (household money from the district) and goes home */
export function completeHomeOrder(state: GameState, customerId: Id, staffId: Id | null): { ok: boolean; msg: string } {
  const b = state.businesses[HOME_STORE];
  const d = state.districts.harbourside;
  const c = state.people[customerId];
  if (!b || !c) return { ok: false, msg: 'No customer.' };
  const amount = orderValue(customerId, state.minute);
  const key = `homeorder:${customerId}:${Math.floor(state.minute)}`;
  const r = transfer(state, { from: d.accountId, to: b.accountId, amount, reason: 'sale', memo: 'Furniture & decor order (in store)', key });
  b.queue = (b.queue ?? []).filter((id) => id !== customerId);
  if (c.npc) c.npc.step = 'paid';
  if (!r.ok) return { ok: false, msg: 'The customer could not pay.' };
  settleSale(state, amount, `${key}:`);
  if (staffId) { const a = openAttendance(state, staffId); if (a) { a.served++; a.tasks++; } }
  return { ok: true, msg: `${c.name} ordered ${fmtMoney(amount)} of furniture.` };
}
