import { describe, expect, it } from 'vitest';
import { createNewGame, auditLedger, step } from '../src/sim/index';
import { GANGS, gangTick, turfSpots } from '../src/sim/gangs';
import { knockDown } from '../src/sim/health';

const setup = { name: 'Tester', appearance: { skin: '#e3b48f', hair: 'short' as const, hairColor: '#3b2416', build: 'average' as const } };

describe('Gangs', () => {
  it('hang about their corners, warn you off, come at you, and give up the corner when beaten', () => {
    const s = createNewGame(7, setup);
    const me = s.people.player;
    const spot = turfSpots(GANGS[0])[0];
    expect(spot).toBeTruthy();
    me.pos = { x: spot.x + 30, z: spot.z }; me.where = 'outside'; me.visible = true;
    gangTick(s);
    const crew = Object.values(s.people).filter((p) => p.id.startsWith('gang_rats_0_'));
    expect(crew.length).toBe(3);
    expect(crew.every((p) => p.visible && p.appearance.outfit === 'gang_red')).toBe(true);
    // right up close: warned, then they come for you
    me.pos = { x: spot.x + 1, z: spot.z + 1 };
    gangTick(s);
    expect(s.turf!['rats:0'].warned).toBeDefined();
    s.minute += 2;
    gangTick(s);
    expect(crew.some((p) => p.combat?.target === me.id)).toBe(true);
    // put them all down
    for (const p of crew) knockDown(s, p);
    gangTick(s);
    expect(s.turf!['rats:0'].day).toBe(Math.floor(s.minute / 1440));
    expect(s.ledger.txns.some((t) => t.memo === 'A thank-you from the neighbours')).toBe(true);
    void step;
    expect(auditLedger(s)).toEqual([]);
  });
});
