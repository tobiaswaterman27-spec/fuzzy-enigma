import { describe, expect, it } from 'vitest';
import { createNewGame, transfer, auditLedger, optionsFor } from '../src/sim/index';
import { rescueDogs, adoptFromKennel, dogDies, dogsDaily } from '../src/sim/rescue';

const setup = { name: 'Tester', appearance: { skin: '#e3b48f', hair: 'short' as const, hairColor: '#3b2416', build: 'average' as const } };

describe('Dog rescue', () => {
  it('has four dogs in the kennels to adopt in person, through the ledger', () => {
    const s = createNewGame(7, setup);
    const me = s.people.player;
    expect(rescueDogs(s)).toHaveLength(4);
    const opts = optionsFor(s, me.id, 'kennel_1');
    expect(opts[0].label).toMatch(/^Adopt /);
    transfer(s, { from: s.externalId, to: me.accountId, amount: 50000, reason: 'transfer', memo: 'test' });
    const name = rescueDogs(s)[1].name;
    expect(adoptFromKennel(s, me.id, 1).ok).toBe(true);
    expect(me.dog?.name).toBe(name);
    expect(rescueDogs(s)).toHaveLength(3);
    expect(adoptFromKennel(s, me.id, 0).ok).toBe(false);
    expect(auditLedger(s)).toEqual([]);
  });

  it('dogs die, and old dogs die of old age eventually', () => {
    const s = createNewGame(7, setup);
    const me = s.people.player;
    me.dog = { name: 'Rex', color: '#000', size: 1, since: 0, happy: 80, born: s.minute - 15 * 365 * 1440 } as any;
    const mood = me.needs.mood;
    for (let i = 0; i < 400 && me.dog; i++) { s.minute += 1440; dogsDaily(s); }
    expect(me.dog).toBeUndefined();
    expect(me.needs.mood).toBeLessThan(mood);
    me.dog = { name: 'Fido', color: '#000', size: 1, since: 0, happy: 80 } as any;
    dogDies(s, me, 'hit by a car');
    expect(me.dog).toBeUndefined();
  });
});
