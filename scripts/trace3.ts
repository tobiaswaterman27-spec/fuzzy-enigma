import { createNewGame, step, fmtClock, total } from '../src/sim/index';
const s = createNewGame(42, { name: 'Test', appearance: { skin: '#e3b48f', hair: 'short', hairColor: '#3b2416', build: 'average' } });
step(s, 60 * 24);
const counts: Record<string, number> = {};
let prev = '';
for (let i = 0; i < 8 * 60; i++) {
  step(s, 1);
  const p = s.people.p_harlan;
  const k = p.action?.type ?? (p.move ? 'walk:' + p.move.destLabel : 'idle');
  counts[k] = (counts[k] ?? 0) + 1;
  if (k !== prev && i < 200) console.log(fmtClock(s.minute), k, 'q', s.tills.till.queue.length, 'tasks', Object.values(s.tasks).filter(t => t.status === 'open' || t.status === 'claimed').map(t => t.kind[0] + (t.status === 'claimed' ? '*' : '')).join(''));
  prev = k;
}
console.log(counts);
