import { describe, expect, it } from 'vitest';
import { createNewGame, step } from '../src/sim/index';
import { attack, floor } from '../src/sim/health';

const setup = { name: 'Tester', appearance: { skin: '#e3b48f', hair: 'short' as const, hairColor: '#3b2416', build: 'average' as const } };

describe('Fighting', () => {
  it('runs punches into a combination ending in a kick, and knocks people back', () => {
    const s = createNewGame(7, setup);
    const me = s.people.player;
    const o = Object.values(s.people).find((q) => q.npc && !q.police && !q.isPlayer)!;
    me.pos = { x: -20, z: 3 }; me.where = 'outside'; me.visible = true;
    o.pos = { x: -19.2, z: 3 }; o.where = 'outside'; o.visible = true; o.health = 100;
    const swings: string[] = [];
    for (let i = 0; i < 3; i++) {
      me.action = null;
      attack(s, me.id, o.id);
      swings.push(me.action!.arg!);
      s.minute += 0.2;
      if (o.down != null) { o.down = null; o.downUntil = null; }
      o.pos = { x: -19.2, z: 3 };
    }
    expect(swings).toEqual(['fists', 'flurry', 'kick']);
    me.action = null; s.minute += 5;
    attack(s, me.id, o.id);
    expect(me.action!.arg).toBe('fists');
    expect(o.hit?.by).toBe(me.id);
  });

  it('someone knocked over gets back up by themselves', () => {
    const s = createNewGame(7, setup);
    const o = Object.values(s.people).find((q) => q.npc && !q.police && !q.isPlayer)!;
    o.health = 90; o.visible = true; o.where = 'outside';
    floor(s, o, 1.2);
    expect(o.down).not.toBeNull();
    for (let i = 0; i < 8; i++) step(s, 0.25);
    expect(o.down).toBeNull();
    expect(o.away).toBeFalsy();
  });
});
