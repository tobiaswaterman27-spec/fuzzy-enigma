import { describe, expect, it } from 'vitest';
import { createNewGame, initLife, residents, scheduleGathering, step, GATHER_SPOT, die } from '../src/sim/index';

const setup = { name: 'Tester', appearance: { skin: '#e3b48f', hair: 'short' as const, hairColor: '#3b2416', build: 'average' as const } };

describe('Gatherings', () => {
  it('guests walk to a wedding in the park and stand together; you are invited if you know the couple', () => {
    const s = createNewGame(7, setup);
    initLife(s);
    s.minute = Math.floor(s.minute / 1440) * 1440 + 10 * 60;
    const [a, b, ...rest] = residents(s);
    for (const r of rest.slice(0, 5)) { r.relations[a.id] = 50; }
    s.people.player.relations[a.id] = 30;
    const g = scheduleGathering(s, 'wedding', [a, b], 'the wedding of A and B', 0, 12);
    expect(g.invited).toBe(true);
    expect(s.news[0].title).toMatch(/Invited/);
    step(s, 140);
    const near = [...g.hosts, ...g.guests].filter((id) => { const p = s.people[id]; return p.visible && Math.hypot(p.pos.x - GATHER_SPOT.x, p.pos.z - GATHER_SPOT.z) < 7; });
    expect(near.length).toBeGreaterThanOrEqual(3);
    step(s, 120);
    expect(g.done).toBe(true);
  });

  it('a death brings a funeral two days later', () => {
    const s = createNewGame(7, setup);
    initLife(s);
    const p = residents(s)[3];
    die(s, p, 'old age');
    expect(s.gatherings?.some((g) => g.kind === 'funeral' && g.title.includes(p.name))).toBe(true);
  });
});
