// Other people's houses on Harbour Road. The front door is locked: knock and whoever is home may let
// you in (friends will; strangers at night will not), or force it. Inside, people who are home are
// there to see; the drawers hold some cash. Breaking in or stealing, if anyone sees, is burglary.
import type { GameState, Id, Person } from './types';
import { clamp, dist, fmtMoney, rand } from './core';
import { lifeEvent, news } from './events';
import { FRIEND_AT } from './social';
import { minuteOfDay, dayIndex } from './clock';
import { transfer } from './ledger';
import { crime, flee } from './health';
import { goTo } from './npc';
import { getWorld, HOUSE_IDS, locationOf } from './world/layout';

export const houseOf = (id: string) => id.replace(/_(door|valuables)$/, '');
const residentsHome = (state: GameState, houseId: Id): Person[] =>
  Object.values(state.people).filter((p) => !p.isPlayer && p.homeId === houseId && !p.dead && !p.left && !p.away && p.where === houseId);
const night = (state: GameState) => { const m = minuteOfDay(state.minute); return m < 7 * 60 || m >= 22 * 60; };

export function houseOpen(state: GameState, houseId: Id): boolean {
  return (state.houseOpen?.[houseId] ?? 0) > state.minute;
}
function open(state: GameState, houseId: Id, minutes: number) {
  (state.houseOpen ??= {})[houseId] = Math.max(state.houseOpen[houseId] ?? 0, state.minute + minutes);
}

/** knock: whoever is up and at home comes to the door. Friends (and, by day, people who know you)
 * let you in; anyone else opens up, sees who it is and closes the door again. Acted out in doorTick */
export function knock(state: GameState, personId: Id, houseId: Id): { ok: boolean; msg: string } {
  const me = state.people[personId];
  const awake = residentsHome(state, houseId).filter((p) => !p.sleeping);
  if (!awake.length) { state.doorCall = { house: houseId, by: personId, at: state.minute, answerer: null, stage: 'done', letIn: false }; return { ok: true, msg: '' }; }
  const best = awake.reduce((a, b) => ((b.relations[me.id] ?? 0) > (a.relations[me.id] ?? 0) ? b : a));
  const rel = best.relations[me.id] ?? 0;
  const hostile = best.history.some((e) => e.text.includes(`attacked by ${me.name}`) || e.text.includes('Burgled'));
  const letIn = !hostile && (rel >= FRIEND_AT || (rel >= 20 && !night(state)));
  state.doorCall = { house: houseId, by: personId, at: state.minute, answerer: best.id, stage: 'waiting', letIn };
  if (night(state) && !letIn) best.relations[me.id] = Math.max(0, rel - 3);
  return { ok: true, msg: '' };
}

/** the answering of the door, step by step: footsteps, the door opens, they let you in or close it */
export function doorTick(state: GameState) {
  const c = state.doorCall;
  if (!c || c.stage === 'done' || !c.answerer) return;
  const p = state.people[c.answerer];
  const idx = HOUSE_IDS.indexOf(c.house) + 1;
  const door = getWorld().nodes[`door_house_${idx}`], inside = getWorld().nodes[`in_house_${idx}`];
  if (!p || !door || !inside || p.dead || p.away) { c.stage = 'done'; return; }
  const t = state.minute - c.at;
  const east = inside.x > door.x;
  if (c.stage === 'waiting' && t > 0.8) {
    // they come to the door: standing just inside the open door, facing out
    p.visible = true; p.move = null; p.action = null;
    p.pos = { x: door.x + (east ? 1.25 : -1.25), z: door.z };
    p.facing = east ? -Math.PI / 2 : Math.PI / 2;
    (p.npc as any).shownIn = c.house;
    if (p.npc) { p.npc.plan = [{ kind: 'wait', until: state.minute + 3 }]; }
    c.stage = 'open';
    if (c.letIn) { open(state, c.house, 45); p.relations[c.by] = clamp((p.relations[c.by] ?? 0) + 2, 0, 100); }
    p.gesture = { clip: c.letIn ? 'wave' : night(state) ? 'argue' : 'shrug', until: state.minute + 1 };
  } else if (c.stage === 'open' && t > (c.letIn ? 2.2 : 2.6)) {
    // let in: they step back into the front room; not: they close the door and go back inside
    c.stage = 'done';
    if (p.npc) p.npc.plan = [];
    if (c.letIn) goTo(state, p, { x: inside.x + (east ? 2.4 : -2.4), z: inside.z + 1 }, 'front room');
    else { p.visible = false; (p.npc as any).shownIn = undefined; p.pos = { x: door.x, z: door.z }; }
  }
}

/** force the door: noisy; anyone home or nearby calls the police */
export function breakIn(state: GameState, personId: Id, houseId: Id): { ok: boolean; msg: string } {
  const me = state.people[personId];
  open(state, houseId, 90);
  const name = getWorld().buildings.find((b) => b.id === houseId)?.name ?? 'the house';
  const home = residentsHome(state, houseId);
  const nearby = Object.values(state.people).some((o) => !o.isPlayer && o.visible && !o.dead && !o.police && dist(o.pos, me.pos) < 18);
  if (home.length || nearby || rand(state) < 0.2) {
    crime(state, 'burglary', 3);
    for (const p of home) { p.relations[me.id] = 0; p.sleeping = false; lifeEvent(state, p, `Burgled by ${me.name}`); }
    // whoever is in comes into the hall, frightened, phone in hand
    const idx = HOUSE_IDS.indexOf(houseId) + 1;
    const door = getWorld().nodes[`door_house_${idx}`], inside = getWorld().nodes[`in_house_${idx}`];
    const p = home[0];
    if (p && door && inside) {
      const east = inside.x > door.x;
      p.visible = true; p.move = null; p.action = null; (p.npc as any).shownIn = houseId;
      p.pos = { x: door.x + (east ? 3.2 : -3.2), z: door.z - 0.6 };
      p.facing = east ? -Math.PI / 2 : Math.PI / 2;
      p.gesture = { clip: 'scared', until: state.minute + 1.2 };
      if (p.npc) p.npc.plan = [{ kind: 'wait', until: state.minute + 4 }];
    }
    return { ok: true, msg: '' };
  }
  void name;
  return { ok: true, msg: '' };
}

/** go through the drawers for cash: a little of what the household has */
export function searchValuables(state: GameState, personId: Id, houseId: Id): { ok: boolean; msg: string } {
  const me = state.people[personId];
  const key = `burgled:${houseId}:${dayIndex(state.minute)}`;
  if (state.processed[key] !== undefined) return { ok: true, msg: 'Nothing left worth taking.' };
  state.processed[key] = state.minute;
  const victims = Object.values(state.people).filter((p) => !p.isPlayer && p.homeId === houseId && !p.dead && !p.left);
  if (!victims.length) return { ok: true, msg: 'Empty drawers. Nobody lives here.' };
  const v = victims.reduce((a, b) => ((state.ledger.accounts[b.accountId]?.balance ?? 0) > (state.ledger.accounts[a.accountId]?.balance ?? 0) ? b : a));
  const cash = Math.min(25000, Math.round((state.ledger.accounts[v.accountId]?.balance ?? 0) * 0.04));
  if (cash > 0) transfer(state, { from: v.accountId, to: me.accountId, amount: cash, reason: 'transfer', memo: 'Cash taken from a house', key });
  for (const p of victims) { p.needs.mood = clamp(p.needs.mood - 20, 0, 100); p.relations[me.id] = Math.max(0, (p.relations[me.id] ?? 0) - 30); lifeEvent(state, p, 'Burgled: cash taken from the house'); }
  news(state, 'bad', `Burglary at ${getWorld().buildings.find((b) => b.id === houseId)?.name}`, `Cash was taken from the home of ${victims.map((p) => p.name).join(' and ')}. Police are appealing for witnesses.`, false);
  const home = residentsHome(state, houseId).filter((p) => p.visible);
  if (home.length) {
    crime(state, 'burglary', 3);
    for (const p of home) { if (p.traits.patience < 0.4 && (p.health ?? 100) > 50) p.combat = { target: me.id, until: state.minute + 3, next: state.minute + 0.4 }; else flee(state, p, me.pos); }
  }
  return { ok: true, msg: cash > 0 ? `You find ${fmtMoney(cash)} in cash.` : 'Just a few coins.' };
}

/** every minute: people at home appear inside when you are in their house, and go back to being simulated off-screen when you leave */
export function housesTick(state: GameState) {
  const me = state.people[state.playerId];
  const here = me.visible ? locationOf(me.pos) : null;
  for (const p of Object.values(state.people)) {
    const id = p.homeId;
    if (p.isPlayer || !id || !id.startsWith('house_') || p.dead || p.left || p.away || p.where !== id) continue;
    const inside = here === id;
    if (inside && !p.visible && !p.sleeping) {
      const n = getWorld().nodes[`in_house_${HOUSE_IDS.indexOf(id) + 1}`];
      if (!n) continue;
      p.visible = true;
      // clear floor in the front room, between the coffee table and the drawers
      p.pos = { x: n.x + (n.x > 0 ? 2.8 : -2.8), z: n.z + 0.8 - residentsHome(state, id).indexOf(p) * 1.2 };
      p.facing = Math.atan2(me.pos.x - p.pos.x, me.pos.z - p.pos.z);
      (p.npc as any).shownIn = id;
    } else if (!inside && p.visible && (p.npc as any)?.shownIn === id && !p.move && !p.action && !p.combat && !(state.doorCall?.answerer === p.id && state.doorCall.stage !== 'done') && !(p.gesture && state.minute < p.gesture.until)) {
      p.visible = false;
      (p.npc as any).shownIn = undefined;
    }
  }
}
