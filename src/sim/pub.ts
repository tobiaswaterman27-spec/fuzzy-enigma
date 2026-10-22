// The Anchor: open 11:00 to 23:00. Maureen pulls the pints; of an evening the regulars come in for a
// drink (and come out a little louder). Buy a pint, buy a round for the whole pub, or play darts.
import type { GameState, Id, Person } from './types';
import { clamp, dist, fmtMoney, rand } from './core';
import { lifeEvent } from './events';
import { dayIndex, minuteOfDay } from './clock';
import { transfer } from './ledger';
import { makePerson } from './newgame';
import { getWorld } from './world/layout';
import { openAttendance } from './employment';

export const PUB_PINT = 480;
export const LANDLADY = 'pub_landlady';
export const pubOpen = (minute: number) => { const m = minuteOfDay(minute); return m >= 11 * 60 && m < 23 * 60; };

function landlady(state: GameState): Person {
  let p = state.people[LANDLADY];
  if (!p) {
    p = makePerson(state, LANDLADY, 'Maureen Doyle', { homeId: null, cash: 0, traits: { sociability: 0.95, patience: 0.6 } });
    p.age = 58;
    p.fixedJob = 'pub';
    p.npc!.ambient = true;
    p.appearance.outfit = 'outfit_smart';
  }
  return p;
}

/** every minute: the landlady behind the bar in opening hours; regulars drift in of an evening */
export function pubTick(state: GameState) {
  const m = landlady(state);
  const open = pubOpen(state.minute);
  if (open && !m.visible) { m.visible = true; m.where = 'pub'; m.pos = { x: 78.6, z: 79 }; m.facing = -Math.PI / 2; m.move = null; }
  if (!open && m.visible) { m.visible = false; m.where = 'offsite'; }
  const mod = minuteOfDay(state.minute);
  if (mod < 18 * 60 || mod > 21 * 60 + 30 || Math.floor(state.minute) % 4 !== 0) return;
  const day = dayIndex(state.minute);
  const inPub = Object.values(state.people).filter((q) => q.visible && q.where === 'pub' && !q.isPlayer).length;
  const weekend = [4, 5].includes(day % 7);
  if (inPub > (weekend ? 9 : 5)) return;
  for (const p of Object.values(state.people)) {
    const n = p.npc;
    if (!n || p.isPlayer || n.ambient || p.police || p.dead || p.away || p.sleeping || p.action || p.move || n.goal !== 'idle_home') continue;
    if ((n as any).pubDay === day || openAttendance(state, p.id) || (p.age ?? 30) < 18) continue;
    if (rand(state) > (weekend ? 0.2 : 0.1) * (0.5 + p.traits.sociability)) continue;
    (n as any).pubDay = day;
    const w = getWorld().nodes;
    const spots = [w.pub_t, w.pub_mid, w.pub_darts].filter(Boolean);
    const spot = spots[Math.floor(rand(state) * spots.length)];
    n.goal = 'leisure';
    n.plan = [
      { kind: 'move', to: { x: w.pub_bar.x, z: w.pub_bar.z }, label: 'The Anchor' },
      { kind: 'call', fn: 'pubDrink' },
      { kind: 'move', to: { x: spot.x + (rand(state) - 0.5) * 1.5, z: spot.z + (rand(state) - 0.5) * 1.5 }, label: 'a table' },
      { kind: 'wait', until: state.minute + 60 + rand(state) * 100 },
      { kind: 'call', fn: 'pubDrink' },
      { kind: 'wait', until: state.minute + 140 + rand(state) * 60 },
      { kind: 'call', fn: 'goHomeNow' },
    ];
    n.nextDecision = state.minute + 300;
    return;
  }
}

/** a pint at the bar */
export function pubDrink(state: GameState, p: Person) {
  const r = transfer(state, { from: p.accountId, to: state.externalId, amount: PUB_PINT, reason: 'purchase', memo: 'A pint at The Anchor', key: `pint:${p.id}:${Math.floor(state.minute)}` });
  if (!r.ok) return;
  p.drunk = Math.min(100, (p.drunk ?? 0) + 24);
  p.needs.mood = clamp(p.needs.mood + 4, 0, 100);
}

/** a round for everyone in the pub: they all like you a bit more */
export function buyRound(state: GameState, buyerId: Id): { ok: boolean; msg: string } {
  const me = state.people[buyerId];
  const here = Object.values(state.people).filter((q) => !q.isPlayer && q.visible && q.where === 'pub' && q.id !== LANDLADY && dist(q.pos, me.pos) < 20);
  if (!here.length) return { ok: false, msg: 'There is nobody in to buy a round for.' };
  const cost = PUB_PINT * (here.length + 1);
  const r = transfer(state, { from: me.accountId, to: state.externalId, amount: cost, reason: 'purchase', memo: `A round at The Anchor (${here.length + 1})`, key: `round:${Math.floor(state.minute)}` });
  if (!r.ok) return { ok: false, msg: `A round for ${here.length + 1} is ${fmtMoney(cost)}.` };
  for (const q of here) {
    q.relations[me.id] = clamp((q.relations[me.id] ?? 0) + 6, 0, 100);
    me.relations[q.id] = q.relations[me.id];
    q.drunk = Math.min(100, (q.drunk ?? 0) + 20);
    q.gesture = { clip: 'happy', until: state.minute + 0.8 };
  }
  me.drunk = Math.min(100, (me.drunk ?? 0) + 22);
  lifeEvent(state, me, `Bought a round at The Anchor`);
  return { ok: true, msg: `Cheers! A round for ${here.length + 1}: ${fmtMoney(cost)}. Everyone raises a glass to you.` };
}
