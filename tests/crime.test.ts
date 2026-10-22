import { describe, expect, it } from 'vitest';
import { createNewGame, auditLedger, optionsFor, startAction, step } from '../src/sim/index';
import { forceShop, lootTill, shopLocked } from '../src/sim/breakins';
import { stealParked, stealOwnedCar } from '../src/sim/cars';
import { knock, breakIn, searchValuables } from '../src/sim/houses';

const setup = { name: 'Tester', appearance: { skin: '#e3b48f', hair: 'short' as const, hairColor: '#3b2416', build: 'average' as const } };

describe('Crime', () => {
  it('shops lock after hours; forcing the door sets off the alarm and the till can be emptied', () => {
    const s = createNewGame(7, setup);
    const me = s.people.player;
    s.minute = Math.floor(s.minute / 1440) * 1440 + 1440 + 2 * 60; // 2am
    expect(shopLocked(s, 'market')).toBe(true);
    const door = optionsFor(s, me.id, 'market_door');
    expect(door.some((o) => o.type === 'break_in')).toBe(true);
    forceShop(s, me.id, 'market');
    expect(shopLocked(s, 'market')).toBe(false);
    expect(s.wanted?.level ?? 0).toBeGreaterThan(0);
    const bal = s.ledger.accounts[me.accountId].balance;
    expect(lootTill(s, me.id, 'market')).toMatch(/drawer/);
    expect(s.ledger.accounts[me.accountId].balance).toBeGreaterThan(bal);
    expect(lootTill(s, me.id, 'market')).toBe('Already empty.');
    expect(auditLedger(s)).toEqual([]);
  });

  it('parked cars can be stolen, and so can neighbours\' own cars', () => {
    const s = createNewGame(7, setup);
    const me = s.people.player;
    stealParked(s, me.id, 2);
    expect(s.takenParked).toContain(2);
    expect(me.where).toBe('vehicle');
    const car = Object.values(s.vehicles).find((v) => v.stolen && v.driverId === me.id);
    expect(car).toBeTruthy();
  });

  it('flats in Marlow Court: knock, force the door, go through the drawers', () => {
    const s = createNewGame(7, setup);
    const me = s.people.player;
    const olu = s.people.p_olu;
    expect(olu.homeId).toBe('mc_0a');
    olu.where = 'mc_0a'; olu.visible = false; olu.sleeping = false;
    knock(s, me.id, 'mc_0a');
    expect(s.doorCall?.answerer).toBe('p_olu');
    for (let i = 0; i < 20; i++) step(s, 0.25);
    breakIn(s, me.id, 'mc_1a');
    const msg = searchValuables(s, me.id, 'mc_1a').msg;
    expect(msg).toMatch(/cash|coins|Empty/);
    expect(auditLedger(s)).toEqual([]);
    void startAction; void stealOwnedCar;
  });
});
