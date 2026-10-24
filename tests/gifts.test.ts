import { describe, expect, it } from 'vitest';
import { createNewGame, optionsFor, startAction, addItems, count } from '../src/sim/index';
import { venues, offersAt } from '../src/sim/venues';

const setup = { name: 'Tester', appearance: { skin: '#e3b48f', hair: 'short' as const, hairColor: '#3b2416', build: 'average' as const } };

describe('Gifts and the new shops', () => {
  it('the town has a bakery, a florist and a bookshop, and the florist sells flowers', () => {
    const v = venues();
    for (const k of ['bakery', 'florist', 'bookshop']) expect(v.some((x) => x.kind === k)).toBe(true);
    const f = v.find((x) => x.kind === 'florist')!;
    expect(offersAt(f, 'venue_counter').some((o) => o.item === 'flowers')).toBe(true);
  });
  it('flowers handed over make them happier and closer', () => {
    const s = createNewGame(7, setup);
    const me = s.people.player;
    const o = Object.values(s.people).find((p) => p.npc && !p.npc.ambient && !p.police)!;
    o.visible = true; o.where = me.where; o.pos = { x: me.pos.x + 1, z: me.pos.z };
    me.relations[o.id] = 30;
    addItems(s.containers[me.bagId], 'flowers', 1);
    const opt = optionsFor(s, 'player', `person:${o.id}`).find((x) => x.type === 'give_flowers');
    expect(opt).toBeTruthy();
    const mood = o.needs.mood;
    const r = startAction(s, 'player', `person:${o.id}`, 'give_flowers');
    expect(r.ok).toBe(true);
    expect(me.relations[o.id]).toBeGreaterThan(30);
    expect(o.needs.mood).toBeGreaterThan(mood);
    expect(count(s.containers[me.bagId], 'flowers')).toBe(0);
    expect(o.npc?.gift?.what).toBe('flowers');
  });
});
