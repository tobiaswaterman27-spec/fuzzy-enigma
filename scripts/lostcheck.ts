import { createNewGame, step, startAction } from '../src/sim/index';
import * as A from '../src/sim/actions';
const s = createNewGame(42, { name: 'Test', appearance: { skin: '#e3b48f', hair: 'short', hairColor: '#3b2416', build: 'average' } });
const reasons: Record<string, number> = {};
const orig = A.optionsFor;
for (let d = 0; d < 3; d++) for (let m = 0; m < 1440; m++) {
  step(s, 1);
  for (const p of Object.values(s.people)) for (const l of p.npc?.log ?? []) if (l.includes('pick_item failed')) { const r = l.split('failed: ')[1]; reasons[r] = (reasons[r] ?? 0) + 1; }
  for (const p of Object.values(s.people)) if (p.npc) p.npc.log = p.npc.log.filter(l => !l.includes('pick_item failed'));
}
console.log(reasons, void orig, void startAction);
const shelves = ['bread','milk','apples','soup','pasta','coffee','snacks','soap'];
console.log(s.businesses.market.stats.map(x => x.lostSales));
