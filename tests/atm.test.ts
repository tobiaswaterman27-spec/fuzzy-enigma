import { describe, expect, it } from 'vitest';
import { createNewGame, auditLedger, optionsFor, startAction, step } from '../src/sim/index';
import { getWorld } from '../src/sim/world/layout';

const setup = { name: 'Tester', appearance: { skin: '#e3b48f', hair: 'short' as const, hairColor: '#3b2416', build: 'average' as const } };

describe('Cash machines', () => {
  it('check your balance, or smash one open (once a day) and the police come', () => {
    const s = createNewGame(7, setup);
    const me = s.people.player;
    const atm = Object.values(getWorld().interactables).find((i) => i.kind === 'atm')!;
    expect(atm).toBeTruthy();
    me.pos = { ...atm.pos }; me.where = 'outside'; me.visible = true;
    expect(startAction(s, me.id, atm.id, 'atm_balance').msg).toMatch(/Balance/);
    expect(optionsFor(s, me.id, atm.id).find((o) => o.type === 'smash_atm')!.enabled).toBe(false);
    me.weapon = 'bat';
    expect(startAction(s, me.id, atm.id, 'smash_atm').ok).toBe(true);
    expect(s.wanted?.level).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < 12 && me.action; i++) step(s, 0.25);
    expect(s.ledger.txns.some((t) => t.memo === 'Cash from a broken cash machine')).toBe(true);
    expect(optionsFor(s, me.id, atm.id).find((o) => o.type === 'smash_atm')!.enabled).toBe(false);
    expect(auditLedger(s)).toEqual([]);
  });
});
