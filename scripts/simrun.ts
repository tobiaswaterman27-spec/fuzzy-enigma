import { createNewGame, step, moneySupply, auditLedger, fmtDate, fmtClock, fmtMoney, total } from '../src/sim/index';
const s = createNewGame(42, { name: 'Test', appearance: { skin: '#e3b48f', hair: 'short', hairColor: '#3b2416', build: 'average' } });
const days = Number(process.argv[2] ?? 3);
const t0 = Date.now();
for (let h = 0; h < days * 24; h++) {
  step(s, 60);
  if (h % 6 === 5) {
    const m = s.businesses.market;
    const st = m.stats[m.stats.length - 1];
    const shelves = ['bread','milk','apples','soup','pasta','coffee','snacks','soap'].map(k => s.containers['shelf_'+k].items[k] ?? 0).join(',');
    const back = total(s.containers.market_backroom);
    console.log(fmtDate(s.minute), fmtClock(s.minute), 'cash', fmtMoney(s.ledger.accounts[m.accountId].balance), 'rev', st && fmtMoney(st.revenue), 'cust', st?.customers, 'walk', st?.walkouts, 'lost', st?.lostSales, 'shelves', shelves, 'back', back, 'queue', s.tills.till.queue.length, 'dirt', Object.keys(s.dirt).length, 'van', s.vehicles.van_1.state);
  }
}
console.log('elapsed ms', Date.now() - t0, 'money', moneySupply(s), 'audit', auditLedger(s));
for (const p of Object.values(s.people)) if (!p.isPlayer && !p.npc?.ambient) console.log(p.name.padEnd(14), p.npc?.goal, p.where, p.visible, 'E', p.needs.energy.toFixed(0), 'S', p.needs.satiety.toFixed(0), fmtMoney(s.ledger.accounts[p.accountId].balance), p.contractId ? s.contracts[p.contractId].performance : '-', (p.npc?.log ?? []).slice(-3).join(' | '));
const att = Object.values(s.attendance);
console.log('attendance', att.length, 'absent', att.filter(a=>a.absent).map(a=>a.key).join(' '));
console.log('shipments', Object.values(s.shipments).map(x=>x.id+':'+x.status+':'+x.buyerId).join(' '));
console.log(s.news.slice(0,15).map(n=>fmtClock(n.time)+' '+n.title).join('\n'));
for (const b of Object.values(s.businesses)) console.log(b.name.padEnd(22), fmtMoney(s.ledger.accounts[b.accountId].balance), b.stats.map(x=>`${x.day}:${(x.revenue/100).toFixed(0)}/${x.customers}`).join(' '));
console.log('district', fmtMoney(s.ledger.accounts[s.districts.harbourside.accountId].balance));
