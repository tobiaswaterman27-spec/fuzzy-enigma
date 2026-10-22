import { describe, expect, it } from 'vitest';
import { createNewGame, initLife, buyCar, startTaxi, taxiTick, taxiTarget, transfer, enterCar, auditLedger } from '../src/sim/index';

const setup = { name: 'Tester', appearance: { skin: '#e3b48f', hair: 'short' as const, hairColor: '#3b2416', build: 'average' as const } };

describe('HarbourCabs', () => {
  it('a fare waits at the kerb, gets in, and pays at their destination', () => {
    const s = createNewGame(7, setup);
    initLife(s);
    const me = s.people.player;
    transfer(s, { from: s.externalId, to: me.accountId, amount: 500000, reason: 'transfer', memo: 'test' });
    (me.quals ??= []).push('driving');
    expect(buyCar(s, me.id, 'hatch', '#8a8f94').ok).toBe(true);
    const car = Object.values(s.vehicles).find((v) => v.kind === 'car')!;
    enterCar(s, me.id, car.id);
    expect(startTaxi(s, me.id).ok).toBe(true);
    for (let i = 0; i < 2000 && !s.taxi?.job; i++) taxiTick(s);
    const job = s.taxi!.job!;
    expect(job).toBeTruthy();
    expect(taxiTarget(s)?.text).toMatch(/pick up/);
    const p = s.people[job.passenger];
    expect(p.visible).toBe(true);
    // drive to them and stop
    car.pos = { ...job.pickup };
    for (let i = 0; i < 6; i++) taxiTick(s);
    expect(job.stage).toBe('ride');
    expect(p.where).toBe('vehicle');
    car.pos = { ...job.dropoff };
    const before = s.ledger.accounts[me.accountId].balance;
    for (let i = 0; i < 6; i++) taxiTick(s);
    expect(s.taxi!.job).toBeNull();
    expect(s.ledger.accounts[me.accountId].balance).toBeGreaterThan(before + 300);
    expect(p.visible).toBe(true);
    expect(auditLedger(s)).toEqual([]);
  });
});
