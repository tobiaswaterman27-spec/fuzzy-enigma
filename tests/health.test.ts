import { describe, expect, it } from 'vitest';
import { createNewGame, step, attack, hurt, crime, residents, initLife, hitByVehicle, buyWeapon, nextWeapon, auditLedger, healthDaily, startAction, getWorld, type GameState } from '../src/sim/index';

const setup = { name: 'Tester', appearance: { skin: '#e3b48f', hair: 'short' as const, hairColor: '#3b2416', build: 'average' as const } };

function nearby(s: GameState) {
  const me = s.people.player;
  me.pos = { x: 0, z: 2 }; me.where = 'outside'; me.visible = true; me.facing = 0;
  const v = residents(s).find((p) => !p.dead)!;
  v.visible = true; v.where = 'outside'; v.pos = { x: 0, z: 2.9 }; v.move = null; v.action = null;
  return { me, v };
}

describe('Health, violence and the law', () => {
  it('a punch hurts, the victim reacts, witnesses mean the police want you, and they arrest you', () => {
    const s = createNewGame(7, setup);
    initLife(s);
    const { me, v } = nearby(s);
    v.traits.patience = 0.9; // will run, not fight
    const w = residents(s).find((p) => p !== v)!;
    w.visible = true; w.where = 'outside'; w.pos = { x: 3, z: 4 }; w.move = null; w.action = null;
    let hits = 0;
    for (let i = 0; i < 6 && hits === 0; i++) { me.action = null; attack(s, me.id, v.id); if ((v.health ?? 100) < 100) hits++; }
    expect(v.health).toBeLessThan(100);
    expect(s.wanted?.level).toBeGreaterThanOrEqual(1);
    expect(v.relations[me.id] ?? 0).toBe(0);
    // stand still: the police come and take you in
    for (let i = 0; i < 400 && !me.away; i++) { step(s, 0.25); me.pos = { x: 0, z: 2 }; }
    expect(me.away?.place).toBe('custody');
    expect(me.record?.length).toBe(1);
    expect(s.wanted ?? null).toBeNull();
    s.minute = me.away!.until + 1;
    step(s, 1);
    expect(me.away ?? null).toBeNull();
    expect(me.visible).toBe(true);
    expect(auditLedger(s)).toEqual([]);
  });

  it('serious injuries put people on the ground; an ambulance takes them to hospital and they come home', () => {
    const s = createNewGame(7, setup);
    initLife(s);
    const { v } = nearby(s);
    hurt(s, v, 85, 'fell off a ladder');
    expect(v.down).not.toBeNull();
    for (let i = 0; i < 12; i++) step(s, 1);
    expect(v.away?.place).toBe('hospital');
    s.minute = v.away!.until + 0.5;
    step(s, 1);
    expect(v.away ?? null).toBeNull();
    expect(v.health).toBeGreaterThanOrEqual(90);
    expect(v.injured ?? null).toBeNull();
  });

  it('knife wounds bleed; enough damage kills, leaving blood and a body that is taken away', () => {
    const s = createNewGame(7, setup);
    initLife(s);
    const { v } = nearby(s);
    hurt(s, v, 40, 'stabbed', null, 0.5);
    expect(v.bleeding).toBeGreaterThan(0);
    const h = v.health!;
    step(s, 2);
    expect(v.health!).toBeLessThan(h);
    expect(s.blood!.length).toBeGreaterThan(0);
    hurt(s, v, 100, 'stabbed');
    expect(v.dead).toBeTruthy();
    expect(v.visible).toBe(true);
    for (let i = 0; i < 15; i++) step(s, 1);
    expect(v.visible).toBe(false);
  });

  it('the player can buy and hold weapons; being hit by a car is a crime; the player can die', () => {
    const s = createNewGame(7, setup);
    initLife(s);
    const { me, v } = nearby(s);
    expect(nextWeapon(s, me.id)).toMatch(/no weapons/);
    expect(buyWeapon(s, me.id, 'bat', s.businesses.homestore.accountId).ok).toBe(true);
    expect(nextWeapon(s, me.id)).toMatch(/cricket bat/);
    expect(me.weapon).toBe('bat');
    hitByVehicle(s, v.id, me.id, 10);
    expect(v.health).toBeLessThan(60);
    expect(s.wanted?.level).toBeGreaterThanOrEqual(2);
    crime(s, 'test', 1);
    hurt(s, me, 200, 'hit by a bus');
    expect(s.gameOver?.cause).toBe('hit by a bus');
    expect(auditLedger(s)).toEqual([]);
  });

  it('a pint goes to your head; townspeople get ill and have accidents in the background', () => {
    const s = createNewGame(7, setup);
    initLife(s);
    const me = s.people.player;
    const it = getWorld().interactables.cafe_counter;
    s.minute = Math.floor(s.minute / 1440) * 1440 + 13 * 60;
    me.pos = { ...it.pos }; me.where = it.locationId;
    const r = startAction(s, me.id, 'cafe_counter', 'buy_pint');
    if (r.ok) { let g = 0; while (me.action && g++ < 200) step(s, 0.25); expect(me.drunk ?? 0).toBeGreaterThan(10); }
    for (let d = 0; d < 60; d++) { s.minute += 1440; healthDaily(s); }
    const hist = residents(s).flatMap((p) => p.history.map((e) => e.text)).join(' | ');
    expect(hist).toMatch(/Came down with|hurt their back|scaffold|fight|punched/);
  });
});

describe('Houses', () => {
  it('knocking: strangers keep the door shut, friends let you in; breaking in and taking cash is burglary', async () => {
    const { knock, breakIn, searchValuables, houseOpen, HOUSE_IDS, residents: res, initLife: init } = await import('../src/sim/index');
    const s = createNewGame(7, setup);
    init(s);
    const me = s.people.player;
    s.minute = Math.floor(s.minute / 1440) * 1440 + 14 * 60;
    const h = HOUSE_IDS.find((id) => res(s).some((p) => p.homeId === id))!;
    const r = res(s).find((p) => p.homeId === h)!;
    r.where = h; r.visible = false; r.sleeping = false;
    r.relations[me.id] = 0;
    knock(s, me.id, h);
    expect(houseOpen(s, h)).toBe(false);
    for (let i = 0; i < 16; i++) step(s, 0.25);
    expect(houseOpen(s, h)).toBe(false);
    expect(s.doorCall?.stage).toBe('done');
    // they are in again (and staying in) when you come back as a friend
    r.where = h; r.visible = false; r.move = null; r.action = null; r.npc!.plan = []; r.npc!.nextDecision = s.minute + 600;
    r.relations[me.id] = 60;
    knock(s, me.id, h);
    expect(houseOpen(s, h)).toBe(false);
    // a moment later they come to the door and open it, and you are let in
    for (let i = 0; i < 6; i++) step(s, 0.25);
    expect(s.doorCall?.stage).toBe('open');
    expect(r.visible).toBe(true);
    expect(houseOpen(s, h)).toBe(true);
    // another house, nobody home, quiet street: force the door and take the cash
    const h2 = HOUSE_IDS.find((id) => id !== h && res(s).some((p) => p.homeId === id))!;
    for (const p of res(s)) if (p.homeId === h2) { p.where = 'outside'; p.visible = true; p.pos = { x: 80, z: -30 }; }
    me.pos = { x: 0, z: 70 };
    breakIn(s, me.id, h2);
    expect(houseOpen(s, h2)).toBe(true);
    const before = s.ledger.accounts[me.accountId].balance;
    searchValuables(s, me.id, h2);
    expect(s.ledger.accounts[me.accountId].balance).toBeGreaterThan(before);
    expect(searchValuables(s, me.id, h2).msg).toMatch(/Nothing left/);
    expect(auditLedger(s)).toEqual([]);
  });
});
