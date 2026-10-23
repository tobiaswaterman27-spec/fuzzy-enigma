import { describe, expect, it } from 'vitest';
import { createNewGame, auditLedger, step } from '../src/sim/index';
import { damageCar, garageJob, stealCar } from '../src/sim/cars';
import { getWorld } from '../src/sim/world/layout';
import { transfer } from '../src/sim/ledger';

const setup = { name: 'Tester', appearance: { skin: '#e3b48f', hair: 'short' as const, hairColor: '#3b2416', build: 'average' as const } };

describe('Car damage', () => {
  it('dents the side that hits, burns out when wrecked, and blows up', () => {
    const s = createNewGame(7, setup);
    const me = s.people.player;
    stealCar(s, me.id, { x: -40, z: 4 }, 0, '#c00', 'car');
    const v = Object.values(s.vehicles).find((x) => x.driverId === me.id)!;
    damageCar(s, v, 8, 0);
    expect(v.dmg![0]).toBeGreaterThan(0.2);
    expect(v.dmg![1]).toBe(0);
    expect(v.condition).toBeLessThan(100);
    for (let i = 0; i < 20 && v.burning == null; i++) damageCar(s, v, 12, 0);
    expect(v.burning).not.toBeNull();
    for (let i = 0; i < 10; i++) step(s, 0.25);
    expect(v.wrecked).toBe(true);
    expect(me.where).toBe('outside');
    expect((me.health ?? 100)).toBeLessThan(100);
  });

  it('Eastgate Motors fixes a car, and resprays one the police want', () => {
    const s = createNewGame(7, setup);
    const me = s.people.player;
    transfer(s, { from: s.externalId, to: me.accountId, amount: 200000, reason: 'transfer', memo: 't' });
    const yard = getWorld().interactables.chop_shop.pos;
    stealCar(s, me.id, { ...yard }, 0, '#c00', 'car');
    const v = Object.values(s.vehicles).find((x) => x.driverId === me.id)!;
    damageCar(s, v, 7, 2);
    expect(s.wanted?.level).toBeGreaterThan(0);
    const before = v.color;
    expect(garageJob(s, me.id, v)).toMatch(/different car/);
    expect(s.wanted).toBeNull();
    expect(v.condition).toBe(100);
    expect(v.color).not.toBe(before);
    expect(auditLedger(s)).toEqual([]);
  });
});

import { landedJump } from '../src/sim/stunts';
describe('Stunt jumps', () => {
  it('pays the first decent jump off each ramp, once', () => {
    const s = createNewGame(7, setup);
    const me = s.people.player;
    expect(landedJump(s, me.id, 2, 8, 0.5)).toMatch(/Jump/);
    expect(landedJump(s, me.id, 2, 22, 1.4)).toMatch(/UNIQUE STUNT BONUS/);
    expect(landedJump(s, me.id, 2, 30, 1.8)).not.toMatch(/BONUS/);
    expect(s.stunts).toEqual([2]);
    expect(auditLedger(s)).toEqual([]);
  });
});
