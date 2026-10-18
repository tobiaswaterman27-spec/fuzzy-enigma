// Player enterprise: starting and running a business through the same
// ledger, inventory, logistics, employment and retail systems the NPC
// businesses use. Nothing here creates money or stock from nowhere.
import type { Business, GameState, Id, ShiftTemplate } from './types';
import { dayIndex } from './clock';
import { fmtMoney } from './core';
import { transfer } from './ledger';
import { createContainer, total } from './inventory';
import { ITEMS, PRODUCTS, itemName } from './items';
import { lifeEvent, news } from './events';
import { createLease } from './housing';
import { makeBusiness } from './newgame';
import { acceptOffer, endContract, filledCount, refreshVacancies, statsFor } from './employment';
import { placeOrder } from './logistics';
import { NIGHT_FILL_PER_UNIT, SHELF_CAPACITY } from './retail';
import { SHOPS, U4_SECTIONS } from './world/layout';

export const UNIT4 = 'unit4';
export const UNIT4_RENT = 18000; // per week
export const UNIT4_DEPOSIT = 18000;
export const REGISTRATION_FEE = 5000;
export const TILL_COST = 25000;
export const START_MIN_CAPITAL = UNIT4_RENT + UNIT4_DEPOSIT + REGISTRATION_FEE;

export const HOURS_PRESETS: Record<string, { label: string; open: ShiftTemplate[] }> = {
  day: { label: 'Mon-Sat 08:00-19:00', open: [{ days: [0, 1, 2, 3, 4, 5], start: 8 * 60, end: 19 * 60 }] },
  late: { label: 'Mon-Sat 11:00-22:00', open: [{ days: [0, 1, 2, 3, 4, 5], start: 11 * 60, end: 22 * 60 }] },
  week: { label: 'Every day 09:00-18:00', open: [{ days: [0, 1, 2, 3, 4, 5, 6], start: 9 * 60, end: 18 * 60 }] },
};

export const SHIFT_PRESETS: Record<string, { label: string; shifts: ShiftTemplate[] }> = {
  am: { label: 'Mon-Sat 08:00-14:00', shifts: [{ days: [0, 1, 2, 3, 4, 5], start: 8 * 60, end: 14 * 60 }] },
  pm: { label: 'Mon-Sat 13:00-19:00', shifts: [{ days: [0, 1, 2, 3, 4, 5], start: 13 * 60, end: 19 * 60 }] },
  late: { label: 'Mon-Sat 16:00-22:00', shifts: [{ days: [0, 1, 2, 3, 4, 5], start: 16 * 60, end: 22 * 60 }] },
  full: { label: 'Mon-Sat 09:00-17:00', shifts: [{ days: [0, 1, 2, 3, 4, 5], start: 9 * 60, end: 17 * 60 }] },
};

type R = { ok: boolean; msg: string };
const ok = (msg: string): R => ({ ok: true, msg });
const no = (msg: string): R => ({ ok: false, msg });

export const playerBusiness = (state: GameState): Business | null => {
  const b = state.businesses[UNIT4];
  return b && b.ownerId === state.playerId ? b : null;
};

export function startBusiness(state: GameState, name: string, capital: number): R {
  const p = state.people[state.playerId];
  if (state.businesses[UNIT4]) return no('Dockside Unit 4 is already let.');
  name = name.trim().slice(0, 28) || `${p.name.split(' ')[0]}'s Store`;
  if (capital < START_MIN_CAPITAL) return no(`You need to invest at least ${fmtMoney(START_MIN_CAPITAL)} (deposit, first week's rent and registration).`);
  if (state.ledger.accounts[p.accountId].balance < capital) return no('You do not have that much in your account.');
  const b = makeBusiness(state, {
    id: UNIT4, name, kind: 'retail', ownerId: p.id, locationId: UNIT4, open: HOURS_PRESETS.day.open,
    positions: [
      { id: 'assistant', title: 'Retail Assistant', wage: 1250, shifts: SHIFT_PRESETS.am.shifts, payEvery: 'daily', headcount: 0, requires: {}, uniform: null, playable: false, description: `Serve, restock and clean at ${name}.`, duties: ['Serve customers', 'Restock shelves', 'Clean'] },
      { id: 'manager', title: 'Shop Manager', wage: 1650, shifts: SHIFT_PRESETS.full.shifts, payEvery: 'weekly', headcount: 0, requires: { retail: 120 }, uniform: null, playable: false, description: `Runs ${name} day to day and places the stock orders.`, duties: ['Daily stock ordering', 'Serve and restock'] },
    ],
    prices: Object.fromEntries(PRODUCTS.map((k) => [k, ITEMS[k].retail])), reputation: 50, supplierId: 'wholesale', reorder: {},
    rentDue: UNIT4_RENT, utilitiesPerDay: 1200, stockContainers: ['unit4_backroom', ...U4_SECTIONS.map((x) => x.id), 'unit4_bay'],
    cashReserve: 1e12, cash: 0,
  });
  b.ownerDecidesHiring = true;
  b.equipment = { till: false };
  createContainer(state, 'backroom', UNIT4, UNIT4, 800, undefined, 'unit4_backroom');
  createContainer(state, 'loading_bay', UNIT4, UNIT4, 1500, undefined, 'unit4_bay');
  for (const sct of U4_SECTIONS) createContainer(state, 'shelf', UNIT4, UNIT4, SHELF_CAPACITY, undefined, sct.id);
  state.tills[SHOPS.unit4.till] = { id: SHOPS.unit4.till, businessId: UNIT4, queue: [], scanned: {}, staffId: null };
  state.districts.harbourside.shopDemand[UNIT4] = 0;
  // money: owner investment, then the business pays its own set-up costs
  transfer(state, { from: p.accountId, to: b.accountId, amount: capital, reason: 'transfer', memo: `Owner investment in ${name}` });
  transfer(state, { from: b.accountId, to: state.businesses[state.governmentId].accountId, amount: REGISTRATION_FEE, reason: 'public_service', memo: 'Business registration fee' });
  const estates = state.businesses.estates;
  transfer(state, { from: b.accountId, to: estates.accountId, amount: UNIT4_DEPOSIT, reason: 'deposit', memo: 'Deposit: Dockside Unit 4' });
  transfer(state, { from: b.accountId, to: estates.accountId, amount: UNIT4_RENT, reason: 'rent', memo: 'First week rent: Dockside Unit 4' });
  const l = createLease(state, p.id, 'estates', UNIT4, 'Dockside Unit 4 (commercial)', UNIT4_RENT, dayIndex(state.minute) + 7);
  l.tenantBusinessId = UNIT4;
  l.dueDay = dayIndex(state.minute) % 7;
  statsFor(state, b).otherCosts += REGISTRATION_FEE + UNIT4_RENT;
  lifeEvent(state, p, `Founded ${name} at Dockside Unit 4`);
  news(state, 'good', `You founded ${name}`, 'Next: buy a till system, choose products for the four shelf sections, order stock from Harbour Wholesale, then open the doors.', true);
  news(state, 'world', `New shop coming to Dockside: ${name}`, 'Corner Market will soon have competition.');
  return ok(`${name} is registered and Dockside Unit 4 is yours.`);
}

function own(state: GameState): Business | null {
  return playerBusiness(state);
}

export function buyTill(state: GameState): R {
  const b = own(state);
  if (!b) return no('You do not own a business.');
  if (b.equipment.till) return no('Till already installed.');
  const r = transfer(state, { from: b.accountId, to: state.externalId, amount: TILL_COST, reason: 'purchase', memo: 'Till system & card terminal' });
  if (!r.ok) return no(`The business needs ${fmtMoney(TILL_COST)}. Invest more money first.`);
  b.equipment.till = true;
  return ok('Till system installed. You can now take payments.');
}

export function setSection(state: GameState, shelf: Id, product: string | null): R {
  const b = own(state);
  if (!b || !(shelf in Object.fromEntries(U4_SECTIONS.map((x) => [x.id, 1])))) return no('Not your shelf.');
  const c = state.containers[shelf];
  if (total(c) > 0) return no('Empty the shelf section before changing what it sells.');
  if (product && Object.entries(b.sections).some(([sh, k]) => k === product && sh !== shelf)) return no(`${itemName(product)} already has a section.`);
  if (product) { b.sections[shelf] = product; c.filter = product; }
  else { delete b.sections[shelf]; delete c.filter; }
  return ok(product ? `Section will sell ${itemName(product)}.` : 'Section cleared.');
}

export function setPrice(state: GameState, product: string, cents: number): R {
  const b = own(state);
  if (!b) return no('You do not own a business.');
  const ref = ITEMS[product].retail;
  b.prices[product] = Math.round(Math.max(ref * 0.6, Math.min(ref * 1.8, cents)) / 5) * 5;
  return ok(`${itemName(product)} now ${fmtMoney(b.prices[product])}.`);
}

export function setHours(state: GameState, preset: string): R {
  const b = own(state);
  if (!b || !HOURS_PRESETS[preset]) return no('Unknown hours.');
  b.open = HOURS_PRESETS[preset].open;
  return ok(`Opening hours: ${HOURS_PRESETS[preset].label}.`);
}

export function setClosed(state: GameState, closed: boolean): R {
  const b = own(state);
  if (!b) return no('You do not own a business.');
  b.manualClosed = closed;
  return ok(closed ? 'Doors closed.' : 'Open for business (within opening hours).');
}

/** Hire (or stop) the overnight shelf-fill crew: before opening they fill shelves to 60% for a per-unit fee. */
export function setNightFill(state: GameState, on: boolean): R {
  const b = own(state);
  if (!b) return no('You do not own a business.');
  b.nightFill = on;
  return ok(on ? `Overnight shelf-fill crew hired (Cr ${(NIGHT_FILL_PER_UNIT / 100).toFixed(2)} per unit put out).` : 'Overnight shelf-fill crew cancelled.');
}

export function orderCost(state: GameState, items: Record<string, number>) {
  const w = state.businesses.wholesale;
  return Object.entries(items).reduce((s, [k, n]) => s + n * (w.prices[k] ?? ITEMS[k].wholesale), 0);
}

export function orderStock(state: GameState, items: Record<string, number>): R {
  const b = own(state);
  if (!b) return no('You do not own a business.');
  const clean = Object.fromEntries(Object.entries(items).filter(([, n]) => n > 0));
  if (!Object.keys(clean).length) return no('Nothing to order.');
  const cost = orderCost(state, clean);
  if (state.ledger.accounts[b.accountId].balance < cost) return no(`The invoice will be ${fmtMoney(cost)} on delivery; the business only has ${fmtMoney(state.ledger.accounts[b.accountId].balance)}.`);
  const s = placeOrder(state, b.id, 'wholesale', clean);
  if (!s) return no('Order failed.');
  return ok(`Order placed (${fmtMoney(cost)}, paid on delivery). Harbour Wholesale's van delivers from 06:30 on the next working day, if their driver is at work.`);
}

export function invest(state: GameState, amount: number): R {
  const b = own(state);
  if (!b) return no('You do not own a business.');
  const p = state.people[state.playerId];
  const r = transfer(state, { from: p.accountId, to: b.accountId, amount, reason: 'transfer', memo: `Owner investment in ${b.name}` });
  return r.ok ? ok(`Invested ${fmtMoney(amount)}.`) : no(r.error);
}

export function withdraw(state: GameState, amount: number): R {
  const b = own(state);
  if (!b) return no('You do not own a business.');
  const p = state.people[state.playerId];
  const r = transfer(state, { from: b.accountId, to: p.accountId, amount, reason: 'owner_draw', memo: `Owner's draw from ${b.name}` });
  return r.ok ? ok(`Withdrew ${fmtMoney(amount)}.`) : no('The business does not have that much cash.');
}

export function setStaffing(state: GameState, positionId: string, headcount: number, shiftPreset?: string, wage?: number): R {
  const b = own(state);
  const pos = b?.positions.find((x) => x.id === positionId);
  if (!b || !pos) return no('Unknown position.');
  pos.headcount = Math.max(0, Math.min(3, headcount));
  if (shiftPreset && SHIFT_PRESETS[shiftPreset]) pos.shifts = SHIFT_PRESETS[shiftPreset].shifts;
  if (wage) pos.wage = Math.max(1100, Math.min(2500, wage));
  refreshVacancies(state);
  const filled = filledCount(state, b.id, pos.id);
  return ok(pos.headcount > filled ? `Advertising ${pos.headcount - filled} ${pos.title} vacancy. Applicants appear in this tab.` : `${pos.title}: ${filled} employed.`);
}

/** the owner chooses an applicant; unemployed NPCs accept straight away */
export function hireApplicant(state: GameState, appId: Id): R {
  const a = state.applications[appId];
  const b = own(state);
  if (!a || !b || a.status !== 'pending') return no('That application is no longer available.');
  const v = state.vacancies[a.vacancyId];
  if (v.businessId !== b.id) return no('Not your vacancy.');
  a.status = 'offered';
  a.offerExpires = state.minute + 1440;
  const p = state.people[a.personId];
  const r = acceptOffer(state, a.id);
  if (!r.ok) return no(r.msg);
  news(state, 'good', `${p.name} joined ${b.name}`, 'They will start on their next scheduled shift.', true);
  return ok(`${p.name} accepted.`);
}

export function rejectApplicant(state: GameState, appId: Id): R {
  const a = state.applications[appId];
  if (!a || a.status !== 'pending') return no('Gone.');
  a.status = 'rejected';
  return ok('Applicant turned down.');
}

export function dismissStaff(state: GameState, contractId: Id): R {
  const c = state.contracts[contractId];
  const b = own(state);
  if (!c || !b || c.businessId !== b.id) return no('Not your employee.');
  const pos = b.positions.find((x) => x.id === c.positionId);
  if (pos) pos.headcount = Math.max(0, pos.headcount - 1);
  endContract(state, contractId, 'dismissed', 'Let go by the owner.');
  return ok(`${state.people[c.personId].name} was let go. Outstanding wages will still be paid.`);
}

/** default reorder targets used when a manager is employed */
export function syncReorderRules(b: Business) {
  b.reorder = Object.fromEntries(Object.values(b.sections).map((k) => [k, { min: 40, target: 80 }]));
}
