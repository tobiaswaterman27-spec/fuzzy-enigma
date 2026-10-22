import { describe, expect, it } from 'vitest';
import { createNewGame, step, startAction, optionsFor, getWorld, choresOf, isDirty, retailTick, openTasks, addItems, auditLedger, hire, at, homeQueueSlot, creditLimit, takeLoan, transfer, loansTick, canBuyHome, mortgageTerms, HOME_PRICES, buyProperty, activeLease, hasHomeAccess, ownedHome, propertyTick, sellHome, inviteForCoffee, plannedMeetup, blockPrice, buyStake, sellStake, stakeOf, dividendsReceived, BLOCK, dailyEconomy, buyOut, holdings, inspect, hygieneOf, isOpen, inspectionsTick, buyCar, playerCar, enterCar, exitCar, carsTick, sellCar, FUEL_PER_KM, CAR_WEEKLY, allInteractables, enrol, marketOn, stallPrice, raining, forSale, buyNewBuild, sellNewBuild, NEW_BUILD_PRICE, lettingsTick, billAccount, billEstimate, billsTick, netWorth, wealthDaily, initLife, residents, lifeDaily, askOut, propose, breakUp, type GameState } from '../src/sim/index';
import { buyHome, ONLINE_DELIVERY, quoteHome } from '../src/sim/homestore';

const setup = { name: 'Tester', appearance: { skin: '#e3b48f', hair: 'short' as const, hairColor: '#3b2416', build: 'average' as const } };
function act(s: GameState, itId: string, type: Parameters<typeof startAction>[3], arg?: string) {
  const it = getWorld().interactables[itId];
  const p = s.people.player;
  p.pos = { ...it.pos };
  p.where = it.locationId;
  const r = startAction(s, 'player', itId, type, arg);
  if (r.ok && type !== 'sit') { let guard = 0; while (p.action && guard++ < 4000) step(s, 0.25); }
  return r;
}

describe('chores', () => {
  it('home: meals make dishes, cooking needs clean pans, laundry cleans clothes, tidying clears the mess', () => {
    const s = createNewGame(7, setup);
    const p = s.people.player;
    const c = choresOf(p);
    addItems(s.containers[p.pantryId!], 'pasta', 3);
    addItems(s.containers[p.pantryId!], 'bread', 2);
    expect(act(s, 'kitchen', 'eat', 'bread').ok).toBe(true);
    expect(c.dishes).toBe(1);
    c.dishes = 8;
    const cook = optionsFor(s, 'player', 'stove').find((o) => o.type === 'cook')!;
    expect(cook.enabled).toBe(false);
    expect(act(s, 'kitchen', 'wash_up').ok).toBe(true);
    expect(c.dishes).toBe(0);
    expect(act(s, 'stove', 'cook', 'pasta').ok).toBe(true);
    expect(c.dishes).toBe(3);
    // wear a uniform until it is dirty, change, wash it
    const wr = s.containers[p.wardrobeId!];
    addItems(wr, 'uniform_market', 1);
    p.appearance.outfit = 'uniform_market';
    c.wear.uniform_market = 90;
    expect(isDirty(p)).toBe(true);
    const blocked = optionsFor(s, 'player', 'washer').find((o) => o.type === 'laundry')!;
    expect(blocked.enabled).toBe(false); // still wearing it
    expect(act(s, 'wardrobe', 'change_outfit', 'outfit_casual').ok).toBe(true);
    expect(act(s, 'washer', 'laundry', 'load').ok).toBe(true);
    expect(c.washer?.items).toContain('uniform_market');
    expect(optionsFor(s, 'player', 'wardrobe').find((o) => o.arg === 'uniform_market')?.reason).toBe('In the wash');
    for (let k = 0; k < 80; k++) step(s, 1);
    expect(act(s, 'washer', 'laundry', 'unload').ok).toBe(true);
    expect(isDirty(p, 'uniform_market')).toBe(false);
    c.mess = 70;
    expect(act(s, 'sofa', 'tidy').ok).toBe(true);
    expect(c.mess).toBeLessThan(1);
  });

  it('shop: picks untidy the facings, emptied cases need baling, the bin bag goes to the dumpster', () => {
    const s = createNewGame(7, setup);
    const b = s.businesses.market;
    b.ownerId = 'player'; // the owner may work in the shop without a contract
    const p = s.people.player;
    b.messy = { shelf_milk: 50 };
    b.cardboard = 5;
    b.binFill = 25;
    retailTick(s, b);
    const kinds = openTasks(s, 'market').map((t) => t.kind);
    expect(kinds).toEqual(expect.arrayContaining(['face', 'cardboard', 'rubbish']));
    expect(act(s, 'shelf_milk', 'face_shelf').ok).toBe(true);
    expect(b.messy.shelf_milk).toBe(0);
    expect(act(s, 'baler', 'bale_cardboard').ok).toBe(true);
    expect(b.cardboard).toBe(0);
    expect(act(s, 'shopbin', 'empty_bin').ok).toBe(true);
    expect(p.equipment).toBe('rubbish');
    expect(b.binFill).toBe(0);
    expect(act(s, 'dumpster', 'dump_rubbish').ok).toBe(true);
    expect(p.equipment).toBe(null);
    retailTick(s, b);
    expect(openTasks(s, 'market').filter((t) => t.kind === 'face' || t.kind === 'cardboard' || t.kind === 'rubbish')).toEqual([]);
  });
});

describe('Harbour Home', () => {
  it('home changes are bought (online here), paid through the ledger and fitted later', () => {
    const s = createNewGame(7, setup);
    const p = s.people.player;
    const before = s.ledger.accounts[p.accountId].balance;
    const storeBefore = s.ledger.accounts[s.businesses.homestore.accountId].balance;
    const want = JSON.parse(JSON.stringify(s.homeDesigns.flat));
    want.wallpaper.living = 'navy';
    want.rug.living = 'blue';
    const q = quoteHome(s.homeDesigns.flat, want);
    expect(q.lines.length).toBe(2);
    expect(buyHome(s, 'player', want, true).ok).toBe(false); // not at a staffed counter: online only
    const r = buyHome(s, 'player', want, false);
    expect(r.ok).toBe(true);
    expect(s.ledger.accounts[p.accountId].balance).toBe(before - q.total - ONLINE_DELIVERY);
    expect(s.ledger.accounts[s.businesses.homestore.accountId].balance).toBeGreaterThan(storeBefore);
    expect(s.homeDesigns.flat.wallpaper.living).not.toBe('navy');
    while (s.pendingHome) step(s, 10);
    expect(s.homeDesigns.flat.wallpaper.living).toBe('navy');
    expect(auditLedger(s)).toEqual([]);
  });
});

describe('Sales Assistant', () => {
  it('the player on the Harbour Home counter takes a waiting customer\'s order', () => {
    const s = createNewGame(7, setup);
    while (s.minute < at(0, 9, 30)) step(s, 5);
    hire(s, 'player', 'homestore', 'sales', true);
    expect(act(s, 'hh_terminal', 'clock_in').ok).toBe(true);
    // a customer has browsed and is waiting at the counter
    const c = Object.values(s.people).find((p) => p.npc?.ambient && !p.visible)!;
    c.visible = true; c.where = 'homestore'; c.pos = homeQueueSlot(0);
    c.npc!.shopId = 'homestore'; c.npc!.step = 'home_wait'; c.npc!.queuedAt = s.minute; c.npc!.patienceUntil = s.minute + 60; c.npc!.queueSlot = 0; c.npc!.plan = []; c.npc!.goal = 'shop';
    s.businesses.homestore.queue = [c.id];
    const rev = s.ledger.accounts[s.businesses.homestore.accountId].balance;
    const r = act(s, 'home_counter', 'take_order');
    expect(r.ok).toBe(true);
    expect(s.businesses.homestore.queue).toEqual([]);
    expect(s.ledger.accounts[s.businesses.homestore.accountId].balance).toBeGreaterThan(rev);
    expect(auditLedger(s)).toEqual([]);
  });
});

describe('Bank loans', () => {
  it('lends against wages, takes weekly repayments, and defaults after three missed', () => {
    const s = createNewGame(7, setup);
    const p = s.people.player;
    expect(creditLimit(s, 'player').limit).toBe(0); // no income yet
    // a fortnight of wages
    for (let k = 0; k < 4; k++) transfer(s, { from: s.businesses.market.accountId, to: p.accountId, amount: 30000, reason: 'wage', memo: 'test wage' });
    const lim = creditLimit(s, 'player').limit;
    expect(lim).toBeGreaterThanOrEqual(100000);
    const bal = s.ledger.accounts[p.accountId].balance;
    expect(takeLoan(s, 'player', 100000).ok).toBe(true);
    expect(s.ledger.accounts[p.accountId].balance).toBe(bal + 100000);
    expect(takeLoan(s, 'player', 50000).ok).toBe(false); // one loan at a time
    const loan = Object.values(s.loans!)[0];
    s.minute = loan.nextDue; loansTick(s);
    expect(loan.owed).toBe(112000 - loan.weekly);
    // empty the account: three missed payments default the loan
    transfer(s, { from: p.accountId, to: s.externalId, amount: s.ledger.accounts[p.accountId].balance, reason: 'purchase', memo: 'spent' });
    for (let k = 0; k < 3; k++) { s.minute = loan.nextDue; loansTick(s); }
    expect(loan.status).toBe('defaulted');
    expect(creditLimit(s, 'player').limit).toBe(0);
    expect(auditLedger(s)).toEqual([]);
  });
});

describe('Home ownership', () => {
  it('buys the rented flat with a deposit and mortgage, pays weekly, and can sell', () => {
    const s = createNewGame(7, setup);
    const p = s.people.player;
    expect(canBuyHome(s, 'player').ok).toBe(false); // no deposit, no income
    transfer(s, { from: s.externalId, to: p.accountId, amount: 800000, reason: 'transfer', memo: 'savings' });
    for (let k = 0; k < 4; k++) transfer(s, { from: s.businesses.market.accountId, to: p.accountId, amount: 60000, reason: 'wage', memo: 'test wage' });
    expect(canBuyHome(s, 'player').reason).toBe('');
    const t = mortgageTerms(HOME_PRICES.flat);
    const bal = s.ledger.accounts[p.accountId].balance;
    expect(buyProperty(s, 'player').ok).toBe(true);
    expect(s.ledger.accounts[p.accountId].balance).toBe(bal - t.deposit);
    expect(activeLease(s, 'player')).toBeUndefined();
    expect(hasHomeAccess(s, 'player', 'flat')).toBe(true);
    const o = ownedHome(s, 'player')!;
    s.minute = o.mortgage!.nextDue; propertyTick(s);
    expect(o.mortgage!.owed).toBe(t.owed - t.weekly);
    expect(sellHome(s, 'player').ok).toBe(true);
    expect(ownedHome(s, 'player')).toBeNull();
    expect(activeLease(s, 'player')).toBeTruthy();
    expect(auditLedger(s)).toEqual([]);
  });
});

describe('Friends', () => {
  it('chatting makes friends; an invited friend comes to the cafe and you catch up', () => {
    const s = createNewGame(7, setup);
    const p = s.people.player;
    const f = s.people.p_joan; // retired, so free in the day
    p.relations[f.id] = 28; f.relations[p.id] = 28;
    while (s.minute < at(0, 10, 0)) step(s, 5);
    expect(inviteForCoffee(s, 'player', f.id).ok).toBe(false); // not a friend yet
    p.relations[f.id] = 35; f.relations[p.id] = 35;
    const r = inviteForCoffee(s, 'player', f.id);
    expect(r.ok).toBe(true);
    const m = plannedMeetup(s)!;
    // go and sit at the corner table at the time
    while (s.minute < m.at - 5) step(s, 1);
    expect(act(s, 'meet_chair', 'sit').ok).toBe(true);
    for (let k = 0; k < 40 && m.status === 'planned'; k++) step(s, 1);
    expect(m.status).toBe('met');
    expect(p.relations[f.id]).toBeGreaterThan(35);
  });
});

describe('Investing', () => {
  it('buys a stake in the cafe, takes a share of the weekly draw, and sells back', () => {
    const s = createNewGame(7, setup);
    const p = s.people.player;
    const cafe = s.businesses.cafe;
    const price = blockPrice(s, cafe);
    transfer(s, { from: s.externalId, to: p.accountId, amount: price * 3, reason: 'transfer', memo: 'test funds', key: 'inv_funds' });
    const before = s.ledger.accounts[p.accountId].balance;
    expect(buyStake(s, 'player', 'cafe').ok).toBe(true);
    expect(stakeOf(cafe, 'player')).toBe(BLOCK);
    expect(s.ledger.accounts[p.accountId].balance).toBe(before - price);
    // the Sunday draw (cafe has cash above its reserve)
    transfer(s, { from: s.externalId, to: cafe.accountId, amount: 500000, reason: 'sale', memo: 'test takings', key: 'inv_takings' });
    s.minute = at(6, 23, 30);
    dailyEconomy(s);
    expect(dividendsReceived(s, 'player')).toBeGreaterThan(0);
    const mid = s.ledger.accounts[p.accountId].balance;
    expect(sellStake(s, 'player', 'cafe').ok).toBe(true);
    expect(stakeOf(cafe, 'player')).toBe(0);
    expect(s.ledger.accounts[p.accountId].balance).toBeGreaterThan(mid);
    expect(auditLedger(s)).toEqual([]);
    expect(buyStake(s, 'player', 'council').ok).toBe(false);
  });

  it('with a quarter of the shares, buys the market outright; the draw then comes to the player', () => {
    const s = createNewGame(7, setup);
    const p = s.people.player;
    const m = s.businesses.market;
    transfer(s, { from: s.externalId, to: p.accountId, amount: 50000000, reason: 'transfer', memo: 'test funds', key: 'inv_funds2' });
    for (let i = 0; i < 4; i++) expect(buyStake(s, 'player', 'market').ok).toBe(true);
    expect(buyOut(s, 'player', 'market').ok).toBe(false);
    expect(buyStake(s, 'player', 'market').ok).toBe(true);
    const harlan = s.ledger.accounts[s.people.p_harlan.accountId].balance;
    expect(buyOut(s, 'player', 'market').ok).toBe(true);
    expect(m.ownerId).toBe('player');
    expect(s.ledger.accounts[s.people.p_harlan.accountId].balance).toBeGreaterThan(harlan);
    expect(holdings(s, 'player').map((b) => b.id)).toEqual(['market']);
    transfer(s, { from: s.externalId, to: m.accountId, amount: 500000, reason: 'sale', memo: 'test takings', key: 'inv_takings2' });
    const before = s.ledger.accounts[p.accountId].balance;
    s.minute = at(6, 23, 30);
    dailyEconomy(s);
    expect(s.ledger.accounts[p.accountId].balance).toBeGreaterThan(before);
    expect(auditLedger(s)).toEqual([]);
  });
});

describe('Town events', () => {
  it('inspectors rate the market and cafe; a filthy shop scores worse; a power cut closes the shop', () => {
    const s = createNewGame(7, setup);
    const m = s.businesses.market;
    const clean = inspect(s, m);
    m.cardboard = 10;
    m.binFill = 30;
    for (const k of Object.keys(m.messy ?? {})) m.messy![k] = 90;
    const dirty = inspect(s, m);
    expect(dirty.score).toBeLessThan(clean.score);
    expect(dirty.notes.join(' ')).toMatch(/Cardboard/);
    m.cardboard = 0; m.binFill = 0;
    for (const k of Object.keys(m.messy ?? {})) m.messy![k] = 0;
    while (s.minute < at(1, 11, 0)) step(s, 5);
    inspectionsTick(s);
    for (const r of Object.values(s.hygiene!)) r.nextAt = s.minute;
    inspectionsTick(s);
    expect(hygieneOf(s, 'market')?.rating).not.toBeNull();
    expect(hygieneOf(s, 'cafe')?.rating).not.toBeNull();
    m.outage = { from: at(21, 11, 0), until: at(21, 12, 0) };
    expect(isOpen(m, at(21, 11, 30))).toBe(false);
    expect(isOpen(m, at(21, 12, 30))).toBe(true);
    expect(auditLedger(s)).toEqual([]);
  });
});

describe('Cars', () => {
  it('buys a car, drives and parks it (fuel paid), pays insurance weekly and sells it', () => {
    const s = createNewGame(7, setup);
    const p = s.people.player;
    transfer(s, { from: s.externalId, to: p.accountId, amount: 400000, reason: 'transfer', memo: 'test funds', key: 'car_funds' });
    expect(buyCar(s, 'player', 'new', '#c0392b').ok).toBe(false);
    expect(buyCar(s, 'player', 'hatch', '#8a8f94').ok).toBe(true);
    const car = playerCar(s, 'player')!;
    expect(car.state).toBe('parked');
    expect(enterCar(s, 'player', car.id)).toMatch(/licence/);
    p.quals = ['driving'];
    const it = allInteractables(s).find((x) => x.id === `car:${car.id}`)!;
    expect(it).toBeTruthy();
    expect(optionsFor(s, 'player', it.id).find((o) => o.type === 'drive_car')?.enabled).toBe(true);
    expect(enterCar(s, 'player', car.id)).toMatch(/W\/S/);
    expect(p.where).toBe('vehicle');
    car.pos = { x: 22, z: -4 }; car.odometer += 4000;
    const before = s.ledger.accounts[p.accountId].balance;
    expect(exitCar(s, 'player').ok).toBe(true);
    expect(p.visible).toBe(true);
    expect(s.ledger.accounts[p.accountId].balance).toBe(before - 4 * FUEL_PER_KM);
    s.minute = car.nextCharge!;
    const b2 = s.ledger.accounts[p.accountId].balance;
    carsTick(s);
    expect(s.ledger.accounts[p.accountId].balance).toBe(b2 - CAR_WEEKLY);
    expect(sellCar(s, 'player').ok).toBe(true);
    expect(playerCar(s, 'player')).toBeNull();
    expect(auditLedger(s)).toEqual([]);
  });
});

describe('Training', () => {
  it('enrols, attends sessions at the training desk one a day, qualifies, and can then apply for the cook job', () => {
    const s = createNewGame(7, setup);
    const p = s.people.player;
    const cook = s.businesses.cafe.positions.find((x) => x.id === 'cook')!;
    expect(cook.quals).toEqual(['food_hygiene']);
    transfer(s, { from: s.externalId, to: p.accountId, amount: 100000, reason: 'transfer', memo: 'test funds', key: 'course_funds' });
    expect(enrol(s, 'player', 'food_hygiene').ok).toBe(true);
    while (s.minute < at(0, 9, 30)) step(s, 5);
    expect(act(s, 'training', 'study').ok).toBe(true);
    expect(p.course?.done).toBe(1);
    expect(optionsFor(s, 'player', 'training').find((o) => o.type === 'study')?.enabled).toBe(false);
    while (s.minute < at(1, 9, 30)) step(s, 5);
    expect(act(s, 'training', 'study').ok).toBe(true);
    expect(p.quals).toContain('food_hygiene');
    expect(p.course).toBeNull();
    expect(auditLedger(s)).toEqual([]);
  });
});

describe('Saturday market', () => {
  it('stalls open on Saturday mornings; the player buys fresh produce and townspeople come to browse', () => {
    const s = createNewGame(7, setup);
    const p = s.people.player;
    expect(marketOn(s, at(4, 10, 0))).toBe(false);
    s.minute = at(5, 8, 0);
    let buyers = 0;
    while (s.minute < at(5, 13, 0)) {
      step(s, 2);
      for (const q of Object.values(s.people)) if (q.action?.type === 'buy_stall') buyers++;
    }
    expect(marketOn(s)).toBe(s.minute < at(5, 15, 0) && (raining(s) < 0.3));
    if (marketOn(s)) {
      expect(buyers).toBeGreaterThan(0);
      const before = s.ledger.accounts[p.accountId].balance;
      expect(act(s, 'stall_veg', 'buy_stall').ok).toBe(true);
      expect(s.ledger.accounts[p.accountId].balance).toBe(before - stallPrice('apples'));
      expect(s.containers[p.bagId].items.apples).toBe(1);
    }
    expect(auditLedger(s)).toEqual([]);
  });
});

describe('Buy to let', () => {
  it('a finished new build is bought, let to a tenant, pays rent weekly and can be sold', () => {
    const s = createNewGame(7, setup);
    const p = s.people.player;
    expect(forSale(s).length).toBe(0);
    s.build!.plot = 2; // both houses finished
    expect(forSale(s).length).toBe(2);
    transfer(s, { from: s.externalId, to: p.accountId, amount: NEW_BUILD_PRICE, reason: 'transfer', memo: 'test funds', key: 'let_funds' });
    expect(buyNewBuild(s, 'player', 'plot_w').ok).toBe(true);
    expect(forSale(s).length).toBe(1);
    const before = s.ledger.accounts[p.accountId].balance;
    const b = s.newBuilds!.plot_w;
    s.minute = b.boughtAt + 3 * 1440 + 1;
    lettingsTick(s);
    expect(b.tenant).toBeTruthy();
    s.minute = b.nextRent!;
    lettingsTick(s);
    expect(s.ledger.accounts[p.accountId].balance).toBeGreaterThan(before);
    expect(sellNewBuild(s, 'player', 'plot_w').ok).toBe(true);
    expect(auditLedger(s)).toEqual([]);
  });
});

describe('Household bills', () => {
  it('meters energy at home and takes energy and council tax by direct debit every four weeks', () => {
    const s = createNewGame(7, setup);
    const p = s.people.player;
    expect(act(s, 'shower', 'shower').ok).toBe(true);
    const a = billAccount(s, 'player');
    expect(a.kwh).toBeGreaterThan(2);
    const est = billEstimate(s, 'player');
    const before = s.ledger.accounts[p.accountId].balance;
    transfer(s, { from: s.externalId, to: p.accountId, amount: est.total + 10000, reason: 'transfer', memo: 'test funds', key: 'bill_funds' });
    s.minute = a.nextBill;
    billsTick(s);
    expect(a.kwh).toBe(0);
    expect(s.ledger.accounts[p.accountId].balance).toBeLessThan(before + est.total + 10000);
    expect(auditLedger(s)).toEqual([]);
  });
});

describe('Net worth', () => {
  it('adds up cash, property, shares and car, less loans; milestones are announced once', () => {
    const s = createNewGame(7, setup);
    const p = s.people.player;
    const w0 = netWorth(s, 'player').total;
    transfer(s, { from: s.externalId, to: p.accountId, amount: 1500000, reason: 'transfer', memo: 'test funds', key: 'nw_funds' });
    expect(netWorth(s, 'player').total).toBe(w0 + 1500000);
    expect(buyStake(s, 'player', 'cafe').ok).toBe(true);
    expect(netWorth(s, 'player').lines.some((l) => l.label.startsWith('Shares'))).toBe(true);
    wealthDaily(s);
    expect(s.wealthMilestone).toBe(1);
    wealthDaily(s);
    expect(s.news.filter((n) => n.title.includes('net worth over')).length).toBe(1);
  });
});

describe('Life', () => {
  it('ages, couples, weddings, babies, break-ups, deaths and newcomers happen over time; the player can date and marry', () => {
    const s = createNewGame(7, setup);
    initLife(s);
    const res = residents(s);
    expect(res.every((p) => typeof p.age === 'number')).toBe(true);
    // two singles who like each other
    const singles = res.filter((p) => !p.partnerId && (p.age ?? 0) < 60);
    const [a, b] = singles;
    a.relations[b.id] = 80; b.relations[a.id] = 80;
    b.age = a.age;
    const old = res.find((p) => p !== a && p !== b)!;
    old.age = 90;
    for (let d = 1; d <= 120; d++) { s.minute = d * 1440 + 60; lifeDaily(s); }
    const titles = s.news.map((n) => n.title).join(' | ');
    expect(titles).toMatch(/seeing each other|Wedding|married/i);
    expect(old.dead ?? null).not.toBeNull();
    // the player and a single person who adores them
    const me = s.people.player;
    const c = residents(s).find((p) => !p.partnerId && !p.dead)!;
    c.relations[me.id] = 90;
    expect(askOut(s, c.id).ok).toBe(true);
    expect(propose(s, c.id).ok).toBe(false);
    s.minute += 8 * 1440;
    (me.lastSeen ??= {})[c.id] = s.minute;
    expect(propose(s, c.id).ok).toBe(true);
    expect(c.homeId).toBe(me.homeId);
    expect(breakUp(s, c.id).ok).toBe(true);
    expect(me.relationship).toBe('divorced');
  });
});
