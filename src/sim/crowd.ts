// People on the city's streets. A pool of passers-by is kept walking the pavements within sight of
// you wherever you go: each walks from one corner to another a few blocks off, and someone who falls
// far behind is replaced by someone new up ahead. They are real people (you can talk to them, bump
// into them, pick their pockets); they just do not live in Harbourside.
import type { GameState, Person } from './types';
import { dist, rand, randInt } from './core';
import { ambientName, makePerson } from './newgame';
import { goTo } from './npc';
import { getWorld } from './world/layout';
import { levelOf } from './world/levels';

const POOL = 14;
const KEEP = 190;

function walker(state: GameState, i: number): Person {
  const id = `crowd_${i}`;
  let p = state.people[id];
  if (!p) {
    p = makePerson(state, id, ambientName(state), { homeId: null, cash: 2000 + randInt(state, 0, 40000) });
    p.npc!.ambient = true;
    p.fixedJob = 'crowd';
    p.age = 18 + randInt(state, 0, 55);
    p.visible = false; p.where = 'offsite';
  }
  return p;
}

const cityNodes = () => Object.values(getWorld().nodes).filter((n) => n.id.startsWith('c_'));

export function crowdTick(state: GameState) {
  const me = state.people[state.playerId];
  if (!me || levelOf(me.pos.x) !== 0) return;
  const nodes = cityNodes();
  if (!nodes.length) return;
  const near = nodes.filter((n) => { const d = dist(n, me.pos); return d > 40 && d < KEEP - 30; });
  for (let i = 0; i < POOL; i++) {
    const p = walker(state, i);
    if (p.dead || p.away || p.down != null || p.combat || p.action || (p.fleeing ?? 0) > state.minute) continue;
    const far = !p.visible || dist(p.pos, me.pos) > KEEP;
    if (far) {
      // someone new appears on a corner a little way off
      if (!near.length) { if (p.visible) { p.visible = false; p.where = 'offsite'; p.move = null; } continue; }
      const a = near[randInt(state, 0, near.length - 1)];
      p.pos = { x: a.x + (rand(state) - 0.5), z: a.z + (rand(state) - 0.5) };
      p.visible = true; p.where = 'outside';
      p.move = null;
    }
    if (!p.move) {
      // off to another corner a few blocks away
      const dests = nodes.filter((n) => { const d = dist(n, p.pos); return d > 60 && d < 320; });
      if (dests.length) goTo(state, p, dests[randInt(state, 0, dests.length - 1)], 'somewhere');
    }
  }
}
