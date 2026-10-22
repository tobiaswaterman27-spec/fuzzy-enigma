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

describe('Street incidents', () => {
  it('people with a grudge row in front of you; hot-headed ones come to blows and get arrested', async () => {
    const { incidentsTick } = await import('../src/sim/index');
    const s = createNewGame(7, setup);
    initLife(s);
    const me = s.people.player;
    me.pos = { x: 0, z: 10 }; me.visible = true; me.where = 'outside';
    const [a, b] = residents(s);
    for (const [p, x] of [[a, 1], [b, 3]] as const) { p.visible = true; p.where = 'outside'; p.pos = { x, z: 12 }; p.action = null; p.move = null; p.npc!.nextDecision = s.minute + 999; p.npc!.plan = []; }
    a.grudge = 3; b.grudge = 3; a.relations[b.id] = 0; b.relations[a.id] = 0;
    a.traits.patience = 0.1; b.traits.patience = 0.1; a.drunk = 60;
    for (let i = 0; i < 40 && !s.incident; i++) { s.minute = Math.ceil(s.minute / 15) * 15; incidentsTick(s); s.minute += 1; }
    expect(s.incident?.stage).toBe('argue');
    expect(s.incident?.escalate).toBe(true);
    for (let i = 0; i < 40; i++) step(s, 0.25);
    expect(a.history.some((e) => e.text.includes('row'))).toBe(true);
    expect(s.incident?.stage).toBe('done');
    expect([a, b].some((p) => p.away?.place === 'custody' || p.down != null)).toBe(true);
    expect([a, b].some((p) => p.record?.includes('affray')) || [a, b].some((p) => p.down != null)).toBe(true);
  });
});

describe('Shoplifting', () => {
  it('a shopper runs off with the goods; grabbing them puts the goods back and the police take them', async () => {
    const { shopliftTick, grabShoplifter, addItems } = await import('../src/sim/index');
    const s = createNewGame(7, setup);
    const p = Object.values(s.people).find((q) => q.npc && !q.isPlayer)!;
    p.visible = true; p.where = 'market'; p.pos = { x: 20, z: -20 }; p.action = null;
    p.npc!.goal = 'shop'; p.npc!.shopId = 'market'; p.npc!.step = 'run'; p.npc!.plan = [{ kind: 'call', fn: 'checkout' }];
    p.traits.conscientiousness = 0.1;
    addItems(s.containers[p.basketId], 'bread', 2);
    for (let i = 0; i < 400 && !(p.npc as any).shoplift; i++) shopliftTick(s);
    expect((p.npc as any).shoplift).toBeTruthy();
    expect(s.containers[p.bagId].items.bread).toBe(2);
    expect(grabShoplifter(s, 'player', p.id)).toMatch(/goods back/);
    expect(s.containers[p.bagId].items.bread ?? 0).toBe(0);
    expect(p.away?.place).toBe('custody');
  });
});
