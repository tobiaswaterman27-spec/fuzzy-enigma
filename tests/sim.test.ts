import { describe, expect, it } from 'vitest';
import {
  createNewGame, step, transfer, auditLedger, moneySupply, getWorld, segIntersectsRect, planRoute, astar,
  applyForJob, acceptOffer, startAction, runPayroll, serialize, deserialize, safeWrite, loadSlot, worldCount,
  PRODUCTS, at, openAttendance, total, count, hire, completeSale, moveItems, minuteOfDay,
  type GameState, type KV,
} from '../src/sim/index';

const setup = { name: 'Tester', appearance: { skin: '#e3b48f', hair: 'short' as const, hairColor: '#3b2416', build: 'average' as const } };
const newGame = (seed = 7) => createNewGame(seed, setup);
const advance = (s: GameState, minutes: number) => { while (minutes > 0) { const d = Math.min(minutes, 60); step(s, d); minutes -= d; } };
const advanceTo = (s: GameState, minute: number) => advance(s, minute - s.minute);
/** test helper: put the player at an interactable and perform an action to completion */
function act(s: GameState, itId: string, type: Parameters<typeof startAction>[3], arg?: string) {
  const it = getWorld().interactables[itId] ?? { pos: s.dirt[itId].pos };
  const p = s.people.player;
  p.pos = { ...it.pos };
  p.where = getWorld().interactables[itId]?.locationId === 'market' && it.pos.z < -36 ? 'outside' : (getWorld().interactables[itId]?.locationId ?? p.where);
  const r = startAction(s, 'player', itId, type, arg);
  if (r.ok) { let guard = 0; while (p.action && guard++ < 2000) step(s, 0.25); }
  return r;
}

describe('ledger', () => {
  it('rejects overdrafts, invalid amounts and duplicate keys; balances stay auditable', () => {
    const s = newGame();
    const pl = s.people.player.accountId;
    const shop = s.businesses.market.accountId;
    const before = s.ledger.accounts[pl].balance;
    expect(transfer(s, { from: pl, to: shop, amount: before + 1, reason: 'purchase', memo: 'x' }).ok).toBe(false);
    expect(transfer(s, { from: pl, to: shop, amount: 0, reason: 'purchase', memo: 'x' }).ok).toBe(false);
    expect(transfer(s, { from: pl, to: shop, amount: 1.5, reason: 'purchase', memo: 'x' }).ok).toBe(false);
    expect(transfer(s, { from: pl, to: shop, amount: 100, reason: 'purchase', memo: 'x', key: 'k1' }).ok).toBe(true);
    expect(transfer(s, { from: pl, to: shop, amount: 100, reason: 'purchase', memo: 'x', key: 'k1' }).ok).toBe(false);
    expect(s.ledger.accounts[pl].balance).toBe(before - 100);
    expect(auditLedger(s)).toEqual([]);
    expect(moneySupply(s)).toBe(0);
  });
});

describe('world layout & navigation', () => {
  const w = getWorld();
  it('no navigation edge passes through a collider', () => {
    const bad: string[] = [];
    for (const [a, list] of Object.entries(w.edges)) for (const b of list) {
      if (a > b) continue;
      for (const r of w.colliders) if (segIntersectsRect(w.nodes[a], w.nodes[b], r, 0.2)) { bad.push(`${a}-${b}`); break; }
    }
    expect(bad).toEqual([]);
  });
  it('the pedestrian graph is fully connected', () => {
    const ids = Object.keys(w.nodes);
    for (const id of ids) expect(astar('fl_in', id), id).not.toBeNull();
  });
  it('every interactable anchor is reachable from the player flat and not inside a collider', () => {
    for (const it of Object.values(w.interactables)) {
      const inside = w.colliders.some((r) => it.pos.x > r.x0 && it.pos.x < r.x1 && it.pos.z > r.z0 && it.pos.z < r.z1);
      expect(inside, it.id).toBe(false);
      expect(planRoute(w.playerSpawn, it.pos), it.id).not.toBeNull();
    }
  });
});

describe('Journey A - start a life', () => {
  it('apply, get hired, work a shift, get paid exactly, pay rent', () => {
    const s = newGame();
    const p = s.people.player;
    const vac = Object.values(s.vacancies).find((v) => v.positionId === 'assistant_am')!;
    expect(applyForJob(s, 'player', vac.id, [1, 1, 1]).ok).toBe(true);
    expect(applyForJob(s, 'player', vac.id, [1, 1, 1]).ok).toBe(false); // no duplicate applications
    advance(s, 150);
    const app = Object.values(s.applications).find((a) => a.personId === 'player')!;
    expect(app.status).toBe('offered');
    expect(acceptOffer(s, app.id).ok).toBe(true);
    const c = s.contracts[p.contractId!];
    expect(c.startDay).toBe(1); // today's shift already started
    expect(count(s.containers[p.wardrobeId!], 'uniform_market')).toBe(1);
    // clocking in without the uniform is refused
    advanceTo(s, at(1, 7, 50));
    expect(act(s, 'terminal', 'clock_in').ok).toBe(true);
    expect(openAttendance(s, 'player')).toBeNull();
    p.appearance.outfit = 'uniform_market';
    expect(act(s, 'terminal', 'clock_in').ok).toBe(true);
    const att = openAttendance(s, 'player')!;
    expect(att.late).toBe(0);
    // real work: take a case and stock a shelf (inventory actually moves)
    const back0 = count(s.containers.market_backroom, 'milk');
    const shelf0 = count(s.containers.shelf_milk, 'milk');
    expect(act(s, 'pallet_milk', 'take_case').ok).toBe(true);
    expect(total(s.containers[p.handsId])).toBe(12);
    expect(act(s, 'shelf_milk', 'stock_shelf').ok).toBe(true);
    const moved = count(s.containers.shelf_milk, 'milk') - shelf0;
    expect(moved).toBeGreaterThan(0);
    expect(count(s.containers.market_backroom, 'milk') + count(s.containers.shelf_milk, 'milk') + total(s.containers[p.handsId])).toBeLessThanOrEqual(back0 + shelf0 + 12);
    if (total(s.containers[p.handsId])) act(s, 'pallet_milk', 'return_case');
    // finish the shift
    advanceTo(s, at(1, 14, 0));
    expect(act(s, 'terminal', 'clock_out').ok).toBe(true);
    const a2 = s.attendance[att.key];
    expect(a2.closed).toBe(true);
    expect(a2.minutesWorked).toBe(360 - (a2.clockIn! - a2.scheduledStart > 0 ? a2.clockIn! - a2.scheduledStart : 0));
    const bal0 = s.ledger.accounts[p.accountId].balance;
    advanceTo(s, at(1, 22, 5));
    const gross = Math.round((a2.minutesWorked * c.wage) / 60);
    const net = gross - Math.round(gross * 0.1);
    expect(s.ledger.accounts[p.accountId].balance - bal0).toBe(net);
    // payroll is idempotent
    runPayroll(s);
    expect(s.ledger.accounts[p.accountId].balance - bal0).toBe(net);
    // weekly rent on Monday day 8 09:00 (absent days in between are recorded, which may cost warnings)
    const before = s.ledger.accounts[p.accountId].balance;
    advanceTo(s, at(7, 9, 5));
    const rentPaid = s.ledger.txns.some((t) => t.reason === 'rent' && t.from === p.accountId);
    expect(rentPaid || s.leases[Object.keys(s.leases)[0]].arrears > 0).toBe(true);
    expect(s.ledger.accounts[p.accountId].balance).toBeLessThanOrEqual(before);
    expect(auditLedger(s)).toEqual([]);
  });
});

describe('Journey B - shop transactions', () => {
  it('a sale moves goods, money and tax consistently', () => {
    const s = newGame();
    const p = s.people.player;
    const shelf0 = count(s.containers.shelf_bread, 'bread');
    expect(act(s, 'shelf_bread', 'pick_item').ok).toBe(true);
    expect(count(s.containers[p.basketId], 'bread')).toBe(1);
    expect(count(s.containers.shelf_bread, 'bread')).toBe(shelf0 - 1);
    const shop0 = s.ledger.accounts[s.businesses.market.accountId].balance;
    const gov0 = s.ledger.accounts[s.businesses.council.accountId].balance;
    const me0 = s.ledger.accounts[p.accountId].balance;
    expect(act(s, 'kiosk', 'self_checkout').ok).toBe(true);
    const price = s.businesses.market.prices.bread;
    const tax = Math.round((price * 0.1) / 1.1);
    expect(s.ledger.accounts[p.accountId].balance).toBe(me0 - price);
    expect(s.ledger.accounts[s.businesses.market.accountId].balance - shop0).toBe(price - tax);
    expect(s.ledger.accounts[s.businesses.council.accountId].balance - gov0).toBe(tax);
    expect(count(s.containers[p.bagId], 'bread')).toBe(1);
    expect(total(s.containers[p.basketId])).toBe(0);
  });
  it('a customer who cannot afford everything only buys what they can pay for', () => {
    const s = newGame();
    const p = s.people.player;
    moveItems(s, 'shelf_coffee', p.basketId, 'coffee', 3);
    const acc = s.ledger.accounts[p.accountId];
    transfer(s, { from: acc.id, to: s.externalId, amount: acc.balance - 700, reason: 'transfer', memo: 'spend down' });
    const r = completeSale(s, 'market', 'player', null);
    expect(r.ok).toBe(true);
    expect(r.units).toBe(1);
    expect(acc.balance).toBeGreaterThanOrEqual(0);
    expect(count(s.containers.market_backroom, 'coffee')).toBeGreaterThan(0);
  });
  it('leaving the shop with unpaid items returns them', () => {
    const s = newGame();
    act(s, 'shelf_soup', 'pick_item');
    const p = s.people.player;
    p.where = 'market';
    p.pos = { x: 17.5, z: -6 };
    step(s, 0.25);
    expect(total(s.containers[p.basketId])).toBe(0);
  });
});

describe('Journey F/G - deliveries and supply disruption', () => {
  it('ordered stock is delivered by van, checked in and invoiced exactly once', () => {
    const s = newGame();
    advanceTo(s, at(1, 6, 0));
    const ship = Object.values(s.shipments).find((x) => x.buyerId === 'market')!;
    expect(ship.status).toBe('ordered');
    advanceTo(s, at(1, 9, 0));
    expect(['arrived', 'received']).toContain(s.shipments[ship.id].status);
    advanceTo(s, at(1, 13, 0));
    const sh = s.shipments[ship.id];
    expect(sh.status).toBe('received');
    expect(sh.paid).toBe(true);
    const invoices = s.ledger.txns.filter((t) => t.ref === ship.id && t.reason === 'supplier_invoice');
    expect(invoices.length).toBe(1);
    expect(invoices[0].amount).toBe(sh.invoiced);
    expect(total(s.containers.market_bay)).toBe(0);
  });
  it('a national shortage of milk produces short deliveries and empty shelves', () => {
    const s = newGame();
    s.flags.disrupt_milk = true;
    s.containers.wholesale_stock.items.milk = 0;
    for (let d = 0; d < 3; d++) advance(s, 1440);
    expect(s.news.some((n) => n.title.includes('Supply problem'))).toBe(true);
    expect(count(s.containers.shelf_milk, 'milk') + count(s.containers.market_backroom, 'milk')).toBeLessThan(20);
    expect(s.businesses.market.stats.reduce((a, x) => a + x.lostSales, 0)).toBeGreaterThan(0);
  });
});

describe('Journey H/J - persistence and extended simulation', () => {
  it('runs 14 days with consistent money, inventory and NPC identities', () => {
    const s = newGame(11);
    const ids = Object.keys(s.people).sort();
    for (let d = 0; d < 14; d++) advance(s, 1440);
    expect(Object.keys(s.people).sort()).toEqual(ids);
    expect(moneySupply(s)).toBe(0);
    expect(auditLedger(s)).toEqual([]);
    for (const c of Object.values(s.containers)) for (const n of Object.values(c.items)) expect(n).toBeGreaterThanOrEqual(0);
    for (const c of Object.values(s.containers)) expect(Object.values(c.items).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(c.capacity);
    // named workers kept turning up
    const absences = Object.values(s.attendance).filter((a) => a.absent && !s.people[s.contracts[a.contractId].personId].isPlayer);
    expect(absences.length).toBeLessThan(4);
    // shop received deliveries and kept trading
    expect(s.businesses.market.stats.filter((x) => x.customers > 20).length).toBeGreaterThan(8);
    for (const k of PRODUCTS) expect(worldCount(s, k)).toBeGreaterThan(0);
    // nobody is permanently stranded mid-plan
    const stuck = Object.values(s.people).filter((p) => p.npc && p.move && p.move.stuckTime > 30);
    expect(stuck).toEqual([]);
  });
});

describe('Journey I - save and resume', () => {
  it('a saved game resumes identically mid-delivery and mid-shift (deterministic)', () => {
    const s = newGame(3);
    hire(s, 'player', 'market', 'assistant_am', true);
    advanceTo(s, at(1, 7, 10));
    const text = serialize(s);
    const r = deserialize(text);
    expect(r.ok).toBe(true);
    const copy = (r as any).state as GameState;
    advance(s, 600);
    advance(copy, 600);
    expect(JSON.stringify(copy)).toBe(JSON.stringify(s));
  });
  it('safe write keeps a backup and refuses corrupted saves', () => {
    const mem = new Map<string, string>();
    const kv: KV = { get: (k) => mem.get(k) ?? null, set: (k, v) => void mem.set(k, v), remove: (k) => void mem.delete(k) };
    const s = newGame();
    expect(safeWrite(kv, 'slot1', s, 'a').ok).toBe(true);
    advance(s, 60);
    expect(safeWrite(kv, 'slot1', s, 'b').ok).toBe(true);
    expect(mem.has('slot1.bak')).toBe(true);
    mem.set('slot1', '{"broken":');
    const back = loadSlot(kv, 'slot1');
    expect(back.ok).toBe(true);
    expect((back as any).recoveredFromBackup).toBe(true);
    const bad = JSON.parse(serialize(s));
    bad.state.ledger.accounts[s.people.player.accountId].balance += 999;
    expect(deserialize(JSON.stringify(bad)).ok).toBe(false);
    void minuteOfDay;
  });
});
