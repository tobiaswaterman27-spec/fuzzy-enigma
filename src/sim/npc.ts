// NPCSimulation: persistent people with schedules, needs, jobs and shopping.
// Decision layer: a priority/utility choice of goal every few minutes.
// Execution layer: a plan of move/act/wait steps using the same validated
// actions as the player. Arrival is verified by distance, never by a timer.
import { GOODS_IN_SPOT } from './forklift';
import { marketOn, STALLS } from './streetmarket';
import type { GameState, Id, NpcGoal, Person, PlanStep, Task, Vec2 } from './types';
import { dayIndex, minuteOfDay } from './clock';
import { clamp, dist, pick, rand, randInt } from './core';
import { count, moveAll, removeItems, total } from './inventory';
import { ITEMS, PRODUCTS, isFood } from './items';
import { hostingInterview, acceptOffer as acceptOfferNpc, applyForJob as applyForJobNpc, canApply as canApplyNpc, clockIn, clockOut, currentShift, isOnShift, nextShift, openAttendance, positionOf, statsFor } from './employment';
import { cancelAction, interactable, startAction } from './actions';
import { isOpen, joinQueue, leaveQueue, openTasks, queueSlot, shelfFor, staffOnDuty, walkout, productsOf } from './retail';
import { getWorld, SHOPS } from './world/layout';
import { pickNeed, pickQueue } from './logistics';
import { CAFE_PATIENCE, cafeQueueSlot } from './cafe';
import { currentPlot, currentStage, PLOTS } from './construction';
import { planRoute, resolveCircle, routeLength } from './world/nav';
import { capability } from './needs';
import { npcLog } from './events';
import { raining } from './weather';

export const WALK = 4.5; // metres per game minute (1.5 m/s real at the default 1/3 game-min per real second)

interface Workplace {
  mode: 'shop' | 'post' | 'hidden' | 'warehouse' | 'site';
  pos: Vec2;
  facing: number;
}

/** which plot the builders are on (set each tick from the state, used by workplaceOf) */
let sitePlot = 0;

export function workplaceOf(bid: Id, positionId?: Id): Workplace {
  const w = getWorld();
  const n = (id: string) => ({ x: w.nodes[id].x, z: w.nodes[id].z });
  switch (bid) {
    case 'market': case 'unit4': return { mode: 'shop', pos: w.interactables[SHOPS[bid].terminal].pos, facing: w.interactables[SHOPS[bid].terminal].facing };
    case 'cafe': return { mode: 'post', pos: { x: -24, z: 21.3 }, facing: Math.PI };
    case 'builders': {
      const plot = PLOTS[Math.min(sitePlot, PLOTS.length - 1)];
      const it = w.interactables[`${plot.id}_cabin`];
      return { mode: 'site', pos: it.pos, facing: it.facing };
    }
    case 'homestore': return { mode: 'post', pos: { x: -51, z: -33.45 }, facing: 0 };
    case 'council': return { mode: 'post', pos: n('jc_desk_back'), facing: 0 };
    case 'wholesale':
      // operatives work the warehouse floor; drivers go out with the van; the forklift driver works goods-in
      if (positionId === 'forklift') return { mode: 'post', pos: { x: GOODS_IN_SPOT.x - 1.6, z: GOODS_IN_SPOT.z - 2.4 }, facing: 0 };
      if (positionId !== 'driver' && w.interactables.wh_terminal) return { mode: 'warehouse', pos: w.interactables.wh_terminal.pos, facing: w.interactables.wh_terminal.facing };
      return { mode: 'hidden', pos: n('door_wholesale'), facing: 0 };
    default: return { mode: 'hidden', pos: n('bus_w'), facing: 0 };
  }
}

export function homeDoor(homeId: Id | null): Vec2 {
  const w = getWorld();
  const id = homeId === 'flat_upper' ? 'door_upper' : `door_${homeId}`;
  const n = w.nodes[id] ?? w.nodes.bus_e;
  return { x: n.x, z: n.z };
}

const atHome = (p: Person) => !!p.homeId && p.where === p.homeId && (!p.visible || (p.npc as any)?.shownIn === p.homeId);

function hide(p: Person, where: Id) {
  p.visible = false;
  p.where = where;
  p.move = null;
}

function show(p: Person) {
  if (!p.visible) {
    p.visible = true;
    if (p.where !== 'vehicle') p.where = 'outside';
  }
}

export function goTo(state: GameState, p: Person, to: Vec2, label: string): boolean {
  show(p);
  const route = planRoute(p.pos, to);
  if (!route) {
    npcLog(state, p, `no route to ${label}`);
    return false;
  }
  p.move = { path: route, idx: 0, dest: { ...to }, destLabel: label, stuckTime: 0, lastDist: Infinity, replans: 0 };
  return true;
}

/** movement execution with arrival verification and stuck recovery */
export function tickMovement(state: GameState, p: Person, dt: number) {
  const m = p.move;
  if (!m) return;
  const hurry = p.down != null ? 0 : (p.fleeing ?? 0) > state.minute ? 2.3 : p.police || p.combat ? 2.0 : p.following ? 1.8 : (p.jogging ?? 0) > state.minute ? 2.1 : 1;
  let step = WALK * capability(p).move * hurry * dt;
  // personal space: someone just ahead slows you down and you step round them (keeping left)
  const tgt0 = m.path[m.idx];
  if (tgt0) {
    const d0 = dist(p.pos, tgt0);
    if (d0 > 0.3) {
      const hx = (tgt0.x - p.pos.x) / d0, hz = (tgt0.z - p.pos.z) / d0;
      for (const o of Object.values(state.people)) {
        if (o === p || !o.visible || o.sleeping) continue;
        const ox = o.pos.x - p.pos.x, oz = o.pos.z - p.pos.z;
        const along = ox * hx + oz * hz, side = ox * -hz + oz * hx;
        if (along <= 0 || along > 0.9 || Math.abs(side) > 0.5) continue;
        step *= 0.45;
        // sidestep away from them (to the left when dead ahead), without walking into walls
        const away = side > 0.05 ? -1 : 1;
        p.pos = resolveCircle({ x: p.pos.x - hz * away * 0.9 * dt, z: p.pos.z + hx * away * 0.9 * dt }, 0.25);
        break;
      }
    }
  }
  while (step > 0 && m.idx < m.path.length) {
    const tgt = m.path[m.idx];
    const d = dist(p.pos, tgt);
    if (d < 0.02) { m.idx++; continue; }
    const mv = Math.min(step, d);
    const dx = (tgt.x - p.pos.x) / d, dz = (tgt.z - p.pos.z) / d;
    p.pos = { x: p.pos.x + dx * mv, z: p.pos.z + dz * mv };
    p.facing = Math.atan2(dx, dz);
    step -= mv;
    if (mv >= d - 1e-6) m.idx++;
  }
  const remaining = dist(p.pos, m.dest);
  const moved = WALK * capability(p).move * hurry * dt - step;
  if (moved < 0.01 * dt) m.stuckTime += dt;
  else m.stuckTime = 0;
  if (m.idx >= m.path.length) {
    if (remaining < 0.3) { p.move = null; return; }
    // path consumed but not at the destination: replan
    m.replans++;
    const r = m.replans < 3 ? planRoute(p.pos, m.dest) : null;
    if (r) { m.path = r; m.idx = 0; } else { npcLog(state, p, `failed to reach ${m.destLabel}`); p.move = null; if (p.npc) { p.npc.plan = []; p.npc.nextDecision = state.minute; } }
    return;
  }
  if (m.stuckTime > 6) {
    npcLog(state, p, `stuck going to ${m.destLabel}, replanning`);
    const r = planRoute(p.pos, m.dest);
    m.stuckTime = 0;
    m.lastDist = Infinity;
    if (r) { m.path = r; m.idx = 0; } else { p.move = null; if (p.npc) p.npc.plan = []; }
  }
}

// ------------------------------------------------------------ decisions
function setGoal(state: GameState, p: Person, goal: NpcGoal, plan: PlanStep[]) {
  const n = p.npc!;
  if (n.claim) releaseClaim(state, p);
  n.goal = goal;
  n.goalSince = state.minute;
  n.plan = plan;
  n.step = 'run';
  npcLog(state, p, `goal ${goal}`);
}

function releaseClaim(state: GameState, p: Person) {
  const n = p.npc!;
  const t = n.claim ? state.tasks[n.claim] : null;
  if (t && t.claimedBy === p.id && t.status === 'claimed') { t.status = 'open'; t.claimedBy = null; }
  n.claim = undefined;
}

function travelMinutes(p: Person, to: Vec2): number {
  const from = p.visible ? p.pos : homeDoor(p.homeId);
  const r = planRoute(from, to);
  return r ? routeLength(from, r) / WALK : 60;
}

const pantryFood = (state: GameState, p: Person) => {
  const c = p.pantryId ? state.containers[p.pantryId] : null;
  if (!c) return 0;
  return Object.entries(c.items).filter(([k]) => isFood(k)).reduce((s, [, n]) => s + n, 0);
};

/** An interviewer heads to the cafe table before the booked time and waits there, seated. */
function hostInterview(state: GameState, p: Person): boolean {
  const seat = getWorld().interactables.iv_host;
  const due = Object.values(state.applications).find((a) => a.interviewerId === p.id && a.status === 'interview' && a.interviewAt != null
    && state.minute >= a.interviewAt - travelMinutes(p, seat.pos) - 8 && state.minute <= a.interviewAt + 45);
  if (!due && !hostingInterview(state, p.id)) return false;
  const n = p.npc!;
  if (p.action?.type === 'sit' && p.action.target === 'iv_host') return true;
  if (n.plan?.some((st) => st.kind === 'act' && st.it === 'iv_host')) return true;
  if (p.action) cancelAction(state, p, 'interview');
  releaseClaim(state, p);
  if (total(state.containers[p.handsId]) > 0) return false; // put the case down first (work plan does that)
  n.plan = [{ kind: 'move', to: seat.pos, label: 'interview at the cafe' }, { kind: 'act', it: 'iv_host', type: 'sit' }];
  n.step = 'interview';
  return true;
}

function decide(state: GameState, p: Person) {
  const n = p.npc!;
  const now = state.minute;
  const mod = minuteOfDay(now);
  n.nextDecision = now + 10;
  if (n.ambient) return; // ambient shoppers are driven by the demand model
  if (hostInterview(state, p)) { n.nextDecision = now + 1; return; }
  if (goToMeetup(state, p)) return;
  const c = p.contractId ? state.contracts[p.contractId] : null;
  // 1. work
  if (c) {
    const wp = workplaceOf(c.businessId, c.positionId);
    const travel = travelMinutes(p, wp.pos);
    const s = currentShift(c, now, travel + 15);
    const att = openAttendance(state, p.id);
    if (att || (s && now < s.end - 15 && !state.attendance[`${c.id}:${s.day}`]?.closed)) {
      if (n.goal !== 'work' && n.goal !== 'go_work') startWork(state, p);
      return;
    }
  }
  if (n.goal === 'work' || n.goal === 'go_work') return; // finishing is handled by the work plan
  const nextS = c ? nextShift(c, now) : null;
  const freeFor = nextS ? nextS.start - now - travelMinutes(p, workplaceOf(c!.businessId, c!.positionId).pos) - 20 : 9999;
  const sleepy = p.needs.energy < 15 || mod >= n.bedtime || mod < n.wake;
  if (atHome(p) && p.needs.satiety < 50) eatAtHome(state, p);
  // 2. sleep
  if (sleepy) {
    if (atHome(p)) { p.sleeping = true; return; }
    if (n.goal !== 'go_home') setGoal(state, p, 'go_home', [{ kind: 'move', to: homeDoor(p.homeId), label: 'home' }, { kind: 'call', fn: 'arriveHome' }]);
    return;
  }
  p.sleeping = false;
  if (n.goal === 'shop' || n.goal === 'leisure') return; // let errands finish
  // 3. groceries
  const money = state.ledger.accounts[p.accountId].balance;
  const shop = pantryFood(state, p) < 4 && freeFor > 90 && money > 1500 ? chooseShop(state, p) : null;
  if (shop) {
    startShopping(state, p, shop, groceryList(state, p, shop, 3 + randInt(state, 0, 3)));
    return;
  }
  // 4. leisure
  const market = marketOn(state);
  if (freeFor > 120 && p.needs.energy > 35 && mod > 9 * 60 && mod < 20 * 60 && rand(state) < 0.08 + p.traits.sociability * 0.15 + (market ? 0.12 : 0)) {
    // Saturday market: most outings go there to browse and buy something fresh
    if (market && money > 1500 && rand(state) < 0.7) {
      const st = pick(state, STALLS);
      setGoal(state, p, 'leisure', [
        { kind: 'move', to: { x: st.pos.x + (rand(state) - 0.5) * 1.2, z: st.pos.z - rand(state) * 0.4 }, label: 'the market' },
        { kind: 'act', it: st.id, type: 'buy_stall' },
        { kind: 'wait', until: now + randInt(state, 10, 35) },
        { kind: 'move', to: homeDoor(p.homeId), label: 'home' }, { kind: 'call', fn: 'arriveHome' },
      ]);
      return;
    }
    const cafe = state.businesses.cafe;
    const cafeOk = isOpen(cafe, now) && staffOnDuty(state, 'cafe').length > 0 && money > 2500 && p.needs.satiety < 60;
    if (cafeOk) {
      setGoal(state, p, 'leisure', [
        { kind: 'move', to: getWorld().interactables.cafe_counter.pos, label: 'cafe' },
        { kind: 'act', it: 'cafe_counter', type: 'buy_meal' },
        { kind: 'move', to: homeDoor(p.homeId), label: 'home' }, { kind: 'call', fn: 'arriveHome' },
      ]);
    } else {
      // half the time, call on someone and meet them in the park for a chat
      if (rand(state) < 0.5 && raining(state) < 0.05 && arrangeChat(state, p)) return;
      const bench = pick(state, ['bench_1', 'bench_2']);
      const busy = Object.values(state.people).some((o) => o.action?.target === bench);
      // nobody sits in the park in the rain
      if (!busy && raining(state) < 0.05) {
        setGoal(state, p, 'leisure', [
          { kind: 'move', to: getWorld().interactables[bench].pos, label: 'park' },
          { kind: 'act', it: bench, type: 'sit' },
          { kind: 'wait', until: now + randInt(state, 30, 90) },
          { kind: 'move', to: homeDoor(p.homeId), label: 'home' }, { kind: 'call', fn: 'arriveHome' },
        ]);
      }
    }
    return;
  }
  // 5. otherwise be at home
  if (!atHome(p) && n.goal !== 'go_home') setGoal(state, p, 'go_home', [{ kind: 'move', to: homeDoor(p.homeId), label: 'home' }, { kind: 'call', fn: 'arriveHome' }]);
}

/** spots in the park where two people stand and talk, facing each other */
const CHAT_SPOTS = [{ x: 56, z: 32 }, { x: 52, z: 25 }, { x: 62, z: 26 }, { x: 56, z: 13.5 }, { x: 59, z: 29 }];

/** minutes until this person must set off for their next shift (a lot if they have no job) */
function freeMinutes(state: GameState, q: Person): number {
  const c = q.contractId ? state.contracts[q.contractId] : null;
  if (!c || c.status !== 'active') return 9999;
  if (openAttendance(state, q.id)) return 0;
  const s = nextShift(c, state.minute);
  return s ? s.start - state.minute - travelMinutes(q, workplaceOf(c.businessId, c.positionId).pos) - 20 : 9999;
}

/** find someone free at home (a friend if possible) and meet them in the park to talk for a while */
function arrangeChat(state: GameState, p: Person): boolean {
  const now = state.minute;
  // free: nobody standing there and nobody already on their way to it
  const spot = CHAT_SPOTS.find((s) => !Object.values(state.people).some((o) => (o.visible && dist(o.pos, s) < 2.5) || o.npc?.plan.some((st) => st.kind === 'move' && dist(st.to, s) < 2.5) || (o.move && dist(o.move.dest ?? o.pos, s) < 2.5)));
  if (!spot) return false;
  const cands = Object.values(state.people).filter((q) => q.npc && !q.npc.ambient && q.id !== p.id && !q.sleeping && !q.action && q.npc.goal === 'idle_home' && atHome(q)
    && q.needs.energy > 35 && freeMinutes(state, q) > 150 && !state.meetups?.some((m) => m.friendId === q.id && m.status === 'planned'));
  if (!cands.length) return false;
  cands.sort((a, b) => (p.relations[b.id] ?? 0) - (p.relations[a.id] ?? 0));
  const q = (p.relations[cands[0].id] ?? 0) > 0 ? cands[0] : pick(state, cands);
  const a = { x: spot.x - 0.55, z: spot.z }, b = { x: spot.x + 0.55, z: spot.z };
  const at = now + Math.max(travelMinutes(p, a), travelMinutes(q, b)) + 3;
  const plan = (who: Person, here: Vec2, other: Person): PlanStep[] => [
    { kind: 'move', to: here, label: `meeting ${other.name.split(' ')[0]}` },
    { kind: 'wait', until: at },
    { kind: 'act', it: `person:${other.id}`, type: 'talk', arg: 'long' },
    { kind: 'move', to: homeDoor(who.homeId), label: 'home' }, { kind: 'call', fn: 'arriveHome' },
  ];
  if (!q.visible) { q.pos = homeDoor(q.homeId); show(q); }
  setGoal(state, p, 'leisure', plan(p, a, q));
  setGoal(state, q, 'leisure', plan(q, b, p));
  q.npc!.nextDecision = now + 1;
  npcLog(state, p, `meeting ${q.name} in the park`);
  return true;
}

/** a coffee with the player: drop what you are doing in time to get to the cafe and sit at the corner table */
function goToMeetup(state: GameState, p: Person): boolean {
  const n = p.npc!;
  const now = state.minute;
  const meet = state.meetups?.find((m) => m.status === 'planned' && m.friendId === p.id);
  if (!meet) return false;
  const seat = getWorld().interactables.meet_host;
  if (now < meet.at - travelMinutes(p, seat.pos) - 8 || now >= meet.at + 30) return false;
  const already = (p.action?.type === 'sit' && p.action.target === 'meet_host') || n.plan.some((s) => s.kind === 'act' && s.it === 'meet_host');
  if (already) return false;
  if (p.action) cancelAction(state, p);
  if (!p.visible) { p.pos = homeDoor(p.homeId); show(p); }
  setGoal(state, p, 'leisure', [
    { kind: 'move', to: seat.pos, label: 'meeting a friend' },
    { kind: 'act', it: 'meet_host', type: 'sit' },
    { kind: 'wait', until: meet.at + 45 },
    { kind: 'move', to: homeDoor(p.homeId), label: 'home' }, { kind: 'call', fn: 'arriveHome' },
  ]);
  p.move = null;
  n.nextDecision = now + 1;
  return true;
}

function eatAtHome(state: GameState, p: Person) {
  const pantry = p.pantryId ? state.containers[p.pantryId] : null;
  if (!pantry) return;
  const foods = Object.keys(pantry.items).filter(isFood).sort((a, b) => ITEMS[b].satiety - ITEMS[a].satiety);
  for (const f of foods) {
    if (p.needs.satiety >= 70) break;
    if (removeItems(pantry, f, 1)) p.needs.satiety = clamp(p.needs.satiety + ITEMS[f].satiety, 0, 100);
  }
}

/** pick an open shop, weighing reputation, prices, stock and walking distance */
export function chooseShop(state: GameState, p: Person): string | null {
  const from = p.visible ? p.pos : homeDoor(p.homeId);
  let best: string | null = null;
  let bestScore = 0;
  for (const id of Object.keys(SHOPS)) {
    const b = state.businesses[id];
    if (!b || !isOpen(b, state.minute) || !isOpen(b, state.minute + 60) || !productsOf(b).length) continue;
    const S = SHOPS[id];
    const d = Math.hypot(S.entrance.x - from.x, S.entrance.z - from.z);
    const score = (0.6 + b.reputation / 125) * (productsOf(b).length / 8 + 0.5) / (1 + d / 60) * (0.85 + rand(state) * 0.3);
    if (score > bestScore) { bestScore = score; best = id; }
  }
  return best;
}

export function groceryList(state: GameState, p: Person | null, shopId: string, items: number): Record<string, number> {
  const b = state.businesses[shopId];
  const list: Record<string, number> = {};
  const range = productsOf(b);
  // wanting things the shop does not stock is part of demand too (recorded as lost sales)
  const PRODUCTS_WANTED = PRODUCTS.filter((k) => range.includes(k) || rand(state) < 0.08);
  const weights = PRODUCTS_WANTED.map((k) => {
    const rel = ITEMS[k].retail / Math.max(1, b.prices[k] ?? ITEMS[k].retail);
    const thrift = p ? p.traits.thrift : 0.5;
    return ITEMS[k].demand * Math.pow(rel, 1 + thrift * 1.5);
  });
  const sum = weights.reduce((a, c) => a + c, 0);
  for (let i = 0; i < items; i++) {
    let r = rand(state) * sum;
    let k = 0;
    while (r > weights[k] && k < weights.length - 1) { r -= weights[k]; k++; }
    if (PRODUCTS_WANTED[k]) list[PRODUCTS_WANTED[k]] = (list[PRODUCTS_WANTED[k]] ?? 0) + 1;
  }
  return list;
}

export function startShopping(state: GameState, p: Person, shopId: string, list: Record<string, number>) {
  const w = getWorld();
  const S = SHOPS[shopId];
  const plan: PlanStep[] = [{ kind: 'move', to: S.entrance, label: state.businesses[shopId].name }];
  let missing = 0;
  const shelves: [string, string][] = [];
  for (const k of Object.keys(list)) {
    const sh = shelfFor(state, shopId, k);
    if (sh) shelves.push([k, sh]); else missing += list[k];
  }
  // visit shelves in aisle order
  shelves.sort((a, b) => w.interactables[a[1]].pos.x - w.interactables[b[1]].pos.x);
  for (const [k, sh] of shelves) {
    const it = w.interactables[sh];
    plan.push({ kind: 'move', to: it.pos, label: `shelf ${k}` });
    plan.push({ kind: 'act', it: it.id, type: 'pick_item', arg: String(list[k]) });
  }
  plan.push({ kind: 'call', fn: 'checkout' });
  setGoal(state, p, 'shop', plan);
  p.npc!.list = list;
  p.npc!.shopId = shopId;
  if (missing) statsFor(state, state.businesses[shopId]).lostSales += missing;
}

/** a cafe customer when you are cooking: in through the door, queue at the counter for a meal */
export function startCafeVisit(state: GameState, p: Person) {
  setGoal(state, p, 'shop', [{ kind: 'move', to: { x: -24, z: 11.8 }, label: 'Tidewater Cafe' }, { kind: 'call', fn: 'cafeQueue' }]);
  p.npc!.shopId = 'cafe';
}

/** a Harbour Home customer: browses the room sets, then queues at the counter to order */
const HOME_BROWSE = [{ x: -55.6, z: -22.5 }, { x: -47.6, z: -24.5 }, { x: -48.6, z: -15.4 }, { x: -59.3, z: -27.4 }];
export const homeQueueSlot = (i: number) => ({ x: -51, z: -30.0 + i * 0.9 });
export function startHomeShopping(state: GameState, p: Person) {
  const a = HOME_BROWSE[randInt(state, 0, HOME_BROWSE.length - 1)];
  const b = HOME_BROWSE[randInt(state, 0, HOME_BROWSE.length - 1)];
  setGoal(state, p, 'shop', [
    { kind: 'move', to: { x: -51, z: -13.6 }, label: 'Harbour Home' },
    { kind: 'move', to: a, label: 'browse' }, { kind: 'wait', until: state.minute + 6 + randInt(state, 0, 6) },
    { kind: 'move', to: b, label: 'browse' }, { kind: 'wait', until: state.minute + 14 + randInt(state, 0, 8) },
    { kind: 'call', fn: 'homeQueue' },
  ]);
  p.npc!.shopId = 'homestore';
}

function startWork(state: GameState, p: Person) {
  const c = state.contracts[p.contractId!];
  const pos = positionOf(state, c);
  const wp = workplaceOf(c.businessId, c.positionId);
  if (p.action) cancelAction(state, p);
  p.sleeping = false;
  if (pos?.uniform) p.appearance.outfit = pos.uniform;
  const plan: PlanStep[] = [{ kind: 'move', to: wp.pos, label: 'work' }];
  if (wp.mode === 'shop') plan.push({ kind: 'act', it: SHOPS[c.businessId].terminal, type: 'clock_in' });
  else if (wp.mode === 'warehouse') plan.push({ kind: 'act', it: 'wh_terminal', type: 'clock_in' });
  else if (wp.mode === 'site') plan.push({ kind: 'call', fn: 'arriveWork' });
  else plan.push({ kind: 'call', fn: 'arriveWork' });
  setGoal(state, p, 'go_work', plan);
}

// ------------------------------------------------------------ plan calls
function runCall(state: GameState, p: Person, fn: string) {
  const n = p.npc!;
  switch (fn) {
    case 'goHomeNow':
      p.jogging = 0;
      n.plan = [{ kind: 'move', to: homeDoor(p.homeId), label: 'home' }, { kind: 'call', fn: 'arriveHome' }];
      n.goal = 'go_home';
      break;
    case 'arriveHome':
      if (p.bagId && p.pantryId) moveAll(state, p.bagId, p.pantryId);
      p.appearance.outfit = n.homeOutfit;
      hide(p, p.homeId ?? 'offsite');
      n.goal = 'idle_home';
      n.nextDecision = state.minute;
      break;
    case 'arriveWork': {
      const c = state.contracts[p.contractId!];
      const wp = workplaceOf(c.businessId, c.positionId);
      if (!openAttendance(state, p.id)) clockIn(state, p.id);
      if (wp.mode === 'hidden') hide(p, c.businessId === 'wholesale' ? 'wholesale' : 'offsite');
      p.facing = wp.facing;
      n.goal = 'work';
      n.step = 'post';
      break;
    }
    case 'leaveWork': {
      if (openAttendance(state, p.id)) clockOut(state, p.id);
      setGoal(state, p, 'go_home', [{ kind: 'move', to: homeDoor(p.homeId), label: 'home' }, { kind: 'call', fn: 'arriveHome' }]);
      break;
    }
    case 'checkout': {
      const shopId = n.shopId ?? 'market';
      const S = SHOPS[shopId];
      const b = state.businesses[shopId];
      if (total(state.containers[p.basketId]) === 0) { leaveShop(state, p); break; }
      const staffed = staffOnDuty(state, shopId).length > 0 && b.equipment.till !== false;
      if (staffed) {
        const i = joinQueue(state, S.till, p.id);
        n.step = 'queue';
        n.queueSlot = i;
        n.patienceUntil = state.minute + 8 + Math.round(p.traits.patience * 14);
        n.queuedAt = state.minute;
        goTo(state, p, queueSlot(shopId, i), 'queue');
      } else if (S.kiosk) {
        const k = getWorld().interactables[S.kiosk];
        n.plan = [{ kind: 'move', to: k.pos, label: 'kiosk' }, { kind: 'act', it: S.kiosk, type: 'self_checkout' }, { kind: 'call', fn: 'leaveShop' }];
      } else {
        // nobody to take the money: put everything back and leave unhappy
        npcLog(state, p, 'nobody at the till');
        const units = total(state.containers[p.basketId]);
        moveAll(state, p.basketId, S.backroom);
        const st = statsFor(state, b);
        st.lostSales += units;
        st.walkouts++;
        leaveShop(state, p);
      }
      break;
    }
    case 'leaveShop':
      leaveShop(state, p);
      break;
    case 'dropBricks':
      moveAll(state, p.handsId, 'site_bricks');
      break;
    case 'cafeQueue': {
      const b = state.businesses.cafe;
      if (!b || !isOpen(b, state.minute)) { leaveShop(state, p); break; }
      const q = (b.queue ??= []);
      if (!q.includes(p.id)) q.push(p.id);
      n.step = 'cafe_wait';
      n.queuedAt = state.minute;
      n.patienceUntil = state.minute + CAFE_PATIENCE + Math.round(p.traits.patience * 8);
      n.queueSlot = q.indexOf(p.id);
      goTo(state, p, cafeQueueSlot(n.queueSlot), 'counter');
      break;
    }
    case 'homeQueue': {
      const b = state.businesses.homestore;
      if (!b || !isOpen(b, state.minute)) { leaveShop(state, p); break; }
      const q = (b.queue ??= []);
      if (!q.includes(p.id)) q.push(p.id);
      n.step = 'home_wait';
      n.queuedAt = state.minute;
      n.patienceUntil = state.minute + 12 + Math.round(p.traits.patience * 16);
      n.queueSlot = q.indexOf(p.id);
      goTo(state, p, homeQueueSlot(n.queueSlot), 'counter');
      break;
    }
    case 'despawn':
      // ambient shoppers take their goods home to the wider district (consumption)
      for (const [k, v] of Object.entries({ ...state.containers[p.bagId].items })) removeItems(state.containers[p.bagId], k, v);
      hide(p, 'offsite');
      n.goal = 'offsite';
      n.plan = [];
      break;
  }
}

function leaveShop(state: GameState, p: Person) {
  const n = p.npc!;
  n.step = 'run';
  if (n.ambient) {
    const sp = getWorld().nodes[pick(state, getWorld().spawnPoints)];
    n.plan = [{ kind: 'move', to: { x: sp.x, z: sp.z }, label: 'leave' }, { kind: 'call', fn: 'despawn' }];
  } else {
    n.plan = [{ kind: 'move', to: homeDoor(p.homeId), label: 'home' }, { kind: 'call', fn: 'arriveHome' }];
    n.goal = 'go_home';
  }
}

// ------------------------------------------------------------ work loop
function claimable(t: Task, p: Person) {
  return t.status === 'open' || (t.status === 'claimed' && t.claimedBy === p.id);
}

function claim(state: GameState, p: Person, t: Task) {
  releaseClaim(state, p);
  t.status = 'claimed';
  t.claimedBy = p.id;
  p.npc!.claim = t.id;
}

function workChoose(state: GameState, p: Person) {
  const n = p.npc!;
  const c = state.contracts[p.contractId!];
  const att = openAttendance(state, p.id);
  if (!att) { n.goal = 'idle_home'; n.nextDecision = state.minute; return; }
  const w = getWorld();
  const I = w.interactables;
  const hands = state.containers[p.handsId];
  const wp = workplaceOf(c.businessId, c.positionId);
  const bid = c.businessId;
  const S = SHOPS[bid];
  const b = state.businesses[bid];
  const palletOf = (item: string) => { const sh = shelfFor(state, bid, item); return sh ? S.pallets[sh] : null; };
  // end of shift
  if (wp.mode === 'warehouse') { warehouseWork(state, p, state.minute >= att.scheduledEnd); return; }
  if (wp.mode === 'site') { siteWork(state, p, state.minute >= att.scheduledEnd); return; }
  if (state.minute >= att.scheduledEnd) {
    if (wp.mode !== 'shop') {
      if (p.where === 'vehicle') return; // driver still out on the road
      runCall(state, p, 'leaveWork');
      return;
    }
    const plan: PlanStep[] = [];
    if (total(hands) > 0) {
      const item = Object.keys(hands.items)[0];
      const pal = palletOf(item);
      if (pal) plan.push({ kind: 'move', to: I[pal].pos, label: 'store room' }, { kind: 'act', it: pal, type: 'return_case' });
    }
    if (p.equipment === 'mop') plan.push({ kind: 'move', to: I[S.cupboard].pos, label: 'cupboard' }, { kind: 'act', it: S.cupboard, type: 'return_mop' });
    if (p.equipment === 'rubbish' && S.dumpster) plan.push({ kind: 'move', to: I[S.dumpster].pos, label: 'dumpster' }, { kind: 'act', it: S.dumpster, type: 'dump_rubbish' });
    plan.push({ kind: 'move', to: I[S.terminal].pos, label: 'terminal' }, { kind: 'act', it: S.terminal, type: 'clock_out' }, { kind: 'call', fn: 'leaveWork' });
    releaseClaim(state, p);
    n.plan = plan;
    n.step = 'finishing';
    return;
  }
  if (wp.mode !== 'shop') {
    // posts and hidden workplaces: stay put
    if (wp.mode === 'post' && dist(p.pos, wp.pos) > 0.5) n.plan = [{ kind: 'move', to: wp.pos, label: 'post' }];
    else p.facing = wp.facing;
    return;
  }
  if (hostInterview(state, p)) return;
  const tasks = openTasks(state, bid);
  const till = state.tills[S.till];
  const cupboardPlan = (type: 'take_mop' | 'return_mop'): PlanStep[] => [{ kind: 'move', to: I[S.cupboard].pos, label: 'cupboard' }, { kind: 'act', it: S.cupboard, type }];
  // carrying something: finish that first
  if (p.equipment === 'rubbish' && S.dumpster) { n.plan = [{ kind: 'move', to: I[S.dumpster].pos, label: 'dumpster' }, { kind: 'act', it: S.dumpster, type: 'dump_rubbish' }]; return; }
  if (total(hands) > 0) {
    const item = Object.keys(hands.items)[0];
    const sh = shelfFor(state, bid, item);
    const pal = palletOf(item);
    if (sh && count(state.containers[sh], item) < state.containers[sh].capacity) n.plan = [{ kind: 'move', to: I[sh].pos, label: 'shelf' }, { kind: 'act', it: sh, type: 'stock_shelf' }];
    else if (pal) n.plan = [{ kind: 'move', to: I[pal].pos, label: 'store room' }, { kind: 'act', it: pal, type: 'return_case' }];
    return;
  }
  // each role has its own priorities; anyone helps out when their speciality has nothing to do
  const role = positionOf(state, c)?.role ?? 'general';
  const onDuty = staffOnDuty(state, bid).filter((o) => o.id !== p.id);
  const rolesOnDuty = new Set(onDuty.map((o) => (o.contractId ? positionOf(state, state.contracts[o.contractId])?.role : null) ?? (state.businesses[bid].ownerId === o.id ? 'manager' : 'general')));
  const queueLen = till?.queue.length ?? 0;
  const back = state.containers[S.backroom];
  const restockPlan = (_item: string, sh: string): PlanStep[] => {
    const pal = S.pallets[sh];
    return [
      { kind: 'move', to: I[pal].pos, label: 'store room' },
      { kind: 'act', it: pal, type: 'take_case' },
      { kind: 'move', to: I[sh].pos, label: 'shelf' },
      { kind: 'act', it: sh, type: 'stock_shelf' },
    ];
  };
  const tryServe = (): boolean => {
    const serve = tasks.find((t) => t.kind === 'serve' && claimable(t, p));
    const someoneAtTill = till?.staffId && till.staffId !== p.id;
    const colleagueServing = tasks.some((t) => t.kind === 'serve' && t.status === 'claimed' && t.claimedBy !== p.id);
    if (!(till && serve && !someoneAtTill && !colleagueServing && b.equipment.till !== false)) return false;
    claim(state, p, serve);
    const head = state.people[till.queue[0]];
    if (head && dist(head.pos, queueSlot(bid, 0)) < 1.2) n.plan = [{ kind: 'move', to: I[S.till].pos, label: 'till' }, { kind: 'act', it: S.till, type: 'serve_customer' }];
    else n.plan = [{ kind: 'move', to: I[S.till].pos, label: 'till' }, { kind: 'wait', until: state.minute + 1 }];
    return true;
  };
  const tryReceive = (): boolean => {
    const recv = tasks.find((t) => t.kind === 'receive' && claimable(t, p));
    if (!recv || p.equipment) return false;
    claim(state, p, recv);
    n.plan = [{ kind: 'move', to: I[S.bay].pos, label: 'loading bay' }, { kind: 'act', it: S.bay, type: 'check_in_delivery' }];
    return true;
  };
  const tryClean = (): boolean => {
    const clean = tasks.find((t) => t.kind === 'clean' && claimable(t, p));
    if (!clean) return false;
    claim(state, p, clean);
    const spot = state.dirt[clean.target];
    const plan: PlanStep[] = [];
    if (p.equipment !== 'mop') plan.push(...cupboardPlan('take_mop'));
    plan.push({ kind: 'move', to: { x: spot.pos.x - 0.9, z: spot.pos.z }, label: 'spill' }, { kind: 'act', it: spot.id, type: 'clean' });
    n.plan = plan;
    return true;
  };
  const tryRestock = (): boolean => {
    if (p.equipment === 'mop') return false;
    const restock = tasks.filter((t) => t.kind === 'restock' && claimable(t, p)).sort((a, b2) => count(state.containers[a.target], a.product!) - count(state.containers[b2.target], b2.product!))[0];
    if (!restock || count(back, restock.product!) <= 0) return false;
    claim(state, p, restock);
    n.plan = restockPlan(restock.product!, restock.target);
    return true;
  };
  const tryTopUp = (fill: number): boolean => {
    if (p.equipment === 'mop' || queueLen) return false;
    const claimed = new Set(tasks.filter((t) => t.status === 'claimed').map((t) => t.product));
    const low = Object.entries(b.sections)
      .filter(([sh, k]) => !claimed.has(k) && count(state.containers[sh], k) < state.containers[sh].capacity * fill && count(back, k) > 0)
      .sort((x, y) => count(state.containers[x[0]], x[1]) - count(state.containers[y[0]], y[1]))[0];
    if (!low) return false;
    n.plan = restockPlan(low[1], low[0]);
    return true;
  };
  // chores; the mop goes back first so both hands are free
  const freeHands = (): PlanStep[] => (p.equipment === 'mop' ? cupboardPlan('return_mop') : []);
  const tryFace = (): boolean => {
    if (queueLen && role !== 'cleaner') return false;
    const face = tasks.filter((t) => t.kind === 'face' && claimable(t, p)).sort((x, y) => (b.messy?.[y.target] ?? 0) - (b.messy?.[x.target] ?? 0))[0];
    if (!face || !I[face.target]) return false;
    claim(state, p, face);
    n.plan = [...freeHands(), { kind: 'move', to: I[face.target].pos, label: 'shelf' }, { kind: 'act', it: face.target, type: 'face_shelf' }];
    return true;
  };
  const tryCardboard = (): boolean => {
    const t = tasks.find((x) => x.kind === 'cardboard' && claimable(x, p));
    if (!t || !S.baler) return false;
    claim(state, p, t);
    n.plan = [...freeHands(), { kind: 'move', to: I[S.baler].pos, label: 'baler' }, { kind: 'act', it: S.baler, type: 'bale_cardboard' }];
    return true;
  };
  const tryRubbish = (): boolean => {
    const t = tasks.find((x) => x.kind === 'rubbish' && claimable(x, p));
    if (!t || !S.bin || !S.dumpster || !(b.binFill ?? 0)) return false;
    claim(state, p, t);
    n.plan = [...freeHands(), { kind: 'move', to: I[S.bin].pos, label: 'bin' }, { kind: 'act', it: S.bin, type: 'empty_bin' }, { kind: 'move', to: I[S.dumpster].pos, label: 'dumpster' }, { kind: 'act', it: S.dumpster, type: 'dump_rubbish' }];
    return true;
  };
  const noCashier = !rolesOnDuty.has('cashier') && !rolesOnDuty.has('general');
  const desperate = queueLen >= 3 && !(till?.staffId && till.staffId !== p.id);
  const order: (() => boolean)[] = {
    cashier: [tryServe, () => tryTopUp(0.75), tryRestock, () => !rolesOnDuty.has('cleaner') && tryClean(), () => !rolesOnDuty.has('stocker') && tryReceive(), tryFace, () => !rolesOnDuty.has('cleaner') && tryRubbish()],
    stocker: [tryReceive, tryRestock, () => tryTopUp(0.9), tryCardboard, () => !rolesOnDuty.has('cleaner') && tryClean(), () => (desperate || noCashier && queueLen > 0) && tryServe(), tryFace],
    cleaner: [tryClean, tryRubbish, () => (desperate || (noCashier && !rolesOnDuty.has('manager') && queueLen > 0)) && tryServe(), tryFace, () => !rolesOnDuty.has('stocker') && tryCardboard(), () => !rolesOnDuty.has('stocker') && tryRestock()],
    manager: [() => (queueLen >= 2 || noCashier) && tryServe(), tryReceive, () => !rolesOnDuty.has('stocker') && tryRestock(), () => onDuty.length === 0 && tryClean(), () => onDuty.length === 0 && tryTopUp(0.6), () => !rolesOnDuty.has('stocker') && tryCardboard(), () => onDuty.length === 0 && tryRubbish()],
    general: [tryServe, tryReceive, tryClean, tryRestock, () => tryTopUp(0.75), tryRubbish, tryCardboard, tryFace],
  }[role];
  for (const f of order) if (f()) return;
  if (p.equipment === 'mop' && role !== 'cleaner') { n.plan = cupboardPlan('return_mop'); return; }
  if (role === 'cleaner') {
    // floor rounds: walk the aisles with the mop, checking for spills
    if (p.equipment !== 'mop') { n.plan = cupboardPlan('take_mop'); return; }
    const spots = S.dirtSpots;
    const next = spots[Math.floor(state.minute / 3) % spots.length];
    n.plan = [{ kind: 'move', to: { x: next.x - 0.9, z: next.z }, label: 'floor round' }, { kind: 'wait', until: state.minute + 2 }];
    return;
  }
  if (role === 'stocker') {
    // nothing to bring out: wait in the store room by the pallets
    const pal = Object.values(S.pallets)[0];
    const spot = I[pal].pos;
    if (dist(p.pos, spot) > 0.6) n.plan = [{ kind: 'move', to: spot, label: 'store room' }];
    else n.plan = [{ kind: 'wait', until: state.minute + 1 }];
    return;
  }
  // 6. stand by the till / shop floor
  const colleagues = staffOnDuty(state, bid).filter((o) => o.id !== p.id && !o.isPlayer);
  const spot = colleagues.some((o) => dist(o.pos, S.standby[0]) < 1) ? S.standby[1] : S.standby[0];
  if (dist(p.pos, spot) > 0.4) n.plan = [{ kind: 'move', to: spot, label: 'shop floor' }];
  else { p.facing = I[S.till].facing; n.plan = [{ kind: 'wait', until: state.minute + 1 }]; }
}

/** Site labourer: fetch the right tool (or a load of bricks) and work the current stage of the build */
function siteWork(state: GameState, p: Person, ending: boolean) {
  const n = p.npc!;
  const I = getWorld().interactables;
  const plot = currentPlot(state);
  const st = currentStage(state);
  const hands = state.containers[p.handsId];
  const pl = plot ?? PLOTS[0];
  const cabin = `${pl.id}_cabin`, pallet = `${pl.id}_pallet`, work = `${pl.id}_work`;
  if (ending || !plot || !st) {
    const plan: PlanStep[] = [];
    if (p.equipment?.startsWith('tool_')) plan.push({ kind: 'move', to: I[cabin].pos, label: 'cabin' }, { kind: 'act', it: cabin, type: 'return_tool' });
    if (count(hands, 'bricks')) plan.push({ kind: 'move', to: I[pallet].pos, label: 'pallet' }, { kind: 'call', fn: 'dropBricks' });
    if (ending) { plan.push({ kind: 'call', fn: 'leaveWork' }); n.step = 'finishing'; }
    else if (!plan.length) plan.push({ kind: 'move', to: I[cabin].pos, label: 'cabin' }, { kind: 'wait', until: state.minute + 10 });
    n.plan = plan;
    return;
  }
  const tool = st.tool ? `tool_${st.tool}` : null;
  if (st.id === 'walls') {
    if (p.equipment) { n.plan = [{ kind: 'move', to: I[cabin].pos, label: 'cabin' }, { kind: 'act', it: cabin, type: 'return_tool' }]; return; }
    n.plan = count(hands, 'bricks') > 0
      ? [{ kind: 'move', to: I[work].pos, label: 'wall' }, { kind: 'act', it: work, type: 'site_work' }]
      : [{ kind: 'move', to: I[pallet].pos, label: 'pallet' }, { kind: 'act', it: pallet, type: 'take_bricks' }];
    return;
  }
  if (count(hands, 'bricks')) { n.plan = [{ kind: 'move', to: I[pallet].pos, label: 'pallet' }, { kind: 'call', fn: 'dropBricks' }]; return; }
  if (p.equipment !== tool) {
    n.plan = p.equipment ? [{ kind: 'move', to: I[cabin].pos, label: 'cabin' }, { kind: 'act', it: cabin, type: 'return_tool' }]
      : [{ kind: 'move', to: I[cabin].pos, label: 'cabin' }, { kind: 'act', it: cabin, type: 'take_tool', arg: tool! }];
    return;
  }
  n.plan = [{ kind: 'move', to: I[work].pos, label: 'house' }, { kind: 'act', it: work, type: 'site_work' }];
}

/** Warehouse operative: take the oldest pick line, pick it from the racking, bring it to the staging lanes */
function warehouseWork(state: GameState, p: Person, ending: boolean) {
  const n = p.npc!;
  const I = getWorld().interactables;
  const hands = state.containers[p.handsId];
  const bid = 'wholesale';
  const item = Object.keys(hands.items)[0];
  if (ending) {
    const plan: PlanStep[] = [];
    if (item) plan.push({ kind: 'move', to: I[`wh_rack_${item}`].pos, label: 'racking' }, { kind: 'act', it: `wh_rack_${item}`, type: 'return_case' });
    plan.push({ kind: 'move', to: I.wh_terminal.pos, label: 'terminal' }, { kind: 'act', it: 'wh_terminal', type: 'clock_out' }, { kind: 'call', fn: 'leaveWork' });
    releaseClaim(state, p);
    n.plan = plan;
    n.step = 'finishing';
    return;
  }
  if (item) {
    const needed = pickQueue(state, bid).some((s) => pickNeed(s, item) > 0);
    n.plan = needed
      ? [{ kind: 'move', to: I.wh_stage.pos, label: 'staging' }, { kind: 'act', it: 'wh_stage', type: 'stage_case' }]
      : [{ kind: 'move', to: I[`wh_rack_${item}`].pos, label: 'racking' }, { kind: 'act', it: `wh_rack_${item}`, type: 'return_case' }];
    return;
  }
  const tasks = openTasks(state, bid).filter((t) => t.kind === 'pick' && claimable(t, p) && I[`wh_rack_${t.product}`] && count(state.containers.wholesale_stock, t.product!) > 0);
  const order = new Map(pickQueue(state, bid).map((s, i) => [s.id, i]));
  const t = tasks.sort((a, b) => (order.get(a.target.split('|')[0]) ?? 99) - (order.get(b.target.split('|')[0]) ?? 99))[0];
  if (t) {
    claim(state, p, t);
    const rack = `wh_rack_${t.product}`;
    n.plan = [{ kind: 'move', to: I[rack].pos, label: 'racking' }, { kind: 'act', it: rack, type: 'pick_case' }, { kind: 'move', to: I.wh_stage.pos, label: 'staging' }, { kind: 'act', it: 'wh_stage', type: 'stage_case' }];
    return;
  }
  releaseClaim(state, p);
  // nothing to pick: wait by the staging lanes
  const spot = { x: -48 + (p.id.length % 3), z: 18.6 };
  if (dist(p.pos, spot) > 0.6) n.plan = [{ kind: 'move', to: spot, label: 'staging' }];
  else n.plan = [{ kind: 'wait', until: state.minute + 2 }];
}

/** waiting for a meal at the cafe counter */
function cafeWaitTick(state: GameState, p: Person) {
  const n = p.npc!;
  const b = state.businesses.cafe;
  if (n.step === 'paid' || !b) { leaveShop(state, p); return; }
  const i = (b.queue ?? []).indexOf(p.id);
  if (i < 0 || state.minute > (n.patienceUntil ?? Infinity)) {
    b.queue = (b.queue ?? []).filter((id) => id !== p.id);
    if (i >= 0) { statsFor(state, b).walkouts++; const pl = state.people[state.playerId]; const a = openAttendance(state, pl.id); if (a && state.contracts[a.contractId]?.businessId === 'cafe') a.waitPenalty += 6; }
    leaveShop(state, p);
    return;
  }
  if (i !== n.queueSlot && !p.move) { n.queueSlot = i; goTo(state, p, cafeQueueSlot(i), 'counter'); }
  if (!p.move) p.facing = 0;
}

/** waiting at the Harbour Home counter: shuffle up the queue, give up when patience runs out */
function homeWaitTick(state: GameState, p: Person) {
  const n = p.npc!;
  const b = state.businesses.homestore;
  if (n.step === 'paid' || !b) { leaveShop(state, p); return; }
  const i = (b.queue ?? []).indexOf(p.id);
  if (i < 0 || state.minute > (n.patienceUntil ?? Infinity)) {
    b.queue = (b.queue ?? []).filter((id) => id !== p.id);
    if (i >= 0) statsFor(state, b).walkouts++;
    n.step = 'run';
    leaveShop(state, p);
    return;
  }
  if (i !== n.queueSlot && !p.move) { n.queueSlot = i; goTo(state, p, homeQueueSlot(i), 'counter'); }
  if (!p.move) p.facing = Math.PI;
}

// ------------------------------------------------------------ shopper queue
function queueTick(state: GameState, p: Person) {
  const n = p.npc!;
  const shopId = n.shopId ?? 'market';
  const S = SHOPS[shopId];
  const till = state.tills[S.till];
  const i = till.queue.indexOf(p.id);
  if (n.step === 'paid' || i < 0) {
    if (n.step === 'paid' || total(state.containers[p.basketId]) === 0) leaveShop(state, p);
    return;
  }
  if (i !== n.queueSlot && !p.move) { n.queueSlot = i; goTo(state, p, queueSlot(shopId, i), 'queue'); }
  if (!p.move && dist(p.pos, queueSlot(shopId, i)) < 0.4) {
    const obj = getWorld().interactables[S.till].obj;
    const slot = queueSlot(shopId, i);
    p.facing = i === 0 ? Math.atan2(obj.x - slot.x, obj.z - slot.z) : Math.atan2(queueSlot(shopId, i - 1).x - slot.x, queueSlot(shopId, i - 1).z - slot.z);
  }
  // patience: being served (or about to be) resets the clock
  const beingServed = i === 0 && till.staffId !== null;
  if (beingServed) n.patienceUntil = Math.max(n.patienceUntil ?? 0, state.minute + 3);
  if (staffOnDuty(state, shopId).length === 0) {
    leaveQueue(state, S.till, p.id);
    n.step = 'run';
    if (S.kiosk) {
      // staff left: use the self-checkout instead of waiting forever
      const k = getWorld().interactables[S.kiosk];
      n.plan = [{ kind: 'move', to: k.pos, label: 'kiosk' }, { kind: 'act', it: S.kiosk, type: 'self_checkout' }, { kind: 'call', fn: 'leaveShop' }];
    } else {
      n.plan = [{ kind: 'call', fn: 'checkout' }];
    }
    return;
  }
  if (state.minute > (n.patienceUntil ?? Infinity)) {
    npcLog(state, p, 'gave up waiting');
    walkout(state, shopId, S.till, p.id);
    leaveShop(state, p);
  }
}

function shouldPreemptForTill(state: GameState, p: Person): boolean {
  const n = p.npc!;
  if (n.goal !== 'work' || p.action || !p.contractId || hostingInterview(state, p.id)) return false;
  const c = state.contracts[p.contractId];
  const S = SHOPS[c.businessId];
  if (!S || !openAttendance(state, p.id)) return false;
  if (total(state.containers[p.handsId]) > 0) return false;
  const till = state.tills[S.till];
  if (!till || !till.queue.length || till.staffId) return false;
  const head = state.people[till.queue[0]];
  if (state.minute - (head.npc?.queuedAt ?? state.minute) < 3) return false;
  const claimedServe = Object.values(state.tasks).some((t) => t.businessId === c.businessId && t.kind === 'serve' && t.status === 'claimed');
  if (claimedServe) return false;
  if (n.claim && state.tasks[n.claim]?.kind === 'serve') return false;
  return n.plan.length > 0 || !!p.move;
}

// ------------------------------------------------------------ main tick
export function npcTick(state: GameState) {
  sitePlot = state.build?.plot ?? 0;
  for (const p of Object.values(state.people)) {
    if (p.isPlayer || !p.npc || p.dead || p.left || p.away || p.down != null || p.police || p.combat || p.following) continue;
    if (p.fleeing && p.move) continue;
    if (state.doorCall?.answerer === p.id && state.doorCall.stage !== 'done') continue;
    // on the way to, or at, a wedding, funeral or party: the plan is set by the event
    const gid = (p.npc as any).gathering;
    if (gid && state.gatherings?.some((g) => g.id === gid && !g.done)) { runPlan(state, p); continue; }
    const n = p.npc;
    if (state.meetups?.length && !n.ambient) goToMeetup(state, p);
    if (state.minute >= n.nextDecision && !p.action) decide(state, p);
    if (n.step === 'home_wait' || (n.step === 'paid' && n.shopId === 'homestore')) { homeWaitTick(state, p); continue; }
    if (n.step === 'cafe_wait' || (n.step === 'paid' && n.shopId === 'cafe')) { cafeWaitTick(state, p); continue; }
    if (n.step === 'queue' || n.step === 'paid') { queueTick(state, p); continue; }
    if (shouldPreemptForTill(state, p)) { releaseClaim(state, p); n.plan = []; p.move = null; npcLog(state, p, 'customer waiting - going to till'); }
    runPlan(state, p);
  }
}

export function runPlan(state: GameState, p: Person) {
  const n = p.npc!;
  let guard = 0;
  while (guard++ < 6) {
    if (p.action || p.move) return;
    const s = n.plan[0];
    if (!s) {
      if (n.goal === 'work' || n.goal === 'go_work') {
        if (openAttendance(state, p.id)) { n.goal = 'work'; workChoose(state, p); if (!n.plan.length) return; continue; }
        n.goal = 'idle_home';
      }
      if (n.claim) releaseClaim(state, p);
      return;
    }
    if (s.kind === 'move') {
      n.plan.shift();
      if (dist(p.pos, s.to) < 0.3) continue;
      if (!goTo(state, p, s.to, s.label)) { n.plan = []; n.nextDecision = state.minute + 5; return; }
      return;
    }
    if (s.kind === 'wait') {
      if (state.minute < s.until) return;
      n.plan.shift();
      continue;
    }
    if (s.kind === 'call') {
      n.plan.shift();
      runCall(state, p, s.fn);
      if (n.step === 'queue') return;
      continue;
    }
    // act
    n.plan.shift();
    const it = interactable(state, s.it);
    if (!it) { npcLog(state, p, `target ${s.it} gone`); n.plan = []; continue; }
    const r = startAction(state, p.id, s.it, s.type, s.arg);
    if (!r.ok) {
      npcLog(state, p, `${s.type} failed: ${r.msg}`);
      if (s.type === 'pick_item' && it.product) {
        // empty shelf: an unmet sale the business can see in its reports
        statsFor(state, state.businesses[n.shopId ?? 'market']).lostSales += Number(s.arg ?? 1);
        continue;
      }
      if (n.goal === 'work') { releaseClaim(state, p); n.plan = []; continue; }
      if (n.goal === 'shop') { leaveShop(state, p); return; }
      n.plan = [];
      n.nextDecision = state.minute + 2;
      return;
    }
    return;
  }
}

/** keep an NPC from sitting on the bench forever once its wait step passes */
export function npcPostAction(state: GameState, p: Person) {
  const n = p.npc;
  if (!n || !p.action) return;
  if (p.action.type === 'sit' && p.action.target !== 'iv_host') {
    const next = n.plan[0];
    if (next?.kind === 'wait' && state.minute >= next.until) cancelAction(state, p);
    if (!next) cancelAction(state, p);
  }
}

export { dayIndex, isOnShift };

/** unemployed NPCs look for work once a day, using the same vacancies as the player */
export function npcJobSearch(state: GameState) {
  for (const p of Object.values(state.people)) {
    if (p.isPlayer || !p.npc || p.npc.ambient || p.npc.retired || (p.npc.searchFrom ?? 0) > state.minute) continue;
    // reply to offers first
    for (const a of Object.values(state.applications)) {
      if (a.personId === p.id && a.status === 'offered') acceptOfferNpc(state, a.id);
    }
    if (p.contractId) continue;
    const options = Object.values(state.vacancies)
      .filter((v) => v.status === 'open' && !canApplyNpc(state, p.id, v.id))
      .map((v) => {
        const pos = state.businesses[v.businessId].positions.find((x) => x.id === v.positionId)!;
        const match = Object.keys(pos.requires).length ? 1 : 0;
        const skillFit = (p.skills.warehouse ?? 0) > 100 && v.businessId === 'wholesale' ? 400 : 0;
        return { v, score: pos.wage + skillFit + match };
      })
      .sort((a, b) => b.score - a.score);
    if (options[0] && rand(state) < 0.4 + p.traits.ambition * 0.6) {
      applyForJobNpc(state, p.id, options[0].v.id, [randInt(state, 0, 2), randInt(state, 0, 2), randInt(state, 0, 2)]);
      npcLog(state, p, `applied for ${options[0].v.id}`);
    }
  }
}
