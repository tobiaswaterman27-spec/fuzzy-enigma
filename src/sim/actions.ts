// InteractionSystem + TaskAndJobSystem execution.
// Actions are timed, interruptible and validated. State changes happen in
// unit callbacks or on completion - never because an animation finished.
import { useEnergy } from './bills';
import { buyWeapon, WEAPONS } from './health';
import { breakIn, houseOf, houseOpen, knock, searchValuables } from './houses';
import { grabShoplifter } from './incidents';
import { buyLotto, LOTTO_PRICE, SCRATCH_PRICE, scratchcard } from './leisure';
import { BAIT_PRICE, buyTackle, cast, fishingBlocker, fishingTick, hasCatch, npcCatch, ROD_PRICE, sellCatch } from './fishing';

const PINT = 520;
import { canDriveForklift, mountForklift, palletsWaiting } from './forklift';
import { buyAtStall, marketOn, stallPrice } from './streetmarket';
import { COURSES, completeSession, sessionBlocker, sessionMinutes } from './training';
import { canDriveCar, enterCar } from './cars';
import type { ActionState, ActionType, GameState, Id, Person } from './types';
import { dist, fmtMoney, clamp } from './core';
import { count, firstItem, isEmpty, moveAll, moveItems, removeItems, spaceFor, total } from './inventory';
import { CLOTHING, ITEMS, isFood, itemName } from './items';
import { clockIn, clockOut, hostingInterview, interviewOpen, isOnShift, openAttendance } from './employment';
import { basketValue, BIN_CAPACITY, completeSale, completeTask, isOpen, isStaff, leaveQueue, priceOf, productAt, queueSlot, RESTOCK_DONE } from './retail';
import { checkInDeliveries, pickDemand, pickQueue, stageFromHands, STAGING } from './logistics';
import { hasHomeAccess } from './housing';
import { addXp, capability, skillLevel } from './needs';
import { getWorld, locationOf, SHOPS, type Interactable } from './world/layout';
import { clearLine } from './world/nav';
import { transfer } from './ledger';
import { news } from './events';
import { fmtClock, minuteOfDay } from './clock';
import { completeHomeOrder, storeStaffed } from './homestore';
import { FRIEND_AT, plannedMeetup, relationLabel } from './social';
import { cafeQueueSlot, serveMeal, takePortion } from './cafe';
import { addWork, bricksOnPallet, courses, currentPlot, currentStage, plotFinished, PLOTS, stageProgress } from './construction';
import { homeQueueSlot } from './npc';
import { choresOf, DISHES_BLOCK, homeMess, inWash, messLabel, wearOf, WASH_MINUTES } from './home';

export interface ActionOption {
  type: ActionType | 'ui';
  label: string;
  enabled: boolean;
  reason?: string;
  arg?: string;
  ui?: 'jobs' | 'advisor' | 'interview' | 'laptop' | 'homestore' | 'invite' | 'chat';
}

export function interactable(state: GameState, id: Id): Interactable | null {
  const w = getWorld();
  if (w.interactables[id]) return w.interactables[id];
  const d = state.dirt[id];
  if (d) return { id, kind: 'spill', label: 'Spill', pos: d.pos, facing: 0, obj: d.pos, locationId: d.locationId, businessId: d.locationId, range: 1.4 };
  if (id.startsWith('van:')) {
    const v = state.vehicles[id.slice(4)];
    if (v && (v.state === 'loaded' || v.state === 'parked')) {
      const front = { x: v.pos.x + Math.sin(v.heading + Math.PI / 2) * 1.6, z: v.pos.z + Math.cos(v.heading + Math.PI / 2) * 1.6 };
      return { id, kind: 'vehicle', label: v.name, pos: front, facing: v.heading - Math.PI / 2, obj: v.pos, locationId: 'outside', businessId: v.ownerId, range: 2.6 };
    }
  }
  if (id.startsWith('forklift:')) {
    const v = state.vehicles[id.slice(9)];
    if (v && v.state === 'parked') {
      const side = { x: v.pos.x + Math.sin(v.heading - Math.PI / 2) * 1.3, z: v.pos.z + Math.cos(v.heading - Math.PI / 2) * 1.3 };
      return { id, kind: 'vehicle', label: 'Forklift truck', pos: side, facing: v.heading + Math.PI / 2, obj: v.pos, locationId: 'wholesale', businessId: 'wholesale', range: 2.4 };
    }
  }
  if (id.startsWith('car:')) {
    const v = state.vehicles[id.slice(4)];
    if (v && v.state === 'parked') {
      const door = { x: v.pos.x + Math.sin(v.heading - Math.PI / 2) * 1.6, z: v.pos.z + Math.cos(v.heading - Math.PI / 2) * 1.6 };
      return { id, kind: 'vehicle', label: v.stolen ? `${v.name} (stolen)` : `Your ${v.name}`, pos: door, facing: v.heading + Math.PI / 2, obj: v.pos, locationId: locationOf(door), range: 2.6 };
    }
  }
  if (id.startsWith('person:')) {
    const o = state.people[id.slice(7)];
    if (o && o.visible) return { id, kind: 'person', label: o.name, pos: o.pos, facing: 0, obj: o.pos, locationId: locationOf(o.pos), range: 1.9 };
  }
  return null;
}

export function allInteractables(state: GameState): Interactable[] {
  const out = Object.values(getWorld().interactables);
  for (const d of Object.values(state.dirt)) out.push(interactable(state, d.id)!);
  for (const o of Object.values(state.people)) if (!o.isPlayer && o.visible && !o.sleeping) out.push(interactable(state, `person:${o.id}`)!);
  for (const v of Object.values(state.vehicles)) if (v.kind === 'van' && v.state === 'loaded') out.push(interactable(state, `van:${v.id}`)!);
  for (const v of Object.values(state.vehicles)) if (v.kind === 'car' && v.state === 'parked') out.push(interactable(state, `car:${v.id}`)!);
  for (const v of Object.values(state.vehicles)) if (v.kind === 'forklift' && v.state === 'parked') out.push(interactable(state, `forklift:${v.id}`)!);
  return out;
}

/** the interactable the actor is facing within range, preferring the closest / most frontal */
/** an actor can only use things in the same space (inside the same building, or both outside) with nothing solid in between */
export function canReach(actor: Person, it: Interactable): boolean {
  const here = locationOf(actor.pos);
  const there = locationOf(it.pos);
  if (here !== there) return false;
  return clearLine(actor.pos, it.pos, 0.05);
}

export function focusInteractable(state: GameState, actor: Person): Interactable | null {
  let best: Interactable | null = null;
  let bestScore = Infinity;
  for (const it of allInteractables(state)) {
    if (!canReach(actor, it)) continue;
    const dPos = dist(actor.pos, it.pos);
    const dObj = dist(actor.pos, it.obj);
    const d = Math.min(dPos, dObj);
    if (d > it.range + 0.6) continue;
    const ang = Math.atan2(it.obj.x - actor.pos.x, it.obj.z - actor.pos.z);
    let diff = Math.abs(((ang - actor.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (dObj < 0.9) diff = 0;
    let score = d + diff * 1.2;
    if (it.kind === 'person') {
      // people you are facing come first, unless your hands are busy with work;
      // someone you have an appointment with comes before anything else
      score += handsFree(state, actor) ? -0.4 : 1.5;
      const pid = it.id.slice(7);
      if (Object.values(state.applications).some((a) => a.personId === actor.id && a.status === 'interview' && a.interviewerId === pid)) score -= 3;
    }
    if (score < bestScore) { bestScore = score; best = it; }
  }
  return best;
}

const hands = (state: GameState, p: Person) => state.containers[p.handsId];
const handsFree = (state: GameState, p: Person) => isEmpty(hands(state, p)) && !p.equipment;
const speed = (p: Person, skill?: string) => {
  const lvl = skill ? skillLevel(p.skills[skill] ?? 0) : 0;
  return capability(p).act * (1 + Math.min(0.5, lvl * 0.06));
};

const opt = (type: ActionType, label: string, reason?: string, arg?: string): ActionOption => ({ type, label, enabled: !reason, reason, arg });

export function optionsFor(state: GameState, actorId: Id, itId: Id): ActionOption[] {
  const p = state.people[actorId];
  const it = interactable(state, itId);
  if (!it) return [];
  const out: ActionOption[] = [];
  const bid = it.businessId;
  const h = hands(state, p);
  const carrying = firstItem(h);
  const b = bid ? state.businesses[bid] ?? null : null;
  const onShift = bid ? isStaff(state, actorId, bid) : false;
  const product = productAt(state, it);
  const shopKinds = ['shelf', 'pallet', 'till', 'cupboard', 'spill', 'bay', 'terminal', 'baler', 'shopbin', 'dumpster'];
  if (bid && !b && shopKinds.includes(it.kind)) return [opt('stock_shelf', 'Vacant unit', 'Lease this unit and start a business from Phone > Business')];
  switch (it.kind) {
    case 'shelf': {
      if (!product) { out.push(opt('stock_shelf', 'Empty shelf section', b && b.ownerId === actorId ? 'Choose a product for it in Phone > Business' : 'Not in use')); break; }
      const shelf = state.containers[it.container!];
      const n = count(shelf, product);
      if (onShift || carrying === product) {
        if (carrying === product) out.push(opt('stock_shelf', `Stock shelf with ${itemName(product)} (${count(h, product)} in case)`, spaceFor(shelf, product) === 0 ? 'Shelf is full' : undefined));
        else if (onShift) out.push(opt('stock_shelf', `Restock ${itemName(product)} (${n}/${shelf.capacity})`, carrying ? `You are carrying ${itemName(carrying)}` : p.equipment ? 'Put the mop away first' : `Fetch a case of ${itemName(product)} from the store room`));
      }
      const mess = Math.round(b?.messy?.[it.id] ?? 0);
      if (onShift && !carrying && mess >= 8) out.push(opt('face_shelf', `Face up ${itemName(product)} (${mess >= 60 ? 'a mess' : mess >= 30 ? 'untidy' : 'a bit untidy'})`, p.equipment ? `Put the ${p.equipment === 'mop' ? 'mop' : 'bin bag'} down first` : undefined));
      if (b && !onShift) {
        const price = priceOf(b, product);
        out.push(opt('pick_item', `Take 1 ${itemName(product)} - ${fmtMoney(price)}`, n === 0 ? 'Out of stock' : !isOpen(b, state.minute) ? 'Shop is closed' : !handsFree(state, p) ? 'Your hands are full' : undefined));
      }
      break;
    }
    case 'pallet': {
      if (!product) { out.push(opt('take_case', 'Empty pallet', 'No product assigned to this section')); break; }
      const back = state.containers[it.container!];
      const n = count(back, product);
      if (carrying === product) out.push(opt('return_case', `Put ${itemName(product)} back in store room`));
      else out.push(opt('take_case', `Pick up a case of ${itemName(product)} (${n} in store)`, !onShift ? 'Staff only - clock in first' : !handsFree(state, p) ? 'Your hands are full' : n === 0 ? 'None in stock' : undefined));
      break;
    }
    case 'terminal': {
      const a = openAttendance(state, actorId);
      if (a) out.push(opt('clock_out', 'Clock out', carrying || p.equipment ? 'Put away what you are carrying first' : undefined));
      else if (b && b.ownerId === actorId && !(p.contractId && state.contracts[p.contractId]?.businessId === bid)) out.push(opt('clock_in', 'Owner: you can work here any time without clocking in', 'No timesheet needed for the owner'));
      else out.push(opt('clock_in', 'Clock in', p.contractId && state.contracts[p.contractId].businessId === bid ? undefined : 'You do not work here'));
      break;
    }
    case 'till': {
      const till = state.tills[it.id];
      if (!till || (b && b.equipment.till === false)) { out.push(opt('serve_customer', 'Checkout counter', 'No till system installed - buy one in Phone > Business')); break; }
      const head = till.queue[0] ? state.people[till.queue[0]] : null;
      const atTill = head && dist(head.pos, queueSlot(bid!, 0)) < 1.2;
      out.push(opt('serve_customer', head ? `Serve ${head.name} (${total(state.containers[head.basketId])} items)` : 'Serve customers', !onShift ? 'Staff only' : !isEmpty(h) ? 'Put down what you are carrying' : !head ? 'No customer waiting' : !atTill ? 'Customer is still walking up' : undefined));
      break;
    }
    case 'kiosk': {
      const basket = state.containers[p.basketId];
      const v = b ? basketValue(state, b, basket.id) : 0;
      out.push(opt('self_checkout', `Self-checkout: pay ${fmtMoney(v)} for ${total(basket)} items`, total(basket) === 0 ? 'Your basket is empty - take items from the shelves' : state.ledger.accounts[p.accountId].balance < v ? 'Not enough money' : undefined));
      if (p.isPlayer) {
        out.push(opt('scratch', `Buy a scratchcard · ${fmtMoney(SCRATCH_PRICE)}`));
        out.push(opt('lotto', `Lottery ticket for Saturday · ${fmtMoney(LOTTO_PRICE)}`));
      }
      break;
    }
    case 'cupboard':
      if (p.equipment === 'mop') out.push(opt('return_mop', 'Put mop away'));
      else out.push(opt('take_mop', 'Take mop & bucket', !onShift ? 'Staff only' : !handsFree(state, p) ? 'Your hands are full' : undefined));
      break;
    case 'rack': {
      const prod = it.product!;
      const stock = count(state.containers[it.container!], prod);
      const need = pickDemand(state, bid!, prod);
      if (carrying === prod) out.push(opt('return_case', `Put ${itemName(prod)} back on the racking`));
      out.push(opt('pick_case', `Pick ${itemName(prod)} (${need ? `${need} still needed for orders` : 'no orders need it'} · ${stock} in stock)`, !onShift ? 'Staff only - clock in first' : !handsFree(state, p) ? 'Your hands are full' : !need ? 'Nothing on the pick list' : !stock ? 'Out of stock' : undefined));
      break;
    }
    case 'staging': {
      const q = pickQueue(state, bid!);
      const lines = q.reduce((n, s) => n + Object.keys(s.items).filter((k) => (s.items[k] ?? 0) > (s.picked?.[k] ?? 0)).length, 0);
      const staged = total(state.containers[STAGING]);
      if (carrying) out.push(opt('stage_case', `Stage ${count(h, carrying)} ${itemName(carrying)} for dispatch`, !onShift ? 'Staff only' : !q.some((s) => (s.items[carrying] ?? 0) > (s.picked?.[carrying] ?? 0)) ? 'No order needs it - put it back on the racking' : undefined));
      else out.push(opt('stage_case', q.length ? `Pick list: ${q.length} order${q.length === 1 ? '' : 's'}, ${lines} line${lines === 1 ? '' : 's'} to pick · ${staged} units staged` : `No orders waiting · ${staged} units staged`, 'Pick from the racking, then bring the cases here'));
      break;
    }
    case 'baler': {
      const n = b?.cardboard ?? 0;
      out.push(opt('bale_cardboard', `Flatten and bale cardboard (${n} empty case${n === 1 ? '' : 's'})`, !onShift ? 'Staff only' : n === 0 ? 'No cardboard waiting' : !handsFree(state, p) ? 'Your hands are full' : undefined));
      break;
    }
    case 'shopbin': {
      const fill = b?.binFill ?? 0;
      out.push(opt('empty_bin', `Empty the bin (${Math.round((fill / BIN_CAPACITY) * 100)}% full)`, !onShift ? 'Staff only' : fill === 0 ? 'The bin is empty' : !handsFree(state, p) ? 'Your hands are full' : undefined));
      break;
    }
    case 'dumpster':
      out.push(opt('dump_rubbish', 'Throw the bin bag in the dumpster', p.equipment !== 'rubbish' ? 'Nothing to throw away' : undefined));
      break;
    case 'spill':
      out.push(opt('clean', 'Mop up spill', !onShift ? 'Staff only' : p.equipment !== 'mop' ? 'You need the mop from the cleaning cupboard' : undefined));
      break;
    case 'bay': {
      const arrived = Object.values(state.shipments).filter((s) => s.buyerId === bid && s.status === 'arrived');
      const units = arrived.reduce((n, s) => n + Object.values(s.loaded).reduce((a, c) => a + c, 0), 0);
      out.push(opt('check_in_delivery', arrived.length ? `Check in delivery (${units} items)` : 'Check in delivery', !onShift ? 'Staff only' : !arrived.length ? 'No delivery waiting' : !handsFree(state, p) ? 'Your hands are full' : undefined));
      break;
    }
    case 'bed': {
      const home = hasHomeAccess(state, actorId, it.locationId);
      out.push(opt('sleep', 'Sleep until 07:00', home ? undefined : 'This is no longer your home', 'morning'));
      out.push(opt('sleep', 'Nap for 2 hours', home ? undefined : 'This is no longer your home', '120'));
      break;
    }
    case 'kitchen': {
      const home = hasHomeAccess(state, actorId, it.locationId);
      const pantry = p.pantryId ? state.containers[p.pantryId] : null;
      const bag = state.containers[p.bagId];
      const foods = new Set<string>();
      for (const c of [pantry, bag]) if (c) for (const k of Object.keys(c.items)) if (isFood(k)) foods.add(k);
      if (!home) { out.push(opt('eat', 'Eat', 'This is no longer your home')); break; }
      if (p.isPlayer) {
        const d = choresOf(p).dishes;
        out.push(opt('wash_up', d ? `Wash up (${d} dirty dish${d === 1 ? '' : 'es'})` : 'Wash up', d ? undefined : 'Nothing to wash'));
      }
      if (pantry && Object.keys(bag.items).some(isFood)) out.push(opt('store_food', `Put shopping away (${total(bag)} items)`));
      if (!foods.size) out.push(opt('eat', 'Eat something', 'No food - buy groceries at Corner Market'));
      for (const f of [...foods].sort((a, b2) => ITEMS[b2].satiety - ITEMS[a].satiety).slice(0, 4)) out.push(opt('eat', `Eat ${itemName(f)} (+${ITEMS[f].satiety} food${ITEMS[f].energy ? `, +${ITEMS[f].energy} energy` : ''})`, undefined, f));
      break;
    }
    case 'wardrobe': {
      const home = hasHomeAccess(state, actorId, it.locationId);
      const wr = p.wardrobeId ? state.containers[p.wardrobeId] : null;
      const outfits = wr ? Object.keys(wr.items).filter((k) => ITEMS[k]?.category === 'clothing') : [];
      for (const o of outfits) {
        const w = p.isPlayer ? wearOf(p, o) : 0;
        out.push(opt('change_outfit', `Wear ${itemName(o)} - ${CLOTHING[o]?.label ?? ''}${w >= 70 ? ' (dirty)' : ''}`, !home ? 'This is no longer your home' : p.appearance.outfit === o ? 'Already wearing' : inWash(p, o) ? 'In the wash' : undefined, o));
      }
      break;
    }
    case 'chair':
      out.push(opt('sit', 'Sit down'));
      out.push({ type: 'ui', label: 'Use laptop (job sites, bank, business)', enabled: true, ui: 'laptop' });
      break;
    case 'iv_chair': {
      const iv = Object.values(state.applications).find((a) => a.personId === actorId && a.status === 'interview');
      if (iv) {
        const host = iv.interviewerId ? state.people[iv.interviewerId] : null;
        const seated = !!host && host.action?.type === 'sit' && host.action.target === 'iv_host';
        const open = interviewOpen(state, iv);
        out.push({ type: 'ui', label: `Sit down for your interview${host ? ` with ${host.name}` : ''}`, enabled: open && seated, reason: !open ? 'Not yet - check the time on your invitation' : !seated ? `${host?.name.split(' ')[0] ?? 'They'} has not arrived yet` : undefined, ui: 'interview', arg: iv.id });
      }
      out.push(opt('sit', 'Sit down'));
      break;
    }
    case 'iv_host':
      out.push(opt('sit', 'Sit down'));
      break;
    case 'meet_chair': {
      const m = plannedMeetup(state);
      out.push(opt('sit', m && p.isPlayer ? `Sit down - meeting ${state.people[m.friendId].name.split(' ')[0]} at ${fmtClock(m.at)}` : 'Sit down'));
      break;
    }
    case 'sofa':
      out.push(opt('watch_tv', 'Watch TV (raises mood)', hasHomeAccess(state, actorId, it.locationId) ? undefined : 'Not your home'));
      out.push(opt('sit', 'Sit and rest'));
      if (p.isPlayer && hasHomeAccess(state, actorId, it.locationId)) {
        const m = Math.round(choresOf(p).mess);
        out.push(opt('tidy', `Tidy the flat (${messLabel(m)})`, m < 5 ? 'Already spotless' : undefined));
      }
      break;
    case 'washer': {
      if (!hasHomeAccess(state, actorId, it.locationId)) { out.push(opt('laundry', 'Washing machine', 'Not your home')); break; }
      const c = choresOf(p);
      if (c.washer && state.minute < c.washer.until) { out.push(opt('laundry', `Washing ${c.washer.items.map(itemName).join(', ')}`, `Running - done at ${fmtClock(c.washer.until)}`)); break; }
      if (c.washer) { out.push(opt('laundry', `Unload and hang up the washing (${c.washer.items.length})`, undefined, 'unload')); break; }
      const wr = p.wardrobeId ? state.containers[p.wardrobeId] : null;
      const worn = wr ? Object.keys(wr.items).filter((k) => ITEMS[k]?.category === 'clothing' && wearOf(p, k) >= 15) : [];
      const load = worn.filter((k) => k !== p.appearance.outfit);
      out.push(opt('laundry', load.length ? `Put a wash on: ${load.map(itemName).join(', ')}` : 'Put a wash on', !worn.length ? 'Nothing needs washing' : !load.length ? 'Change out of those clothes first (wardrobe)' : undefined, 'load'));
      break;
    }
    case 'shower':
      out.push(opt('shower', `Shower (hygiene ${Math.round(p.needs.hygiene ?? 0)})`, hasHomeAccess(state, actorId, it.locationId) ? undefined : 'Not your home'));
      break;
    case 'stove': {
      const pantry = p.pantryId ? state.containers[p.pantryId] : null;
      const has = (k: string) => count(pantry ?? undefined, k) + count(state.containers[p.bagId], k);
      const fish = ['fish_bass', 'fish_cod', 'fish_pollock', 'fish_mackerel', 'crab'].find((k) => has(k) > 0);
      if (fish && p.isPlayer && choresOf(p).dishes < DISHES_BLOCK) out.push(opt('cook', `Cook your ${itemName(fish).toLowerCase()} (+food, +mood)`, !hasHomeAccess(state, actorId, it.locationId) ? 'Not your home' : undefined, fish));
      const base = has('pasta') > 0 ? 'pasta' : has('soup') > 0 ? 'soup' : null;
      if (p.isPlayer && choresOf(p).dishes >= DISHES_BLOCK) { out.push(opt('cook', 'Cook a meal', 'Every pan is dirty - wash up at the sink first')); break; }
      out.push(opt('cook', base === 'pasta' ? `Cook a pasta dinner (+50 food, +mood)${has('soup') || has('apples') ? ' with extras' : ''}` : base === 'soup' ? 'Heat soup (+40 food)' : 'Cook a meal', !hasHomeAccess(state, actorId, it.locationId) ? 'Not your home' : !base ? 'Needs pasta or soup - buy some at the shop' : undefined, base ?? undefined));
      break;
    }
    case 'person': {
      const other = state.people[it.id.slice(7)];
      const iv = Object.values(state.applications).find((a) => a.personId === actorId && a.status === 'interview' && a.interviewerId === other.id);
      if (iv) out.push({ type: 'ui', label: `Interview with ${other.name}`, enabled: false, reason: 'Held at the window table in Tidewater Cafe - sit down there', ui: 'interview', arg: iv.id });
      const fam = Math.round(p.relations?.[other.id] ?? 0);
      if (p.isPlayer) out.push({ type: 'ui', label: `Talk to ${other.name}${fam ? ` (${relationLabel(fam).toLowerCase()} · ${fam})` : ''}`, enabled: other.action?.type !== 'serve_customer', reason: 'Busy serving', ui: 'chat', arg: other.id });
      if (p.isPlayer && (other.npc as any)?.shoplift) out.unshift(opt('grab', `Grab ${other.name.split(' ')[0]} (shoplifter!)`));
      out.push(opt('talk', p.isPlayer ? `Say hello in passing` : `Chat with ${other.name}`, other.action?.type === 'serve_customer' ? 'Busy serving' : undefined));
      if (p.isPlayer && !other.npc?.ambient) out.push({ type: 'ui', label: `Invite ${other.name.split(' ')[0]} for a coffee`, enabled: fam >= FRIEND_AT && !plannedMeetup(state), reason: fam < FRIEND_AT ? 'Get to know them better first (chat more)' : 'You already have a meet-up arranged', ui: 'invite', arg: other.id });
      break;
    }
    case 'vehicle': {
      if (it.id.startsWith('forklift:')) {
        out.push(opt('drive_forklift', `Get on the forklift (${palletsWaiting(state)} pallet(s) at goods-in)`, canDriveForklift(state, actorId)));
        break;
      }
      if (it.id.startsWith('car:')) {
        const car = state.vehicles[it.id.slice(4)];
        out.push(opt('drive_car', car?.stolen ? `Get back in the stolen ${car.name}` : `Get in and drive your ${car?.name ?? 'car'}`, !car || (car.ownerId !== actorId && !car.stolen) ? 'Not your car' : canDriveCar(state, car)));
        break;
      }
      const v = state.vehicles[it.id.slice(4)];
      const s = v?.shipmentId ? state.shipments[v.shipmentId] : null;
      const buyer = s ? state.businesses[s.buyerId]?.name : '';
      out.push(opt('drive_van', `Get in and drive the delivery to ${buyer}`, v?.driverId !== actorId ? 'Only the driver on shift can take the van' : undefined));
      break;
    }
    case 'home_counter': {
      const staffed = storeStaffed(state);
      if (onShift) {
        const b2 = state.businesses[bid!];
        const head = b2.queue?.[0] ? state.people[b2.queue[0]] : null;
        const ready = !!head && dist(head.pos, homeQueueSlot(0)) < 1.3;
        out.push(opt('take_order', head ? `Help ${head.name} and take their order` : 'Take orders at the counter', !head ? 'No customer waiting' : !ready ? `${head.name.split(' ')[0]} is still walking up` : undefined));
        break;
      }
      out.push({ type: 'ui', label: 'Browse furniture, wallpaper, flooring and rugs for your home', enabled: true, ui: 'homestore', reason: staffed ? undefined : 'Counter closed - you can still order online' });
      for (const k of ['bat', 'knife'] as const) out.push(opt('buy_weapon', `Buy a ${WEAPONS[k].label} · ${fmtMoney(WEAPONS[k].price)}`, !staffed ? 'Counter closed' : count(state.containers[p.bagId], WEAPONS[k].item) ? 'You already have one' : undefined, k));
      break;
    }
    case 'housedoor': {
      const h = houseOf(it.id);
      if (houseOpen(state, h)) break;
      out.push(opt('knock', 'Knock on the door', state.doorCall && state.doorCall.house === h && state.doorCall.stage !== 'done' ? 'Someone is coming to the door' : undefined));
      out.push(opt('break_in', 'Force the door (break in)'));
      break;
    }
    case 'fishing': {
      out.push(opt('fish', state.fishing && state.fishing.by !== actorId ? 'Someone is fishing here' : 'Cast a line', fishingBlocker(state, p) ?? (state.fishing && state.fishing.by !== actorId ? 'Taken' : undefined)));
      break;
    }
    case 'bait_shop': {
      out.push(opt('buy_tackle', `Buy a fishing rod · ${fmtMoney(ROD_PRICE)}`, count(state.containers[p.bagId], 'fishing_rod') ? 'You have one' : undefined, 'rod'));
      out.push(opt('buy_tackle', `Buy bait (10) · ${fmtMoney(BAIT_PRICE)}`, undefined, 'bait'));
      out.push(opt('sell_catch', 'Sell your catch', hasCatch(state, p) ? undefined : 'Nothing to sell'));
      break;
    }
    case 'valuables':
      out.push(opt('search', 'Search the drawers for cash'));
      break;
    case 'stall': {
      const k = it.product!;
      out.push(opt('buy_stall', `Buy ${itemName(k)} · ${fmtMoney(stallPrice(k))}`, !marketOn(state) ? 'The market is on Saturdays, 09:00-15:00 (not in the rain)' : undefined));
      break;
    }
    case 'study_desk': {
      const e = p.course;
      const c = e ? COURSES[e.courseId] : null;
      const what = c && e ? (c.test && e.done === c.sessions - 1 ? `Take the ${c.name} test` : `Attend session ${e.done + 1} of ${c.sessions}: ${c.name}`) + ` (${c.minutes / 60} h)` : 'Attend a course session';
      out.push(opt('study', what, sessionBlocker(state, p)));
      break;
    }
    case 'bench':
      out.push(opt('sit', 'Sit on bench'));
      out.push(opt('sleep', 'Sleep rough until 07:00 (poor rest)', undefined, 'morning'));
      break;
    case 'board':
      out.push({ type: 'ui', label: 'Browse vacancies', enabled: true, ui: 'jobs' });
      break;
    case 'advisor':
      out.push({ type: 'ui', label: 'Talk to the employment advisor', enabled: true, ui: 'advisor' });
      break;
    case 'site_cabin': case 'site_pallet': case 'site_work': {
      const plot = currentPlot(state), st = currentStage(state);
      const here = !!plot && it.id.startsWith(plot.id);
      if (p.equipment?.startsWith('tool_') && it.kind === 'site_cabin') { out.push(opt('return_tool', `Put the ${p.equipment.slice(5)} back`)); break; }
      if (!here) { out.push(opt('site_work', plotFinished(state, PLOTS.findIndex((x) => it.id.startsWith(x.id))) ? 'The house here is finished' : 'Not started yet', 'Work is on the other plot')); break; }
      const tool = st?.tool ? `tool_${st.tool}` : null;
      if (it.kind === 'site_cabin') {
        if (p.equipment?.startsWith('tool_')) out.push(opt('return_tool', `Put the ${p.equipment.slice(5)} back`));
        else out.push(opt('take_tool', tool ? `Take a ${st!.tool} for: ${st!.label.split(':')[0].toLowerCase()}` : 'Tools (none needed for brickwork)', !onShift ? 'Staff only' : !tool ? 'Bricks and a trowel: take bricks from the pallet' : !handsFree(state, p) ? 'Your hands are full' : undefined, tool ?? undefined));
      } else if (it.kind === 'site_pallet') {
        const n = bricksOnPallet(state);
        out.push(opt('take_bricks', `Pick up a load of bricks (${n} on the pallet)`, !onShift ? 'Staff only' : st?.id !== 'walls' ? 'Bricks are for the brickwork stage' : !handsFree(state, p) ? 'Your hands are full' : !n ? 'Pallet empty' : undefined));
      } else {
        const pct = Math.round(stageProgress(state) * 100);
        const carrying = count(h, 'bricks');
        const label = st?.id === 'walls' ? `Lay bricks (${carrying} in hand · course ${courses(state, state.build!.plot) + 1}/12)` : `${st?.label} (${pct}%)`;
        out.push(opt('site_work', label, !onShift ? 'Staff only' : st?.id === 'walls' ? (carrying ? undefined : 'Fetch bricks from the pallet') : p.equipment !== tool ? `Fetch a ${st?.tool} from the site cabin` : undefined));
      }
      break;
    }
    case 'cafe_grill': {
      const b2 = state.businesses.cafe;
      const waiting = (b2.queue?.length ?? 0);
      const supplies = count(state.containers[b2.stockContainers[0]], 'cafe_supplies');
      out.push(opt('cook_meal', waiting ? `Cook a meal (${waiting} waiting)` : 'Cook a meal', !onShift ? 'Staff only' : p.equipment === 'plate' ? 'Serve the plate you have first' : !handsFree(state, p) ? 'Your hands are full' : !supplies ? 'Out of supplies' : !waiting ? 'No orders waiting' : undefined));
      break;
    }
    case 'cafe_counter': {
      if (onShift) {
        const head = b?.queue?.[0] ? state.people[b.queue[0]] : null;
        out.push(opt('serve_meal', head ? `Serve ${head.name} their meal` : 'Serve a meal', p.equipment !== 'plate' ? 'Cook a meal at the grill first' : !head ? 'Nobody waiting' : dist(head.pos, cafeQueueSlot(0)) > 1.3 ? `${head.name.split(' ')[0]} is still coming over` : undefined));
        break;
      }
      const staffed = b ? Object.values(state.people).some((x) => isOnShift(state, x.id, b.id)) : false;
      const supplies = b ? count(state.containers[b.stockContainers[0]], 'cafe_supplies') : 0;
      const price = b ? priceOf(b, 'meal') : 0;
      out.push(opt('buy_meal', `Buy a hot meal - ${fmtMoney(price)} (+55 food)`, !b || !isOpen(b, state.minute) || !staffed ? 'Cafe is closed' : supplies <= 0 ? 'Sold out - waiting for supplies' : state.ledger.accounts[p.accountId].balance < price ? 'Not enough money' : undefined));
      const mod = minuteOfDay(state.minute);
      out.push(opt('buy_pint', `Have a pint · ${fmtMoney(PINT)} (mood up, but it goes to your head)`, !b || !isOpen(b, state.minute) || !staffed ? 'Cafe is closed' : mod < 12 * 60 ? 'Licensed from 12:00' : (p.drunk ?? 0) > 70 ? "You've had enough, mate" : undefined));
      break;
    }
  }
  return out;
}

function begin(p: Person, type: ActionType, target: Id, cfg: Partial<ActionState>, now: number): ActionState {
  const a: ActionState = { type, target, started: now, progress: 0, unitTime: 0, duration: 0, units: 0, ...cfg };
  p.action = a;
  p.move = null;
  return a;
}

/** Validate and start an action. Returns a message for the UI. */
export function startAction(state: GameState, actorId: Id, itId: Id, type: ActionType, arg?: string): { ok: boolean; msg: string } {
  const p = state.people[actorId];
  if (p.action) return { ok: false, msg: 'Busy.' };
  const it = interactable(state, itId);
  if (!it) return { ok: false, msg: 'Nothing there.' };
  if (Math.min(dist(p.pos, it.pos), dist(p.pos, it.obj)) > it.range + 0.7) return { ok: false, msg: 'Too far away.' };
  if (!canReach(p, it)) return { ok: false, msg: 'You cannot reach that from here.' };
  const o = optionsFor(state, actorId, itId).find((x) => x.type === type && (arg === undefined || x.arg === undefined || x.arg === arg));
  if (!o) return { ok: false, msg: 'Not possible here.' };
  if (!o.enabled) return { ok: false, msg: o.reason ?? 'Not possible.' };
  const now = state.minute;
  p.facing = it.facing;
  const sp = speed(p, 'retail');
  switch (type) {
    case 'clock_in':
    case 'clock_out':
      begin(p, type, itId, { duration: 0.4 }, now); break;
    case 'take_case':
    case 'take_mop':
    case 'return_mop':
    case 'store_food':
      begin(p, type, itId, { duration: 0.5 / sp }, now); break;
    case 'return_case':
      begin(p, type, itId, { duration: 0.4 }, now); break;
    case 'stock_shelf':
      begin(p, type, itId, { unitTime: 0.1 / sp }, now); break;
    case 'serve_customer': {
      const till = state.tills[itId];
      till.staffId = actorId;
      begin(p, type, itId, { unitTime: 0.12 / sp }, now); break;
    }
    case 'clean':
      begin(p, type, itId, { unitTime: 0.15 / speed(p, 'cleaning') }, now); break;
    case 'face_shelf':
      begin(p, type, itId, { unitTime: 0.1 / sp }, now); break;
    case 'pick_case':
      begin(p, type, itId, { duration: 0.6 / speed(p, 'warehouse') }, now); break;
    case 'drive_van':
    case 'drive_car':
    case 'drive_forklift':
      begin(p, type, itId, { duration: 0.3 }, now); break;
    case 'study':
      begin(p, type, itId, { duration: sessionMinutes(p) }, now); break;
    case 'buy_stall':
      begin(p, type, itId, { duration: 1.5 }, now); break;
    case 'take_order':
      begin(p, type, itId, { duration: 3 / sp }, now); break;
    case 'cook_meal':
      begin(p, type, itId, { duration: 4 / speed(p, 'cooking') }, now); break;
    case 'take_tool': case 'return_tool':
      begin(p, type, itId, { duration: 0.5, arg }, now); break;
    case 'take_bricks':
      begin(p, type, itId, { duration: 0.8 / speed(p, 'construction') }, now); break;
    case 'site_work':
      { const st = currentStage(state); begin(p, type, itId, { unitTime: (st ? st.minutes / st.units : 5) / speed(p, 'construction') }, now); } break;
    case 'serve_meal':
      begin(p, type, itId, { duration: 0.5 }, now); break;
    case 'stage_case':
      begin(p, type, itId, { duration: 0.4 / speed(p, 'warehouse') }, now); break;
    case 'bale_cardboard':
      begin(p, type, itId, { unitTime: 0.3 / speed(p, 'warehouse') }, now); break;
    case 'empty_bin':
      begin(p, type, itId, { duration: 0.8 / speed(p, 'cleaning') }, now); break;
    case 'dump_rubbish':
      begin(p, type, itId, { duration: 0.4 }, now); break;
    case 'check_in_delivery': {
      const units = Object.values(state.shipments).filter((s) => s.buyerId === it.businessId && s.status === 'arrived').reduce((n, s) => n + Object.values(s.loaded).reduce((a, c) => a + c, 0), 0);
      begin(p, type, itId, { duration: (1 + units / 25) / speed(p, 'warehouse') }, now); break;
    }
    case 'pick_item':
      begin(p, type, itId, { unitTime: 0.12, arg: arg ?? '1' }, now); break;
    case 'self_checkout':
      begin(p, type, itId, { unitTime: 0.16 }, now); break;
    case 'sleep': {
      let mins = 120;
      if (arg === 'morning') {
        const m = minuteOfDay(now);
        mins = m < 7 * 60 ? 7 * 60 - m : 24 * 60 - m + 7 * 60;
      } else if (arg) mins = Number(arg);
      begin(p, type, itId, { duration: mins }, now);
      p.sleeping = true;
      break;
    }
    case 'eat':
      // a proper sit-down meal at home; a quick bite anywhere else
      begin(p, type, itId, { duration: it.kind === 'kitchen' && p.isPlayer ? 8 : 3, arg }, now); break;
    case 'change_outfit':
      begin(p, type, itId, { duration: 1, arg }, now); break;
    case 'buy_weapon': {
      const r = buyWeapon(state, p.id, arg as 'bat' | 'knife', state.businesses[it.businessId ?? 'homestore']?.accountId ?? state.businesses.homestore.accountId);
      if (!r.ok) return r;
      begin(p, type, itId, { duration: 0.6 }, now);
      return r;
    }
    case 'knock':
      begin(p, type, itId, { duration: 0.6 }, now); break;
    case 'scratch':
      begin(p, type, itId, { duration: 0.4 }, now); break;
    case 'fish': {
      if (p.isPlayer) { cast(state, p); begin(p, type, itId, { duration: 999 }, now); }
      else begin(p, type, itId, { duration: 30 + Math.floor(now % 20) }, now);
      break;
    }
    case 'buy_tackle': {
      const r = buyTackle(state, p, arg as 'rod' | 'bait');
      if (!r.ok) return r;
      begin(p, type, itId, { duration: 0.4 }, now);
      return r;
    }
    case 'sell_catch': {
      const r = sellCatch(state, p);
      if (!r.ok) return r;
      begin(p, type, itId, { duration: 0.4 }, now);
      return r;
    }
    case 'lotto': {
      const r = buyLotto(state, p.id);
      if (!r.ok) return r;
      begin(p, type, itId, { duration: 0.3 }, now);
      return r;
    }
    case 'grab':
      return { ok: true, msg: grabShoplifter(state, p.id, itId.slice(7)) };
    case 'break_in':
      begin(p, type, itId, { duration: 1.2 }, now); break;
    case 'search':
      begin(p, type, itId, { duration: 1.5 }, now); break;
    case 'buy_pint': {
      const b = state.businesses[it.businessId!];
      const r = transfer(state, { from: p.accountId, to: b.accountId, amount: PINT, reason: 'purchase', memo: `Pint at ${b.name}` });
      if (!r.ok) return { ok: false, msg: r.error };
      const st = b.stats[b.stats.length - 1];
      if (st) { st.revenue += PINT; st.customers++; }
      begin(p, type, itId, { duration: 10 }, now);
      break;
    }
    case 'buy_meal': {
      const b = state.businesses[it.businessId!];
      const price = priceOf(b, 'meal');
      const r = transfer(state, { from: p.accountId, to: b.accountId, amount: price, reason: 'purchase', memo: `Meal at ${b.name}` });
      if (!r.ok) return { ok: false, msg: r.error };
      removeItems(state.containers[b.stockContainers[0]], 'cafe_supplies', 1);
      const tax = Math.round((price * state.policy.salesTax) / (1 + state.policy.salesTax));
      transfer(state, { from: b.accountId, to: state.businesses[state.governmentId].accountId, amount: tax, reason: 'sales_tax', memo: `Sales tax ${b.name}` });
      const st = b.stats[b.stats.length - 1];
      if (st) { st.revenue += price - tax; st.customers++; st.cogs += ITEMS.cafe_supplies.wholesale / ITEMS.cafe_supplies.caseSize; }
      begin(p, type, itId, { duration: 8 }, now);
      break;
    }
    case 'sit':
    case 'watch_tv':
      begin(p, type, itId, { duration: 600 }, now); break;
    case 'shower':
      begin(p, type, itId, { duration: 8 }, now); break;
    case 'cook':
      begin(p, type, itId, { duration: 15, arg }, now); break;
    case 'wash_up':
      begin(p, type, itId, { unitTime: 0.6 }, now); break;
    case 'laundry':
      begin(p, type, itId, { duration: arg === 'unload' ? 2.5 : 1.5, arg }, now); break;
    case 'tidy':
      begin(p, type, itId, { duration: Math.max(3, Math.min(25, choresOf(p).mess * 0.3)) }, now); break;
    case 'talk': {
      // townspeople who meet up on purpose talk for a good while
      begin(p, type, itId, { duration: arg === 'long' ? 20 : 2 }, now);
      const o = state.people[itId.slice(7)];
      if (o) p.facing = Math.atan2(o.pos.x - p.pos.x, o.pos.z - p.pos.z);
      break;
    }
  }
  const started = p.action as ActionState | null;
  if (started && arg !== undefined && started.arg === undefined) started.arg = arg;
  if (started) useEnergy(state, p, type, arg);
  return { ok: true, msg: o.label };
}

export function cancelAction(state: GameState, p: Person, why = 'Interrupted') {
  const a = p.action;
  if (!a) return;
  if (a.type === 'fish' && state.fishing?.by === p.id) state.fishing = null;
  if (a.type === 'serve_customer') {
    const till = state.tills[a.target];
    if (till && till.staffId === p.id) till.staffId = null;
  }
  p.action = null;
  p.sleeping = false;
  void why;
}

function finish(state: GameState, p: Person) {
  const a = p.action!;
  if (a.type === 'serve_customer') {
    const till = state.tills[a.target];
    if (till?.staffId === p.id) till.staffId = null;
  }
  p.action = null;
  p.sleeping = false;
}

function creditTask(state: GameState, p: Person) {
  const att = openAttendance(state, p.id);
  if (att) att.tasks++;
}

/** advance an actor's current action by dt game minutes */
export function tickAction(state: GameState, p: Person, dt: number): string | null {
  const a = p.action;
  if (!a) return null;
  const it = interactable(state, a.target);
  if (a.type === 'attack') { a.progress += dt; if (a.progress >= a.duration) p.action = null; return null; }
  if (a.type === 'fish' && p.isPlayer) { a.progress += dt; return fishingTick(state, p); }
  if (!it && a.type !== 'sleep') { cancelAction(state, p); return 'Target is gone.'; }
  if (it && Math.min(dist(p.pos, it.pos), dist(p.pos, it.obj)) > it.range + 1.5) { cancelAction(state, p); return 'Stopped: you moved away.'; }
  a.progress += dt;
  const h = hands(state, p);
  // unit-based actions
  if (a.unitTime > 0) {
    while (p.action === a && a.progress >= a.unitTime) {
      a.progress -= a.unitTime;
      const r = doUnit(state, p, a, it!, h);
      if (r !== null) return r;
    }
    return null;
  }
  // an interviewer waiting at the table gets up once the interview is over
  if (a.type === 'sit' && a.target === 'iv_host' && !hostingInterview(state, p.id)) { finish(state, p); return null; }
  if (a.progress < a.duration) {
    if (a.type === 'sleep' && p.needs.energy >= 100 && a.arg !== 'morning' && a.progress > 30) { finish(state, p); return 'You wake up rested.'; }
    if (a.type === 'buy_meal') p.needs.satiety = clamp(p.needs.satiety + (55 / 8) * dt, 0, 100);
    if (a.type === 'watch_tv') p.needs.energy = clamp(p.needs.energy + 0.04 * dt, 0, 100);
    return null;
  }
  // fixed-duration completion
  let msg: string | null = null;
  switch (a.type) {
    case 'clock_in': msg = clockIn(state, p.id).msg; break;
    case 'clock_out': msg = clockOut(state, p.id).msg; break;
    case 'take_case': {
      const prod = productAt(state, it!);
      const n = prod ? moveItems(state, it!.container!, p.handsId, prod, ITEMS[prod].caseSize) : 0;
      msg = n ? `Picked up ${n} ${itemName(prod!)}.` : 'Nothing left.';
      break;
    }
    case 'return_case': {
      const item = firstItem(h);
      const n = item ? moveItems(state, p.handsId, it!.container!, item, count(h, item)) : 0;
      msg = `Returned ${n} items to the store room.`;
      break;
    }
    case 'take_mop': p.equipment = 'mop'; msg = 'Mop & bucket ready.'; break;
    case 'take_tool': p.equipment = a.arg ?? null; msg = `Got the ${(a.arg ?? '').slice(5)}.`; break;
    case 'return_tool': msg = `Put the ${(p.equipment ?? '').slice(5)} away.`; p.equipment = null; break;
    case 'take_bricks': {
      const n = moveItems(state, 'site_bricks', p.handsId, 'bricks', ITEMS.bricks.caseSize);
      msg = n ? `Picked up ${n} bricks.` : 'The pallet is empty.';
      break;
    }
    case 'cook_meal':
      if (takePortion(state)) { p.equipment = 'plate'; addXp(p, 'cooking', 2); msg = 'Meal plated up - take it to the counter.'; } else msg = 'Out of supplies.';
      break;
    case 'serve_meal': {
      const head = state.businesses.cafe.queue?.[0];
      if (head && p.equipment === 'plate') { p.equipment = null; msg = serveMeal(state, head, p.id).msg; addXp(p, 'cooking', 1); } else msg = 'Nobody to serve.';
      break;
    }
    case 'take_order': {
      const b = state.businesses[it!.businessId!];
      const head = b?.queue?.[0];
      msg = head ? completeHomeOrder(state, head, p.id).msg : 'The customer has gone.';
      if (head) addXp(p, 'retail', 3);
      break;
    }
    case 'study': {
      msg = completeSession(state, p);
      break;
    }
    case 'buy_stall': {
      msg = buyAtStall(state, p.id, a.target).msg;
      break;
    }
    case 'drive_forklift': {
      msg = mountForklift(state, p.id);
      break;
    }
    case 'drive_car': {
      msg = enterCar(state, p.id, a.target.slice(4));
      break;
    }
    case 'drive_van': {
      const v = state.vehicles[a.target.slice(4)];
      if (v && v.state === 'loaded' && v.driverId === p.id) {
        v.state = 'manual_out';
        p.where = 'vehicle';
        p.visible = false;
        p.pos = { ...v.pos };
        const s = v.shipmentId ? state.shipments[v.shipmentId] : null;
        msg = `Drive to ${s ? state.businesses[s.buyerId].name : 'the shop'}'s loading bay (W/S to drive, A/D to steer).`;
      }
      break;
    }
    case 'pick_case': {
      const prod = it!.product!;
      const want = Math.min(ITEMS[prod].caseSize, pickDemand(state, it!.businessId!, prod));
      const n = want > 0 ? moveItems(state, it!.container!, p.handsId, prod, want) : 0;
      if (n) addXp(p, 'warehouse', 1);
      msg = n ? `Picked ${n} ${itemName(prod)} - take them to the staging lanes.` : 'Nothing to pick.';
      break;
    }
    case 'stage_case': {
      const r = stageFromHands(state, p.id, it!.businessId!);
      if (r.units) { creditTask(state, p); addXp(p, 'warehouse', 2); }
      msg = r.units ? `Staged ${r.units} units for ${r.orders.join(', ')}.` : 'No order needs that.';
      break;
    }
    case 'empty_bin': {
      const b = state.businesses[it!.businessId!];
      if (b) b.binFill = 0;
      p.equipment = 'rubbish';
      msg = 'Bag tied off - take it out to the dumpster by the loading bay.';
      break;
    }
    case 'dump_rubbish':
      p.equipment = null;
      completeTask(state, it!.businessId!, 'rubbish', SHOPS[it!.businessId!]?.bin ?? '', p.id);
      creditTask(state, p);
      addXp(p, 'cleaning', 2);
      msg = 'Rubbish out.';
      break;
    case 'return_mop': p.equipment = null; msg = 'Mop put away.'; break;
    case 'check_in_delivery': {
      const r = checkInDeliveries(state, it!.businessId!, p.id);
      if (r.ok) {
        completeTaskAll(state, it!.businessId!, 'receive', p.id);
        creditTask(state, p);
        addXp(p, 'warehouse', 3 + Math.floor(r.units / 20));
      }
      msg = r.msg;
      break;
    }
    case 'sleep':
      msg = 'You wake up.';
      break;
    case 'eat': {
      const pantry = p.pantryId ? state.containers[p.pantryId] : null;
      const bag = state.containers[p.bagId];
      const item = a.arg!;
      const src = pantry && count(pantry, item) > 0 ? pantry : count(bag, item) > 0 ? bag : null;
      if (src && removeItems(src, item, 1)) {
        p.needs.satiety = clamp(p.needs.satiety + ITEMS[item].satiety, 0, 100);
        p.needs.energy = clamp(p.needs.energy + ITEMS[item].energy, 0, 100);
        msg = `Ate ${itemName(item)}.`;
        if (it?.kind === 'kitchen') homeMess(p, 'eat');
        if (p.isPlayer && it?.kind === 'kitchen') state.flags.ateHome = true;
      } else msg = 'That food is gone.';
      break;
    }
    case 'store_food': {
      const n = p.pantryId ? moveAll(state, p.bagId, p.pantryId) : 0;
      homeMess(p, 'shopping');
      msg = `Put away ${n} items.`;
      break;
    }
    case 'change_outfit':
      if (a.arg) p.appearance.outfit = a.arg;
      homeMess(p, 'change');
      msg = `Now wearing ${itemName(a.arg!)}.`;
      break;
    case 'buy_meal':
      msg = 'That hit the spot.';
      break;
    case 'buy_pint':
      p.drunk = Math.min(100, (p.drunk ?? 0) + 22);
      p.needs.mood = clamp(p.needs.mood + 5, 0, 100);
      msg = (p.drunk ?? 0) > 60 ? 'The room is starting to spin.' : (p.drunk ?? 0) > 35 ? "You're feeling merry." : 'Cheers.';
      break;
    case 'buy_weapon':
      msg = null;
      break;
    case 'knock': knock(state, p.id, houseOf(a.target)); msg = null; break;
    case 'scratch': msg = scratchcard(state, p.id).msg; break;
    case 'fish': if (!p.isPlayer) npcCatch(state, p); msg = null; break;
    case 'buy_tackle': case 'sell_catch': msg = null; break;
    case 'lotto': msg = null; break;
    case 'break_in': msg = breakIn(state, p.id, houseOf(a.target)).msg || null; break;
    case 'search': msg = searchValuables(state, p.id, houseOf(a.target)).msg; break;
    case 'sit':
    case 'watch_tv':
      msg = null;
      break;
    case 'shower':
      p.needs.hygiene = 100;
      msg = 'Fresh and clean.';
      break;
    case 'cook': {
      const pantry = p.pantryId ? state.containers[p.pantryId] : null;
      const bag = state.containers[p.bagId];
      const take = (k: string) => (pantry && removeItems(pantry, k, 1)) || removeItems(bag, k, 1);
      if (!a.arg || !take(a.arg)) { msg = 'The ingredients are gone.'; break; }
      let food = a.arg === 'pasta' ? 50 : ITEMS[a.arg]?.needsCooking && a.arg !== 'pasta' ? ITEMS[a.arg].satiety + 10 : 40;
      if (a.arg.startsWith('fish_') || a.arg === 'crab') p.needs.mood = clamp(p.needs.mood + 8, 0, 100);
      let extras = 0;
      if (a.arg === 'pasta') for (const k of ['soup', 'apples']) if (take(k)) { food += 10; extras++; }
      p.needs.satiety = clamp(p.needs.satiety + food, 0, 100);
      p.needs.mood = clamp((p.needs.mood ?? 60) + 8 + extras * 3, 0, 100);
      if (p.isPlayer) state.flags.ateHome = true;
      homeMess(p, 'cook');
      msg = a.arg === 'pasta' ? `Home-cooked pasta${extras ? ' with extras' : ''}. Delicious (+${food} food).` : `Hot soup (+${food} food).`;
      break;
    }
    case 'laundry': {
      const c = choresOf(p);
      if (a.arg === 'unload' && c.washer) {
        for (const k of c.washer.items) c.wear[k] = 0;
        msg = `Hung up ${c.washer.items.map(itemName).join(', ')} - clean and dry.`;
        c.washer = null;
      } else {
        const wr = p.wardrobeId ? state.containers[p.wardrobeId] : null;
        const items = wr ? Object.keys(wr.items).filter((k) => ITEMS[k]?.category === 'clothing' && wearOf(p, k) >= 15 && k !== p.appearance.outfit) : [];
        if (items.length) { c.washer = { items, until: state.minute + WASH_MINUTES }; msg = `Washing machine on - ready at ${fmtClock(c.washer.until)}.`; } else msg = 'Nothing to wash.';
      }
      break;
    }
    case 'tidy': {
      const c = choresOf(p);
      c.mess = 0;
      msg = 'The flat looks tidy again.';
      break;
    }
    case 'talk': {
      const o = state.people[a.target.slice(7)];
      if (o) {
        p.relations[o.id] = clamp((p.relations[o.id] ?? 0) + 5, 0, 100);
        o.relations[p.id] = clamp((o.relations[p.id] ?? 0) + 5, 0, 100);
        (p.lastSeen ??= {})[o.id] = state.minute;
        if (p.isPlayer && p.relations[o.id] >= FRIEND_AT && p.relations[o.id] - 5 < FRIEND_AT) news(state, 'good', `${o.name} is now a friend`, 'Invite them for a coffee at Tidewater Cafe to keep in touch.', true);
        p.needs.mood = clamp((p.needs.mood ?? 60) + 6, 0, 100);
        const lines = [`${o.name}: "Morning! Busy day?"`, `${o.name}: "Nice to see a new face around Harbourside."`, `${o.name}: "Corner Market's always short of staff, you know."`, `${o.name}: "Rent's gone up again, hasn't it."`, `${o.name}: "Have you tried the cafe? Rosa does a good lunch."`];
        msg = lines[Math.floor(state.minute) % lines.length];
      }
      break;
    }
  }
  finish(state, p);
  return msg;
}

function completeTaskAll(state: GameState, bid: Id, kind: 'receive', by: Id) {
  for (const t of Object.values(state.tasks)) if (t.businessId === bid && t.kind === kind && (t.status === 'open' || t.status === 'claimed')) {
    t.status = 'done'; t.doneAt = state.minute; t.doneBy = by;
  }
}

function doUnit(state: GameState, p: Person, a: ActionState, it: Interactable, h: ReturnType<typeof hands>): string | null {
  switch (a.type) {
    case 'stock_shelf': {
      const prod = productAt(state, it)!;
      const moved = moveItems(state, p.handsId, it.container!, prod, 1);
      if (moved) { a.units++; addXp(p, 'retail', 1); }
      const shelf = state.containers[it.container!];
      if (moved && count(h, prod) === 0) {
        // the empty case goes on the cardboard pile in the store room
        const b = state.businesses[it.businessId!];
        if (b && SHOPS[b.id]?.baler) b.cardboard = (b.cardboard ?? 0) + 1;
      }
      if (!moved || count(h, prod) === 0 || spaceFor(shelf, prod) === 0) {
        if (a.units >= 3) creditTask(state, p);
        if (count(shelf, prod) >= RESTOCK_DONE) completeTask(state, it.businessId!, 'restock', shelf.id, p.id);
        finish(state, p);
        return `Stocked ${a.units} ${itemName(prod)}${count(h, prod) ? ` (${count(h, prod)} left in case)` : ''}.`;
      }
      return null;
    }
    case 'serve_customer': {
      const till = state.tills[it.id];
      const custId = till.queue[0];
      const cust = custId ? state.people[custId] : null;
      if (!cust || dist(cust.pos, queueSlot(it.businessId!, 0)) > 1.5) { finish(state, p); return 'No customer at the till.'; }
      const basket = state.containers[cust.basketId];
      // scan one unscanned item
      for (const [item, n] of Object.entries(basket.items)) {
        if ((till.scanned[item] ?? 0) < n) {
          till.scanned[item] = (till.scanned[item] ?? 0) + 1;
          a.units++;
          return null;
        }
      }
      // everything scanned: take payment
      const sale = completeSale(state, it.businessId!, cust.id, p.id);
      completeTask(state, it.businessId!, 'serve', cust.id, p.id);
      leaveQueue(state, till.id, cust.id);
      if (cust.npc) cust.npc.step = 'paid';
      addXp(p, 'retail', 2);
      finish(state, p);
      return sale.ok ? `${cust.name}: ${sale.msg}` : `${cust.name} could not pay.`;
    }
    case 'clean': {
      const d = state.dirt[it.id];
      if (!d) { finish(state, p); return 'Already clean.'; }
      d.dirt -= 12;
      addXp(p, 'cleaning', 1);
      if (d.dirt <= 0) {
        delete state.dirt[it.id];
        completeTask(state, it.businessId!, 'clean', it.id, p.id);
        creditTask(state, p);
        finish(state, p);
        return 'Spill cleaned up.';
      }
      return null;
    }
    case 'face_shelf': {
      const b = state.businesses[it.businessId!];
      const m = b.messy ?? (b.messy = {});
      m[it.id] = Math.max(0, (m[it.id] ?? 0) - 9);
      a.units++;
      if (a.units % 3 === 0) addXp(p, 'retail', 1);
      if (m[it.id] <= 0) {
        completeTask(state, b.id, 'face', it.id, p.id);
        if (a.units >= 3) creditTask(state, p);
        finish(state, p);
        return `${itemName(productAt(state, it) ?? '')} faced up - labels forward, rows pulled to the front.`;
      }
      return null;
    }
    case 'bale_cardboard': {
      const b = state.businesses[it.businessId!];
      if ((b.cardboard ?? 0) > 0) { b.cardboard = (b.cardboard ?? 0) - 1; a.units++; addXp(p, 'warehouse', 1); }
      if (!b.cardboard) {
        completeTask(state, b.id, 'cardboard', it.id, p.id);
        creditTask(state, p);
        finish(state, p);
        return `Flattened ${a.units} box${a.units === 1 ? '' : 'es'} into the baler.`;
      }
      return null;
    }
    case 'pick_item': {
      const want = Number(a.arg ?? 1);
      const prod = productAt(state, it)!;
      const moved = moveItems(state, it.container!, p.basketId, prod, 1);
      if (moved) {
        a.units++;
        // shoppers reaching in pull the facings out of line
        const b = it.businessId ? state.businesses[it.businessId] : null;
        if (b) { const m = b.messy ?? (b.messy = {}); m[it.id] = Math.min(100, (m[it.id] ?? 0) + 3); }
      }
      if (!moved || a.units >= want) {
        finish(state, p);
        if (!moved && a.units === 0) return `${itemName(prod)} is out of stock.`;
        return `Added ${a.units} ${itemName(prod)} to your basket.`;
      }
      return null;
    }
    case 'wash_up': {
      const c = choresOf(p);
      if (c.dishes > 0) { c.dishes--; a.units++; }
      if (c.dishes <= 0) { finish(state, p); return `Washed and dried ${a.units} dish${a.units === 1 ? '' : 'es'}.`; }
      return null;
    }
    case 'site_work': {
      const st = currentStage(state);
      if (!st) { finish(state, p); return 'Nothing to do here.'; }
      if (st.id === 'walls') {
        if (!removeItems(h, 'bricks', 1)) { finish(state, p); return 'Out of bricks - fetch more from the pallet.'; }
      } else if (p.equipment !== `tool_${st.tool}`) { finish(state, p); return `You need the ${st.tool}.`; }
      a.units++;
      addXp(p, 'construction', st.xpPerUnit);
      const att = openAttendance(state, p.id);
      if (att && a.units % 10 === 0) att.tasks++;
      const done = addWork(state, 1);
      if (done) {
        // a new stage needs a different tool: put this one back first
        finish(state, p);
        return done;
      }
      if (st.id === 'walls' && count(h, 'bricks') === 0) { finish(state, p); return `Laid ${a.units} bricks - fetch more from the pallet.`; }
      if (st.id !== 'walls' && a.units * a.unitTime >= 30) { finish(state, p); return `${st.label.split(':')[0]}: ${Math.round(stageProgress(state) * 100)}% done.`; }
      return null;
    }
    case 'self_checkout': {
      const basket = state.containers[p.basketId];
      const scanned = a.units;
      if (scanned < total(basket)) { a.units++; return null; }
      const sale = completeSale(state, it.businessId!, p.id, null);
      finish(state, p);
      return sale.msg;
    }
  }
  finish(state, p);
  return null;
}

/** keep inventory honest when people leave a building */
export function enforceLocationRules(state: GameState, p: Person) {
  const loc = locationOf(p.pos);
  if (loc === p.where) return;
  const prev = p.where;
  p.where = loc;
  // warehouse stock stays in the warehouse
  if (prev === 'wholesale' && total(hands(state, p)) > 0) {
    moveAll(state, p.handsId, 'wholesale_stock');
    if (p.isPlayer) news(state, 'info', 'Stock stays in the warehouse', 'The cases you were carrying were put back on the racking.', true);
  }
  const S = SHOPS[prev];
  const b = state.businesses[prev];
  if (S && b && loc !== prev) {
    const basket = state.containers[p.basketId];
    if (total(basket) > 0) {
      for (const [item, n] of Object.entries({ ...basket.items })) {
        const sh = Object.entries(b.sections).find(([, prod]) => prod === item)?.[0];
        const moved = sh ? moveItems(state, basket.id, sh, item, n) : 0;
        if (moved < n) moveItems(state, basket.id, S.backroom, item, n - moved);
      }
      if (p.isPlayer) news(state, 'info', 'Basket left at the door', 'Unpaid items were returned to the shelves.', true);
    }
    const h = hands(state, p);
    const viaGoodsDoor = loc === 'outside' && Math.hypot(p.pos.x - S.dropZone.x, p.pos.z - S.dropZone.z) < 4;
    if (total(h) > 0 && !viaGoodsDoor) {
      moveAll(state, p.handsId, S.backroom);
      if (p.isPlayer) news(state, 'info', 'Stock stays in the shop', 'The case you were carrying was returned to the store room.', true);
    }
    if (p.equipment === 'mop') p.equipment = null;
    // the bin bag goes out through the goods door to the dumpster; anywhere else it is left by the door
    if (p.equipment === 'rubbish' && !viaGoodsDoor) { p.equipment = null; b.binFill = Math.min(BIN_CAPACITY, (b.binFill ?? 0) + 20); }
    const till = state.tills[S.till];
    if (till && till.queue.includes(p.id)) leaveQueue(state, till.id, p.id);
  }
}
