import { describe, expect, it } from 'vitest';
import { createNewGame, optionsFor, startAction, addItems, count, step, minuteOfDay } from '../src/sim/index';
import { venues, offersAt, shiftBlocker, finishShift, SHIFT_PAY, venuesTick } from '../src/sim/venues';
import { venueOpen } from '../src/sim/world/venues';

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

describe('Cash shifts', () => {
  it('a shift at the bakery pays in cash, once a day', () => {
    const s = createNewGame(7, setup);
    const me = s.people.player;
    const v = venues().find((x) => x.kind === 'bakery')!;
    while (!venueOpen(v, s.minute) || minuteOfDay(s.minute) < 10 * 60) step(s, 10);
    me.pos = { ...v.staff }; me.where = v.id; me.visible = true;
    venuesTick(s);
    expect(shiftBlocker(s, me, v)).toBeNull();
    const before = s.ledger.accounts[me.accountId].balance;
    const msg = finishShift(s, me.id, v);
    expect(msg).toMatch(/cash/);
    expect(s.ledger.accounts[me.accountId].balance).toBe(before + SHIFT_PAY.bakery!.hourly * 2);
    expect(shiftBlocker(s, me, v)).toMatch(/already/);
  });
});

describe('Busking', () => {
  it('a guitar and listeners bring in coins, and practice helps', async () => {
    const { buskMinute, canBusk } = await import('../src/sim/busking');
    const s = createNewGame(7, setup);
    const me = s.people.player;
    expect(canBusk(s, me.id)).toBe(false);
    addItems(s.containers[me.bagId], 'guitar', 1);
    expect(canBusk(s, me.id)).toBe(true);
    const cash = s.ledger.accounts[me.accountId].balance;
    expect(buskMinute(s, me.id, 0, 0.1)).toBe(0);
    const c = buskMinute(s, me.id, 5, 0.1);
    expect(c).toBeGreaterThan(0);
    expect(s.ledger.accounts[me.accountId].balance).toBe(cash + c);
    expect(me.skills.music).toBeGreaterThan(0);
  });
});
