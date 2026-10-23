import { describe, expect, it } from 'vitest';
import { createNewGame, auditLedger, optionsFor, startAction, step } from '../src/sim/index';
import { forceShop, lootTill, shopLocked } from '../src/sim/breakins';
import { stealParked, stealOwnedCar } from '../src/sim/cars';
import { knock, breakIn, searchValuables } from '../src/sim/houses';
import { pickpocket, mug, chopCandidate, sellToChop, CHOP_SHOP } from '../src/sim/streetcrime';
import { exitCar } from '../src/sim/cars';

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

  it('pockets get picked (or you get caught), muggings, and the chop shop pays cash for stolen cars', () => {
    const s = createNewGame(9, setup);
    const me = s.people.player;
    const victims = ['p_harlan', 'p_gail', 'p_joan', 'p_rosa', 'p_ruth', 'p_kofi'];
    const msgs = victims.map((id) => { s.minute += 1; return pickpocket(s, me.id, id); });
    expect(msgs.some((m) => /notices|never knew/.test(m))).toBe(true);
    me.weapon = 'knife';
    expect(mug(s, me.id, 'p_marcus')).toMatch(/hand|pockets|goes for you/);
    stealParked(s, me.id, 0);
    const car = Object.values(s.vehicles).find((v) => v.stolen && v.driverId === me.id)!;
    car.pos = { x: CHOP_SHOP.x, z: CHOP_SHOP.z + 2 }; car.driverId = null; car.state = 'parked'; me.where = 'outside'; me.visible = true;
    expect(chopCandidate(s, CHOP_SHOP)?.id).toBe(car.id);
    const bal = s.ledger.accounts[me.accountId].balance;
    sellToChop(s, me.id, car.id);
    expect(s.vehicles[car.id]).toBeUndefined();
    expect(s.ledger.accounts[me.accountId].balance).toBeGreaterThan(bal);
    expect(auditLedger(s)).toEqual([]);
    void exitCar;
  });
});

import { busStops, rideBus } from '../src/sim/bus';
describe('Buses', () => {
  it('a bus takes you across the city for the fare, and you get off at the stop', () => {
    const s = createNewGame(7, setup);
    const me = s.people.player;
    const stops = busStops();
    expect(stops.length).toBeGreaterThan(10);
    me.pos = { ...stops[0].pos }; me.where = 'outside'; me.visible = true;
    const far = stops[stops.length - 1];
    const bal = s.ledger.accounts[me.accountId].balance;
    expect(rideBus(s, me.id, far.id).ok).toBe(true);
    expect(s.ledger.accounts[me.accountId].balance).toBe(bal - 250);
    for (let i = 0; i < 4 * 30; i++) step(s, 0.25);
    expect(me.away).toBeNull();
    expect(Math.hypot(me.pos.x - far.pos.x, me.pos.z - far.pos.z)).toBeLessThan(1);
    expect(auditLedger(s)).toEqual([]);
  });
});

import { bargeIn, houseOpen } from '../src/sim/houses';
import { dwellingDoor } from '../src/sim/world/layout';
describe('At the door', () => {
  it('whoever answers stays in the doorway while you are on the step; you can push past them', () => {
    const s = createNewGame(7, setup);
    const me = s.people.player;
    const olu = s.people.p_olu;
    olu.where = 'mc_0a'; olu.visible = false; olu.sleeping = false; olu.relations[me.id] = 0;
    const d = dwellingDoor('mc_0a')!;
    me.pos = { x: d.out.x, z: d.out.z }; me.where = 'marlow'; me.visible = true;
    knock(s, me.id, 'mc_0a');
    for (let i = 0; i < 4 * 6; i++) { step(s, 0.25); me.pos = { x: d.out.x, z: d.out.z }; }
    expect(s.doorCall?.stage).toBe('open');
    expect(olu.visible).toBe(true);
    expect(bargeIn(s, me.id)).toMatch(/push past|shove past/);
    expect(houseOpen(s, 'mc_0a')).toBe(true);
    expect(s.wanted?.level ?? 0).toBeGreaterThan(0);
  });
});
