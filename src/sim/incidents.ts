// Things that happen in the street, in front of you: two people who have a grudge, a couple under
// strain, or a pair who have had a few too many stop and argue. Most storm off; some come to blows,
// and then the police come for whoever started it.
import type { GameState, Id, Person } from './types';
import { clamp, dist, rand } from './core';
import { lifeEvent, news } from './events';
import { minuteOfDay, dayIndex } from './clock';
import { flee, sendAway } from './health';
import { gesture } from './talk';
import { moveAll, moveItems } from './inventory';
import { getWorld, SHOPS } from './world/layout';
import { statsFor } from './employment';
import { isStaff } from './retail';
import { transfer } from './ledger';

export interface Incident { a: Id; b: Id; at: number; stage: 'argue' | 'fight' | 'done'; escalate: boolean; why: string }

const free = (p: Person) => !p.isPlayer && p.npc && !p.police && p.visible && !p.dead && !p.away && p.down == null && !p.action && !p.combat && !p.following && p.where === 'outside' && !(p.npc as any).gathering;

/** what they are rowing about */
function reason(state: GameState, a: Person, b: Person): string | null {
  if (a.partnerId === b.id && (a.needs.mood < 35 || b.needs.mood < 35)) return 'a couple under strain';
  if ((a.grudge ?? 0) > 0 && (a.relations[b.id] ?? 0) < 15) return 'an old grudge';
  if ((a.drunk ?? 0) > 40 || (b.drunk ?? 0) > 40) return 'too much to drink';
  const night = minuteOfDay(state.minute) > 21 * 60 && [4, 5].includes(dayIndex(state.minute) % 7);
  if (night && rand(state) < 0.3) return 'a Friday-night bust-up';
  if ((a.relations[b.id] ?? 0) < 5 && a.traits.patience < 0.3 && b.traits.patience < 0.35 && rand(state) < 0.15) return 'bumping into each other';
  return null;
}

export function incidentsTick(state: GameState) {
  const now = state.minute;
  const inc = state.incident;
  if (inc && inc.stage !== 'done') { run(state, inc); return; }
  if (Math.floor(now) % 15 !== 0) return;
  const me = state.people[state.playerId];
  if (!me.visible) return;
  const near = Object.values(state.people).filter((p) => free(p) && dist(p.pos, me.pos) < 35);
  for (const a of near) for (const b of near) {
    if (a.id >= b.id || dist(a.pos, b.pos) > 12) continue;
    const why = reason(state, a, b);
    if (!why || rand(state) > 0.35) continue;
    const hot = a.traits.patience < 0.35 && b.traits.patience < 0.45;
    const escalate = hot && ((a.drunk ?? 0) > 30 || (b.drunk ?? 0) > 30 || (a.grudge ?? 0) > 1 || rand(state) < 0.3);
    state.incident = { a: a.id, b: b.id, at: now, stage: 'argue', escalate, why };
    // they stop and square up to each other
    for (const [p, q] of [[a, b], [b, a]] as const) {
      p.move = null;
      if (p.npc) { p.npc.plan = [{ kind: 'wait', until: now + 4 }]; p.npc.nextDecision = now + 5; }
      p.facing = Math.atan2(q.pos.x - p.pos.x, q.pos.z - p.pos.z);
    }
    // close the gap: they end up face to face
    const mid = { x: (a.pos.x + b.pos.x) / 2, z: (a.pos.z + b.pos.z) / 2 };
    const d = Math.max(0.01, dist(a.pos, b.pos));
    a.pos = { x: mid.x - ((b.pos.x - a.pos.x) / d) * 0.6, z: mid.z - ((b.pos.z - a.pos.z) / d) * 0.6 };
    b.pos = { x: mid.x + ((b.pos.x - mid.x) / Math.max(0.01, dist(b.pos, mid))) * 0.6, z: mid.z + ((b.pos.z - mid.z) / Math.max(0.01, dist(b.pos, mid))) * 0.6 };
    gesture(state, a, 'argue', 4);
    return;
  }
}

function run(state: GameState, inc: Incident) {
  const a = state.people[inc.a], b = state.people[inc.b];
  const t = state.minute - inc.at;
  if (!a || !b) { inc.stage = 'done'; return; }
  const over = a.dead || b.dead || a.away || b.away || b.down != null || a.down != null;
  if (inc.stage === 'argue' && over) { inc.stage = 'done'; return; }
  if (inc.stage === 'argue') {
    // shouting back and forth
    const speaker = Math.floor(t * 1.5) % 2 ? b : a;
    if (!speaker.gesture || state.minute >= speaker.gesture.until) gesture(state, speaker, 'argue', 2.5);
    for (const p of [a, b]) if (p.npc) p.npc.plan = [{ kind: 'wait', until: state.minute + 2 }];
    if (t < 1.6) return;
    a.relations[b.id] = clamp((a.relations[b.id] ?? 0) - 15, 0, 100); b.relations[a.id] = clamp((b.relations[a.id] ?? 0) - 15, 0, 100);
    a.needs.mood = clamp(a.needs.mood - 8, 0, 100); b.needs.mood = clamp(b.needs.mood - 8, 0, 100);
    lifeEvent(state, a, `Had a row with ${b.name} in the street`); lifeEvent(state, b, `Had a row with ${a.name} in the street`);
    if (inc.escalate) {
      inc.stage = 'fight';
      a.combat = { target: b.id, until: state.minute + 2.5, next: state.minute + 0.1 };
      b.combat = { target: a.id, until: state.minute + 2.5, next: state.minute + 0.5 };
      a.grudge = (a.grudge ?? 0) + 1; b.grudge = (b.grudge ?? 0) + 1;
      return;
    }
    // one storms off, the other goes the other way
    inc.stage = 'done';
    for (const p of [a, b]) if (p.npc) { p.npc.plan = []; p.npc.nextDecision = state.minute; }
    flee(state, a, b.pos);
    if (a.partnerId === b.id && rand(state) < 0.25) news(state, 'world', `${a.name.split(' ')[0]} and ${b.name.split(' ')[0]} were seen rowing in the street`, 'Harbourside gossip.');
    return;
  }
  if (inc.stage === 'fight' && (t > 4.5 || over)) {
    inc.stage = 'done';
    a.combat = null; b.combat = null;
    // the police arrive and take whoever threw the first punch
    if (a.down == null && !a.dead && !a.away) {
      sendAway(state, a, 'custody', 12 * 60, 'fighting in the street');
      (a.record ??= []).push('affray');
      news(state, 'world', `${a.name} arrested after a fight`, `${a.name} was arrested after fighting with ${b.name}${b.down != null ? `, who was taken to hospital` : ''}.`, (state.people[state.playerId].relations[a.id] ?? 0) >= 20);
    }
    if (b.npc && !b.down) { b.npc.plan = []; b.npc.nextDecision = state.minute; }
  }
}

// ------------------------------------------------------------ shoplifting
/** now and then a shopper at Corner Market pockets what is in their basket and runs for the door */
export function shopliftTick(state: GameState) {
  if (Object.values(state.people).some((p) => (p.npc as any)?.shoplift)) return;
  const shop = state.businesses.market;
  if (!shop) return;
  for (const p of Object.values(state.people)) {
    const n = p.npc;
    if (!n || p.isPlayer || n.goal !== 'shop' || n.shopId !== 'market' || !p.visible || p.action || n.step !== 'run') continue;
    if (n.plan[0]?.kind !== 'call' || (n.plan[0] as any).fn !== 'checkout') continue;
    const basket = state.containers[p.basketId];
    const units = Object.values(basket?.items ?? {}).reduce((a, b) => a + b, 0);
    if (!units || rand(state) > 0.006 + (p.traits.conscientiousness < 0.25 ? 0.02 : 0)) continue;
    const items = { ...basket.items };
    moveAll(state, p.basketId, p.bagId);
    (n as any).shoplift = { items, at: state.minute };
    const exit = Object.values(getWorld().nodes).filter((x) => x.loc === 'outside' && dist(x, p.pos) > 30 && dist(x, p.pos) < 60);
    const to = exit[Math.floor(rand(state) * exit.length)] ?? getWorld().nodes.bus_e;
    n.plan = [{ kind: 'move', to: { x: to.x, z: to.z }, label: 'getaway' }, { kind: 'call', fn: n.ambient ? 'despawn' : 'arriveHome' }];
    n.goal = 'go_home';
    p.fleeing = state.minute + 6;
    statsFor(state, shop).lostSales += units;
    const me = state.people[state.playerId];
    if (dist(me.pos, p.pos) < 25 || isStaff(state, me.id, 'market')) news(state, 'bad', 'Shoplifter!', `${p.name} is running out of Corner Market without paying. Catch them (run up and press E).`, true);
    return;
  }
}

/** caught: the goods go back to the shop and the police take them away */
export function grabShoplifter(state: GameState, catcherId: Id, thiefId: Id): string {
  const p = state.people[thiefId], me = state.people[catcherId];
  const sl = (p.npc as any)?.shoplift;
  if (!sl) return 'They have not done anything.';
  for (const [item, q] of Object.entries(sl.items as Record<string, number>)) moveItems(state, p.bagId, SHOPS.market.backroom, item, q);
  (p.npc as any).shoplift = undefined;
  p.fleeing = 0;
  (p.record ??= []).push('shoplifting');
  gesture(state, p, 'sad', 2);
  lifeEvent(state, p, `Caught shoplifting by ${me.name}`);
  me.reputation = clamp(me.reputation + 3, 0, 100);
  let reward = '';
  if (isStaff(state, me.id, 'market')) {
    const r = transfer(state, { from: state.businesses.market.accountId, to: me.accountId, amount: 2500, reason: 'wage', memo: 'Reward for stopping a shoplifter' });
    if (r.ok) reward = ' The manager gives you a £25 reward.';
  }
  sendAway(state, p, 'custody', 8 * 60, 'shoplifting');
  news(state, 'good', 'You caught a shoplifter', `${p.name} was handed over to the police and the goods went back on the shelves.${reward}`, true);
  return `You grab ${p.name.split(' ')[0]} and get the goods back.${reward}`;
}
