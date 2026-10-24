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

describe('Tailing someone for Vince', () => {
  it('pays if you keep on them at a distance, fails if you crowd them', () => {
    for (const crowd of [false, true]) {
      const s = createNewGame(7, setup);
      const me = s.people.player;
      me.where = 'outside'; me.visible = true;
      const t = Object.values(s.people).find((o) => o.npc && !o.npc.ambient && !o.police && !o.isPlayer)!;
      t.visible = true; t.where = 'outside';
      s.mission = { kind: 'tail', stage: 'go', targetId: t.id, deadline: s.minute + 90, reward: 35000, held: 0, close: 0, away: 0, at: s.minute, text: '' };
      const cash = s.ledger.accounts[me.accountId].balance;
      for (let i = 0; i < 60 && s.mission; i++) {
        s.minute += 0.5;
        t.visible = true; t.where = 'outside';
        me.pos = { x: t.pos.x + (crowd ? 2 : 15), z: t.pos.z };
        missionTick(s);
      }
      expect(s.mission).toBeNull();
      if (crowd) expect(s.ledger.accounts[me.accountId].balance).toBe(cash);
      else expect(s.ledger.accounts[me.accountId].balance).toBe(cash + 35000);
    }
  });
});

describe('Takeaway deliveries', () => {
  it('three drops pay with a bonus; too slow and the round ends', async () => {
    const { startDeliveries, DELIVERY_PAY, DELIVERY_BONUS } = await import('../src/sim/missions');
    const s = createNewGame(7, setup);
    const me = s.people.player;
    me.where = 'outside'; me.visible = true;
    const cash = s.ledger.accounts[me.accountId].balance;
    startDeliveries(s, me.id, 'v_0', me.pos);
    for (let k = 0; k < 3; k++) { me.pos = { ...s.delivery!.to }; s.minute += 0.5; missionTick(s); }
    expect(s.delivery).toBeNull();
    expect(s.ledger.accounts[me.accountId].balance).toBe(cash + DELIVERY_PAY * 3 + DELIVERY_BONUS);
    startDeliveries(s, me.id, 'v_0', me.pos);
    s.minute = s.delivery!.deadline + 1; missionTick(s);
    expect(s.delivery).toBeNull();
  });
});
