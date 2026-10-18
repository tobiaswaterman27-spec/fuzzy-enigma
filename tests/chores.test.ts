import { describe, expect, it } from 'vitest';
import { createNewGame, step, startAction, optionsFor, getWorld, choresOf, isDirty, retailTick, openTasks, addItems, type GameState } from '../src/sim/index';

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
