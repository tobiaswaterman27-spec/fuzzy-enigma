// Early-game guidance. Each objective is checked against authoritative state.
import type { GameState, Objective, Vec2 } from './types';
import { activeLease } from './housing';
import { fmtClock } from './clock';
import { nextShift, openAttendance, positionOf } from './employment';
import { workplaceOf } from './npc';
import { getWorld } from './world/layout';
import { planRoute, routeLength } from './world/nav';
import { inWash, isDirty } from './home';
import { itemName } from './items';

export const OBJECTIVES: { id: string; text: string; done: (s: GameState) => boolean }[] = [
  { id: 'find_job', text: 'Find work: check the vacancy board at the Job Centre (or Phone > Jobs)', done: (s) => !!s.flags.viewedJobs },
  { id: 'apply', text: 'Apply for the Retail Assistant job at Corner Market', done: (s) => Object.values(s.applications).some((a) => a.personId === s.playerId) },
  { id: 'interview', text: 'Wait for an interview invitation (Phone > Jobs). Interviews are held over a coffee at Tidewater Cafe; you will be reminded when to set off - smart clothes help.', done: (s) => Object.values(s.applications).some((a) => a.personId === s.playerId && (a.status === 'offered' || a.status === 'accepted')) || Object.values(s.contracts).some((c) => c.personId === s.playerId) },
  { id: 'accept', text: 'Accept the job offer (Phone > Jobs)', done: (s) => Object.values(s.contracts).some((c) => c.personId === s.playerId) },
  { id: 'uniform', text: 'Put on your uniform at the wardrobe in your flat', done: (s) => s.people[s.playerId].appearance.outfit === 'uniform_market' || !!s.flags.clockedInOnce },
  { id: 'clock_in', text: 'Your first shift is booked - you will be reminded when it is time to set off. Clock in at the staff terminal in the store room.', done: (s) => !!s.flags.clockedInOnce },
  { id: 'work', text: 'Work your shift: serve customers, restock shelves, clean spills, then clock out', done: (s) => Object.values(s.attendance).some((a) => s.contracts[a.contractId].personId === s.playerId && a.closed && !a.absent) },
  { id: 'wage', text: 'Receive your wages (paid at 22:00 after each shift)', done: (s) => s.ledger.txns.some((t) => t.reason === 'wage' && t.to === s.people[s.playerId].accountId) || !!s.flags.paidOnce },
  { id: 'food', text: 'Buy groceries at Corner Market and eat at home', done: (s) => !!s.flags.ateHome },
  { id: 'rent', text: 'Keep enough money for Monday\'s rent (Phone > Bank shows obligations)', done: (s) => { const l = activeLease(s, s.playerId); return !!l && l.paidThroughDay > 7; } },
];

export function initObjectives(): Objective[] {
  return OBJECTIVES.map((o) => ({ id: o.id, text: o.text, done: false }));
}

export function tickObjectives(state: GameState) {
  for (const o of state.objectives) {
    if (o.done) continue;
    const def = OBJECTIVES.find((d) => d.id === o.id);
    if (def?.done(state)) o.done = true;
  }
  if (state.ledger.txns.some((t) => t.reason === 'wage' && t.to === state.people[state.playerId].accountId)) state.flags.paidOnce = true;
}

export function currentObjective(state: GameState): Objective | null {
  return state.objectives.find((o) => !o.done) ?? null;
}

// ---------------------------------------------------------------- agenda
/** metres the player covers per game minute when walking (2 m/s at 1/3 game minute per second) */
const PLAYER_M_PER_MIN = 6;

export interface Reminder { text: string; urgent: boolean; leaveAt: number; startsAt: number }

function walkMinutes(from: Vec2, to: Vec2): number {
  const r = planRoute(from, to);
  return (r ? routeLength(from, r) : Math.hypot(to.x - from.x, to.z - from.z) * 1.4) / PLAYER_M_PER_MIN;
}

/** The next commitment the player should act on, but only once it is nearly time to leave:
 * the reminder accounts for the walk from where they are now and for changing clothes first. */
export function agenda(state: GameState): Reminder | null {
  const p = state.people[state.playerId];
  const now = state.minute;
  // driving a delivery: where to, and how far
  const car = Object.values(state.vehicles).find((v) => v.kind === 'car' && v.driverId === p.id);
  if (car) return { text: 'Driving your car: W/S drive, A/D steer, E to park and get out.', urgent: false, leaveAt: now, startsAt: now };
  const van = Object.values(state.vehicles).find((v) => v.kind === 'van' && v.driverId === p.id);
  if (van) {
    const sh = van.shipmentId ? state.shipments[van.shipmentId] : null;
    const shop = sh ? state.businesses[sh.buyerId]?.name : 'the shop';
    if (van.state === 'loaded') return { text: `The van is loaded for ${shop}: get in at the depot by Harbour Wholesale.`, urgent: true, leaveAt: now, startsAt: now };
    const dest = van.state === 'manual_back' ? getWorld().depot : van.route[van.route.length - 1];
    const m = dest ? Math.round(Math.hypot(dest.x - van.pos.x, dest.z - van.pos.z)) : 0;
    if (van.state === 'manual_out') return { text: `Drive to ${shop}'s loading bay - ${m} m (W/S drive, A/D steer).`, urgent: false, leaveAt: now, startsAt: now };
    if (van.state === 'unloading') return { text: `Unloading at ${shop}...`, urgent: false, leaveAt: now, startsAt: now };
    if (van.state === 'manual_back') return { text: `Drive the van back to the depot - ${m} m.`, urgent: false, leaveAt: now, startsAt: now };
  }
  const items: { what: string; at: number; where: Vec2; place: string; outfit?: string; strict: boolean }[] = [];
  for (const a of Object.values(state.applications)) {
    if (a.personId !== p.id || a.status !== 'interview' || a.interviewAt == null || a.interviewAt < now - 10) continue;
    const v = state.vacancies[a.vacancyId];
    const iv = a.interviewerId ? state.people[a.interviewerId] : null;
    void v;
    items.push({ what: `interview${iv ? ` with ${iv.name}` : ''}`, at: a.interviewAt, where: getWorld().interactables.iv_chair.pos, place: 'Tidewater Cafe (window table)', outfit: 'outfit_smart', strict: false });
  }
  for (const m of state.meetups ?? []) {
    if (m.status !== 'planned') continue;
    items.push({ what: `coffee with ${state.people[m.friendId].name.split(' ')[0]}`, at: m.at, where: getWorld().interactables.meet_chair.pos, place: 'Tidewater Cafe (corner table)', strict: false });
  }
  if (p.contractId && !openAttendance(state, p.id)) {
    const c = state.contracts[p.contractId];
    const sh = nextShift(c, now - 30);
    const pos = positionOf(state, c);
    if (sh && sh.start > now - 60) items.push({ what: 'shift', at: sh.start, where: workplaceOf(c.businessId, c.positionId).pos, place: state.businesses[c.businessId].name, outfit: pos?.uniform ?? undefined, strict: true });
  }
  let best: Reminder | null = null;
  for (const it of items) {
    let travel = walkMinutes(p.pos, it.where);
    let prep = 0;
    const needsChange = it.outfit && p.appearance.outfit !== it.outfit;
    if (needsChange && p.homeId) {
      const wardrobe = getWorld().interactables.wardrobe;
      travel = walkMinutes(p.pos, wardrobe.pos) + walkMinutes(wardrobe.pos, it.where);
      prep = 5;
    }
    const leaveAt = Math.floor(it.at - travel - prep - 5);
    // nothing to say until shortly before it is time to set off
    if (now < leaveAt - 20) continue;
    const late = now > it.at;
    const walk = Math.max(1, Math.round(travel));
    let text: string;
    if (late) text = `You are late for your ${it.what} at ${it.place} (${fmtClock(it.at)}). Go now - about ${walk} min away.`;
    else if (now >= leaveAt) text = `Leave now for your ${it.what} at ${it.place} at ${fmtClock(it.at)} - about ${walk} min walk${needsChange ? (it.strict ? ', change into your uniform first' : ', smart clothes recommended') : ''}.`;
    else text = `Get ready: ${it.what} at ${it.place} at ${fmtClock(it.at)}. Set off by ${fmtClock(leaveAt)} (${walk} min walk${needsChange ? (it.strict ? ' + changing into uniform' : ' + changing') : ''}).`;
    const r = { text, urgent: late || now >= leaveAt, leaveAt, startsAt: it.at };
    if (!best || r.startsAt < best.startsAt) best = r;
  }
  if (best) return best;
  // laundry: a grubby uniform with a shift coming up, or a finished wash waiting in the machine
  const c = p.chores;
  if (c?.washer && now >= c.washer.until && p.where !== p.homeId) return { text: 'Your washing is done - unload the machine when you are home.', urgent: false, leaveAt: now, startsAt: now };
  if (p.contractId) {
    const ct = state.contracts[p.contractId];
    const sh = nextShift(ct, now);
    const u = positionOf(state, ct)?.uniform;
    if (sh && u && isDirty(p, u) && !inWash(p, u) && sh.start - now < 16 * 60) return { text: `Your ${itemName(u)} is dirty - put a wash on before your ${fmtClock(sh.start)} shift (the machine takes 75 min).`, urgent: false, leaveAt: now, startsAt: sh.start };
  }
  return null;
}
