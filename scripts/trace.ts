import { createNewGame, step, fmtClock, total } from '../src/sim/index';
const s = createNewGame(42, { name: 'Test', appearance: { skin: '#e3b48f', hair: 'short', hairColor: '#3b2416', build: 'average' } });
const who = process.argv[2] ?? 'p_harlan';
const mins = Number(process.argv[3] ?? 180);
for (let i = 0; i < mins; i++) {
  step(s, 1);
  const p = s.people[who];
  if (i % 3 === 0) console.log(fmtClock(s.minute), p.npc?.goal, p.npc?.step, p.where, p.pos.x.toFixed(1), p.pos.z.toFixed(1), 'act', p.action?.type ?? '-', 'move', p.move?.destLabel ?? '-', 'plan', JSON.stringify(p.npc?.plan.map(x => x.kind === 'act' ? x.type : x.kind === 'move' ? 'mv:' + x.label : x.kind)), 'q', s.tills.till.queue.length, 'staff', s.tills.till.staffId, 'claim', p.npc?.claim, 'hands', total(s.containers[p.handsId]));
}
console.log(s.people[who].npc?.log.join('\n'));
