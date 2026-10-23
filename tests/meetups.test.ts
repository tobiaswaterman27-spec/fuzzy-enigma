import { describe, expect, it } from 'vitest';
import { createNewGame, coffeeSlot, currentShift, minuteOfDay, dayIndex, parseTurn, inviteForCoffee, step, MEET_PLACES, meetupNote } from '../src/sim/index';

const setup = { name: 'Tester', appearance: { skin: '#e3b48f', hair: 'short' as const, hairColor: '#3b2416', build: 'average' as const } };

describe('Meet-ups', () => {
  it('coffee is only ever arranged when the cafe is open and they are not at work', () => {
    const s = createNewGame(7, setup);
    const workers = Object.values(s.people).filter((p) => p.contractId && p.npc && !p.npc.ambient).slice(0, 8);
    for (const w of workers) for (let k = 0; k < 6; k++) {
      s.minute += 377;
      const t = coffeeSlot(s, w);
      if (t == null) continue;
      expect(t).toBeGreaterThanOrEqual(s.minute + 60);
      expect(minuteOfDay(t)).toBeGreaterThanOrEqual(9 * 60);
      expect(minuteOfDay(t)).toBeLessThan(16 * 60 + 30);
      expect(dayIndex(t) % 7).not.toBe(2);
      expect(currentShift(s.contracts[w.contractId!], t, 0)).toBeNull();
    }
  });
  it('a time asked for is kept if it suits', () => {
    const s = createNewGame(7, setup);
    const jobless = Object.values(s.people).find((p) => p.npc && !p.npc.ambient && !p.contractId)!;
    const tomorrow2pm = (dayIndex(s.minute) + 1) * 1440 + 14 * 60;
    const t = coffeeSlot(s, jobless, tomorrow2pm);
    if (dayIndex(tomorrow2pm) % 7 !== 2) expect(t).toBe(tomorrow2pm);
    const turn = parseTurn({ reply: 'Go on then', decision: { type: 'meet', accept: true, when: 'tomorrow 14:00' } }, s.minute);
    expect(turn.decision?.at).toBe(tomorrow2pm);
  });
  it('a drink at the pub happens when you are both near the table, and who was late is remembered', () => {
    const s = createNewGame(7, setup);
    const f = Object.values(s.people).find((p) => p.npc && !p.npc.ambient && !p.police && !p.contractId)!;
    expect(inviteForCoffee(s, 'player', f.id, true, undefined, 'pub').ok).toBe(true);
    const m = s.meetups!.slice(-1)[0];
    expect(m.place).toBe('pub');
    expect(minuteOfDay(m.at)).toBeGreaterThanOrEqual(12 * 60);
    const me = s.people.player;
    while (s.minute < m.at + 6) step(s, 1);
    me.pos = { x: MEET_PLACES.pub.spot.x + 3, z: MEET_PLACES.pub.spot.z + 2 }; me.where = 'outside'; me.visible = true;
    for (let i = 0; i < 40 && m.status === 'planned'; i++) step(s, 1);
    expect(m.status).toBe('met');
    expect(m.youArrived).toBeGreaterThan(m.at);
    expect(meetupNote(s, f.id)).toMatch(/minutes late/);
  });
});
