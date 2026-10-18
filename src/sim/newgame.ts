// Builds a brand-new, internally consistent world. Every opening balance is
// a recorded transfer from the external economy so total money sums to zero.
import type { Appearance, Business, GameState, Id, Person, Position, ShiftTemplate, Traits } from './types';
import { at } from './clock';
import { openAccount, transfer } from './ledger';
import { addItems, createContainer } from './inventory';
import { ITEMS, PRODUCTS } from './items';
import { hire, refreshVacancies } from './employment';
import { createLease } from './housing';
import { initObjectives } from './objectives';
import { getWorld, HOUSE_IDS } from './world/layout';
import { homeDoor } from './npc';
import { rand, randInt, pick } from './core';
import { news } from './events';
import { spawnDirt, SHELF_CAPACITY, shelfId } from './retail';

export const SAVE_VERSION = 4;

export interface PlayerSetup {
  name: string;
  appearance: Omit<Appearance, 'outfit' | 'height'> & { height?: number };
}

export const SKIN_TONES = ['#f1d3b6', '#e3b48f', '#c98e66', '#a86b45', '#7a4a2e', '#4e2f1e'];
export const HAIR_COLORS = ['#1b1b1b', '#3b2416', '#6b4423', '#a8743f', '#d8b36a', '#8e8e8e', '#b5462f'];
export const HAIR_STYLES = ['short', 'long', 'bun', 'bald', 'curly'] as const;
export const BUILDS = ['slim', 'average', 'broad'] as const;

const MON_SAT = [0, 1, 2, 3, 4, 5];
const MON_FRI = [0, 1, 2, 3, 4];
const sh = (days: number[], s: number, e: number): ShiftTemplate => ({ days, start: s * 60, end: e * 60 });

function emptyState(seed: number): GameState {
  return {
    version: SAVE_VERSION, seed, rng: seed, minute: at(0, 7, 30), timeScale: 1 / 3, counters: {},
    ledger: { accounts: {}, txns: [], keys: {}, archived: {} },
    containers: {}, people: {}, playerId: 'player', businesses: {}, contracts: {}, attendance: {}, vacancies: {}, applications: {},
    tasks: {}, dirt: {}, tills: {}, shipments: {}, vehicles: {}, leases: {}, districts: {}, news: [], objectives: initObjectives(),
    processed: {}, governmentId: 'council', externalId: '', policy: { incomeTax: 0.1, salesTax: 0.1, reserve: 3000000 }, flags: {},
  };
}

function fund(state: GameState, accountId: Id, amount: number, memo: string) {
  if (amount > 0) transfer(state, { from: state.externalId, to: accountId, amount, reason: 'opening_balance', memo });
}

export function makeBusiness(state: GameState, b: Omit<Business, 'accountId' | 'stats' | 'unitCost' | 'wageArrears' | 'cleanliness' | 'sections' | 'equipment'> & { cash: number; sections?: Record<string, string> }): Business {
  const acc = b.kind === 'government' ? openAccount(state, b.id, b.name, 'government') : openAccount(state, b.id, b.name, 'business');
  const { cash, ...rest } = b;
  const biz: Business = { sections: {}, equipment: {}, ...rest, accountId: acc.id, stats: [], unitCost: {}, wageArrears: 0, cleanliness: 100 };
  state.businesses[b.id] = biz;
  fund(state, acc.id, cash, `Opening cash ${b.name}`);
  return biz;
}

function randomTraits(state: GameState): Traits {
  const r = () => Math.round((0.2 + rand(state) * 0.75) * 100) / 100;
  return { conscientiousness: r(), sociability: r(), ambition: r(), patience: r(), thrift: r() };
}

function randomAppearance(state: GameState, outfit: string): Appearance {
  const frame = rand(state) < 0.5 ? 'f' : 'm';
  const hair = frame === 'f' ? pick(state, ['long', 'bun', 'curly', 'long', 'short'] as const) : pick(state, ['short', 'short', 'curly', 'bald', 'bun'] as const);
  return {
    frame, skin: pick(state, SKIN_TONES), hair, hairColor: pick(state, HAIR_COLORS), build: pick(state, BUILDS),
    height: Math.round(((frame === 'f' ? 0.9 : 0.96) + rand(state) * 0.1) * 100) / 100, outfit,
  };
}

function makePerson(state: GameState, id: Id, name: string, opts: { homeId: Id | null; cash: number; appearance?: Appearance; isPlayer?: boolean; accountId?: Id; traits?: Partial<Traits> }): Person {
  const acc = opts.accountId ?? openAccount(state, id, name, 'person').id;
  if (!opts.accountId) fund(state, acc, opts.cash, `Savings of ${name}`);
  const homeOutfit = pick(state, ['outfit_casual', 'outfit_smart', 'outfit_casual']);
  const appearance = opts.appearance ?? randomAppearance(state, homeOutfit);
  const hands = createContainer(state, 'hands', id, id, 16, undefined, `hands_${id}`);
  const bag = createContainer(state, 'bag', id, id, 40, undefined, `bag_${id}`);
  const basket = createContainer(state, 'basket', id, id, 30, undefined, `basket_${id}`);
  const pantry = opts.homeId ? createContainer(state, 'pantry', id, opts.homeId, 80, undefined, `pantry_${id}`) : null;
  const wardrobe = opts.homeId ? createContainer(state, 'wardrobe', id, opts.homeId, 30, undefined, `wardrobe_${id}`) : null;
  if (wardrobe) { addItems(wardrobe, 'outfit_casual', 1); addItems(wardrobe, 'outfit_smart', 1); }
  const start = opts.homeId ? homeDoor(opts.homeId) : { x: 0, z: 0 };
  const traits = { ...randomTraits(state), ...(opts.traits ?? {}) };
  const p: Person = {
    id, name, isPlayer: !!opts.isPlayer, appearance, homeId: opts.homeId, accountId: acc, pos: { ...start }, facing: 0,
    where: opts.homeId ?? 'offsite', visible: false, needs: { energy: 80 + randInt(state, 0, 20), satiety: 60 + randInt(state, 0, 30), hygiene: 85, mood: 60 },
    skills: {}, traits, contractId: null, handsId: hands.id, bagId: bag.id, basketId: basket.id, pantryId: pantry?.id ?? null,
    wardrobeId: wardrobe?.id ?? null, action: null, move: null, history: [], reputation: 50, equipment: null, sleeping: false, relations: {},
    npc: opts.isPlayer ? null : {
      goal: 'idle_home', goalSince: state.minute, nextDecision: state.minute + randInt(state, 0, 5), step: 'run', plan: [], log: [],
      homeOutfit, bedtime: 22 * 60 + randInt(state, 0, 90), wake: 6 * 60 + randInt(state, 0, 60),
    },
  };
  state.people[id] = p;
  return p;
}

const pos = (p: Partial<Position> & Pick<Position, 'id' | 'title' | 'wage' | 'shifts'>): Position => ({
  payEvery: 'daily', headcount: 1, requires: {}, uniform: null, playable: false, description: '', duties: [], ...p,
});

export function createNewGame(seed: number, setup: PlayerSetup): GameState {
  const state = emptyState(seed);
  const ext = openAccount(state, 'external', 'Rest of the Country', 'external', true);
  state.externalId = ext.id;

  // ---------------------------------------------------------- businesses
  const council = makeBusiness(state, {
    id: 'council', name: 'Harbourside Council', kind: 'government', ownerId: 'public', locationId: 'jobcentre',
    open: [sh(MON_FRI, 9, 17)], positions: [pos({ id: 'advisor', title: 'Employment Advisor', wage: 1500, shifts: [sh(MON_FRI, 9, 17)], description: 'Helps residents find work.' })],
    prices: {}, reputation: 60, supplierId: null, reorder: {}, rentDue: 0, utilitiesPerDay: 1200, stockContainers: [], cashReserve: 0, cash: 3000000,
  });
  void council;
  const market = makeBusiness(state, {
    id: 'market', name: 'Corner Market', kind: 'retail', ownerId: 'p_harlan', locationId: 'market',
    open: [sh(MON_SAT, 7, 21), sh([6], 10, 16)],
    positions: [
      pos({ id: 'manager', title: 'Owner-Manager', wage: 1000, shifts: [sh(MON_SAT, 6.5, 15), sh([6], 9.5, 16)], uniform: 'uniform_market', role: 'manager', description: 'Runs the shop: orders stock, checks in deliveries, covers the till when a queue builds.' }),
      pos({
        id: 'assistant_am', title: 'Retail Assistant (Mornings)', wage: 1250, shifts: [sh(MON_SAT, 8, 14)], uniform: 'uniform_market', playable: true, role: 'cashier',
        description: 'Cashier first: keep the till covered and serve customers; when it is quiet, keep the shelves full, help with deliveries and spills.',
        duties: ['Serve customers at the checkout', 'Restock shelves from the store room', 'Check in deliveries at the loading bay', 'Mop up spills'],
      }),
      pos({
        id: 'assistant_pm', title: 'Retail Assistant (Evenings)', wage: 1250, shifts: [sh(MON_SAT, 14, 21)], uniform: 'uniform_market', playable: true, role: 'cashier',
        description: 'Evening cashier at Corner Market: till first, then restocking and tidying.', duties: ['Serve customers', 'Restock shelves', 'Clean'],
      }),
      pos({
        id: 'stocker_am', title: 'Shelf Stacker (Mornings)', wage: 1180, shifts: [sh(MON_SAT, 6, 12)], uniform: 'uniform_market', playable: true, role: 'stocker',
        description: 'Stock room and shelves: check in deliveries, bring stock out, keep every section full.',
        duties: ['Check in deliveries at the loading bay', 'Restock shelves from the store room', 'Cover the till only when the queue is long'],
      }),
      pos({
        id: 'cleaner', title: 'Cleaner (Afternoons)', wage: 1100, shifts: [sh(MON_SAT, 12, 18)], uniform: 'uniform_market', playable: true, role: 'cleaner',
        description: 'Keep Corner Market clean and safe: spills, floor rounds and tidying.',
        duties: ['Mop up spills', 'Walk the aisles keeping the floor clear'],
      }),
    ],
    prices: Object.fromEntries(PRODUCTS.map((k) => [k, ITEMS[k].retail])), reputation: 55, supplierId: 'wholesale',
    reorder: Object.fromEntries(PRODUCTS.map((k) => [k, { min: 130, target: 230 }])), rentDue: 0, utilitiesPerDay: 2500,
    stockContainers: ['market_backroom', ...PRODUCTS.map(shelfId), 'market_bay'], cashReserve: 400000, cash: 600000,
    sections: Object.fromEntries(PRODUCTS.map((k) => [shelfId(k), k])),
  });
  const wholesale = makeBusiness(state, {
    id: 'wholesale', name: 'Harbour Wholesale', kind: 'wholesale', ownerId: 'p_gail', locationId: 'wholesale', open: [sh(MON_SAT, 6, 18)],
    positions: [
      pos({ id: 'driver', title: 'Delivery Driver', wage: 1450, shifts: [sh(MON_SAT, 6, 14)], uniform: 'uniform_wholesale', description: 'Drives the delivery van.' }),
      pos({ id: 'operative', title: 'Warehouse Operative', wage: 1350, shifts: [sh(MON_SAT, 6, 14)], uniform: 'uniform_wholesale', headcount: 2, requires: {}, description: 'Picks and packs orders (not yet playable).' }),
    ],
    prices: Object.fromEntries([...PRODUCTS, 'cafe_supplies'].map((k) => [k, ITEMS[k].wholesale])), reputation: 60, supplierId: null,
    reorder: { ...Object.fromEntries(PRODUCTS.map((k) => [k, { min: 250, target: 450 }])), cafe_supplies: { min: 100, target: 200 } },
    rentDue: 0, utilitiesPerDay: 4000, stockContainers: ['wholesale_stock'], cashReserve: 1500000, cash: 2000000,
  });
  const cafe = makeBusiness(state, {
    id: 'cafe', name: 'Tidewater Cafe', kind: 'cafe', ownerId: 'p_rosa', locationId: 'cafe', open: [sh([0, 1, 3, 4, 5, 6], 8, 17)],
    positions: [pos({ id: 'cook', title: 'Cafe Cook', wage: 1300, shifts: [sh([0, 1, 3, 4, 5, 6], 8, 17)], uniform: 'uniform_cafe', description: 'Cooks and serves.' })],
    prices: { meal: 850 }, reputation: 60, supplierId: 'wholesale', reorder: {}, rentDue: 0, utilitiesPerDay: 1500, stockContainers: ['cafe_supplies'], cashReserve: 300000, cash: 300000,
  });
  const port = makeBusiness(state, {
    id: 'port', name: 'Port of Harbourside', kind: 'offsite', ownerId: 'external', locationId: 'offsite', open: [sh([0, 1, 2, 3, 4, 5, 6], 0, 24)],
    positions: [
      pos({ id: 'dock_early', title: 'Dock Worker (Early)', wage: 1500, shifts: [sh(MON_FRI, 6, 14)], headcount: 1, description: 'Works at the port, off the map.' }),
      pos({ id: 'dock_late', title: 'Dock Worker (Late)', wage: 1550, shifts: [sh(MON_FRI, 14, 22)], headcount: 1 }),
      pos({ id: 'clerk', title: 'Port Clerk', wage: 1450, shifts: [sh(MON_FRI, 9, 17)], headcount: 1 }),
      pos({ id: 'crane', title: 'Crane Operator', wage: 1700, shifts: [sh([1, 2, 3, 4, 5], 8, 16)], headcount: 1 }),
      pos({ id: 'dock_mid', title: 'Dock Worker (Mid)', wage: 1500, shifts: [sh(MON_FRI, 12, 20)], headcount: 1 }),
    ],
    prices: {}, reputation: 60, supplierId: null, reorder: {}, rentDue: 0, utilitiesPerDay: 0, stockContainers: [], cashReserve: 500000, cash: 500000,
  });
  void port;
  makeBusiness(state, {
    id: 'estates', name: 'Harbourside Estates', kind: 'landlord', ownerId: 'district', locationId: 'outside', open: [],
    positions: [], prices: {}, reputation: 50, supplierId: null, reorder: {}, rentDue: 0, utilitiesPerDay: 0, stockContainers: [], cashReserve: 800000, cash: 1000000,
  });

  // ---------------------------------------------------------- containers & stock
  createContainer(state, 'backroom', 'market', 'market', 2000, undefined, 'market_backroom');
  createContainer(state, 'loading_bay', 'market', 'market', 1500, undefined, 'market_bay');
  for (const k of PRODUCTS) {
    const sc = createContainer(state, 'shelf', 'market', 'market', SHELF_CAPACITY, k, shelfId(k));
    addItems(sc, k, 34 + randInt(state, 0, 14)); // a normal morning: shelves around two-thirds full
    addItems(state.containers.market_backroom, k, ITEMS[k].caseSize * 5);
    market.unitCost[k] = ITEMS[k].wholesale;
  }
  // nearly empty milk shelf so the first shift has obvious work
  state.containers.shelf_milk.items.milk = 4;
  const wh = createContainer(state, 'warehouse', 'wholesale', 'wholesale', 20000, undefined, 'wholesale_stock');
  for (const k of [...PRODUCTS, 'cafe_supplies']) { addItems(wh, k, 400); wholesale.unitCost[k] = ITEMS[k].importCost; }
  const cs = createContainer(state, 'supplies', 'cafe', 'cafe', 400, undefined, 'cafe_supplies');
  addItems(cs, 'cafe_supplies', 60);
  cafe.unitCost.cafe_supplies = ITEMS.cafe_supplies.wholesale;
  // record the opening stock value as the owners' investment (no money moves)

  state.tills.till = { id: 'till', businessId: 'market', queue: [], scanned: {}, staffId: null };
  const w = getWorld();
  const cargo = createContainer(state, 'van', 'wholesale', 'van_1', 1500, undefined, 'van_1_cargo');
  state.vehicles.van_1 = {
    id: 'van_1', name: 'Harbour Wholesale van', ownerId: 'wholesale', kind: 'van', pos: { ...w.depot }, heading: Math.PI, route: [], routeIdx: 0,
    speed: 15, state: 'parked', cargoId: cargo.id, shipmentId: null, waitUntil: 0, condition: 92, odometer: 18234,
  };

  // ---------------------------------------------------------- district
  const dacc = openAccount(state, 'district', 'Harbourside households', 'aggregate', true);
  fund(state, dacc.id, 6000000, 'District household savings');
  state.districts.harbourside = { id: 'harbourside', name: 'Harbourside', households: 120, accountId: dacc.id, groceryBudget: 6000, shopShare: 0.2, demandAccumulator: 0.6, cafeAccumulator: 0, confidence: 1, shopDemand: { market: 0.6 } };

  // ---------------------------------------------------------- player
  const pl = makePerson(state, 'player', setup.name || 'Alex Morgan', {
    homeId: 'flat', cash: 18000, isPlayer: true,
    appearance: { ...setup.appearance, height: setup.appearance.height ?? 1, outfit: 'outfit_casual' },
    traits: { conscientiousness: 0.6, sociability: 0.6, ambition: 0.8, patience: 0.6, thrift: 0.5 },
  });
  pl.pos = { ...w.playerSpawn };
  pl.facing = Math.PI;
  pl.where = 'flat';
  pl.visible = true;
  pl.needs = { energy: 85, satiety: 55, hygiene: 70, mood: 60 };
  addItems(state.containers[pl.pantryId!], 'bread', 1);
  addItems(state.containers[pl.pantryId!], 'pasta', 1);
  createLease(state, 'player', 'estates', 'flat', 'Flat 1, Marlow Court', 14000, 7);

  // ---------------------------------------------------------- NPCs
  const npcs: { id: string; name: string; home: string; cash: number; job?: [string, string]; rent?: number; retired?: boolean; traits?: Partial<Traits>; skills?: Record<string, number>; search?: number }[] = [
    { id: 'p_harlan', name: 'Harlan Price', home: 'house_1', cash: 250000, job: ['market', 'manager'], traits: { conscientiousness: 0.85 } },
    { id: 'p_dana', name: 'Dana Okafor', home: 'flat_upper', cash: 60000, job: ['market', 'assistant_pm'], rent: 12500, skills: { retail: 300 } },
    { id: 'p_kofi', name: 'Kofi Mensah', home: 'house_2', cash: 35000, job: ['market', 'stocker_am'], skills: { retail: 120, warehouse: 140 } },
    { id: 'p_lena', name: 'Lena Novak', home: 'flat_upper', cash: 28000, job: ['market', 'cleaner'], rent: 11500, skills: { cleaning: 200 } },
    { id: 'p_gail', name: 'Gail Fenwick', home: 'house_2', cash: 400000, retired: true },
    { id: 'p_marcus', name: 'Marcus Bell', home: 'house_3', cash: 80000, job: ['wholesale', 'driver'], rent: 15000 },
    { id: 'p_priya', name: 'Priya Nair', home: 'house_4', cash: 70000, job: ['wholesale', 'operative'], rent: 14500 },
    { id: 'p_rosa', name: 'Rosa Linden', home: 'house_5', cash: 150000, job: ['cafe', 'cook'] },
    { id: 'p_ruth', name: 'Ruth Adeyemi', home: 'house_6', cash: 120000, job: ['council', 'advisor'], rent: 15500 },
    { id: 'p_ken', name: 'Ken Walsh', home: 'house_1', cash: 50000, job: ['port', 'dock_early'] },
    { id: 'p_aisha', name: 'Aisha Bello', home: 'house_2', cash: 65000, job: ['port', 'dock_late'], rent: 13000 },
    { id: 'p_lewis', name: 'Lewis Grant', home: 'house_3', cash: 45000, job: ['port', 'crane'] },
    { id: 'p_mei', name: 'Mei Chen', home: 'flat_upper', cash: 90000, job: ['port', 'clerk'], rent: 12500 },
    { id: 'p_owen', name: 'Owen Hart', home: 'house_6', cash: 40000, job: ['port', 'dock_mid'] },
    { id: 'p_sam', name: 'Sam Ortiz', home: 'house_4', cash: 30000, rent: 11000, skills: { warehouse: 220 }, traits: { ambition: 0.7 } },
    { id: 'p_joan', name: 'Joan Pike', home: 'house_5', cash: 400000, retired: true, traits: { sociability: 0.9 } },
    { id: 'p_tom', name: 'Tom Reyes', home: 'house_6', cash: 25000, rent: 0, skills: { retail: 160 }, search: 3 },
    { id: 'p_nadia', name: 'Nadia Haddad', home: 'flat_upper', cash: 40000, rent: 0, skills: { retail: 60, cleaning: 80 }, search: 3 },
    { id: 'p_ben', name: 'Ben Ashworth', home: 'house_1', cash: 15000, rent: 0, skills: {}, search: 4, traits: { conscientiousness: 0.4 } },
  ];
  for (const n of npcs) {
    const p = makePerson(state, n.id, n.name, { homeId: n.home, cash: n.cash, traits: n.traits });
    if (n.skills) p.skills = { ...n.skills };
    if (n.retired) p.npc!.retired = true;
    if (n.search) p.npc!.searchFrom = n.search * 1440;
    const pantry = state.containers[p.pantryId!];
    for (let i = 0; i < 3 + randInt(state, 0, 6); i++) addItems(pantry, pick(state, PRODUCTS.filter((k) => ITEMS[k].satiety > 0)), 1);
    if (n.job) {
      const c = hire(state, p.id, n.job[0], n.job[1], true);
      c.shiftsWorked = 20 + randInt(state, 0, 40);
      c.performance = 65 + randInt(state, 0, 25);
    }
    if (n.rent) {
      const l = createLease(state, p.id, 'estates', n.home, `${n.home === 'flat_upper' ? 'Upper flat, Marlow Court' : n.home}`, n.rent, 7);
      l.dueDay = randInt(state, 0, 6);
      l.paidThroughDay = l.dueDay === 0 ? 7 : l.dueDay;
    }
  }
  void HOUSE_IDS;

  // ---------------------------------------------------------- ambient shoppers (district residents)
  for (let i = 1; i <= 14; i++) {
    const p = makePerson(state, `amb_${i}`, ambientName(state), { homeId: null, cash: 0, accountId: dacc.id });
    p.npc!.ambient = true;
    p.npc!.goal = 'offsite';
    p.where = 'offsite';
  }

  refreshVacancies(state);
  spawnDirt(state, 'market');
  news(state, 'info', 'Welcome to Harbourside', 'You have just moved into Flat 1, Marlow Court with a little savings. Rent is due every Monday. Find work at the Job Centre across Main Street.', true);
  return state;
}

const FIRST = ['Jamie', 'Chris', 'Pat', 'Morgan', 'Robin', 'Taylor', 'Jordan', 'Casey', 'Ellis', 'Noor', 'Kai', 'Rowan', 'Avery', 'Sasha', 'Remy', 'Lior'];
const LAST = ['Hughes', 'Patel', 'Kowalski', 'Nguyen', 'Murphy', 'Silva', 'Evans', 'Ahmed', 'Brooks', 'Fraser', 'Moreau', 'Okoye', 'Lund', 'Reid'];
function ambientName(state: GameState) {
  return `${pick(state, FIRST)} ${pick(state, LAST)}`;
}
