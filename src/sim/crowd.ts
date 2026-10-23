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

// the park benches (and where you sit on one: just in front of the middle, facing the path)
let benchCache: { w: unknown; all: { x: number; z: number; rot: number }[] } | null = null;
function benchNear(at: { x: number; z: number }, within = 30) {
  const w = getWorld();
  if (benchCache?.w !== w) benchCache = { w, all: w.city.props.filter((q) => q.kind === 'bench').map((q) => ({ x: q.x, z: q.z, rot: q.rot })) };
  return benchCache.all.find((b) => Math.hypot(b.x - at.x, b.z - at.z) < within) ?? null;
}
const benchSeat = (b: { x: number; z: number; rot: number }) => ({ x: b.x + Math.sin(b.rot) * 0.35, z: b.z + Math.cos(b.rot) * 0.35 });

// the street nodes (cached per world), and the ones at the right distance to appear on (cached until you move)
let nodeCache: { w: unknown; all: { id: string; x: number; z: number }[] } | null = null;
const cityNodes = () => {
  const w = getWorld();
  if (nodeCache?.w !== w) nodeCache = { w, all: Object.values(w.nodes).filter((n) => n.id.startsWith('c_')) };
  return nodeCache.all;
};
let nearCache: { all: unknown; x: number; z: number; near: { id: string; x: number; z: number }[] } | null = null;

export function crowdTick(state: GameState) {
  const me = state.people[state.playerId];
  if (!me || levelOf(me.pos.x) !== 0) return;
  const nodes = cityNodes();
  if (!nodes.length) return;
  if (!nearCache || nearCache.all !== nodes || Math.hypot(nearCache.x - me.pos.x, nearCache.z - me.pos.z) > 8) nearCache = { all: nodes, x: me.pos.x, z: me.pos.z, near: nodes.filter((n) => { const d = dist(n, me.pos); return d > 40 && d < KEEP - 30; }) };
  const near = nearCache.near;
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
    // sitting on a bench, or stopped for a chat: leave them be until they are done
    const n = p.npc as typeof p.npc & { idleUntil?: number; bench?: { x: number; z: number; rot: number } | null };
    if ((n.idleUntil ?? 0) > state.minute) continue;
    // on the way somewhere: now and then a bench catches their eye, or they bump into someone they know
    if (p.move && !n.bench && rand(state) < 0.02) {
      const b = benchNear(p.pos, 35);
      if (b && rand(state) < 0.5) { n.bench = b; goTo(state, p, benchSeat(b), 'a bench'); continue; }
      const o = Object.values(state.people).find((q) => q !== p && q.id.startsWith('crowd_') && q.visible && dist(q.pos, p.pos) < 3 && ((q.npc as typeof n).idleUntil ?? 0) <= state.minute);
      if (o && rand(state) < 0.4) {
        const until = state.minute + 1.5 + rand(state) * 2.5;
        for (const [a, c] of [[p, o], [o, p]] as const) { a.move = null; a.facing = Math.atan2(c.pos.x - a.pos.x, c.pos.z - a.pos.z); (a.npc as typeof n).idleUntil = until; a.gesture = { clip: rand(state) < 0.5 ? 'talk' : 'laugh', until }; }
        continue;
      }
    }
    if (!p.move) {
      // made it to the bench: sit down on it for a while, facing the path
      if (n.bench && dist(p.pos, benchSeat(n.bench)) < 1.2) {
        p.pos = benchSeat(n.bench); p.facing = n.bench.rot;
        n.idleUntil = state.minute + 2 + rand(state) * 5;
        p.gesture = { clip: 'sit', until: n.idleUntil };
        n.bench = null;
        continue;
      }
      n.bench = null;
      const r = rand(state);
      // a bench near by
      const b = r < 0.3 ? benchNear(p.pos) : null;
      if (b) { n.bench = b; goTo(state, p, benchSeat(b), 'a bench'); continue; }
      // someone they know: stop and chat, face to face
      if (r < 0.5) {
        const o = Object.values(state.people).find((q) => q !== p && q.id.startsWith('crowd_') && q.visible && !q.move && !q.action && dist(q.pos, p.pos) < 12 && ((q.npc as typeof n).idleUntil ?? 0) <= state.minute);
        if (o) {
          const until = state.minute + 1.5 + rand(state) * 2.5;
          for (const [a, c] of [[p, o], [o, p]] as const) { a.facing = Math.atan2(c.pos.x - a.pos.x, c.pos.z - a.pos.z); (a.npc as typeof n).idleUntil = until; a.gesture = { clip: rand(state) < 0.5 ? 'talk' : 'laugh', until }; }
          continue;
        }
      }
      // off to another corner a few blocks away (a random pick that is the right distance)
      for (let k = 0; k < 30; k++) {
        const d = nodes[randInt(state, 0, nodes.length - 1)];
        const dd = dist(d, p.pos);
        if (dd > 60 && dd < 320) { goTo(state, p, d, 'somewhere'); break; }
      }
    }
  }
}
