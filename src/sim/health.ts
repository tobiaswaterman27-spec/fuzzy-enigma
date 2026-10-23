// Health, violence and the law. People can be hurt (fights, weapons, being hit by a car, accidents at
// work, illness), bleed, collapse, be taken by ambulance to St Mary's and recover, or die. Attacks
// that are seen bring the police: officers come for you, and if they catch you it is a fine, a night
// in the cells or prison, and a criminal record. Everything uses the state's random stream.
import { settleMatch } from './stadium';
import { cellSpot } from './station';
import type { GameState, Id, Person, Vec2 } from './types';
import { clamp, dist, fmtMoney, nextId, rand, randInt } from './core';
import { lifeEvent, news } from './events';
import { die } from './life';
import { clearLine, resolveCircle } from './world/nav';
import { getWorld } from './world/layout';
import { goTo, homeDoor } from './npc';
import { transfer } from './ledger';
import { makePerson } from './newgame';
import { addItems, count, removeItems } from './inventory';
import { minuteOfDay, dayIndex } from './clock';

export const WEAPONS = {
  fists: { label: 'fists', verb: 'punched', min: 5, max: 12, bleed: 0, reach: 1.3, price: 0, item: '' },
  bat: { label: 'cricket bat', verb: 'hit', min: 14, max: 28, bleed: 0.04, reach: 1.7, price: 3500, item: 'cricket_bat' },
  knife: { label: 'kitchen knife', verb: 'stabbed', min: 18, max: 40, bleed: 0.5, reach: 1.25, price: 1200, item: 'kitchen_knife' },
} as const;
export type WeaponId = keyof typeof WEAPONS;

/** where people come out of hospital or the police station (the bus stop on Harbour Road) */
const RELEASE_NODE = 'bus_e';
export const HOSPITAL = 'Harbourside General Hospital';
const OFFICERS = ['PC Dawn Ellery', 'PC Marcus Webb', 'PC Ade Okafor'];

export const healthOf = (p: Person) => p.health ?? 100;
const active = (p: Person) => !p.dead && !p.left && !p.away && p.visible;
const playerOf = (state: GameState) => state.people[state.playerId];

/** the nearest person in front of the attacker within reach of what they are holding */
export function attackTarget(state: GameState, attackerId: Id): Person | null {
  const a = state.people[attackerId];
  const reach = WEAPONS[a.weapon ?? 'fists'].reach + 0.35;
  let best: Person | null = null, bestD = Infinity;
  for (const o of Object.values(state.people)) {
    if (o.id === a.id || !active(o) || o.where === 'vehicle') continue;
    const d = dist(a.pos, o.pos);
    if (d > reach || d >= bestD) continue;
    const ang = Math.atan2(o.pos.x - a.pos.x, o.pos.z - a.pos.z);
    const diff = Math.abs(((ang - a.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (diff > 1.1 && d > 0.6) continue;
    if (!clearLine(a.pos, o.pos, 0.05)) continue;
    best = o; bestD = d;
  }
  return best;
}

/** swing at someone (or at the air). Returns a line for the player, if there is one to say */
export function attack(state: GameState, attackerId: Id, targetId: Id | null): string | null {
  const a = state.people[attackerId];
  if (!a || a.action?.type === 'attack' || a.down || a.away || a.dead || a.sleeping) return null;
  if (a.action) a.action = null;
  const w: WeaponId = a.weapon ?? 'fists';
  const W = WEAPONS[w];
  // bare-handed, quick blows run into a combination: a punch, a flurry, then a kick
  const n = w === 'fists' && a.combo && state.minute - a.combo.at < 0.6 ? (a.combo.n + 1) % 3 : 0;
  a.combo = { n, at: state.minute };
  const swing = w !== 'fists' ? w : n === 2 ? 'kick' : n === 1 ? 'flurry' : 'fists';
  a.action = { type: 'attack', target: targetId ? `person:${targetId}` : 'air', arg: swing, started: state.minute, progress: 0, unitTime: 0, duration: w === 'bat' || swing === 'kick' ? 0.32 : 0.25, units: 0 };
  a.move = null;
  const t = targetId ? state.people[targetId] : null;
  if (!t || t.dead || t.away) return null;
  if (dist(a.pos, t.pos) > W.reach + 0.45) return null;
  a.facing = Math.atan2(t.pos.x - a.pos.x, t.pos.z - a.pos.z);
  // someone on their feet and sober can duck a punch now and then
  const dodge = t.down ? 0 : (t.drunk ?? 0) > 40 ? 0.05 : 0.15;
  if (rand(state) < dodge) {
    if (!a.isPlayer && !t.isPlayer) return null;
    if (!t.isPlayer) react(state, t, a, w);
    return a.isPlayer ? `${t.name.split(' ')[0]} dodged.` : null;
  }
  const heavy = swing === 'kick' || w === 'bat';
  const dmg = (W.min + rand(state) * (W.max - W.min)) * ((a.drunk ?? 0) > 50 ? 0.8 : 1) * (t.down ? 1.3 : 1) * (0.8 + (a.fitness ?? 40) / 250) * (swing === 'kick' ? 1.35 : 1);
  t.hit = { at: state.minute, dir: a.facing, heavy, by: a.id };
  // the blow knocks them back a step (a kick or a bat, further)
  if (!t.down) {
    const push = heavy ? 0.55 : 0.22;
    const to = resolveCircle({ x: t.pos.x + Math.sin(a.facing) * push, z: t.pos.z + Math.cos(a.facing) * push }, 0.3);
    if (Math.hypot(to.x - t.pos.x, to.z - t.pos.z) < push + 0.05) t.pos = to;
  }
  hurt(state, t, dmg, `${W.verb} by ${a.name}${w === 'fists' ? '' : ` with a ${W.label}`}`, a.id, W.bleed);
  // and sometimes off their feet: down for a few seconds, then back up
  if (!t.dead && !t.down && (heavy ? rand(state) < 0.4 : dmg >= 12 && rand(state) < 0.25)) floor(state, t, 1.1 + rand(state) * 0.7);
  if (!t.isPlayer && !t.dead) react(state, t, a, w);
  if (!a.police) witnessed(state, a, t, w);
  if (a.isPlayer) return t.dead ? `${t.name} is not moving.` : t.down ? `${t.name} goes down.` : null;
  if (t.isPlayer) return `${a.name} ${W.verb} you!`;
  return null;
}

/** damage someone: blood, injuries, collapsing, death */
export function hurt(state: GameState, p: Person, dmg: number, cause: string, byId: Id | null = null, bleed = 0) {
  if (p.dead || dmg <= 0) return;
  p.health = clamp(healthOf(p) - dmg, 0, 100);
  if (bleed) p.bleeding = Math.min(3, (p.bleeding ?? 0) + (bleed * dmg) / 20);
  if (dmg >= 9 || bleed) splash(state, p.pos, 0.18 + dmg / 90);
  p.needs.mood = clamp(p.needs.mood - dmg / 3, 0, 100);
  if (p.health <= 0) { kill(state, p, cause, byId); return; }
  if (p.health < 55) p.injured = { severity: Math.max(p.injured?.severity ?? 0, Math.round(100 - p.health)), cause, since: p.injured?.since ?? state.minute };
  if (p.health <= 20 && (p.down == null || p.downUntil != null)) knockDown(state, p);
}

/** blood on the ground */
export function splash(state: GameState, pos: Vec2, size: number) {
  const b = (state.blood ??= []);
  b.push({ id: nextId(state, 'blood'), pos: { x: pos.x + (rand(state) - 0.5) * 0.3, z: pos.z + (rand(state) - 0.5) * 0.3 }, at: state.minute, size: Math.min(0.9, size) });
  if (b.length > 60) b.splice(0, b.length - 60);
}

/** off their feet for a moment (a heavy blow, a car clipping them): they get up again by themselves */
export function floor(state: GameState, p: Person, minutes: number) {
  if (p.dead || p.down != null) return;
  p.down = state.minute;
  p.downUntil = state.minute + minutes;
  p.action = null; p.move = null; p.combat = null; p.sleeping = false;
  if (p.npc) { p.npc.plan = []; p.npc.nextDecision = p.downUntil + 0.2; }
}

export function knockDown(state: GameState, p: Person) {
  p.downUntil = null;
  p.down = state.minute;
  p.action = null; p.move = null; p.combat = null; p.fleeing = 0; p.sleeping = false;
  if (p.npc) { p.npc.plan = []; p.npc.nextDecision = state.minute + 9999; }
  if (p.isPlayer) news(state, 'bad', 'You collapse', 'Someone calls an ambulance.', true);
}

function kill(state: GameState, p: Person, cause: string, byId: Id | null) {
  p.down ??= state.minute;
  splash(state, p.pos, 0.8);
  p.bleeding = 0;
  const killer = byId ? state.people[byId] : null;
  if (p.isPlayer) {
    lifeEvent(state, p, `Died: ${cause}`);
    p.dead = { at: state.minute, cause };
    p.action = null; p.move = null;
    state.gameOver = { at: state.minute, cause };
    return;
  }
  die(state, p, cause, true);
  if (killer?.isPlayer) crime(state, 'murder', 5, p.id);
}

/** someone you hit fights back, or runs */
function react(state: GameState, t: Person, a: Person, w: WeaponId) {
  if (t.dead || t.down) return;
  t.relations[a.id] = Math.max(0, (t.relations[a.id] ?? 0) - 35);
  t.grudge = (t.grudge ?? 0) + 1;
  if (!t.history.some((e) => e.time > state.minute - 60 && e.text.includes(a.name))) lifeEvent(state, t, `Was attacked by ${a.name}`);
  if (t.police) { t.combat = { target: a.id, until: state.minute + 3, next: state.minute + 0.3 }; return; }
  const brave = w === 'fists' && healthOf(t) > 45 && t.traits.patience < 0.5 && (t.drunk ?? 0) < 70;
  if (brave) { t.combat = { target: a.id, until: state.minute + 2.5, next: state.minute + 0.35 }; t.fleeing = 0; return; }
  flee(state, t, a.pos);
}

/** run away from somewhere: to a spot well away, then carry on with the day */
export function flee(state: GameState, p: Person, from: Vec2) {
  if (p.isPlayer || p.down || p.dead) return;
  const w = getWorld();
  let best: Vec2 | null = null, bestScore = -Infinity;
  for (const n of Object.values(w.nodes)) {
    if (n.loc !== 'outside') continue;
    const dMe = Math.hypot(n.x - p.pos.x, n.z - p.pos.z);
    if (dMe > 45 || dMe < 8) continue;
    const score = Math.hypot(n.x - from.x, n.z - from.z) - dMe * 0.4;
    if (score > bestScore) { bestScore = score; best = { x: n.x, z: n.z }; }
  }
  p.action = null; p.combat = null;
  p.fleeing = state.minute + 3;
  if (p.npc) { p.npc.plan = []; p.npc.nextDecision = state.minute + 5; }
  if (best) goTo(state, p, best, 'away from trouble');
}

/** who saw it: bystanders run, think less of the attacker, and someone calls the police */
function witnessed(state: GameState, a: Person, t: Person, w: WeaponId) {
  let seen = !t.dead && !t.isPlayer;
  for (const o of Object.values(state.people)) {
    if (o === a || o === t || o.isPlayer || !active(o) || o.down) continue;
    if (dist(o.pos, t.pos) > 20 || !clearLine(o.pos, t.pos, 0.05)) continue;
    seen = true;
    o.relations[a.id] = Math.max(0, (o.relations[a.id] ?? 0) - 12);
    o.needs.mood = clamp(o.needs.mood - 6, 0, 100);
    if (o.police) { if (a.isPlayer || a.id !== o.combat?.target) o.combat = { target: a.id, until: state.minute + 3, next: state.minute + 0.3 }; continue; }
    if (!o.combat && (w !== 'fists' || t.down || o.traits.patience > 0.55)) flee(state, o, a.pos);
  }
  if (a.isPlayer && seen) crime(state, w === 'fists' ? (t.down ? 'assault causing injury' : 'common assault') : 'assault with a weapon', w === 'fists' ? (t.down ? 2 : 1) : 3, t.id);
}

/** the police now want the player */
export function crime(state: GameState, what: string, stars: number, victimId?: Id) {
  const cur = state.wanted;
  const v = victimId ? state.people[victimId] : null;
  const extra = v?.police ? 1 : 0;
  const level = Math.min(5, Math.max(cur?.level ?? 0, stars + extra) + (cur && cur.level >= stars ? 1 : 0));
  if (!cur || level > cur.level) news(state, 'bad', `Wanted by the police (${'★'.repeat(level)})`, `For ${what}${v ? ` (${v.name})` : ''}. Get out of sight to lose them, or they will arrest you.`, true);
  state.wanted = { level, unseen: 0, crime: cur && cur.level > stars ? cur.crime : what };
}

/** a car or van hits someone */
export function hitByVehicle(state: GameState, victimId: Id, driverId: Id, speed: number) {
  const t = state.people[victimId], d = state.people[driverId];
  if (!t || t.dead || !t.visible || Math.abs(speed) < 1.5) return;
  const dmg = speed * speed * 0.55 + 4;
  // sent flying the way the car was going (the view's ragdoll reads this)
  const car = Object.values(state.vehicles).find((v) => v.driverId === driverId);
  t.hit = { at: state.minute, dir: car?.heading ?? 0, heavy: true, by: driverId, force: Math.min(13, 2 + speed * 0.9) };
  hurt(state, t, dmg, `hit by ${d?.isPlayer ? 'your' : 'a'} car`, driverId, 0.03);
  if (!t.dead && !t.down && dmg > 14) knockDown(state, t);
  else if (!t.dead && !t.down) floor(state, t, 1.2 + rand(state) * 0.6);
  if (!t.dead && !t.down && !t.isPlayer) flee(state, t, d?.pos ?? t.pos);
  if (d?.isPlayer) {
    t.relations[d.id] = Math.max(0, (t.relations[d.id] ?? 0) - 30);
    const seen = Object.values(state.people).some((o) => o !== t && !o.isPlayer && active(o) && dist(o.pos, t.pos) < 25);
    if (seen || !t.dead) crime(state, t.dead ? 'causing death by dangerous driving' : 'dangerous driving', t.dead ? 4 : 2, t.id);
  }
}

/** taken in: hospital beds, police cells, prison */
export function sendAway(state: GameState, p: Person, place: 'hospital' | 'custody' | 'prison', minutes: number, reason: string) {
  p.away = { until: state.minute + minutes, reason, place };
  p.visible = false; p.where = place; p.down = null; p.action = null; p.move = null; p.combat = null; p.bleeding = 0; p.fleeing = 0; p.sleeping = false;
  for (const v of Object.values(state.vehicles)) if (v.driverId === p.id && v.kind !== 'van') { v.driverId = null; v.state = 'parked'; }
  if (place === 'hospital') p.health = Math.max(healthOf(p), 25);
  if (p.npc) { p.npc.plan = []; p.npc.goal = 'offsite'; p.npc.nextDecision = p.away.until; }
  // a night in the cells is spent where you can see it
  if (place === 'custody' && p.isPlayer) { const c = cellSpot(state, p); if (c) { p.visible = true; p.where = 'police'; p.pos = c; p.facing = Math.PI; } }
  lifeEvent(state, p, place === 'hospital' ? `Admitted to ${HOSPITAL} (${reason})` : place === 'prison' ? `Sent to prison (${reason})` : `Held in a police cell (${reason})`);
}

function release(state: GameState, p: Person) {
  const a = p.away!;
  p.away = null;
  if (a.place === 'hospital') { p.health = Math.max(healthOf(p), p.isPlayer ? 85 : 90); p.injured = null; }
  if (a.place === 'stadium') { p.pos = { ...(a.to ?? p.pos) }; p.visible = true; p.where = 'outside'; settleMatch(state, p.id); return; }
  if (a.place === 'bus' || a.place === 'train') { p.pos = { ...(a.to ?? p.pos) }; p.visible = true; p.where = 'outside'; return; }
  if (p.isPlayer) {
    const n = getWorld().nodes[a.place === 'custody' ? 'pol_out' : RELEASE_NODE];
    p.pos = n ? { x: n.x, z: n.z } : { x: 0, z: 0 };
    // out of the hospital's front doors
    const hosp = a.place === 'hospital' ? hospitalDoor() : null;
    if (hosp) p.pos = hosp;
    p.visible = true; p.where = 'outside';
    p.needs.energy = Math.max(p.needs.energy, 60); p.needs.satiety = Math.max(p.needs.satiety, 45);
    if (a.place === 'hospital') {
      const gov = state.businesses[state.governmentId];
      transfer(state, { from: p.accountId, to: gov.accountId, amount: 990, reason: 'public_service', memo: 'Prescription charge', key: `rx:${Math.floor(state.minute)}` });
      news(state, 'info', `Discharged from ${HOSPITAL}`, 'Patched up and sent home. Prescription charge £9.90. Take it easy for a while.', true);
    } else news(state, 'info', a.place === 'prison' ? 'Released from prison' : 'Released from the police station', 'You are free to go. It is on your record now.', true);
  } else {
    p.where = p.homeId ?? 'offsite';
    p.pos = homeDoor(p.homeId);
    p.visible = false;
    if (p.npc) { p.npc.goal = 'idle_home'; p.npc.nextDecision = state.minute; }
    if (a.place === 'hospital') lifeEvent(state, p, `Home from ${HOSPITAL}`);
  }
}

// ------------------------------------------------------------ police
function officerPool(state: GameState): Person[] {
  const out: Person[] = [];
  OFFICERS.forEach((name, i) => {
    const id = `police_${i + 1}`;
    let o = state.people[id];
    if (!o) {
      o = makePerson(state, id, name, { homeId: null, cash: 0, traits: { patience: 0.6, sociability: 0.5 } });
      o.appearance.outfit = 'uniform_police';
      o.police = true;
      o.age = 26 + i * 7;
      o.npc!.ambient = true;
      o.visible = false; o.where = 'offsite';
    }
    out.push(o);
  });
  return out;
}

function policeMinute(state: GameState) {
  const me = playerOf(state);
  const w = state.wanted;
  const pool = Object.values(state.people).filter((o) => o.police);
  if (!w || w.level <= 0 || me.dead || me.away) {
    // officers go back to the station
    // officers walk back to the station and go in (the sergeant stays at the desk)
    const door = getWorld().nodes.pol_in;
    for (const o of pool) {
      if (!o.visible || o.move || o.fixedJob || o.away) continue;
      o.combat = null;
      if (door && dist(o.pos, door) > 2 && dist(o.pos, door) < 120 && !(o.npc as any)?.homing) { goTo(state, o, door, 'the station'); (o.npc as any).homing = true; continue; }
      o.visible = false; o.where = 'offsite'; if (o.npc) (o.npc as any).homing = false;
    }
    return;
  }
  const officers = officerPool(state);
  const need = Math.min(officers.length, Math.ceil(w.level * 0.7));
  const nodes = Object.values(getWorld().nodes).filter((n) => n.loc === 'outside');
  for (const o of officers.slice(0, need)) {
    if (o.visible || o.down || o.dead || o.away) continue;
    // out of the station door if it is near, otherwise a car drops them off down the road
    const st = getWorld().nodes.pol_out;
    const near = st && Math.hypot(st.x - me.pos.x, st.z - me.pos.z) < 75;
    const spot = near ? st : nodes.filter((n) => { const d = Math.hypot(n.x - me.pos.x, n.z - me.pos.z); return d > 28 && d < 55; })[randInt(state, 0, 30)] ?? nodes[0];
    o.pos = { x: spot.x, z: spot.z };
    o.visible = true; o.where = 'outside'; o.health = 100; if (o.npc) (o.npc as any).homing = false;
  }
  let sees = false;
  for (const o of officers) {
    if (!active(o) || o.down) continue;
    const d = dist(o.pos, me.pos);
    // in sight, or close behind you and closing in
    if ((d < 25 && me.visible && clearLine(o.pos, me.pos, 0.05)) || d < 40) sees = true;
    if (!o.action && me.visible && me.where !== 'vehicle' && (!o.move || dist(o.move.dest, me.pos) > 3)) goTo(state, o, me.pos, 'the suspect');
  }
  if (sees) w.unseen = 0;
  else if (++w.unseen >= 10 + w.level * 4) {
    w.level--; w.unseen = 0;
    if (w.level <= 0) { state.wanted = null; news(state, 'good', 'The police have lost you', 'For now. People round here remember, though.', true); }
  }
}

/** an officer close enough takes the player in */
function policeCatch(state: GameState) {
  const me = playerOf(state);
  const w = state.wanted;
  if (!w || !me.visible || me.where === 'vehicle' || me.dead || me.away) return;
  const cop = Object.values(state.people).find((o) => o.police && active(o) && !o.down && dist(o.pos, me.pos) < 1.4);
  if (cop) arrest(state, cop);
}

export function arrest(state: GameState, cop: Person) {
  const me = playerOf(state);
  const w = state.wanted!;
  const fine = w.level * 15000;
  const r = fine ? transfer(state, { from: me.accountId, to: state.businesses[state.governmentId].accountId, amount: fine, reason: 'fine', memo: `Court fine: ${w.crime}`, key: `fine:${Math.floor(state.minute)}` }) : { ok: true };
  const prison = w.level >= 4;
  const minutes = prison ? (w.level >= 5 ? 28 : 7) * 1440 : (w.level * 4 + (r.ok ? 0 : 12)) * 60;
  (me.record ??= []).push(`${w.crime} (day ${dayIndex(state.minute) + 1})`);
  for (const k of ['bat', 'knife'] as const) removeItems(state.containers[me.bagId], WEAPONS[k].item, 99);
  me.weapon = null;
  news(state, 'bad', `Arrested by ${cop.name}`, `${w.crime[0].toUpperCase()}${w.crime.slice(1)}. ${fine ? `Fined ${fmtMoney(fine)}${r.ok ? '' : ' (you could not pay: longer in custody)'}. ` : ''}${prison ? `Sentenced to ${Math.round(minutes / 1440)} days in prison.` : `Held overnight in the cells.`} Your weapons were taken.`, true);
  sendAway(state, me, prison ? 'prison' : 'custody', minutes, w.crime);
  state.wanted = null;
  for (const o of Object.values(state.people)) if (o.police) { o.combat = null; o.move = null; }
}

// ------------------------------------------------------------ ticks
/** fights, bleeding: every sub-step */
export function healthSubstep(state: GameState, dt: number) {
  for (const p of Object.values(state.people)) {
    if (p.dead || p.away) continue;
    // back on their feet after being knocked over
    if (p.downUntil != null && p.down != null && state.minute >= p.downUntil) {
      p.down = null; p.downUntil = null;
      const by = p.hit ? state.people[p.hit.by] : null;
      if (p.npc) { p.npc.nextDecision = state.minute; if (by && !by.dead) react(state, p, by, by.weapon ?? 'fists'); }
    }
    if ((p.bleeding ?? 0) > 0) {
      p.bleeding = Math.max(0, p.bleeding! - 0.025 * dt);
      p.health = healthOf(p) - p.bleeding! * dt;
      if (rand(state) < 0.15 * dt * p.bleeding! + (p.move ? 0.1 * dt : 0)) splash(state, p.pos, 0.08 + p.bleeding! * 0.08);
      if (p.health <= 0) { p.health = 0; kill(state, p, `bled to death (${p.injured?.cause ?? 'wounds'})`, null); continue; }
      if (p.health <= 20 && !p.down) knockDown(state, p);
    }
    const c = p.combat;
    if (c && !p.down) {
      const t = state.people[c.target];
      if (state.minute > c.until || !t || t.dead || t.down || t.away || !t.visible) { p.combat = null; continue; }
      const d = dist(p.pos, t.pos);
      if (d < (p.police ? 1.2 : 1.3)) {
        p.move = null;
        p.facing = Math.atan2(t.pos.x - p.pos.x, t.pos.z - p.pos.z);
        if (state.minute >= c.next && !p.action) {
          c.next = state.minute + 0.45 + rand(state) * 0.35;
          c.until = Math.max(c.until, state.minute + 1);
          if (!(p.police && t.isPlayer)) attack(state, p.id, t.id);
        }
      } else if (d < 14) {
        if (!p.move || dist(p.move.dest, t.pos) > 1.5) goTo(state, p, t.pos, t.name);
      } else p.combat = null;
    }
  }
  policeCatch(state);
}

/** recovery, ambulances, discharge, sobering up, police: every game minute */
export function healthMinute(state: GameState) {
  for (const p of Object.values(state.people)) {
    if (p.left) continue;
    if (p.away) { if (state.minute >= p.away.until) release(state, p); continue; }
    if (p.dead) {
      // the body is taken away once the police and ambulance have been
      if (p.visible && !p.isPlayer && state.minute - p.dead.at > 12) { p.visible = false; p.where = 'offsite'; }
      continue;
    }
    if (p.drunk) p.drunk = Math.max(0, p.drunk - 0.17);
    if (p.down !== null && p.down !== undefined && p.downUntil == null) {
      // an ambulance: a few minutes for someone in the street, sooner for you
      if (state.minute - p.down >= (p.isPlayer ? 1.5 : 8)) {
        const sev = p.injured?.severity ?? 60;
        sendAway(state, p, 'hospital', p.isPlayer ? 240 + sev * 18 : (1 + Math.round(sev / 30)) * 1440, p.injured?.cause ?? 'collapsed');
        if (!p.isPlayer) news(state, 'bad', `${p.name} taken to ${HOSPITAL}`, `An ambulance came for ${p.name.split(' ')[0]} (${p.injured?.cause ?? 'collapsed'}).`, (playerOf(state).relations[p.id] ?? 0) >= 20);
      }
      continue;
    }
    if (!(p.bleeding ?? 0) && healthOf(p) < 100) {
      p.health = Math.min(100, healthOf(p) + (p.sleeping ? 0.05 : 0.02));
      if (p.injured && healthOf(p) >= 70) p.injured = null;
    }
    if (p.fleeing && state.minute > p.fleeing) p.fleeing = 0;
  }
  if (state.blood?.length) state.blood = state.blood.filter((b) => state.minute - b.at < 1440);
  policeMinute(state);
}

/** daily: illness, accidents at work and the odd late-night scuffle happen to other people too */
export function healthDaily(state: GameState) {
  const day = dayIndex(state.minute);
  const people = Object.values(state.people).filter((p) => !p.isPlayer && p.npc && !p.npc.ambient && !p.police && !p.dead && !p.left && !p.away);
  for (const p of people) {
    const r = rand(state);
    if (r < 0.012) {
      const ill = ['the flu', 'a chest infection', 'a nasty stomach bug', 'shingles'][randInt(state, 0, 3)];
      hurt(state, p, 25 + rand(state) * 25, ill);
      lifeEvent(state, p, `Came down with ${ill}`);
      if (healthOf(p) < 35) sendAway(state, p, 'hospital', randInt(state, 2, 4) * 1440, ill);
    } else if (r < 0.016 && p.contractId) {
      const c = state.contracts[p.contractId];
      if (c && /wholesale|site|construction/.test(c.businessId)) {
        const what = c.businessId.includes('wholesale') ? 'hurt their back lifting at the warehouse' : 'fell from a scaffold on the building site';
        hurt(state, p, 30 + rand(state) * 30, what);
        lifeEvent(state, p, what[0].toUpperCase() + what.slice(1));
        news(state, 'bad', `Accident at work: ${p.name}`, `${p.name.split(' ')[0]} ${what}.`, false);
        if (healthOf(p) < 40) sendAway(state, p, 'hospital', randInt(state, 1, 3) * 1440, 'accident at work');
      }
    }
  }
  // Friday and Saturday nights: trouble outside the cafe after closing
  if ((day % 7 === 4 || day % 7 === 5) && rand(state) < 0.2 && people.length > 3) {
    const a = people[randInt(state, 0, people.length - 1)], b = people[randInt(state, 0, people.length - 1)];
    if (a !== b) {
      hurt(state, b, 12 + rand(state) * 20, `punched by ${a.name}`);
      a.relations[b.id] = 0; b.relations[a.id] = 0; b.grudge = (b.grudge ?? 0) + 1;
      lifeEvent(state, a, `Got into a fight with ${b.name}`);
      lifeEvent(state, b, `Was punched by ${a.name} after a night out`);
      splash(state, { x: -6 + rand(state) * 3, z: 8 + rand(state) * 2 }, 0.3);
      news(state, 'info', 'Late-night scuffle in town', `${a.name} and ${b.name} came to blows after a night out. Police are asking for witnesses.`, false);
    }
  }
}

// ------------------------------------------------------------ the player's choices
/** cycle through fists and the weapons you own */
export function nextWeapon(state: GameState, id: Id): string {
  const p = state.people[id];
  const bag = state.containers[p.bagId];
  const owned: (WeaponId | null)[] = [null, ...(['bat', 'knife'] as const).filter((k) => count(bag, WEAPONS[k].item) > 0)];
  if (owned.length === 1) { p.weapon = null; return 'You have no weapons. Harbour Home sells cricket bats and kitchen knives.'; }
  const i = owned.indexOf(p.weapon ?? null);
  p.weapon = owned[(i + 1) % owned.length] as 'bat' | 'knife' | null;
  return p.weapon ? `Holding: ${WEAPONS[p.weapon].label}. Press F to use it.` : 'Weapon put away.';
}

export function buyWeapon(state: GameState, id: Id, k: WeaponId, sellerAccount: Id): { ok: boolean; msg: string } {
  const p = state.people[id];
  const W = WEAPONS[k];
  if (!W.item) return { ok: false, msg: 'Nothing to buy.' };
  if (count(state.containers[p.bagId], W.item) > 0) return { ok: false, msg: `You already have a ${W.label}.` };
  const r = transfer(state, { from: p.accountId, to: sellerAccount, amount: W.price, reason: 'purchase', memo: W.label, key: `weapon:${k}:${Math.floor(state.minute * 4)}` });
  if (!r.ok) return { ok: false, msg: r.error };
  addItems(state.containers[p.bagId], W.item, 1);
  return { ok: true, msg: `Bought a ${W.label} (${fmtMoney(W.price)}). Press Q to hold it.` };
}

/** go to A&E yourself: a few hours waiting and being seen */
/** the front doors of Harbourside General (in the city, Station Road) */
export function hospitalDoor(): { x: number; z: number } | null {
  const b = getWorld().buildings.find((c) => c.name === HOSPITAL);
  return b ? { x: (b.rect.x0 + b.rect.x1) / 2, z: b.rect.z1 + 2.5 } : null;
}

export function goToAandE(state: GameState, id: Id): { ok: boolean; msg: string } {
  const p = state.people[id];
  if (healthOf(p) >= 90 && !p.injured) return { ok: false, msg: 'You are fine. A&E is for injuries.' };
  sendAway(state, p, 'hospital', 180 + Math.round((100 - healthOf(p)) * 6), 'A&E visit');
  const door = hospitalDoor();
  const there = door && Math.hypot(p.pos.x - door.x, p.pos.z - door.z) < 12;
  return { ok: true, msg: there ? 'You book in at A&E and wait to be seen.' : `You take the bus to ${HOSPITAL}.` };
}

export const isNight = (state: GameState) => { const m = minuteOfDay(state.minute); return m < 6 * 60 || m > 22 * 60; };

// ------------------------------------------------------------ robbery
/** demand the takings at a counter. Without a weapon the staff refuse (or come at you) there and then;
 * with one, the robbery plays out: the clerk opens the till, takes the cash out and hands it over, and
 * the money only changes hands at the end (finishRob). */
export function startRob(state: GameState, robberId: Id, businessId: Id, tillId: Id): { ok: boolean; msg: string; acted?: boolean } {
  void tillId;
  const me = state.people[robberId];
  const b = state.businesses[businessId];
  if (!b) return { ok: false, msg: '' };
  const staff = Object.values(state.people).filter((o) => !o.isPlayer && o.visible && !o.dead && o.down == null && dist(o.pos, me.pos) < 8 && (o.contractId ? state.contracts[o.contractId]?.businessId === businessId : false));
  const clerk = staff.sort((x, y) => dist(x.pos, me.pos) - dist(y.pos, me.pos))[0];
  if (!clerk) return { ok: false, msg: 'There is nobody at the counter.' };
  clerk.facing = Math.atan2(me.pos.x - clerk.pos.x, me.pos.z - clerk.pos.z);
  clerk.relations[me.id] = 0;
  for (const o of Object.values(state.people)) if (!o.isPlayer && o !== clerk && o.visible && dist(o.pos, me.pos) < 15 && !o.police) flee(state, o, me.pos);
  if (!me.weapon) {
    if (clerk.traits.patience < 0.4 && healthOf(clerk) > 50) {
      clerk.combat = { target: me.id, until: state.minute + 3, next: state.minute + 0.3 };
      crime(state, 'attempted robbery', 2, clerk.id);
      return { ok: true, msg: `${clerk.name.split(' ')[0]} comes over the counter at you!` };
    }
    clerk.gesture = { clip: 'argue', until: state.minute + 1 };
    crime(state, 'attempted robbery', 2, clerk.id);
    return { ok: true, msg: `${clerk.name.split(' ')[0]} refuses and hits the alarm.` };
  }
  // the clerk does as they are told, step by step
  clerk.action = { type: 'hand_over_cash', target: `person:${robberId}`, started: state.minute, progress: 0, unitTime: 0, duration: 1.3, units: 0 };
  clerk.move = null;
  if (clerk.npc) clerk.npc.plan = [{ kind: 'wait', until: state.minute + 3 }];
  state.robbery = { robber: robberId, clerk: clerk.id, business: businessId };
  return { ok: true, msg: '', acted: true };
}

/** the end of the hold-up: the cash is yours, and the police are on their way */
export function finishRob(state: GameState, robberId: Id): string {
  const r = state.robbery;
  if (!r || r.robber !== robberId) return '';
  state.robbery = null;
  const me = state.people[robberId], clerk = state.people[r.clerk], b = state.businesses[r.business];
  if (!clerk || !b || clerk.down != null || clerk.dead) return 'You get nothing.';
  const bal = state.ledger.accounts[b.accountId]?.balance ?? 0;
  const take = Math.max(0, Math.min(40000, Math.round(bal * 0.08)));
  if (take > 0) transfer(state, { from: b.accountId, to: me.accountId, amount: take, reason: 'transfer', memo: 'Cash from a till', key: `robbery:${r.business}:${Math.floor(state.minute)}` });
  clerk.gesture = { clip: 'scared', until: state.minute + 1.5 };
  clerk.needs.mood = clamp(clerk.needs.mood - 30, 0, 100);
  lifeEvent(state, clerk, `Held up at ${b.name} by ${me.name}`);
  news(state, 'bad', `Armed robbery at ${b.name}`, `A ${me.weapon === 'knife' ? 'knife' : 'bat'}-wielding robber took ${fmtMoney(take)} from the till. Police are looking for them.`, false);
  crime(state, 'armed robbery', 4, clerk.id);
  return `${fmtMoney(take)} in your pocket. Now run.`;
}

/** the old one-step form, still used by tests and the no-weapon path */
export function robTill(state: GameState, robberId: Id, businessId: Id): string {
  const r = startRob(state, robberId, businessId, 'till');
  if (!r.acted) return r.msg;
  const c = state.robbery ? state.people[state.robbery.clerk] : null;
  if (c) c.action = null;
  const m = finishRob(state, robberId);
  return m.includes('pocket') ? `${c?.name.split(' ')[0] ?? 'The clerk'} empties the till for you with shaking hands: ${m}` : m;
}
