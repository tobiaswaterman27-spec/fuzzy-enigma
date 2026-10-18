// Runs the Corner Market for three days and prints the chores (facings, cardboard, bin) and who did them.
import { createNewGame } from '../src/sim/newgame';
import { step } from '../src/sim/sim';
const s = createNewGame(7, { name: 'T', appearance: { frame: 'm', skin: '#c58c6a', hair: 'short', hairColor: '#222', build: 'average', height: 1, outfit: 'outfit_casual' } } as any);
const b = s.businesses.market;
const done: Record<string, number> = {};
const seen = new Set<string>();
for (let k = 0; k < 18; k++) {
  for (let m = 0; m < 240; m += 1) {
    step(s, 1);
    for (const t of Object.values(s.tasks)) if (t.status === 'done' && !seen.has(t.id)) { seen.add(t.id); const key = `${t.kind}:${t.doneBy ? s.people[t.doneBy]?.name.split(' ')[0] : 'auto'}`; done[key] = (done[key] ?? 0) + 1; }
  }
  const messy = Object.values(b.messy ?? {});
  const avg = messy.length ? Math.round(messy.reduce((a, c) => a + c, 0) / messy.length) : 0;
  const open = Object.values(s.tasks).filter((t) => t.businessId === 'market' && (t.status === 'open' || t.status === 'claimed')).map((t) => `${t.kind}${t.claimedBy ? '*' : ''}`);
  console.log(`d${Math.floor(s.minute / 1440) + 1} ${String(Math.floor((s.minute % 1440) / 60)).padStart(2, '0')}:00 messy avg ${avg} max ${Math.max(0, ...messy)} cardboard ${b.cardboard ?? 0} bin ${b.binFill ?? 0} rep ${b.reputation.toFixed(1)} open [${open.join(',')}]`);
}
console.log(done);
