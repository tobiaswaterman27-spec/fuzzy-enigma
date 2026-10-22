import { describe, expect, it } from 'vitest';
import { createNewGame, initLife, initDogs, residents, adoptDog, dogTick, scratchcard, buyLotto, lottoTick, nextDraw, joggersTick, step, auditLedger, transfer, call999, hurt } from '../src/sim/index';

const setup = { name: 'Tester', appearance: { skin: '#e3b48f', hair: 'short' as const, hairColor: '#3b2416', build: 'average' as const } };

describe('Leisure', () => {
  it('dogs: some households have one; you can adopt, walk and feed yours', () => {
    const s = createNewGame(7, setup);
    initLife(s); initDogs(s);
    expect(residents(s).some((p) => p.dog)).toBe(true);
    const me = s.people.player;
    transfer(s, { from: s.externalId, to: me.accountId, amount: 50000, reason: 'transfer', memo: 'test' });
    expect(adoptDog(s, me.id, 'Rex').ok).toBe(true);
    expect(me.dog?.name).toBe('Rex');
    me.visible = true; me.where = 'outside'; me.pos = { x: 0, z: 0 };
    for (let i = 0; i < 31; i++) { s.minute += 1; dogTick(s); }
    expect(me.dog!.walkedDay).toBe(Math.floor(s.minute / 1440));
    const bal = s.ledger.accounts[me.accountId].balance;
    s.minute = me.dog!.nextFood!; dogTick(s);
    expect(s.ledger.accounts[me.accountId].balance).toBe(bal - 1200);
    expect(auditLedger(s)).toEqual([]);
  });

  it('scratchcards and the Saturday lottery pay out through the ledger', () => {
    const s = createNewGame(7, setup);
    const me = s.people.player;
    transfer(s, { from: s.externalId, to: me.accountId, amount: 100000, reason: 'transfer', memo: 'test' });
    let wins = 0;
    for (let i = 0; i < 200; i++) { s.minute += 0.01; if (!/nothing/.test(scratchcard(s, me.id).msg)) wins++; }
    expect(wins).toBeGreaterThan(20);
    expect(buyLotto(s, me.id).ok).toBe(true);
    expect(buyLotto(s, me.id).ok).toBe(false);
    s.minute = nextDraw(s.minute) + 1;
    lottoTick(s);
    expect(s.news[0].title).toMatch(/Lottery/);
    expect(auditLedger(s)).toEqual([]);
  });

  it('keen townspeople jog round the park in the morning; 999 brings the ambulance', () => {
    const s = createNewGame(7, setup);
    initLife(s);
    s.minute = Math.floor(s.minute / 1440) * 1440 + 6 * 60 + 25;
    for (const p of residents(s)) { p.npc!.goal = 'idle_home'; p.action = null; p.move = null; p.sleeping = false; }
    let jogger = null;
    for (let i = 0; i < 100 && !jogger; i++) { s.minute = Math.ceil((s.minute + 0.1) / 5) * 5; joggersTick(s); jogger = residents(s).find((p) => (p.jogging ?? 0) > s.minute); }
    expect(jogger).toBeTruthy();
    const me = s.people.player;
    const v = residents(s)[0];
    v.visible = true; v.where = 'outside'; v.pos = { ...me.pos };
    hurt(s, v, 85, 'a fall');
    expect(call999(s, me.id, 'ambulance')).toMatch(/ambulance is on its way/);
    step(s, 1.5);
    expect(v.away?.place).toBe('hospital');
  });
});
