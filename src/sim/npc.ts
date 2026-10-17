// NPCSimulation: persistent people with schedules, needs, jobs and shopping.
// Decision layer: a priority/utility choice of goal every few minutes.
// Execution layer: a plan of move/act/wait steps using the same validated
// actions as the player. Arrival is verified by distance, never by a timer.
import type { GameState, Id, NpcGoal, Person, PlanStep, Task, Vec2 } from './types';
import { dayIndex, minuteOfDay } from './clock';
import { clamp, dist, pick, rand, randInt } from './core';
import { count, moveAll, removeItems, total } from './inventory';
import { ITEMS, PRODUCTS, isFood } from './items';
import { acceptOffer as acceptOfferNpc, applyForJob as applyForJobNpc, canApply as canApplyNpc, clockIn, clockOut, currentShift, isOnShift, nextShift, openAttendance, positionOf, statsFor } from './employment';
import { cancelAction, interactable, startAction } from './actions';
import { isOpen, joinQueue, leaveQueue, openTasks, queueSlot, shelfFor, staffOnDuty, walkout, productsOf } from './retail';
import { getWorld, SHOPS } from './world/layout';
import { planRoute, routeLength } from './world/nav';
import { capability } from './needs';
import { npcLog } from './events';

export const WALK = 4.5; // metres per game minute (1.5 m/s real at the default 1/3 game-min per real second)

interface Workplace {
  mode: 'shop' | 'post' | 'hidden';
  pos: Vec2;
  facing: number;
}

export function workplaceOf(bid: Id): Workplace {
  const w = getWorld();
  const n = (id: string) => ({ x: w.nodes[id].x, z: w.nodes[id].z });
  switch (bid) {
    case 'market': case 'unit4': return { mode: 'shop', pos: w.interactables[SHOPS[bid].terminal].pos, facing: w.interactables[SHOPS[bid].terminal].facing };
    case 'cafe': return { mode: 'post', pos: { x: -24, z: 21.3 }, facing: Math.PI };
    case 'council': return { mode: 'post', pos: n('jc_desk_back'), facing: 0 };
    case 'wholesale': return { mode: 'hidden', pos: n('door_wholesale'), facing: 0 };
    default: return { mode: 'hidden', pos: n('bus_w'), facing: 0 };
  }
}

export function homeDoor(homeId: Id | null): Vec2 {
  const w = getWorld();
  const id = homeId === 'flat_upper' ? 'door_upper' : `door_${homeId}`;
  const n = w.nodes[id] ?? w.nodes.bus_e;
  return { x: n.x, z: n.z };
}

const atHome = (p: Person) => !!p.homeId && p.where === p.homeId && !p.visible;

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
  let step = WALK * capability(p).move * dt;
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
  const moved = WALK * capability(p).move * dt - step;
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

function decide(state: GameState, p: Person) {
  const n = p.npc!;
  const now = state.minute;
  const mod = minuteOfDay(now);
  n.nextDecision = now + 10;
  if (n.ambient) return; // ambient shoppers are driven by the demand model
  const c = p.contractId ? state.contracts[p.contractId] : null;
  // 1. work
  if (c) {
    const wp = workplaceOf(c.businessId);
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
  const freeFor = nextS ? nextS.start - now - travelMinutes(p, workplaceOf(c!.businessId).pos) - 20 : 9999;
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
  if (freeFor > 120 && p.needs.energy > 35 && mod > 9 * 60 && mod < 20 * 60 && rand(state) < 0.08 + p.traits.sociability * 0.15) {
    const cafe = state.businesses.cafe;
    const cafeOk = isOpen(cafe, now) && staffOnDuty(state, 'cafe').length > 0 && money > 2500 && p.needs.satiety < 60;
    if (cafeOk) {
      setGoal(state, p, 'leisure', [
        { kind: 'move', to: getWorld().interactables.cafe_counter.pos, label: 'cafe' },
        { kind: 'act', it: 'cafe_counter', type: 'buy_meal' },
        { kind: 'move', to: homeDoor(p.homeId), label: 'home' }, { kind: 'call', fn: 'arriveHome' },
      ]);
    } else {
      const bench = pick(state, ['bench_1', 'bench_2']);
      const busy = Object.values(state.people).some((o) => o.action?.target === bench);
      if (!busy) {
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

function startWork(state: GameState, p: Person) {
  const c = state.contracts[p.contractId!];
  const pos = positionOf(state, c);
  const wp = workplaceOf(c.businessId);
  if (p.action) cancelAction(state, p);
  p.sleeping = false;
  if (pos?.uniform) p.appearance.outfit = pos.uniform;
  const plan: PlanStep[] = [{ kind: 'move', to: wp.pos, label: 'work' }];
  if (wp.mode === 'shop') plan.push({ kind: 'act', it: SHOPS[c.businessId].terminal, type: 'clock_in' });
  else plan.push({ kind: 'call', fn: 'arriveWork' });
  setGoal(state, p, 'go_work', plan);
}

// ------------------------------------------------------------ plan calls
function runCall(state: GameState, p: Person, fn: string) {
  const n = p.npc!;
  switch (fn) {
    case 'arriveHome':
      if (p.bagId && p.pantryId) moveAll(state, p.bagId, p.pantryId);
      p.appearance.outfit = n.homeOutfit;
      hide(p, p.homeId ?? 'offsite');
      n.goal = 'idle_home';
      n.nextDecision = state.minute;
      break;
    case 'arriveWork': {
      const c = state.contracts[p.contractId!];
      const wp = workplaceOf(c.businessId);
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
  const wp = workplaceOf(c.businessId);
  const bid = c.businessId;
  const S = SHOPS[bid];
  const b = state.businesses[bid];
  const palletOf = (item: string) => { const sh = shelfFor(state, bid, item); return sh ? S.pallets[sh] : null; };
  // end of shift
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
  const tasks = openTasks(state, bid);
  const till = state.tills[S.till];
  const cupboardPlan = (type: 'take_mop' | 'return_mop'): PlanStep[] => [{ kind: 'move', to: I[S.cupboard].pos, label: 'cupboard' }, { kind: 'act', it: S.cupboard, type }];
  // carrying something: finish that first
  if (total(hands) > 0) {
    const item = Object.keys(hands.items)[0];
    const sh = shelfFor(state, bid, item);
    const pal = palletOf(item);
    if (sh && count(state.containers[sh], item) < state.containers[sh].capacity) n.plan = [{ kind: 'move', to: I[sh].pos, label: 'shelf' }, { kind: 'act', it: sh, type: 'stock_shelf' }];
    else if (pal) n.plan = [{ kind: 'move', to: I[pal].pos, label: 'store room' }, { kind: 'act', it: pal, type: 'return_case' }];
    return;
  }
  // 1. serve customers
  const serve = tasks.find((t) => t.kind === 'serve' && claimable(t, p));
  const someoneAtTill = till?.staffId && till.staffId !== p.id;
  const colleagueServing = tasks.some((t) => t.kind === 'serve' && t.status === 'claimed' && t.claimedBy !== p.id);
  if (till && serve && !someoneAtTill && !colleagueServing && b.equipment.till !== false) {
    claim(state, p, serve);
    const head = state.people[till.queue[0]];
    if (head && dist(head.pos, queueSlot(bid, 0)) < 1.2) n.plan = [{ kind: 'move', to: I[S.till].pos, label: 'till' }, { kind: 'act', it: S.till, type: 'serve_customer' }];
    else n.plan = [{ kind: 'move', to: I[S.till].pos, label: 'till' }, { kind: 'wait', until: state.minute + 1 }];
    return;
  }
  // 2. receive deliveries
  const recv = tasks.find((t) => t.kind === 'receive' && claimable(t, p));
  if (recv && !p.equipment) {
    claim(state, p, recv);
    n.plan = [{ kind: 'move', to: I[S.bay].pos, label: 'loading bay' }, { kind: 'act', it: S.bay, type: 'check_in_delivery' }];
    return;
  }
  // 3. cleaning
  const clean = tasks.find((t) => t.kind === 'clean' && claimable(t, p));
  if (clean) {
    claim(state, p, clean);
    const spot = state.dirt[clean.target];
    const plan: PlanStep[] = [];
    if (p.equipment !== 'mop') plan.push(...cupboardPlan('take_mop'));
    plan.push({ kind: 'move', to: { x: spot.pos.x - 0.9, z: spot.pos.z }, label: 'spill' }, { kind: 'act', it: spot.id, type: 'clean' });
    n.plan = plan;
    return;
  }
  if (p.equipment === 'mop') { n.plan = cupboardPlan('return_mop'); return; }
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
  // 4. restock the emptiest shelf
  const restock = tasks.filter((t) => t.kind === 'restock' && claimable(t, p)).sort((a, b2) => count(state.containers[a.target], a.product!) - count(state.containers[b2.target], b2.product!))[0];
  if (restock && count(back, restock.product!) > 0) {
    claim(state, p, restock);
    n.plan = restockPlan(restock.product!, restock.target);
    return;
  }
  // 5. nothing urgent: top up the emptiest shelf if the till is quiet
  if (!till?.queue.length) {
    const claimed = new Set(tasks.filter((t) => t.status === 'claimed').map((t) => t.product));
    const low = Object.entries(b.sections)
      .filter(([sh, k]) => !claimed.has(k) && count(state.containers[sh], k) < state.containers[sh].capacity * 0.75 && count(back, k) > 0)
      .sort((x, y) => count(state.containers[x[0]], x[1]) - count(state.containers[y[0]], y[1]))[0];
    if (low) { n.plan = restockPlan(low[1], low[0]); return; }
  }
  // 6. stand by the till / shop floor
  const colleagues = staffOnDuty(state, bid).filter((o) => o.id !== p.id && !o.isPlayer);
  const spot = colleagues.some((o) => dist(o.pos, S.standby[0]) < 1) ? S.standby[1] : S.standby[0];
  if (dist(p.pos, spot) > 0.4) n.plan = [{ kind: 'move', to: spot, label: 'shop floor' }];
  else { p.facing = I[S.till].facing; n.plan = [{ kind: 'wait', until: state.minute + 1 }]; }
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
  if (n.goal !== 'work' || p.action || !p.contractId) return false;
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
  for (const p of Object.values(state.people)) {
    if (p.isPlayer || !p.npc) continue;
    const n = p.npc;
    if (state.minute >= n.nextDecision && !p.action) decide(state, p);
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
  if (p.action.type === 'sit') {
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
