import { describe, expect, it } from 'vitest';
import { createNewGame, step, startAction, getWorld, hire, placeOrder, pickQueue, total, count, at, ITEMS, type GameState } from '../src/sim/index';

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
