import { createNewGame, step, hire, fmtMoney } from '../src/sim/index';
for (const extra of [false, true]) {
  const s = createNewGame(42, { name: 'Test', appearance: { skin: '#e3b48f', hair: 'short', hairColor: '#3b2416', build: 'average' } });
  if (extra) { s.people.p_sam.npc!.retired = true; hire(s, 'p_sam', 'market', 'assistant_am', true); }
  for (let d = 0; d < 10; d++) step(s, 1440);
  const m = s.businesses.market;
  const st = m.stats.slice(-8, -1);
  const sum = (k: 'revenue'|'cogs'|'wages'|'lostSales'|'customers'|'walkouts') => st.reduce((a, x) => a + x[k], 0);
  console.log(extra ? 'WITH AM assistant' : 'baseline', 'cash', fmtMoney(s.ledger.accounts[m.accountId].balance), 'wk rev', fmtMoney(sum('revenue')), 'cogs', fmtMoney(sum('cogs')), 'wages', fmtMoney(sum('wages')), 'lost', sum('lostSales'), 'cust', sum('customers'), 'walkouts', sum('walkouts'), 'rep', m.reputation.toFixed(1));
}
