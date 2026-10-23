import { describe, expect, it } from 'vitest';
import { createNewGame, auditLedger, optionsFor, step } from '../src/sim/index';
import { getWorld } from '../src/sim/world/layout';
import { planVenues } from '../src/sim/world/venues';
import { clearRecord, smashCases, staffOf, venuesTick, watchFilm, wedding } from '../src/sim/venues';
import { rideTrain, trainStops } from '../src/sim/train';
import { transfer } from '../src/sim/ledger';
import { collidersIn } from '../src/sim/world/layout';

const setup = { name: 'Tester', appearance: { skin: '#e3b48f', hair: 'short' as const, hairColor: '#3b2416', build: 'average' as const } };
const at = (s: any, m: number) => { s.minute = Math.floor(s.minute / 1440) * 1440 + 1440 * 2 + m; };

describe('Landmarks', () => {
  it('opens the station, mall, hospital, City Hall and church', () => {
    createNewGame(7, setup);
    const kinds = new Set(planVenues(getWorld().city).map((v) => v.kind));
    for (const k of ['station', 'mall', 'hospital', 'cityhall', 'church']) expect(kinds.has(k as any), k).toBe(true);
  });

  it('runs trains between Central Station and the halts', () => {
    const s = createNewGame(7, setup);
    const me = s.people.player;
    transfer(s, { from: s.externalId, to: me.accountId, amount: 100000, reason: 'transfer', memo: 't' });
    const stops = trainStops();
    expect(stops.map((x) => x.id)).toEqual(['central', 'halt_west', 'halt_north']);
    // the halts stand on open pavement
    for (const h of stops.slice(1)) expect(collidersIn(h.pos.x - 0.3, h.pos.z - 0.3, h.pos.x + 0.3, h.pos.z + 0.3).filter((c) => h.pos.x > c.x0 && h.pos.x < c.x1 && h.pos.z > c.z0 && h.pos.z < c.z1)).toEqual([]);
    at(s, 10 * 60);
    me.pos = { ...stops[0].pos }; me.where = 'outside'; me.visible = true;
    const plat = Object.values(getWorld().interactables).find((i) => i.kind === 'platform' && !i.id.startsWith('halt'))!;
    expect(optionsFor(s, me.id, plat.id).some((o) => o.ui === 'train' && o.enabled)).toBe(true);
    const r = rideTrain(s, me.id, 'halt_north');
    expect(r.ok, r.msg).toBe(true);
    expect(me.away?.place).toBe('train');
    for (let i = 0; i < 40 && me.away; i++) step(s, 1);
    expect(me.away).toBeFalsy();
    expect(Math.hypot(me.pos.x - stops[2].pos.x, me.pos.z - stops[2].pos.z)).toBeLessThan(1);
    expect(auditLedger(s)).toEqual([]);
  });

  it('City Hall wipes your record and marries you; the cinema shows films; the jeweller can be smashed', () => {
    const s = createNewGame(7, setup);
    const me = s.people.player;
    transfer(s, { from: s.externalId, to: me.accountId, amount: 500000, reason: 'transfer', memo: 't' });
    at(s, 11 * 60);
    const vs = planVenues(getWorld().city);
    const hall = vs.find((v) => v.kind === 'cityhall')!;
    me.pos = { ...hall.inside }; me.where = 'outside'; me.visible = true;
    venuesTick(s);
    expect(staffOf(s, hall)).toBeTruthy();
    me.record = ['shoplifting (day 1)', 'affray'];
    expect(clearRecord(s, me.id)).toMatch(/wiped/);
    expect(me.record).toEqual([]);
    const o = Object.values(s.people).find((x) => !x.isPlayer && x.npc && !x.partnerId && x.visible)!;
    me.partnerId = o.id; o.partnerId = me.id; me.relationship = o.relationship = 'dating';
    o.relations[me.id] = 90; o.pos = { ...me.pos };
    expect(wedding(s, me.id)).toMatch(/married/);
    expect(me.relationship).toBe('married');
    const mall = vs.find((v) => v.kind === 'mall')!;
    const mood = me.needs.mood = 30;
    expect(watchFilm(s, me.id, mall)).toMatch(/You watched/);
    expect(me.needs.mood).toBeGreaterThan(mood);
    me.weapon = 'bat';
    expect(smashCases(s, me.id, mall)).toMatch(/Glass everywhere/);
    expect(s.wanted?.level).toBeGreaterThanOrEqual(3);
    expect(smashCases(s, me.id, mall)).toMatch(/empty/);
    expect(auditLedger(s)).toEqual([]);
  });
});

import { fixture, goToMatch, gateOpen, turnstiles } from '../src/sim/stadium';
describe('Match day', () => {
  it('lets you in on match days, and settles the bet at full time', () => {
    const s = createNewGame(7, setup);
    const me = s.people.player;
    transfer(s, { from: s.externalId, to: me.accountId, amount: 100000, reason: 'transfer', memo: 't' });
    // find a Saturday
    let d = Math.floor(s.minute / 1440) + 1; while (d % 7 !== 5) d++;
    s.minute = d * 1440 + 10 * 60;
    expect(gateOpen(s.minute).open).toBe(false);
    for (let i = 0; i < 4 * 60 + 30; i += 30) step(s, 30);
    expect(gateOpen(s.minute).open).toBe(true);
    me.pos = { ...turnstiles() }; me.where = 'outside'; me.visible = true;
    const opts = optionsFor(s, me.id, 'turnstile');
    expect(opts.filter((o) => o.enabled).length).toBe(4);
    const f = fixture(d);
    const bal = s.ledger.accounts[me.accountId].balance;
    expect(goToMatch(s, me.id, f.result).ok).toBe(true);
    for (let i = 0; i < 20 && me.away; i++) step(s, 10);
    expect(me.away).toBeFalsy();
    void bal;
    expect(s.ledger.txns.some((t) => t.memo === 'Winning bet' && t.to === me.accountId)).toBe(true);
    expect(Math.hypot(me.pos.x - turnstiles().x, me.pos.z - turnstiles().z)).toBeLessThan(1);
    expect(auditLedger(s)).toEqual([]);
  });
});
