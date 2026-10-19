import { describe, expect, it } from 'vitest';
import { createNewGame, step, startAction, optionsFor, getWorld, choresOf, isDirty, retailTick, openTasks, addItems, auditLedger, hire, at, homeQueueSlot, creditLimit, takeLoan, transfer, loansTick, canBuyHome, mortgageTerms, HOME_PRICES, buyProperty, activeLease, hasHomeAccess, ownedHome, propertyTick, sellHome, type GameState } from '../src/sim/index';
import { buyHome, ONLINE_DELIVERY, quoteHome } from '../src/sim/homestore';

const setup = { name: 'Tester', appearance: { skin: '#e3b48f', hair: 'short' as const, hairColor: '#3b2416', build: 'average' as const } };
function act(s: GameState, itId: string, type: Parameters<typeof startAction>[3], arg?: string) {
  const it = getWorld().interactables[itId];
  const p = s.people.player;
  p.pos = { ...it.pos };
  p.where = it.locationId;
  const r = startAction(s, 'player', itId, type, arg);
  if (r.ok) { let guard = 0; while (p.action && guard++ < 4000) step(s, 0.25); }
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
