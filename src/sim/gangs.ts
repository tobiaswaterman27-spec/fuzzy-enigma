// Street gangs. The Dock Rats (red tracksuits) hang about on corners down by the docks, the Northfield
// Crew (blue) out in the suburbs. Loiter on their patch and they warn you off; stay, or start on one of
// them, and the lot of them come at you (the one with the bat first). Put them all down and the corner
// is yours for the day, with a little something from the people who are glad to see them gone.
import type { GameState, Person, Vec2 } from './types';
import { dist, fmtMoney, rand, randInt } from './core';
import { dayIndex } from './clock';
import { lifeEvent, news } from './events';
import { transfer } from './ledger';
import { ambientName, makePerson } from './newgame';
import { goTo } from './npc';
import { getWorld } from './world/layout';

interface Gang { id: string; name: string; outfit: string; centre: Vec2 }
export const GANGS: Gang[] = [
  { id: 'rats', name: 'the Dock Rats', outfit: 'gang_red', centre: { x: 330, z: 40 } },
  { id: 'crew', name: 'the Northfield Crew', outfit: 'gang_blue', centre: { x: -220, z: -960 } },
];
const PER = 3;

const spots = new Map<string, Vec2[]>();
/** each gang's three corners: pavement corners near the middle of their patch, well apart */
export function turfSpots(g: Gang): Vec2[] {
  let s = spots.get(g.id);
  if (s) return s;
  const nodes = getWorld().city.nodes.map((n) => ({ n, d: dist(n, g.centre) })).filter((q) => q.d < 220).sort((a, b) => a.d - b.d);
  s = [];
  for (const { n } of nodes) { if (s.every((q) => dist(q, n) > 45)) s.push({ x: n.x, z: n.z }); if (s.length >= 3) break; }
  spots.set(g.id, s);
  return s;
}

const memberId = (g: Gang, k: number, i: number, day: number) => `gang_${g.id}_${k}_${i}_${day % 2}`;

export function gangTick(state: GameState) {
  const me = state.people[state.playerId];
  if (!me || me.dead || me.away) return;
  const day = dayIndex(state.minute);
  const turf = (state.turf ??= {});
  for (const g of GANGS) turfSpots(g).forEach((spot, k) => {
    const key = `${g.id}:${k}`;
    const cleared = turf[key]?.day === day;
    const near = dist(me.pos, spot) < 70 && !cleared;
    const crew: Person[] = [];
    for (let i = 0; i < PER; i++) {
      const id = memberId(g, k, i, day);
      // yesterday's lot go home (or to hospital)
      const old = state.people[memberId(g, k, i, day + 1)];
      if (old && old.visible && !old.combat && old.down == null) { old.visible = false; old.where = 'offsite'; }
      let m = state.people[id];
      if (!m && !near) continue;
      if (!m || (m.dead && !m.visible)) {
        m = makePerson(state, id, ambientName(state), { homeId: null, cash: 2000 + randInt(state, 0, 9000) });
        m.npc!.ambient = true; m.fixedJob = 'gang'; m.age = 17 + randInt(state, 0, 12);
        m.appearance.outfit = g.outfit;
        m.traits.patience = 0.1;
        m.weapon = i === 0 ? 'bat' : null;
        m.visible = false; m.where = 'offsite';
      }
      crew.push(m);
      if (m.dead || m.away) continue;
      if (!near) { if (m.visible && !m.combat && m.down == null) { m.visible = false; m.where = 'offsite'; m.move = null; } continue; }
      if (!m.visible && m.down == null) {
        m.pos = { x: spot.x + Math.cos(i * 2.1) * 1.4, z: spot.z + Math.sin(i * 2.1) * 1.4 };
        m.facing = Math.atan2(spot.x - m.pos.x, spot.z - m.pos.z);
        m.visible = true; m.where = 'outside'; m.move = null; m.action = null;
      }
      // hanging about: talking, laughing, looking at their phones
      if (!m.combat && !m.move && m.down == null && (!m.gesture || state.minute > m.gesture.until + 0.5)) m.gesture = { clip: ['talk', 'laugh', 'phone', 'idle', 'argue'][randInt(state, 0, 4)], until: state.minute + 1 + rand(state) * 2 };
      // drift back to the corner after a scrap
      if (!m.combat && !m.move && m.down == null && dist(m.pos, spot) > 6) goTo(state, m, spot, 'the corner');
    }
    if (!near || !crew.length) return;
    const t = (turf[key] ??= { day: -1 });
    const standing = crew.filter((m) => m.visible && !m.dead && m.down == null);
    const hit = crew.some((m) => m.hit?.by === me.id && state.minute - m.hit.at < 5);
    const close = me.visible && standing.some((m) => dist(m.pos, me.pos) < 5);
    // too close for too long: a warning, then trouble
    if (close && !t.warned) { t.warned = state.minute; const m = standing[0]; if (m) { m.gesture = { clip: 'argue', until: state.minute + 1.5 }; m.facing = Math.atan2(me.pos.x - m.pos.x, me.pos.z - m.pos.z); } news(state, 'info', `"You lost, mate?"`, `This is ${g.name}' corner. Move on.`, true); }
    if (!close && t.warned && state.minute - t.warned > 3) t.warned = undefined;
    const angry = hit || (close && t.warned != null && state.minute - t.warned > 1.2);
    if (angry) {
      t.hostile = state.minute;
      for (const m of standing) if (dist(m.pos, me.pos) < 35) m.combat = { target: me.id, until: state.minute + 3, next: m.combat?.next ?? state.minute + 0.2 + rand(state) * 0.4 };
    }
    // all of them down after a fight: the corner is yours today
    if (t.hostile != null && !standing.length && crew.length >= PER) {
      t.day = day; t.hostile = undefined; t.warned = undefined;
      const prize = 15000;
      transfer(state, { from: state.externalId, to: me.accountId, amount: prize, reason: 'transfer', memo: 'A thank-you from the neighbours', key: `turf:${key}:${day}` });
      lifeEvent(state, me, `Ran ${g.name} off their corner`);
      news(state, 'good', `You ran ${g.name} off their corner`, `The neighbours are grateful: ${fmtMoney(prize)}. They will be back tomorrow.`, true);
    }
  });
}
