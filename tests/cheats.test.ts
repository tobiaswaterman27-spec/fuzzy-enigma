import { describe, expect, it } from 'vitest';
import { createNewGame, auditLedger, typedCheat } from '../src/sim/index';

const setup = { name: 'Tester', appearance: { skin: '#e3b48f', hair: 'short' as const, hairColor: '#3b2416', build: 'average' as const } };

describe('Cheats', () => {
  it('codes do what they say, keep the books straight, and nonsense does nothing', () => {
    const s = createNewGame(7, setup);
    const me = s.people.player;
    const before = s.ledger.accounts[me.accountId].balance;
    expect(typedCheat(s, me.id, 'WONGA')).toMatch(/1,000/);
    expect(s.ledger.accounts[me.accountId].balance - before).toBe(100000);
    s.wanted = { stars: 3 } as never;
    expect(typedCheat(s, me.id, 'XXBOBBIES')).toBeTruthy();
    expect(s.wanted).toBeNull();
    me.health = 20; me.needs.satiety = 5;
    typedCheat(s, me.id, 'CUPPA');
    expect(me.health).toBe(100); expect(me.needs.satiety).toBe(100);
    me.where = 'outside'; me.visible = true;
    typedCheat(s, me.id, 'MOTOR');
    expect(me.where).toBe('vehicle');
    expect(Object.values(s.vehicles).some((v) => v.driverId === me.id && !v.stolen)).toBe(true);
    expect(typedCheat(s, me.id, 'PLEASE')).toBeNull();
    expect(s.cheats).toBe(4);
    expect(auditLedger(s)).toEqual([]);
  });
});
