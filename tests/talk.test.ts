import { describe, expect, it } from 'vitest';
import { createNewGame, initLife, residents, speechNotes, parseTurn, applyTurn, beginTalk, characterBrief, remember, followTick, step, auditLedger } from '../src/sim/index';

const setup = { name: 'Tester', appearance: { skin: '#e3b48f', hair: 'short' as const, hairColor: '#3b2416', build: 'average' as const } };

describe('Conversations', () => {
  it('notices keyboard mashing, repetition, shouting and blurting', () => {
    expect(speechNotes('asdfghjkl', [], 5000).join()).toMatch(/keyboard mashing/);
    expect(speechNotes('jjjjjjjjjj', [], 5000).join()).toMatch(/keyboard mashing/);
    expect(speechNotes('hello, how are you?', [], 5000)).toEqual([]);
    expect(speechNotes('hello', ['hello', 'Hello!'], 5000).join()).toMatch(/3 times/);
    expect(speechNotes('WHERE IS MY MONEY', [], 5000).join()).toMatch(/SHOUTING/);
    expect(speechNotes('hi', [], 300).join()).toMatch(/blurted/);
    expect(speechNotes('???', [], 5000).join()).toMatch(/noise/);
  });

  it('the brief says how long they have known you and what they remember', () => {
    const s = createNewGame(7, setup);
    initLife(s);
    const o = residents(s)[0];
    expect(characterBrief(s, o.id)).toMatch(/never met/);
    beginTalk(s, o.id);
    remember(s, o.id, 'They asked me for directions and were polite.');
    s.minute += 3 * 1440;
    beginTalk(s, o.id);
    const b = characterBrief(s, o.id);
    expect(b).toMatch(/first met .* 3 days ago/);
    expect(b).toMatch(/talked 2 times/);
    expect(b).toMatch(/directions/);
  });

  it('what they decide really happens: dating, lending, following, walking off, the police', () => {
    const s = createNewGame(7, setup);
    initLife(s);
    const me = s.people.player;
    const o = residents(s).find((p) => !p.partnerId)!;
    o.visible = true; o.where = 'outside'; o.pos = { x: 0, z: 3 }; me.pos = { x: 0, z: 2 }; me.visible = true;
    beginTalk(s, o.id);
    // a model reply with junk fields is cleaned up
    const t = parseTurn({ reply: 'Go on then.', emotion: 'ecstatic', attitude: 9, decision: { type: 'date', accept: true }, action: 'dance' });
    expect(t.emotion).toBe('neutral'); expect(t.attitude).toBe(3); expect(t.action).toBe('none');
    applyTurn(s, o.id, t);
    expect(me.partnerId).toBe(o.id);
    expect(o.gesture?.clip).toBe('talk');
    const before = s.ledger.accounts[me.accountId].balance;
    applyTurn(s, o.id, parseTurn({ reply: 'Here.', decision: { type: 'lend', accept: true, amount: 20 } }));
    expect(s.ledger.accounts[me.accountId].balance).toBe(before + 2000);
    applyTurn(s, o.id, parseTurn({ reply: 'No way.', decision: { type: 'lend', accept: false, amount: 500 } }));
    expect(s.ledger.accounts[me.accountId].balance).toBe(before + 2000);
    applyTurn(s, o.id, parseTurn({ reply: 'Lead the way.', decision: { type: 'follow', accept: true } }));
    me.pos = { x: 0, z: 8 };
    for (let i = 0; i < 20; i++) { followTick(s); step(s, 0.25); }
    expect(Math.hypot(o.pos.x - me.pos.x, o.pos.z - me.pos.z)).toBeLessThan(3);
    applyTurn(s, o.id, parseTurn({ reply: 'Get away from me!', emotion: 'scared', action: 'call_police' }));
    expect(s.wanted?.level).toBeGreaterThanOrEqual(1);
    applyTurn(s, o.id, parseTurn({ reply: "I'm going.", action: 'leave' }));
    expect(o.following ?? null).toBeNull();
    expect(auditLedger(s)).toEqual([]);
  });
});
