// Jobs for Vince. Ring him from any of the red phone boxes round the city and he has something that
// needs doing, no questions asked: run a package across town before the deadline, bring him a
// particular kind of car to the Eastgate Motors yard, or have a word with someone who owes him. One job
// at a time; finish it and he pays, take too long and he finds someone else. The better you do, the
// bigger the jobs (and the pay) get.
import type { GameState, Id, Vec2 } from './types';
import { dist, fmtMoney, randInt } from './core';
import { fmtClock } from './clock';
import { lifeEvent, news } from './events';
import { transfer } from './ledger';
import { getWorld } from './world/layout';
import { CAR_MODELS } from './cars';
import { DISTRICT_NAMES, districtAt, streetAt } from './world/city';

export type MissionKind = 'courier' | 'carjack' | 'collect' | 'tail';
export interface Mission {
  kind: MissionKind;
  /** courier: 'pickup' then 'deliver' */
  stage: 'pickup' | 'deliver' | 'go';
  from?: Vec2;
  to?: Vec2;
  body?: string;
  targetId?: Id;
  deadline: number;
  reward: number;
  text: string;
  /** tail: minutes kept on them, minutes spent too close (they notice), minutes out of sight, last tick */
  held?: number;
  close?: number;
  away?: number;
  at?: number;
}

/** tailing someone: stay within LOSE metres for HOLD minutes, never nearer than CLOSE for long */
export const TAIL = { HOLD: 12, CLOSE: 4, LOSE: 45, NOTICE: 1.2, LOST: 1.5 };

const BODY_NAMES: Record<string, string> = { suv: 'an SUV', sports: 'a sports coupe', saloon: 'a saloon', car: 'a hatchback' };


const placeName = (p: Vec2) => `${streetAt(p.x, p.z)}, ${DISTRICT_NAMES[districtAt(p.x, p.z)]}`;
function streetSpot(state: GameState, near: Vec2, min: number, max: number): Vec2 {
  const nodes = Object.values(getWorld().nodes).filter((n) => n.id.startsWith('c_'));
  const ok = nodes.filter((n) => { const d = Math.hypot(n.x - near.x, n.z - near.z); return d > min && d < max; });
  const n = (ok.length ? ok : nodes)[randInt(state, 0, (ok.length ? ok : nodes).length - 1)];
  return { x: n.x, z: n.z };
}

/** Vince picks up: a job, if you have not already got one */
export function callVince(state: GameState, personId: Id): string {
  const p = state.people[personId];
  if (state.mission) return `"You've already got a job on. ${state.mission.text}"`;
  const level = state.vinceRep ?? 0;
  const pay = (base: number) => Math.round((base * (1 + level * 0.15)) / 500) * 500;
  const k = randInt(state, 0, 3);
  if (k === 3) {
    // someone out on foot, a fair way from you: follow them and see where they go, without being seen
    const walkers = Object.values(state.people).filter((o) => o.npc && !o.npc.ambient && !o.isPlayer && !o.police && !o.dead && !o.away && o.visible && o.where === 'outside' && o.move && dist(o.pos, p.pos) > 30 && dist(o.pos, p.pos) < 400);
    const t = walkers[randInt(state, 0, Math.max(0, walkers.length - 1))];
    if (t) {
      state.mission = { kind: 'tail', stage: 'go', targetId: t.id, deadline: state.minute + 90, reward: pay(35000), held: 0, close: 0, away: 0, at: state.minute, text: `${t.name} is up to something. Find them and follow them for a bit. Don't get close, don't let them see you, don't lose them.` };
      lifeEvent(state, p, 'Took a job from Vince');
      return `Vince: "${state.mission.text}"`;
    }
  }
  if (k === 0) {
    const from = streetSpot(state, p.pos, 60, 260), to = streetSpot(state, from, 300, 700);
    const mins = Math.round(8 + Math.hypot(from.x - p.pos.x, from.z - p.pos.z) / 200 + Math.hypot(to.x - from.x, to.z - from.z) / 160);
    state.mission = { kind: 'courier', stage: 'pickup', from, to, deadline: state.minute + mins, reward: pay(30000), text: `Pick up a package on ${placeName(from)}, then get it to ${placeName(to)} by ${fmtClock(state.minute + mins)}. Don't open it.` };
  } else if (k === 1) {
    const bodies = ['suv', 'sports', 'saloon'];
    const body = bodies[randInt(state, 0, bodies.length - 1)];
    state.mission = { kind: 'carjack', stage: 'go', body, deadline: state.minute + 180, reward: pay(body === 'sports' ? 90000 : 55000), text: `Bring me ${BODY_NAMES[body]} to the Eastgate Motors yard gate. Any colour. You've got three hours.` };
  } else if (k === 2 || k === 3) {
    const marks = Object.values(state.people).filter((o) => o.npc && !o.npc.ambient && !o.isPlayer && !o.police && !o.dead && !o.away && o.id !== p.partnerId && (o.relations[p.id] ?? 0) < 50);
    const t = marks[randInt(state, 0, Math.max(0, marks.length - 1))];
    if (!t) return '"Nothing today. Ring me later."';
    state.mission = { kind: 'collect', stage: 'go', targetId: t.id, deadline: state.minute + 240, reward: pay(40000), text: `${t.name} owes me. Find them and put them on the floor, so they know I'm serious. Four hours.` };
  }
  lifeEvent(state, p, 'Took a job from Vince');
  return `Vince: "${state.mission!.text}"`;
}

export function dropMission(state: GameState): string {
  if (!state.mission) return '';
  state.mission = null;
  state.vinceRep = Math.max(0, (state.vinceRep ?? 0) - 1);
  return 'Vince: "Fine. I\'ll find someone who can."';
}

// ---------------------------------------------------------- takeaway deliveries
/** a round of three drops for a takeaway: each to a door a few streets off, before the food goes cold */
export const DELIVERY_PAY = 450, DELIVERY_BONUS = 600;
export function startDeliveries(state: GameState, personId: Id, venueId: string, from: Vec2): string {
  if (state.delivery) return 'You are already out on a round.';
  if (state.mission) return 'Finish Vince\'s job first.';
  const to = streetSpot(state, from, 90, 320);
  const mins = Math.round(4 + Math.hypot(to.x - from.x, to.z - from.z) / 120);
  state.delivery = { venue: venueId, to, left: 3, deadline: state.minute + mins, pay: DELIVERY_PAY, earned: 0 };
  void personId;
  return `Three orders to drop. First: ${placeName(to)}, by ${fmtClock(state.minute + mins)}. Go!`;
}
function deliveryTick(state: GameState) {
  const d = state.delivery!;
  const me = state.people[state.playerId];
  if (!me || me.dead || me.away) { state.delivery = null; return; }
  if (state.minute > d.deadline) {
    state.delivery = null;
    if (d.earned) transfer(state, { from: state.externalId, to: me.accountId, amount: d.earned, reason: 'transfer', memo: 'Delivery tips', key: `deliv:${Math.floor(state.minute)}` });
    news(state, 'bad', 'Cold food', `Too slow: the customer cancelled. ${d.earned ? `You keep ${fmtMoney(d.earned)} for the drops you made.` : ''}`, true);
    return;
  }
  if (dist(me.pos, d.to) > 5) return;
  d.earned += d.pay;
  d.left--;
  if (d.left <= 0) {
    const total = d.earned + DELIVERY_BONUS;
    transfer(state, { from: state.externalId, to: me.accountId, amount: total, reason: 'transfer', memo: 'Takeaway deliveries', key: `deliv:${Math.floor(state.minute)}` });
    state.delivery = null;
    lifeEvent(state, me, 'Did a round of takeaway deliveries');
    news(state, 'good', 'Round done', `Three hot dinners delivered: ${fmtMoney(total)} with the bonus.`, true);
    return;
  }
  const next = streetSpot(state, d.to, 90, 320);
  const mins = Math.round(4 + Math.hypot(next.x - d.to.x, next.z - d.to.z) / 120);
  d.to = next; d.deadline = state.minute + mins;
  news(state, 'info', 'Delivered', `Next: ${placeName(next)}, by ${fmtClock(state.minute + mins)}.`, true);
}

/** where to go next, for the waypoint and the ring */
export function missionGoal(state: GameState): Vec2 | null {
  const m = state.mission;
  if (!m && state.delivery) return state.delivery.to;
  if (!m) return null;
  if (m.kind === 'courier') return m.stage === 'pickup' ? m.from! : m.to!;
  if (m.kind === 'carjack') { const it = getWorld().interactables.chop_shop; return it ? it.pos : null; }
  const t = state.people[m.targetId!];
  return t && t.visible ? { ...t.pos } : null;
}

export function missionText(state: GameState): string {
  const m = state.mission;
  if (!m && state.delivery) { const d = state.delivery, left = Math.max(0, Math.round(d.deadline - state.minute)); return `Delivery ${4 - d.left}/3: ${placeName(d.to)} · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left`; }
  if (!m) return '';
  const left = Math.max(0, Math.round(m.deadline - state.minute));
  const time = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left`;
  if (m.kind === 'courier') return `Vince: ${m.stage === 'pickup' ? 'collect the package' : 'deliver the package'} · ${time}`;
  if (m.kind === 'carjack') return `Vince: bring ${BODY_NAMES[m.body!]} to Eastgate Motors · ${time}`;
  if (m.kind === 'tail') {
    const t = state.people[m.targetId!], me = state.people[state.playerId];
    const d = t && me ? dist(t.pos, me.pos) : 999;
    const state_ = !t?.visible ? 'indoors - wait for them' : (m.held ?? 0) > 0 ? (d < TAIL.CLOSE ? 'TOO CLOSE - back off' : d > TAIL.LOSE * 0.75 ? 'losing them - keep up' : 'on them') : 'find them';
    return `Vince: tail ${t?.name.split(' ')[0] ?? 'them'} · ${state_} · ${Math.round(m.held ?? 0)}/${TAIL.HOLD} min · ${time}`;
  }
  const t = state.people[m.targetId!];
  return `Vince: deal with ${t?.name ?? 'them'}${t && !t.visible ? ' (not out right now)' : ''} · ${time}`;
}

function pay(state: GameState, personId: Id, msg: string) {
  const m = state.mission!;
  const p = state.people[personId];
  transfer(state, { from: state.externalId, to: p.accountId, amount: m.reward, reason: 'transfer', memo: 'Cash from Vince', key: `vince:${Math.floor(state.minute)}:${m.kind}` });
  state.vinceRep = (state.vinceRep ?? 0) + 1;
  state.mission = null;
  news(state, 'good', 'Vince is pleased', `${msg} ${fmtMoney(m.reward)}.`, true);
  lifeEvent(state, p, `Did a job for Vince (${fmtMoney(m.reward)})`);
}

/** each tick: has the job been done, or has the clock run out? */
export function missionTick(state: GameState) {
  if (state.delivery) deliveryTick(state);
  const m = state.mission;
  if (!m) return;
  const me = state.people[state.playerId];
  if (!me || me.dead) { state.mission = null; return; }
  if (state.minute > m.deadline) {
    state.mission = null;
    state.vinceRep = Math.max(0, (state.vinceRep ?? 0) - 1);
    news(state, 'bad', 'Vince rings off', '"Too slow. Forget it."', true);
    return;
  }
  if (me.away) return;
  if (m.kind === 'courier') {
    const goal = m.stage === 'pickup' ? m.from! : m.to!;
    if (dist(me.pos, goal) < 4) {
      if (m.stage === 'pickup') { m.stage = 'deliver'; news(state, 'info', 'Package collected', `Now get it to ${placeName(m.to!)}.`, true); }
      else pay(state, me.id, 'Package delivered, no questions asked.');
    }
  } else if (m.kind === 'carjack') {
    const it = getWorld().interactables.chop_shop;
    const car = Object.values(state.vehicles).find((v) => v.driverId === me.id && v.kind === 'car');
    const body = car && CAR_MODELS.find((x) => x.id === car.model)?.body;
    if (it && car && body === m.body && dist(me.pos, it.pos) < 9) {
      // the lads at the yard take it off your hands
      me.where = 'outside'; me.visible = true; me.pos = { ...it.pos };
      delete state.vehicles[car.id];
      pay(state, me.id, `The ${car.name.toLowerCase()} disappears into the yard.`);
    }
  } else if (m.kind === 'tail') {
    const t = state.people[m.targetId!];
    const dt = Math.max(0, state.minute - (m.at ?? state.minute)); m.at = state.minute;
    if (!t || t.dead) { state.mission = null; news(state, 'info', 'Vince rings', '"Forget it. They\'re not going anywhere now."', true); return; }
    if (!t.visible || t.where !== 'outside') return;
    const d = dist(t.pos, me.pos);
    if ((m.held ?? 0) <= 0 && d > TAIL.LOSE) return; // not found them yet
    if (d > TAIL.LOSE) {
      m.away = (m.away ?? 0) + dt;
      if (m.away > TAIL.LOST) { state.mission = null; state.vinceRep = Math.max(0, (state.vinceRep ?? 0) - 1); news(state, 'bad', 'Lost them', 'Vince: "You lost them? Unbelievable."', true); }
      return;
    }
    m.away = 0;
    m.held = (m.held ?? 0) + dt;
    if (d < TAIL.CLOSE) m.close = (m.close ?? 0) + dt; else m.close = Math.max(0, (m.close ?? 0) - dt * 0.5);
    if ((m.close ?? 0) > TAIL.NOTICE) {
      // they clock you: a look, and off they go somewhere else
      t.facing = Math.atan2(me.pos.x - t.pos.x, me.pos.z - t.pos.z);
      t.gesture = { clip: 'argue', until: state.minute + 0.8 };
      t.grudge = (t.grudge ?? 0) + 1; t.relations[me.id] = Math.max(0, (t.relations[me.id] ?? 0) - 10);
      state.mission = null; state.vinceRep = Math.max(0, (state.vinceRep ?? 0) - 1);
      news(state, 'bad', 'Spotted', `${t.name.split(' ')[0]} saw you following. Vince: "Subtle. Really subtle."`, true);
      return;
    }
    if (m.held >= TAIL.HOLD) pay(state, me.id, `Vince: "Good. That's all I needed to know."`);
  } else {
    const t = state.people[m.targetId!];
    if (!t || t.dead) { state.mission = null; news(state, 'info', 'Vince rings', '"Someone got to them first. Never mind."', true); return; }
    if (t.down != null && dist(t.pos, me.pos) < 10) pay(state, me.id, `${t.name.split(' ')[0]} got the message.`);
  }
}
