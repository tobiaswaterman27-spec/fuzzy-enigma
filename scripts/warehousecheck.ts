// Runs three days and reports warehouse picking: what operatives picked and how much the van took from staging.
import { createNewGame } from '../src/sim/newgame';
import { step } from '../src/sim/sim';
import { total } from '../src/sim/inventory';
const s = createNewGame(7, { name: 'T', appearance: { frame: 'm', skin: '#c58c6a', hair: 'short', hairColor: '#222', build: 'average', height: 1, outfit: 'outfit_casual' } } as any);
const done: Record<string, number> = {};
const seen = new Set<string>();
for (let h = 0; h < 72; h++) {
  for (let m = 0; m < 60; m++) {
    step(s, 1);
    for (const t of Object.values(s.tasks)) if (t.kind === 'pick' && t.status === 'done' && !seen.has(t.id)) { seen.add(t.id); const k = t.doneBy ?? 'auto'; done[k] = (done[k] ?? 0) + 1; }
  }
  if (h % 4 === 0) {
    const ops = Object.values(s.people).filter((p) => p.contractId && s.contracts[p.contractId].businessId === 'wholesale' && s.contracts[p.contractId].positionId === 'operative');
    const q = Object.values(s.shipments).filter((x) => x.status === 'ordered').map((x) => `${x.buyerId}:${Object.entries(x.items).map(([k, n]) => `${k}${x.picked?.[k] ?? 0}/${n}`).join(' ')}`);
    console.log(`d${Math.floor(s.minute / 1440) + 1} ${String(Math.floor((s.minute % 1440) / 60)).padStart(2, '0')}:00 staged ${total(s.containers.wholesale_staging)} ops ${ops.map((o) => `${o.name.split(' ')[0]}@${o.where}${o.action ? ':' + o.action.type : ''}${o.npc?.plan[0]?.kind ?? ''}`).join(',')} orders ${q.join(' | ')}`);
  }
}
console.log('pick lines done', done);
