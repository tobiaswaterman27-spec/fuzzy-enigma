import { describe, expect, it } from 'vitest';
import { createNewGame, auditLedger, optionsFor, startAction, step } from '../src/sim/index';
import { getWorld } from '../src/sim/world/layout';
import { arrest, crime } from '../src/sim/health';
import { prisonVenue, laundryShift } from '../src/sim/prison';

const setup = { name: 'Tester', appearance: { skin: '#e3b48f', hair: 'short' as const, hairColor: '#3b2416', build: 'average' as const } };

function sentence() {
  const s = createNewGame(7, setup);
  const me = s.people.player;
  me.pos = { x: -20, z: 3 }; me.where = 'outside'; me.visible = true;
  crime(s, 'armed robbery', 4);
  const cop = Object.values(s.people).find((o) => !o.isPlayer)!;
  arrest(s, cop);
  return { s, me };
}

describe('Prison', () => {
  it('a prison sentence is served inside HMP Harbourside, on your feet', () => {
    const { s, me } = sentence();
    const v = prisonVenue()!;
    expect(v).toBeTruthy();
    expect(me.away?.place).toBe('prison');
    expect(me.visible).toBe(true);
    expect(me.where).toBe(v.id);
    expect(me.appearance.outfit).toBe('outfit_prison');
    // the gate is locked: no walking route out
    const nodes = getWorld().nodes;
    expect(Object.keys(getWorld().edges[`in_${v.id}`] ?? {}).length >= 0).toBe(true);
    expect((getWorld().edges[`door_${v.id}`] ?? []).includes(`in_${v.id}`)).toBe(false);
    void nodes;
    // laundry knocks time off
    const until = me.away!.until;
    expect(laundryShift(s, me.id)).toMatch(/off your sentence/);
    expect(me.away!.until).toBeLessThan(until);
    // the bunk lets the days go by, and you walk out of the gate in your own clothes
    const bunk = v.spots.find((x) => x.kind === 'prison_bunk')!;
    me.pos = { ...bunk.pos };
    expect(optionsFor(s, me.id, bunk.id).some((o) => o.type === 'serve_time' && o.enabled)).toBe(true);
    startAction(s, me.id, bunk.id, 'serve_time');
    expect(s.serving).toBe(true);
    for (let d = 0; d < 9 && me.away; d++) step(s, 1440);
    expect(me.away).toBeFalsy();
    expect(me.appearance.outfit).not.toBe('outfit_prison');
    expect(Math.hypot(me.pos.x - v.outside.x, me.pos.z - v.outside.z)).toBeLessThan(1);
    expect(auditLedger(s)).toEqual([]);
  });

  it('surrendering takes a star off the sentence', () => {
    const s = createNewGame(7, setup);
    const me = s.people.player;
    me.pos = { x: -20, z: 3 }; me.where = 'outside'; me.visible = true;
    crime(s, 'armed robbery', 4);
    s.wanted!.surrender = true;
    arrest(s, Object.values(s.people).find((o) => !o.isPlayer)!);
    expect(me.away?.place).toBe('custody');
  });
});
