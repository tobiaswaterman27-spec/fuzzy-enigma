// MarketSimulation + aggregate population.
// The wider district is simulated statistically: its households earn income
// from the rest of the country, pay tax and generate customer visits. Visits
// are materialised as pooled "ambient" shoppers who physically walk in, pick
// stock off shelves and pay at the till, so demand is never free money.
import type { Business, GameState } from './types';
import { dayIndex, fmtDate, hourOfDay } from './clock';
import { fmtMoney, randInt } from './core';
import { transfer } from './ledger';
import { count, removeItems } from './inventory';
import { ITEMS, PRODUCTS } from './items';
import { news } from './events';
import { statsFor } from './employment';
import { cleanliness, isOpen, productsOf, staffOnDuty } from './retail';
import { groceryList, startHomeShopping, startShopping } from './npc';
import { rainDemandFactor } from './weather';
import { placeOrder } from './logistics';
import { getWorld, SHOPS } from './world/layout';

/** relative customer traffic by hour of day */
export function hourProfile(h: number): number {
  if (h < 7) return 0.2;
  if (h < 9) return 0.7;
  if (h < 12) return 1.0;
  if (h < 14) return 1.4;
  if (h < 17) return 0.9;
  if (h < 19) return 1.5;
  return 0.8;
}

export const BASE_VISITS_PER_HOUR = 6.2;

/** Explainable demand multiplier for the corner shop; every factor is shown in the business report. */
export function demandFactors(state: GameState, b: Business) {
  const rep = 0.6 + b.reputation / 125;
  const clean = 0.7 + 0.3 * (cleanliness(state, b.id) / 100);
  let priceAcc = 0;
  let avail = 0;
  const sections = Object.entries(b.sections);
  for (const [sh, k] of sections) {
    priceAcc += Math.pow(ITEMS[k].retail / Math.max(1, b.prices[k] ?? ITEMS[k].retail), 1.3);
    if (count(state.containers[sh], k) > 0) avail++;
  }
  const n = Math.max(1, sections.length);
  const price = sections.length ? priceAcc / n : 1;
  const availability = 0.5 + 0.5 * (avail / n);
  const confidence = state.districts.harbourside.confidence;
  const weather = rainDemandFactor(state);
  return { rep, clean, price, availability, confidence, weather, total: rep * clean * price * availability * confidence * weather };
}

/** how convenient a shop's location is for the district's households (fixed by geography) */
export const LOCATION_FACTOR: Record<string, number> = { market: 1.0, unit4: 0.75 };

export function economyTick(state: GameState) {
  const now = state.minute;
  const d = state.districts.harbourside;
  const open = Object.keys(SHOPS).map((id) => state.businesses[id]).filter((b) => b && isOpen(b, now) && productsOf(b).length > 0);
  const locSum = open.reduce((a, b) => a + (LOCATION_FACTOR[b.id] ?? 0.5), 0);
  const growth = 1 + 0.25 * Math.max(0, open.length - 1); // a second shop grows the market a little
  for (const b of open) {
    const f = demandFactors(state, b).total;
    const share = (LOCATION_FACTOR[b.id] ?? 0.5) / locSum;
    const acc = (d.shopDemand[b.id] ?? 0) + (BASE_VISITS_PER_HOUR * hourProfile(hourOfDay(now)) * f * share * growth) / 60;
    d.shopDemand[b.id] = acc;
    if (acc < 1) continue;
    const free = Object.values(state.people).filter((p) => p.npc?.ambient && p.npc.goal === 'offsite' && !p.visible);
    if (free.length && isOpen(b, now + 20)) {
      const p = free[randInt(state, 0, free.length - 1)];
      const sp = getWorld().spawnPoints;
      const spawn = getWorld().nodes[sp[randInt(state, 0, sp.length - 1)]];
      p.pos = { x: spawn.x, z: spawn.z };
      p.where = 'outside';
      p.visible = true;
      startShopping(state, p, b.id, groceryList(state, p, b.id, 3 + randInt(state, 0, 5)));
      d.shopDemand[b.id] = acc - 1;
    } else d.shopDemand[b.id] = Math.min(acc, 3);
  }
  // Harbour Home: a customer every couple of hours comes in to browse and order at the counter
  const hs = state.businesses.homestore;
  if (hs && isOpen(hs, now) && isOpen(hs, now + 40)) {
    d.shopDemand.homestore = (d.shopDemand.homestore ?? 0) + (0.55 * d.confidence) / 60;
    if (d.shopDemand.homestore >= 1) {
      const free = Object.values(state.people).filter((p) => p.npc?.ambient && p.npc.goal === 'offsite' && !p.visible);
      if (free.length) {
        const p = free[randInt(state, 0, free.length - 1)];
        const sp = getWorld().spawnPoints;
        const spawn = getWorld().nodes[sp[randInt(state, 0, sp.length - 1)]];
        p.pos = { x: spawn.x, z: spawn.z };
        p.where = 'outside';
        p.visible = true;
        startHomeShopping(state, p);
      }
      d.shopDemand.homestore -= 1;
    }
  }
  // the cafe's sit-down trade is simulated statistically
  const cafe = state.businesses.cafe;
  if (isOpen(cafe, now) && staffOnDuty(state, 'cafe').length) {
    const h = hourOfDay(now);
    const rate = (h >= 11.5 && h < 14) || (h >= 17 && h < 19) ? 4 : 1.5;
    d.cafeAccumulator = (d.cafeAccumulator ?? 0) + (rate * d.confidence) / 60;
    while (d.cafeAccumulator >= 1) {
      d.cafeAccumulator -= 1;
      const sup = state.containers[cafe.stockContainers[0]];
      if (count(sup, 'cafe_supplies') <= 0) { statsFor(state, cafe).lostSales++; continue; }
      const price = cafe.prices.meal;
      const r = transfer(state, { from: d.accountId, to: cafe.accountId, amount: price, reason: 'sale', memo: 'Cafe meals (walk-in trade)' });
      if (!r.ok) break;
      removeItems(sup, 'cafe_supplies', 1);
      const tax = Math.round((price * state.policy.salesTax) / (1 + state.policy.salesTax));
      transfer(state, { from: cafe.accountId, to: state.businesses[state.governmentId].accountId, amount: tax, reason: 'sales_tax', memo: 'Sales tax Tidewater Cafe' });
      const st = statsFor(state, cafe);
      st.revenue += price - tax;
      st.cogs += Math.round(ITEMS.cafe_supplies.wholesale / ITEMS.cafe_supplies.caseSize);
      st.customers++;
    }
  }
}

/** daily flows of the aggregate economy (runs once per day at 23:30) */
export function dailyEconomy(state: GameState) {
  const day = dayIndex(state.minute);
  const d = state.districts.harbourside;
  const gov = state.businesses[state.governmentId];
  // district households earn income elsewhere in the country
  const income = d.households * 4200; // Cr 42 per household per day
  const tax = Math.round(income * state.policy.incomeTax);
  transfer(state, { from: state.externalId, to: d.accountId, amount: income, reason: 'aggregate_income', memo: `District earnings ${fmtDate(state.minute)}`, key: `agg_income:${day}` });
  transfer(state, { from: d.accountId, to: gov.accountId, amount: tax, reason: 'income_tax', memo: 'District income tax', key: `agg_tax:${day}` });
  // households spend most of the rest outside the corner shop (other shops, bills)
  const spendElsewhere = Math.round(income * 0.82);
  transfer(state, { from: d.accountId, to: state.externalId, amount: spendElsewhere, reason: 'purchase', memo: 'District spending elsewhere', key: `agg_spend:${day}` });
  // the council spends surplus revenue on public services delivered by local people
  const govAcc = state.ledger.accounts[gov.accountId];
  const surplus = govAcc.balance - state.policy.reserve;
  if (surplus > 0) {
    const spend = Math.round(surplus * 0.8);
    transfer(state, { from: gov.accountId, to: d.accountId, amount: spend, reason: 'public_service', memo: 'Public services & public-sector pay', key: `gov_spend:${day}` });
  }
  // owners draw profit from healthy businesses (weekly on Sunday)
  if (day % 7 === 6) {
    for (const b of Object.values(state.businesses)) {
      if (b.kind === 'government' || b.kind === 'offsite') continue;
      const acc = state.ledger.accounts[b.accountId];
      const excess = acc.balance - b.cashReserve;
      if (excess <= 0) continue;
      const draw = Math.round(excess * 0.5);
      const owner = state.people[b.ownerId];
      const to = owner ? owner.accountId : d.accountId;
      const r = transfer(state, { from: b.accountId, to, amount: draw, reason: 'owner_draw', memo: `Owner's draw from ${b.name}`, key: `draw:${b.id}:${day}` });
      if (r.ok) statsFor(state, b);
    }
    // landlords and owners living off-map spend in the district
  }
  // the port (offsite employer) is paid by the rest of the country for work done
  const port = state.businesses.port;
  const worked = Object.values(state.attendance).filter((a) => state.contracts[a.contractId].businessId === 'port' && a.day === day && a.minutesWorked > 0);
  const value = worked.reduce((s, a) => s + Math.round((a.minutesWorked / 60) * state.contracts[a.contractId].wage * 1.35), 0);
  if (value > 0) transfer(state, { from: state.externalId, to: port.accountId, amount: value, reason: 'sale', memo: 'Port services billed', key: `port_rev:${day}` });
  const portAcc = state.ledger.accounts[port.accountId];
  if (portAcc.balance > port.cashReserve) transfer(state, { from: port.accountId, to: state.externalId, amount: portAcc.balance - port.cashReserve, reason: 'owner_draw', memo: 'Port profit to shareholders', key: `port_draw:${day}` });
  // the wholesaler also supplies shops elsewhere in the region; volume is limited by the labour actually worked
  const w = state.businesses.wholesale;
  const opMinutes = Object.values(state.attendance).filter((a) => state.contracts[a.contractId].businessId === 'wholesale' && a.day === day).reduce((m, a) => m + a.minutesWorked, 0);
  const capacity = Math.floor((opMinutes / 60) * 30); // units a worker can pick & pack per hour
  if (capacity > 0) {
    const wh = state.containers[w.stockContainers[0]];
    let units = 0, value = 0, cogs = 0;
    const per = Math.floor(capacity / PRODUCTS.length);
    for (const k of PRODUCTS) {
      const n = removeItems(wh, k, Math.min(per, Math.max(0, count(wh, k) - 60)));
      units += n;
      value += n * w.prices[k];
      cogs += n * (w.unitCost[k] ?? ITEMS[k].importCost);
    }
    if (value > 0) {
      const r = transfer(state, { from: state.externalId, to: w.accountId, amount: value, reason: 'sale', memo: `Regional trade orders (${units} units)`, key: `wh_regional:${day}` });
      if (r.ok) { const st = statsFor(state, w); st.revenue += value; st.cogs += cogs; }
    }
  }
  // landlord: maintenance spend
  const ll = state.businesses.estates;
  const llAcc = state.ledger.accounts[ll.accountId];
  if (llAcc.balance > ll.cashReserve) transfer(state, { from: ll.accountId, to: d.accountId, amount: Math.round((llAcc.balance - ll.cashReserve) * 0.3), reason: 'transfer', memo: 'Property maintenance by local trades', key: `ll_maint:${day}` });
}

/** the cafe's owner restocks ingredients from the wholesaler when they run low */
export function cafeReorder(state: GameState) {
  const cafe = state.businesses.cafe;
  const sup = state.containers[cafe.stockContainers[0]];
  const have = count(sup, 'cafe_supplies');
  const pending = Object.values(state.shipments).some((s) => s.buyerId === 'cafe' && s.status === 'ordered');
  if (have < 25 && !pending) {
    const qty = 40;
    const cost = qty * state.businesses.wholesale.prices.cafe_supplies;
    if (state.ledger.accounts[cafe.accountId].balance > cost + 5000) placeOrder(state, 'cafe', 'wholesale', { cafe_supplies: qty });
    else news(state, 'world', 'Tidewater Cafe short of cash', `Could not afford ${fmtMoney(cost)} of ingredients.`);
  }
}
