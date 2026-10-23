import { describe, expect, it } from 'vitest';
import { createNewGame, auditLedger, optionsFor, step } from '../src/sim/index';
import { crime } from '../src/sim/health';
import { handIn, readBeat, breakUp, stationTick } from '../src/sim/station';
import { canApply } from '../src/sim/employment';

const setup = { name: 'Tester', appearance: { skin: '#e3b48f', hair: 'short' as const, hairColor: '#3b2416', build: 'average' as const } };

describe('Police station', () => {
  it('has a desk sergeant; handing yourself in lands you in a cell you can see', () => {
    const s = createNewGame(7, setup);
    const me = s.people.player;
    stationTick(s);
    expect(s.people.police_sergeant.visible).toBe(true);
    crime(s, 'shoplifting', 2);
    me.pos = { x: 56, z: -16.3 }; me.where = 'police';
    expect(optionsFor(s, me.id, 'police_desk').some((o) => o.type === 'hand_in')).toBe(true);
    handIn(s, me.id);
    expect(s.wanted).toBeNull();
    expect(me.away?.place).toBe('custody');
    expect(me.visible).toBe(true);
    expect(me.pos.z).toBeLessThan(-33);
    for (let i = 0; i < 4 * 60 * 6; i++) step(s, 0.25);
    expect(me.away).toBeNull();
    expect(auditLedger(s)).toEqual([]);
  });

  it('PCSO jobs: no record needed... and a beat to walk; fights can be broken up', () => {
    const s = createNewGame(7, setup);
    const me = s.people.player;
    const vac = Object.values(s.vacancies).find((v) => v.businessId === 'police' && v.positionId === 'pcso');
    expect(vac).toBeTruthy();
    expect(canApply(s, me.id, vac!.id)).toBeNull();
    me.record = ['theft (day 1)'];
    expect(canApply(s, me.id, vac!.id)).toMatch(/record/);
    expect(readBeat(s, me.id)).toMatch(/beat/);
    expect(s.beat?.points.length).toBe(4);
    s.incident = { a: 'p_kofi', b: 'p_ken', at: s.minute, stage: 'argue', escalate: false, why: 'test' };
    expect(breakUp(s, me.id)).toMatch(/enough/);
    expect(s.incident.stage).toBe('done');
  });
});
