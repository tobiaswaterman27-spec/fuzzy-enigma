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

describe('Favours', () => {
  it('ask someone if they need a hand, do it, get paid; leave it and they are let down', async () => {
    const { askFavour, canComplete, completeFavour, favoursTick, addItems, openFavour } = await import('../src/sim/index');
    const s = createNewGame(7, setup);
    initLife(s);
    const me = s.people.player;
    const o = residents(s).find((p) => !p.dog)!;
    const r = askFavour(s, me.id, o.id);
    expect(r.ok).toBe(true);
    const f = openFavour(s, o.id)!;
    if (f.kind === 'fetch') addItems(s.containers[me.bagId], f.item!, 1);
    if (f.kind === 'fish') addItems(s.containers[me.bagId], 'fish_mackerel', 1);
    const target = f.kind === 'deliver' ? f.to! : o.id;
    expect(canComplete(s, me.id, target)).toBeTruthy();
    const before = s.ledger.accounts[me.accountId].balance;
    expect(completeFavour(s, me.id, target)).toMatch(/grateful|pleased/);
    expect(s.ledger.accounts[me.accountId].balance).toBe(before + f.reward);
    // a second one, left too long
    const o2 = residents(s).find((p) => p !== o && !p.dog)!;
    askFavour(s, me.id, o2.id);
    s.minute += 9 * 60;
    favoursTick(s);
    expect(s.favours!.some((x) => x.status === 'failed')).toBe(true);
    expect(auditLedger(s)).toEqual([]);
  });
});

describe('Achievements', () => {
  it('are announced once when first reached', async () => {
    const { achievementsTick } = await import('../src/sim/index');
    const s = createNewGame(7, setup);
    s.minute = Math.floor(s.minute / 2) * 2;
    achievementsTick(s);
    expect(s.achievements?.fish).toBeUndefined();
    s.people.player.fishCaught = 1;
    achievementsTick(s);
    expect(s.achievements?.fish).toBeDefined();
    const n = s.news.filter((x) => x.title.includes('Gone fishing')).length;
    achievementsTick(s);
    expect(s.news.filter((x) => x.title.includes('Gone fishing')).length).toBe(n);
  });
});
