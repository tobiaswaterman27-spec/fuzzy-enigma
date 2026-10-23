import { describe, expect, it } from 'vitest';
import { createNewGame, auditLedger, optionsFor, startAction, step } from '../src/sim/index';
import { getWorld } from '../src/sim/world/layout';
import { callVince, missionGoal, missionTick } from '../src/sim/missions';
import { stealCar } from '../src/sim/cars';

const setup = { name: 'Tester', appearance: { skin: '#e3b48f', hair: 'short' as const, hairColor: '#3b2416', build: 'average' as const } };

describe('Jobs for Vince', () => {
  it('phone boxes stand round the city and Vince offers work', () => {
    const s = createNewGame(7, setup);
    const boxes = Object.values(getWorld().interactables).filter((i) => i.kind === 'payphone');
    expect(boxes.length).toBeGreaterThan(5);
    const me = s.people.player;
    me.pos = { ...boxes[0].pos }; me.where = 'outside'; me.visible = true;
    const o = optionsFor(s, me.id, boxes[0].id).find((x) => x.type === 'vince')!;
    expect(o.enabled).toBe(true);
    expect(startAction(s, me.id, boxes[0].id, 'vince', 'call').ok).toBe(true);
    for (let i = 0; i < 8 && me.action; i++) step(s, 0.25);
    expect(s.mission).toBeTruthy();
    // a mark who is indoors has no marker until they come out
    if (s.mission!.kind !== 'collect' || s.people[s.mission!.targetId!].visible) expect(missionGoal(s)).toBeTruthy();
  });

  it('pays for each kind of job', () => {
    for (const kind of ['courier', 'carjack', 'collect'] as const) {
      const s = createNewGame(7, setup);
      const me = s.people.player;
      me.where = 'outside'; me.visible = true;
      for (let i = 0; i < 30 && s.mission?.kind !== kind; i++) { s.mission = null; callVince(s, me.id); }
      expect(s.mission?.kind).toBe(kind);
      const m = s.mission!;
      if (kind === 'courier') { me.pos = { ...m.from! }; missionTick(s); expect(s.mission?.stage).toBe('deliver'); me.pos = { ...m.to! }; missionTick(s); }
      if (kind === 'carjack') {
        const yard = getWorld().interactables.chop_shop.pos;
        const body = m.body!;
        stealCar(s, me.id, { ...yard }, 0, '#c00', body);
        me.pos = { ...yard };
        missionTick(s);
      }
      if (kind === 'collect') { const t = s.people[m.targetId!]; t.visible = true; t.pos = { ...me.pos }; t.down = s.minute; missionTick(s); }
      expect(s.mission, kind).toBeFalsy();
      expect(s.vinceRep).toBe(1);
      expect(s.ledger.txns.some((t) => t.memo === 'Cash from Vince')).toBe(true);
      expect(auditLedger(s)).toEqual([]);
    }
  });

  it('runs out of patience', () => {
    const s = createNewGame(7, setup);
    callVince(s, s.people.player.id);
    expect(s.mission).toBeTruthy();
    for (let i = 0; i < 6; i++) step(s, 60);
    expect(s.mission).toBeFalsy();
  });
});
