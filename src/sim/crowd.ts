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
import { raining } from './weather';
import { DOG_COATS, DOG_NAMES } from './leisure';

const POOL = 28;
/** how many are out at this hour: busy in the day, a few stragglers in the small hours */
function wanted(minute: number): number {
  const h = Math.floor((minute % 1440) / 60);
  return h >= 8 && h < 19 ? POOL : h >= 7 && h < 22 ? 18 : h >= 22 || h < 1 ? 10 : 5;
}
const KEEP = 150;

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
  if (!(p.npc as { typed?: boolean }).typed) {
    (p.npc as { typed?: boolean }).typed = true;
    // some walk a dog, some are out running (fixed per walker, picked without touching the dice)
    const h = Math.imul(i + 1, 2654435761) >>> 0;
    if (i % 6 === 2) p.dog = { name: DOG_NAMES[h % DOG_NAMES.length], color: DOG_COATS[(h >> 4) % DOG_COATS.length], size: 0.6 + ((h >> 8) % 60) / 100, since: state.minute, happy: 80 };
    if (i % 7 === 4) { p.appearance = { ...p.appearance, outfit: 'outfit_sport', extras: [] }; p.fitness = 75; }
  }
  return p;
}
/** joggers go out early and after work */
const jogHour = (h: number) => (h >= 6 && h < 10) || (h >= 17 && h < 21);

// the park benches (and where you sit on one: just in front of the middle, facing the path)
let benchCache: { w: unknown; all: { x: number; z: number; rot: number }[] } | null = null;
type Bench = { x: number; z: number; rot: number; slot?: number };
/** a bench near by with a free place on it (two to a bench, left and right) */
function benchNear(state: GameState, p: Person, at: { x: number; z: number }, within = 30): Bench | null {
  const w = getWorld();
  if (benchCache?.w !== w) benchCache = { w, all: w.city.props.filter((q) => q.kind === 'bench').map((q) => ({ x: q.x, z: q.z, rot: q.rot })) };
  for (const b of benchCache.all) {
    if (Math.hypot(b.x - at.x, b.z - at.z) >= within) continue;
    const me = state.people[state.playerId];
    if (me && Math.hypot(me.pos.x - b.x, me.pos.z - b.z) < 0.8) continue;
    for (const slot of [-1, 1]) {
      const seat = benchSeat({ ...b, slot });
      const taken = Object.values(state.people).some((q) => q !== p && q.visible && (dist(q.pos, seat) < 0.45 || (() => { const qb = (q.npc as { bench?: Bench | null } | undefined)?.bench; return !!qb && qb.x === b.x && qb.z === b.z && qb.slot === slot; })()));
      if (!taken) return { ...b, slot };
    }
  }
  return null;
}
const benchSeat = (b: Bench) => ({ x: b.x + Math.sin(b.rot) * 0.35 + Math.cos(b.rot) * 0.45 * (b.slot ?? 0), z: b.z + Math.cos(b.rot) * 0.35 - Math.sin(b.rot) * 0.45 * (b.slot ?? 0) });

// the street nodes (cached per world), and the ones at the right distance to appear on (cached until you move)
let nodeCache: { w: unknown; all: { id: string; x: number; z: number }[] } | null = null;
const cityNodes = () => {
  const w = getWorld();
  if (nodeCache?.w !== w) nodeCache = { w, all: Object.values(w.nodes).filter((n) => n.id.startsWith('c_')) };
  return nodeCache.all;
};
let nearCache: { all: unknown; x: number; z: number; near: { id: string; x: number; z: number }[] } | null = null;

// a busker with a guitar outside the station, the shopping centre or city hall, in the daytime
export const BUSKER = 'busker_0';
let buskSpots: { w: unknown; all: { x: number; z: number }[] } | null = null;
function buskerTick(state: GameState, me: Person) {
  const w = getWorld();
  if (buskSpots?.w !== w) buskSpots = { w, all: w.buildings.filter((b) => b.id.startsWith('v_') && /^(Railway station|Shopping centre|City Hall)/.test(b.role ?? '')).map((b) => w.nodes[`walk_${b.id}`]).filter(Boolean).map((n) => ({ x: n.x + 2.6, z: n.z - 1.2 })) };
  const h = Math.floor((state.minute % 1440) / 60);
  const spot = buskSpots.all.find((s) => dist(s, me.pos) < 90) ?? null;
  const on = !!spot && h >= 10 && h < 19 && raining(state) < 0.3;
  let p = state.people[BUSKER];
  if (!p && !on) return;
  if (!p) {
    p = makePerson(state, BUSKER, ambientName(state), { homeId: null, cash: 500 });
    p.npc!.ambient = true; p.fixedJob = 'crowd'; p.age = 24;
    p.visible = false; p.where = 'offsite';
  }
  const b = p as Person & { busking?: boolean };
  if (p.dead || p.down != null || p.combat || (p.fleeing ?? 0) > state.minute) { b.busking = false; return; }
  if (on) {
    if (!p.visible || dist(p.pos, spot!) > 1) { p.pos = { ...spot! }; p.visible = true; p.where = 'outside'; }
    p.move = null; p.facing = 0; b.busking = true;
    (p.npc as { idleUntil?: number }).idleUntil = state.minute + 5;
  } else if (p.visible) { p.visible = false; p.where = 'offsite'; b.busking = false; }
}

export function crowdTick(state: GameState) {
  const me = state.people[state.playerId];
  if (!me || levelOf(me.pos.x) !== 0) return;
  buskerTick(state, me);
  const nodes = cityNodes();
  if (!nodes.length) return;
  if (!nearCache || nearCache.all !== nodes || Math.hypot(nearCache.x - me.pos.x, nearCache.z - me.pos.z) > 8) nearCache = { all: nodes, x: me.pos.x, z: me.pos.z, near: nodes.filter((n) => { const d = dist(n, me.pos); return d > 28 && d < 110; }) };
  const near = nearCache.near;
  const want = wanted(state.minute);
  for (let i = 0; i < POOL; i++) {
    // more than the hour calls for: those out finish their walk and go home once out of sight
    if (i >= want) {
      const q = state.people[`crowd_${i}`];
      if (q?.visible && !q.combat && q.down == null && dist(q.pos, me.pos) > 70) { q.visible = false; q.where = 'offsite'; q.move = null; }
      continue;
    }
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
      // late on, a fair few are on their way home from the pub (picked without touching the dice)
      const hr = Math.floor((state.minute % 1440) / 60), hh = Math.abs(Math.sin(i * 12.9898 + Math.floor(state.minute) * 0.0137) * 43758.5453) % 1;
      p.drunk = (hr >= 22 || hr < 2) && hh < 0.4 ? 45 + hh * 80 : 0;
      p.jogging = i % 7 === 4 && jogHour(hr) && !p.drunk ? state.minute + 60 : 0;
    }
    // sitting on a bench, or stopped for a chat: leave them be until they are done
    const n = p.npc as typeof p.npc & { idleUntil?: number; bench?: Bench | null };
    if ((n.idleUntil ?? 0) > state.minute) continue;
    // on the way somewhere: now and then a bench catches their eye, or they bump into someone they know
    if (p.move && !n.bench && rand(state) < 0.02 && !((p.jogging ?? 0) > state.minute)) {
      const b = benchNear(state, p, p.pos, 35);
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
      const b = r < 0.3 ? benchNear(state, p, p.pos) : null;
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
        // somewhere that keeps them about the streets round you
        if (dd > 40 && dd < 240 && dist(d, me.pos) < KEEP - 30) { goTo(state, p, d, 'somewhere'); break; }
      }
    }
  }
}
