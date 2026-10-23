import { describe, expect, it } from 'vitest';
import { createNewGame, auditLedger, optionsFor, step } from '../src/sim/index';
import { getWorld } from '../src/sim/world/layout';
import { planVenues, venueOpen } from '../src/sim/world/venues';
import { buyAt, crackVault, offersAt, robVenue, roulette, slots, staffOf, venuesTick, dealBlackjack, finishBlackjack, pawnSell, newOutfit, haircut, patronsTick } from '../src/sim/venues';
import { addItems } from '../src/sim/inventory';
import { transfer } from '../src/sim/ledger';

const setup = { name: 'Tester', appearance: { skin: '#e3b48f', hair: 'short' as const, hairColor: '#3b2416', build: 'average' as const } };
const at = (s: any, m: number) => { s.minute = Math.floor(s.minute / 1440) * 1440 + 1440 * 2 + m; };

describe('City venues', () => {
  it('opens a good spread of places, each with a door onto the street', () => {
    createNewGame(7, setup);
    const vs = planVenues(getWorld().city);
    const kinds = new Set(vs.map((v) => v.kind));
    for (const k of ['shop', 'cafe', 'takeaway', 'pub', 'clothes', 'barber', 'bank', 'casino', 'nightclub', 'gym', 'arcade', 'pawn']) expect(kinds.has(k as any), k).toBe(true);
    expect(vs.length).toBeGreaterThan(25);
    for (const v of vs) expect(getWorld().buildings.some((b) => b.id === v.id)).toBe(true);
  });

  it('staff serve in opening hours; you can eat, shop, dress up, get a haircut, gamble and rob the place', () => {
    const s = createNewGame(7, setup);
    const me = s.people.player;
    s.ledger.accounts[me.accountId].balance += 0;
    const vs = planVenues(getWorld().city);
    const cafe = vs.find((v) => v.kind === 'cafe')!;
    at(s, 10 * 60);
    me.pos = { ...cafe.inside }; me.where = cafe.id; me.visible = true;
    venuesTick(s);
    expect(staffOf(s, cafe)).toBeTruthy();
    const sat = me.needs.satiety = 20;
    expect(buyAt(s, me.id, cafe, offersAt(cafe, 'venue_till')[1])).toMatch(/Full English/);
    expect(me.needs.satiety).toBeGreaterThan(sat);
    const clothes = vs.find((v) => v.kind === 'clothes')!;
    me.pos = { ...clothes.inside }; venuesTick(s);
    // give the tester some money
    transfer(s, { from: s.externalId, to: me.accountId, amount: 500000, reason: 'transfer', memo: 't' });
    expect(newOutfit(s, me.id, clothes, true)).toMatch(/sharp/);
    expect(me.appearance.outfit).toBe('outfit_smart');
    const barber = vs.find((v) => v.kind === 'barber')!;
    me.pos = { ...barber.inside }; venuesTick(s);
    expect(haircut(s, me.id, barber, 'bald')).toMatch(/off/);
    expect(me.appearance.hair).toBe('bald');
    expect(slots(s, me.id, 100).reels.length).toBe(3);
    expect(roulette(s, me.id, 500, 'red')).toMatch(/ball drops/);
    const h = dealBlackjack(s, me.id, 1000);
    if (typeof h !== 'string' && !h.done) expect(finishBlackjack(s, me.id).result).toBeTruthy();
    addItems(s.containers[me.bagId], 'watch', 1);
    expect(pawnSell(s, me.id, 'watch')).toMatch(/No questions/);
    const shop = vs.find((v) => v.kind === 'shop')!;
    me.pos = { ...shop.inside }; venuesTick(s);
    me.weapon = 'knife';
    const bal = s.ledger.accounts[me.accountId].balance;
    expect(robVenue(s, me.id, shop)).toMatch(/empties the till/);
    expect(s.ledger.accounts[me.accountId].balance).toBeGreaterThan(bal);
    expect(s.wanted?.level).toBeGreaterThanOrEqual(4);
    expect(auditLedger(s)).toEqual([]);
  });

  it("the bank vault: the city's biggest score", () => {
    const s = createNewGame(7, setup);
    const me = s.people.player;
    const bank = planVenues(getWorld().city).find((v) => v.kind === 'bank')!;
    const bal = s.ledger.accounts[me.accountId].balance;
    expect(crackVault(s, me.id, bank)).toMatch(/swings open/);
    expect(s.ledger.accounts[me.accountId].balance - bal).toBeGreaterThan(1000000);
    expect(s.wanted?.level).toBe(5);
    expect(optionsFor(s, me.id, `${bank.id}_vault`).length).toBeGreaterThan(0);
    expect(auditLedger(s)).toEqual([]);
  });

  it('the nightclub is open late and full of dancers when you go in', () => {
    const s = createNewGame(7, setup);
    const me = s.people.player;
    const club = planVenues(getWorld().city).find((v) => v.kind === 'nightclub')!;
    at(s, 23 * 60);
    expect(venueOpen(club, s.minute)).toBe(true);
    at(s, 14 * 60);
    expect(venueOpen(club, s.minute)).toBe(false);
    at(s, 23 * 60 + 30);
    me.pos = { ...club.inside }; me.where = club.id; me.visible = true;
    patronsTick(s);
    const dancers = Object.values(s.people).filter((p) => p.id.startsWith('patron_') && p.visible && p.action?.type === 'dance');
    expect(dancers.length).toBeGreaterThan(4);
    step(s, 0.25);
  });
});
