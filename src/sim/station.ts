// Harbourside Police Station. The desk sergeant is behind the front counter day and night; you can
// hand yourself in there (it goes easier on you). A night in custody is spent in a cell you can see.
// Police Community Support Officers walk a beat: the briefing board gives four points round the
// town to check in at, and catching shoplifters or breaking up fights all count on the timesheet.
import type { GameState, Id, Person } from './types';
import { dayIndex } from './clock';
import { clamp, dist, randInt } from './core';
import { news, lifeEvent } from './events';
import { arrest } from './health';
import { openAttendance } from './employment';
import { makePerson } from './newgame';
import { getWorld } from './world/layout';

export const SERGEANT = 'police_sergeant';
const BEAT_SPOTS: [string, string][] = [
  ['ne_17.5', 'Corner Market'], ['sw_-24', 'the Job Centre'], ['se_40', 'the park gates'], ['pub_out', 'The Anchor'],
  ['se_80.5', 'Dockside Unit 4'], ['sw_-53', 'Harbour Wholesale'], ['nw_-70', 'Westway Terrace'], ['res_out', 'the dog rescue'],
  ['hs_e_50', 'Harbour Road'], ['fl_out', 'Marlow Court'],
];

function sergeant(state: GameState): Person {
  let p = state.people[SERGEANT];
  if (!p) {
    p = makePerson(state, SERGEANT, 'Sgt Dave Okonkwo', { homeId: null, cash: 0, traits: { sociability: 0.6, patience: 0.8, conscientiousness: 0.9 } });
    p.age = 49;
    p.fixedJob = 'police';
    p.police = true;
    p.npc!.ambient = true;
    p.appearance.outfit = 'uniform_police';
  }
  return p;
}

export const onPcsoShift = (state: GameState, id: Id) => {
  const a = openAttendance(state, id);
  return !!a && state.contracts[a.contractId]?.businessId === 'police';
};

/** credit a piece of police work to whoever is on shift */
export function policeWork(state: GameState, id: Id, what: string) {
  const a = openAttendance(state, id);
  if (!a || state.contracts[a.contractId]?.businessId !== 'police') return;
  a.tasks++;
  const p = state.people[id];
  p.reputation = clamp(p.reputation + 1, 0, 100);
  if (p.isPlayer) news(state, 'good', 'Logged on your timesheet', what, true);
}

/** the briefing board: four points round town for today's beat */
export function readBeat(state: GameState, id: Id): string {
  const day = dayIndex(state.minute);
  if (!state.beat || state.beat.day !== day || state.beat.by !== id) {
    const pool = [...BEAT_SPOTS];
    const points = [];
    for (let i = 0; i < 4 && pool.length; i++) {
      const [node, label] = pool.splice(randInt(state, 0, pool.length - 1), 1)[0];
      const n = getWorld().nodes[node];
      if (n) points.push({ x: n.x, z: n.z, label, done: false });
    }
    state.beat = { day, by: id, points };
  }
  const left = state.beat.points.filter((p) => !p.done);
  return left.length ? `Today's beat: ${state.beat.points.map((p) => `${p.done ? '✓ ' : ''}${p.label}`).join(', ')}. Check in at each (blue rings).` : 'Beat walked for today. Keep an eye out for trouble.';
}

/** hand yourself in: a star less, and it is over */
export function handIn(state: GameState, id: Id): string {
  const w = state.wanted;
  if (!w || id !== state.playerId) return '';
  w.level = Math.max(1, w.level - 1);
  arrest(state, sergeant(state));
  return 'The sergeant sighs, takes your details and walks you through to the cells.';
}

/** step between two people squaring up: it calms down, unless they are past listening */
export function breakUp(state: GameState, id: Id): string {
  const inc = state.incident;
  const me = state.people[id];
  if (!inc || inc.stage === 'done') return '';
  const a = state.people[inc.a], b = state.people[inc.b];
  inc.stage = 'done';
  for (const p of [a, b]) {
    if (!p) continue;
    p.combat = null;
    p.gesture = { clip: 'shrug', until: state.minute + 1 };
    if (p.npc) { p.npc.plan = []; p.npc.nextDecision = state.minute + 0.5; }
    p.relations[me.id] = clamp((p.relations[me.id] ?? 0) + 2, 0, 100);
  }
  me.gesture = { clip: 'argue', until: state.minute + 1 };
  policeWork(state, id, 'Broke up a fight in the street.');
  return `"Alright, that's enough!" ${a?.name.split(' ')[0]} and ${b?.name.split(' ')[0]} back off and go their separate ways.`;
}

/** where someone in custody sits: a cell bench */
export function cellSpot(state: GameState, p: Person) {
  const taken = Object.values(state.people).filter((o) => o !== p && o.away?.place === 'custody' && o.visible).length;
  const n = getWorld().nodes[`cell_in_${(taken % 3) + 1}`];
  return n ? { x: n.x, z: n.z } : null;
}

/** every minute: the sergeant at the desk; beat points checked in at */
export function stationTick(state: GameState) {
  const s = sergeant(state);
  if (!s.visible && !s.away && !s.dead) { s.visible = true; s.where = 'police'; s.pos = { x: 56, z: -18.5 }; s.facing = 0; s.move = null; }
  const b = state.beat;
  if (!b || b.day !== dayIndex(state.minute)) return;
  const p = state.people[b.by];
  if (!p || !onPcsoShift(state, p.id)) return;
  for (const pt of b.points) if (!pt.done && dist(pt, p.pos) < 3) {
    pt.done = true;
    policeWork(state, p.id, `Beat point: ${pt.label} (${b.points.filter((q) => q.done).length}/${b.points.length}).`);
    if (b.points.every((q) => q.done)) { lifeEvent(state, p, 'Walked the whole beat'); }
  }
}
