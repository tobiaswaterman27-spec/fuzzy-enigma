// Driving for HarbourCabs in your own car: a fare waves you down at the kerb, gets in, and you
// take them where they are going. Paid by distance less the firm's cut, with a tip for a smooth ride.
import type { GameState, Id, Vec2 } from './types';
import { clamp, dist, fmtMoney, rand } from './core';
import { lifeEvent, news } from './events';
import { transfer } from './ledger';
import { getWorld } from './world/layout';
import { playerCar } from './cars';
import { gesture } from './talk';
import { AVENUES, DISTRICT_NAMES, districtAt, ROAD_HALF, STREETS, streetAt, WALK_W } from './world/city';

export interface TaxiJob { passenger: Id; pickup: Vec2; dropoff: Vec2; from: string; to: string; stage: 'pickup' | 'ride'; since: number; bumps: number; last?: Vec2; slow?: number }
const FIRM_CUT = 0.2;

/** kerbside spots: the main road and Harbour Road, and halfway along every street in the city */
let spotCache: { w: unknown; spots: { pos: Vec2; name: string }[] } | null = null;
export function taxiSpots(): { pos: Vec2; name: string }[] {
  const w = getWorld();
  if (spotCache?.w === w) return spotCache.spots;
  const spots = [...harbourSpots(), ...citySpots()];
  spotCache = { w, spots };
  return spots;
}
function citySpots(): { pos: Vec2; name: string }[] {
  const C = ROAD_HALF + WALK_W / 2, out: { pos: Vec2; name: string }[] = [];
  const harbour = (x: number, z: number) => Math.abs(x) < 135 && z > -135;
  const add = (x: number, z: number) => { if (!harbour(x, z)) out.push({ pos: { x, z }, name: `${streetAt(x, z)}, ${DISTRICT_NAMES[districtAt(x, z)]}` }); };
  for (const z of STREETS) for (let i = 0; i + 1 < AVENUES.length; i++) for (const dz of [-C, C]) add((AVENUES[i] + AVENUES[i + 1]) / 2, z + dz);
  for (const x of AVENUES) for (let j = 0; j + 1 < STREETS.length; j++) for (const dx of [-C, C]) add(x + dx, (STREETS[j] + STREETS[j + 1]) / 2);
  return out;
}
function harbourSpots(): { pos: Vec2; name: string }[] {
  const w = getWorld();
  const pts: Vec2[] = [];
  for (const x of [-80, -52, -24, 24, 50, 80]) for (const z of [-6.6, 6.6]) pts.push({ x, z });
  for (const z of [22, 40, 58]) for (const x of [-6.5, 6.5]) pts.push({ x, z });
  return pts.map((pos) => {
    let best = 'the main road', bd = Infinity;
    for (const b of w.buildings) {
      const cx = Math.max(b.rect.x0, Math.min(pos.x, b.rect.x1)), cz = Math.max(b.rect.z0, Math.min(pos.z, b.rect.z1));
      const d = Math.hypot(cx - pos.x, cz - pos.z);
      if (d < bd) { bd = d; best = b.name; }
    }
    return { pos, name: bd < 14 ? `outside ${best}` : pos.x > -9 && pos.x < 9 ? 'Harbour Road' : 'the main road' };
  });
}

export function startTaxi(state: GameState, personId: Id): { ok: boolean; msg: string } {
  const me = state.people[personId];
  if (!playerCar(state, personId)) return { ok: false, msg: 'You need your own car (Car tab).' };
  if (!me.quals?.includes('driving')) return { ok: false, msg: 'You need a driving licence.' };
  state.taxi = { on: true, job: null, done: state.taxi?.done ?? 0, earned: state.taxi?.earned ?? 0 };
  return { ok: true, msg: 'You are on the HarbourCabs app. Get in your car: fares will come in.' };
}
export function stopTaxi(state: GameState): string {
  const t = state.taxi;
  if (t?.job) { const p = state.people[t.job.passenger]; if (p && t.job.stage === 'ride') { p.visible = true; p.where = 'outside'; p.pos = { ...state.people[state.playerId].pos }; } }
  state.taxi = t ? { ...t, on: false, job: null } : null;
  return 'Off the app for now.';
}

/** every sub-step while on the app */
export function taxiTick(state: GameState) {
  const t = state.taxi;
  if (!t?.on) return;
  const me = state.people[state.playerId];
  const car = Object.values(state.vehicles).find((v) => v.driverId === me.id && v.kind === 'car' && !v.stolen);
  if (!t.job) {
    if (!car || rand(state) > 0.02) return;
    const spots = taxiSpots();
    const near = spots.filter((s) => { const d = dist(s.pos, car.pos); return d > 15 && d < 160; });
    if (!near.length) return;
    const from = near[Math.floor(rand(state) * near.length)];
    const dests = spots.filter((s) => { const d = dist(s.pos, from.pos); return d > 45 && d < 800; });
    const to = dests[Math.floor(rand(state) * dests.length)];
    const p = Object.values(state.people).find((q) => q.npc && !q.isPlayer && !q.police && !q.dead && !q.away && !q.sleeping && !q.action && !q.combat && q.npc.goal === 'idle_home' && !q.visible && rand(state) < 0.3);
    if (!p || !to) return;
    // they are waiting at the kerb, phone in hand
    p.visible = true; p.where = 'outside'; p.pos = { ...from.pos }; p.move = null;
    p.npc!.goal = 'leisure'; p.npc!.plan = [{ kind: 'wait', until: state.minute + 120 }]; p.npc!.nextDecision = state.minute + 120;
    p.facing = from.pos.z > 0 ? Math.PI : 0;
    gesture(state, p, 'wave', 2.5);
    t.job = { passenger: p.id, pickup: from.pos, dropoff: to.pos, from: from.name, to: to.name, stage: 'pickup', since: state.minute, bumps: 0 };
    news(state, 'info', `HarbourCabs: pick up ${p.name.split(' ')[0]}`, `Waiting ${from.name}, going to ${to.name}.`, true);
    return;
  }
  const j = t.job;
  const p = state.people[j.passenger];
  if (!p || p.dead || p.away) { t.job = null; return; }
  if (!car) return;
  const moved = j.last ? dist(j.last, car.pos) : 1;
  j.last = { ...car.pos };
  j.slow = moved < 0.05 ? (j.slow ?? 0) + 1 : 0;
  // they give up if you take too long to arrive
  if (j.stage === 'pickup' && state.minute - j.since > 40) { p.npc!.plan = []; p.npc!.nextDecision = state.minute; t.job = null; news(state, 'bad', 'Fare cancelled', `${p.name.split(' ')[0]} gave up waiting and walked.`, true); return; }
  if (j.stage === 'pickup' && dist(car.pos, j.pickup) < 8 && (j.slow ?? 0) > 3) {
    p.visible = false; p.where = 'vehicle'; p.npc!.plan = [{ kind: 'wait', until: state.minute + 240 }]; p.npc!.nextDecision = state.minute + 240;
    j.stage = 'ride'; j.since = state.minute;
    (p.knowsYou ??= { since: state.minute, talks: 0, last: state.minute, notes: [] });
    return;
  }
  if (j.stage === 'ride') {
    p.pos = { ...car.pos };
    if (dist(car.pos, j.dropoff) < 8 && (j.slow ?? 0) > 3) {
      const metres = dist(j.pickup, j.dropoff) * 1.3;
      const fare = Math.round(350 + metres * 1.6);
      const tip = j.bumps === 0 ? Math.round(fare * 0.15) : j.bumps < 3 ? Math.round(fare * 0.05) : 0;
      const bal = state.ledger.accounts[p.accountId]?.balance ?? 0;
      const payer = bal >= fare + tip ? p.accountId : state.externalId;
      transfer(state, { from: payer, to: me.accountId, amount: Math.round((fare) * (1 - FIRM_CUT)) + tip, reason: 'wage', memo: `HarbourCabs fare: ${p.name}`, key: `fare:${p.id}:${Math.floor(state.minute)}` });
      if (payer === p.accountId) transfer(state, { from: p.accountId, to: state.externalId, amount: fare - Math.round(fare * (1 - FIRM_CUT)), reason: 'services', memo: 'HarbourCabs booking fee', key: `farefee:${p.id}:${Math.floor(state.minute)}` });
      p.visible = true; p.where = 'outside'; p.pos = { ...j.dropoff };
      p.npc!.plan = []; p.npc!.nextDecision = state.minute;
      p.relations[me.id] = clamp((p.relations[me.id] ?? 0) + (j.bumps ? 1 : 4), 0, 100);
      gesture(state, p, j.bumps > 2 ? 'argue' : 'wave', 2);
      t.done = (t.done ?? 0) + 1; t.earned = (t.earned ?? 0) + Math.round(fare * (1 - FIRM_CUT)) + tip;
      if (t.done === 1) lifeEvent(state, me, 'First fare for HarbourCabs');
      news(state, 'good', `Fare paid: ${fmtMoney(Math.round(fare * (1 - FIRM_CUT)) + tip)}`, `${fmtMoney(fare)} fare less 20% to HarbourCabs${tip ? `, plus a ${fmtMoney(tip)} tip` : j.bumps > 2 ? '. No tip: that was a rough ride' : ''}.`, true);
      t.job = null;
    }
  }
}

/** the car bumped into something with a passenger aboard */
export function taxiBump(state: GameState) {
  const j = state.taxi?.job;
  if (j?.stage === 'ride') j.bumps++;
}

/** where to drive to right now (for the marker and the goal line) */
export function taxiTarget(state: GameState): { pos: Vec2; text: string } | null {
  const j = state.taxi?.on ? state.taxi.job : null;
  if (!j) return null;
  const p = state.people[j.passenger];
  return j.stage === 'pickup' ? { pos: j.pickup, text: `HarbourCabs: pick up ${p?.name.split(' ')[0]} ${j.from} (stop beside them)` } : { pos: j.dropoff, text: `HarbourCabs: take ${p?.name.split(' ')[0]} to ${j.to} (stop there)` };
}
