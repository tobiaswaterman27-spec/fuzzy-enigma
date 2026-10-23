import { describe, expect, it } from 'vitest';
import { createNewGame, auditLedger, optionsFor, startAction } from '../src/sim/index';
import { getWorld } from '../src/sim/world/layout';
import { leaveBike } from '../src/sim/bikes';

const setup = { name: 'Tester', appearance: { skin: '#e3b48f', hair: 'short' as const, hairColor: '#3b2416', build: 'average' as const } };

describe('Harbour Bikes', () => {
  it('hire a bike at a dock, leave it, get back on, and dock it', () => {
    const s = createNewGame(7, setup);
    const me = s.people.player;
    const docks = Object.values(getWorld().interactables).filter((i) => i.kind === 'bike_dock');
    expect(docks.length).toBeGreaterThan(3);
    me.pos = { ...docks[0].pos }; me.where = 'outside'; me.visible = true;
    expect(optionsFor(s, me.id, docks[0].id)[0].enabled).toBe(true);
    expect(startAction(s, me.id, docks[0].id, 'hire_bike').msg).toMatch(/pedal/);
    const bike = Object.values(s.vehicles).find((v) => v.kind === 'bike')!;
    expect(bike.driverId).toBe(me.id);
    // ride off and leave it in the street
    bike.pos = { x: docks[0].pos.x + 40, z: docks[0].pos.z };
    expect(leaveBike(s, me.id)).toMatch(/kerb/);
    expect(s.vehicles[bike.id].state).toBe('parked');
    me.pos = { ...bike.pos };
    expect(startAction(s, me.id, `bike:${bike.id}`, 'ride_bike').ok).toBe(true);
    // into another dock
    bike.pos = { ...docks[1].pos };
    expect(leaveBike(s, me.id)).toMatch(/docked/);
    expect(s.vehicles[bike.id]).toBeUndefined();
    expect(auditLedger(s)).toEqual([]);
  });
});
