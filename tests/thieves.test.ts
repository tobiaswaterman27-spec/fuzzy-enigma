import { describe, expect, it } from 'vitest';
import { createNewGame, auditLedger } from '../src/sim/index';
import { thiefTick } from '../src/sim/thieves';
import { hurt } from '../src/sim/health';
import { walletsTick } from '../src/sim/collect';
import { transfer } from '../src/sim/ledger';

const setup = { name: 'Tester', appearance: { skin: '#e3b48f', hair: 'short' as const, hairColor: '#3b2416', build: 'average' as const } };

describe('Pickpockets', () => {
  it('a thief takes your money and runs; put them down and it is on the pavement', async () => {
    const s = createNewGame(7, setup);
    const me = s.people.player;
    transfer(s, { from: s.externalId, to: me.accountId, amount: 50000, reason: 'transfer', memo: 't' });
    me.pos = { x: -100, z: -262 }; me.where = 'outside'; me.visible = true;
    const o = Object.values(s.people).find((p) => p.npc && !p.isPlayer && !p.police)!;
    o.visible = true; o.where = 'outside'; o.pos = { x: me.pos.x + 0.5, z: me.pos.z };
    s.thief = { id: o.id, at: s.minute, stage: 'closing' };
    const before = s.ledger.accounts[me.accountId].balance;
    thiefTick(s);
    expect(s.thief?.stage).toBe('running');
    const lost = before - s.ledger.accounts[me.accountId].balance;
    expect(lost).toBeGreaterThan(0);
    expect(o.stole).toBe(lost);
    // caught: put down by your blow, and the money is on the pavement to pick up
    o.health = 15;
    hurt(s, o, 10, 'punched', me.id);
    expect(s.drops?.length).toBe(1);
    expect(s.drops![0].amount).toBeGreaterThanOrEqual(lost);
    me.pos = { ...s.drops![0].pos };
    walletsTick(s);
    expect(s.ledger.accounts[me.accountId].balance).toBeGreaterThanOrEqual(before);
    expect(s.thief).toBeNull();
    expect(auditLedger(s)).toEqual([]);
  });
});
