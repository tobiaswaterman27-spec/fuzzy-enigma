import { describe, expect, it } from 'vitest';
import { createNewGame, step, startAction, getWorld, hire, placeOrder, pickQueue, total, count, at, ITEMS, interactable, type GameState } from '../src/sim/index';

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

describe('Warehouse Operative', () => {
  it('picks an order from the racking into staging; the van loads the staged cases', () => {
    const s = createNewGame(7, setup);
    // evening shift on day 1
    while (s.minute < at(0, 14, 5)) step(s, 5);
    hire(s, 'player', 'wholesale', 'operative', true);
    s.people.player.appearance.outfit = 'uniform_wholesale';
    expect(act(s, 'wh_terminal', 'clock_in').ok).toBe(true);
    for (const sh of pickQueue(s, 'wholesale')) sh.status = 'cancelled'; // only our order on the list
    const order = placeOrder(s, 'market', 'wholesale', { coffee: 24 })!;
    step(s, 1);
    expect(Object.values(s.tasks).some((t) => t.kind === 'pick' && t.target === `${order.id}|coffee`)).toBe(true);
    // nothing on the list for milk; coffee picks a case of 12
    expect(act(s, 'wh_rack_milk', 'pick_case').ok).toBe(false);
    for (let k = 0; k < 24 / ITEMS.coffee.caseSize; k++) {
      expect(act(s, 'wh_rack_coffee', 'pick_case').ok).toBe(true);
      expect(count(s.containers[s.people.player.handsId], 'coffee')).toBe(ITEMS.coffee.caseSize);
      expect(act(s, 'wh_stage', 'stage_case').ok).toBe(true);
    }
    expect(order.picked?.coffee).toBe(24);
    expect(count(s.containers.wholesale_staging, 'coffee')).toBe(24);
    expect(act(s, 'wh_rack_coffee', 'pick_case').ok).toBe(false); // fully picked
    // next morning the van takes the staged cases
    while (s.minute < order.dispatchAt + 2) step(s, 1);
    expect(order.status).not.toBe('ordered');
    expect(order.loaded.coffee).toBe(24);
    // what is still staged belongs to orders not yet dispatched
    const reserved = pickQueue(s, 'wholesale').reduce((n, x) => n + Object.values(x.picked ?? {}).reduce((a, c) => a + c, 0), 0);
    expect(total(s.containers.wholesale_staging)).toBe(reserved);
  });
});

describe('Delivery Driver', () => {
  it('the van waits loaded for the player driver, who drives it to the shop bay and back', () => {
    const s = createNewGame(7, setup);
    hire(s, 'player', 'wholesale', 'driver', true);
    s.people.player.appearance.outfit = 'uniform_wholesale';
    const order = placeOrder(s, 'market', 'wholesale', { milk: 24 })!;
    while (s.minute < order.dispatchAt - 30) step(s, 5);
    expect(act(s, 'wh_terminal', 'clock_in').ok).toBe(true);
    while (s.minute < order.dispatchAt + 1) step(s, 1);
    const v = s.vehicles.van_1;
    expect(v.state).toBe('loaded');
    expect(v.driverId).toBe('player');
    // get in
    const p = s.people.player;
    const it = interactable(s, 'van:van_1')!;
    p.pos = { ...it.pos }; p.where = 'outside';
    expect(startAction(s, 'player', 'van:van_1', 'drive_van').ok).toBe(true);
    for (let k = 0; k < 4 && p.action; k++) step(s, 0.25);
    expect(v.state).toBe('manual_out');
    expect(p.where).toBe('vehicle');
    // drive to the bay (teleported here: the driving itself is in the client)
    v.pos = { ...v.route[v.route.length - 1] };
    step(s, 1);
    expect(v.state).toBe('unloading');
    for (let k = 0; k < 8; k++) step(s, 1);
    expect(order.status).toBe('arrived');
    expect(v.state).toBe('manual_back');
    v.pos = { ...getWorld().depot };
    step(s, 1);
    // parked; the next order due may already be loaded for the next run
    expect(['parked', 'loaded']).toContain(v.state);
    expect(p.where).toBe('outside');
    expect(p.visible).toBe(true);
  });
});

describe('Cafe Cook', () => {
  it('customers queue while you cook; you cook at the grill and serve at the counter', () => {
    const s = createNewGame(7, setup);
    while (s.minute < at(0, 11, 30)) step(s, 5);
    hire(s, 'player', 'cafe', 'kitchen', true);
    s.people.player.appearance.outfit = 'uniform_cafe';
    expect(act(s, 'cafe_terminal', 'clock_in').ok).toBe(true);
    // lunchtime: customers come in to the counter
    for (let k = 0; k < 40 && !(s.businesses.cafe.queue?.length); k++) step(s, 1);
    const q = s.businesses.cafe.queue!;
    expect(q.length).toBeGreaterThan(0);
    const c = s.people[q[0]];
    for (let k = 0; k < 20 && Math.hypot(c.pos.x - (-24), c.pos.z - 18.8) > 1.0; k++) step(s, 0.5);
    expect(act(s, 'cafe_grill', 'cook_meal').ok).toBe(true);
    expect(s.people.player.equipment).toBe('plate');
    const rev = s.ledger.accounts[s.businesses.cafe.accountId].balance;
    expect(act(s, 'cafe_counter', 'serve_meal').ok).toBe(true);
    expect(s.people.player.equipment).toBe(null);
    expect(s.ledger.accounts[s.businesses.cafe.accountId].balance).toBeGreaterThan(rev);
    expect(s.businesses.cafe.queue).not.toContain(c.id);
  });
});
