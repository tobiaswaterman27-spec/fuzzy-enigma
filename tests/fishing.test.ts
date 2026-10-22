import { describe, expect, it } from 'vitest';
import { createNewGame, startAction, step, strike, buyTackle, sellCatch, transfer, getWorld, auditLedger, count, optionsFor, initLife, anglersTick, residents } from '../src/sim/index';

const setup = { name: 'Tester', appearance: { skin: '#e3b48f', hair: 'short' as const, hairColor: '#3b2416', build: 'average' as const } };

describe('Fishing', () => {
  it('buy tackle, cast, strike at the bite, sell the catch', () => {
    const s = createNewGame(7, setup);
    const me = s.people.player;
    transfer(s, { from: s.externalId, to: me.accountId, amount: 20000, reason: 'transfer', memo: 'test' });
    const spot = getWorld().interactables.fish_2;
    me.pos = { ...spot.pos }; me.where = 'outside'; me.visible = true;
    expect(optionsFor(s, me.id, 'fish_2')[0].enabled).toBe(false);
    expect(buyTackle(s, me, 'rod').ok).toBe(true);
    expect(buyTackle(s, me, 'bait').ok).toBe(true);
    let landed = 0;
    for (let k = 0; k < 8; k++) {
      expect(startAction(s, me.id, 'fish_2', 'fish').ok).toBe(true);
      // wait for the float to go under, then strike
      for (let i = 0; i < 400 && s.fishing && s.minute < s.fishing.biteAt; i++) step(s, 0.05);
      const m = strike(s, me);
      if (/land/.test(m)) landed++;
      expect(me.action).toBeNull();
    }
    expect(landed).toBeGreaterThan(4);
    expect(count(s.containers[me.bagId], 'bait')).toBe(2);
    // striking too early loses the bait
    startAction(s, me.id, 'fish_2', 'fish');
    expect(strike(s, me)).toMatch(/Too soon/);
    const before = s.ledger.accounts[me.accountId].balance;
    const r = sellCatch(s, me);
    if (r.ok) expect(s.ledger.accounts[me.accountId].balance).toBeGreaterThan(before);
    expect(auditLedger(s)).toEqual([]);
  });

  it('townspeople come down to the quay to fish', () => {
    const s = createNewGame(7, setup);
    initLife(s);
    s.minute = Math.floor(s.minute / 1440) * 1440 + 17 * 60 + 30;
    for (const p of residents(s)) { p.npc!.goal = 'idle_home'; p.action = null; p.move = null; p.sleeping = false; }
    let angler = null;
    for (let i = 0; i < 60 && !angler; i++) { s.minute = Math.ceil((s.minute + 0.1) / 7) * 7; anglersTick(s); angler = residents(s).find((p) => p.npc!.plan.some((x) => x.kind === 'act' && x.type === 'fish')); }
    expect(angler).toBeTruthy();
  });
});

describe('Boat hire', () => {
  it('hire the boat, fish offshore, bring it back (late costs extra)', async () => {
    const { hireBoat, returnBoat, castFromBoat, BOAT_ID } = await import('../src/sim/index');
    const s = createNewGame(7, setup);
    const me = s.people.player;
    transfer(s, { from: s.externalId, to: me.accountId, amount: 20000, reason: 'transfer', memo: 'test' });
    expect(hireBoat(s, me.id).ok).toBe(true);
    expect(me.where).toBe('vehicle');
    const v = s.vehicles[BOAT_ID];
    v.pos = { x: 0, z: 140 };
    expect(returnBoat(s, me.id).ok).toBe(false);
    buyTackle(s, me, 'rod'); buyTackle(s, me, 'bait');
    let big = 0;
    for (let k = 0; k < 6; k++) {
      castFromBoat(s, me);
      s.minute = s.fishing!.biteAt + 0.1;
      if (/bass|cod|pollock|crab/.test(strike(s, me))) big++;
    }
    expect(big).toBeGreaterThan(1);
    v.pos = { x: 24, z: 94 };
    s.minute = v.waitUntil + 20;
    const r = returnBoat(s, me.id);
    expect(r.ok).toBe(true);
    expect(r.msg).toMatch(/extra/);
    expect(me.visible).toBe(true);
    expect(auditLedger(s)).toEqual([]);
  });
});
