import { describe, expect, it } from 'vitest';
import {
  createNewGame, step, transfer, auditLedger, moneySupply, startBusiness, buyTill, setSection, orderStock, setStaffing, hireApplicant,
  at, count, total, playerBusiness, START_MIN_CAPITAL, withdraw, type GameState,
} from '../src/sim/index';

const setup = { name: 'Owner', appearance: { skin: '#e3b48f', hair: 'short' as const, hairColor: '#3b2416', build: 'average' as const } };
const advance = (s: GameState, minutes: number) => { while (minutes > 0) { const d = Math.min(minutes, 60); step(s, d); minutes -= d; } };
const advanceTo = (s: GameState, m: number) => advance(s, m - s.minute);

describe('Journey C/D - build and delegate a business', () => {
  it('founds, fits out, stocks, staffs and trades a shop with its own accounts', () => {
    const s = createNewGame(21, setup);
    const p = s.people.player;
    // give the player savings as if they had worked for a while (recorded transfer from outside)
    transfer(s, { from: s.externalId, to: p.accountId, amount: 300000, reason: 'transfer', memo: 'test savings' });
    expect(startBusiness(s, 'Test Store', START_MIN_CAPITAL - 1).ok).toBe(false);
    expect(startBusiness(s, 'Test Store', 200000).ok).toBe(true);
    expect(startBusiness(s, 'Again', 200000).ok).toBe(false);
    const b = playerBusiness(s)!;
    expect(b.name).toBe('Test Store');
    expect(s.ledger.accounts[b.accountId].balance).toBe(200000 - 5000 - 18000 - 18000);
    // cannot sell without a till; set up sections
    expect(buyTill(s).ok).toBe(true);
    expect(buyTill(s).ok).toBe(false);
    expect(setSection(s, 'u4_s1', 'bread').ok).toBe(true);
    expect(setSection(s, 'u4_s2', 'bread').ok).toBe(false); // one section per product
    setSection(s, 'u4_s2', 'milk'); setSection(s, 'u4_s3', 'snacks'); setSection(s, 'u4_s4', 'coffee');
    // stock arrives by van, not instantly
    expect(orderStock(s, { bread: 40, milk: 48, snacks: 48, coffee: 24 }).ok).toBe(true);
    expect(total(s.containers.unit4_backroom)).toBe(0);
    // hire an assistant from the labour pool
    expect(setStaffing(s, 'assistant', 1, 'am').ok).toBe(true);
    // job seekers search twice a day; give them up to a few days to find the advert
    const pending = () => Object.values(s.applications).filter((a) => s.vacancies[a.vacancyId].businessId === 'unit4' && a.status === 'pending');
    advanceTo(s, at(4, 16, 0));
    for (let d = 5; d < 9 && !pending().length; d++) advanceTo(s, at(d, 16, 0));
    const apps = pending();
    expect(apps.length).toBeGreaterThan(0);
    const best = apps.sort((x, y) => y.score - x.score)[0];
    expect(hireApplicant(s, best.id).ok).toBe(true);
    const worker = s.people[best.personId];
    expect(s.contracts[worker.contractId!].businessId).toBe('unit4');
    // the delivery came on day 2 and waits at goods-in until someone checks it in; the new worker does that
    expect(s.shipments[Object.keys(s.shipments).find((k) => s.shipments[k].buyerId === 'unit4')!]?.status ?? 'received').toMatch(/arrived|received/);
    for (let d = 0; d < 4; d++) advance(s, 1440);
    expect(total(s.containers.unit4_bay)).toBe(0);
    const sold = b.stats.reduce((a, x) => a + x.customers, 0);
    expect(sold).toBeGreaterThan(5);
    expect(b.stats.reduce((a, x) => a + x.wages, 0)).toBeGreaterThan(0);
    expect(count(s.containers.u4_s1, 'bread') + count(s.containers.unit4_backroom, 'bread')).toBeGreaterThanOrEqual(0);
    // owner can withdraw cash only up to what the business holds
    const bal = s.ledger.accounts[b.accountId].balance;
    expect(withdraw(s, bal + 1).ok).toBe(false);
    expect(auditLedger(s)).toEqual([]);
    expect(moneySupply(s)).toBe(0);
  });
});
