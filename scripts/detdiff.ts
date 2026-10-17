import { createNewGame, step, serialize, deserialize, hire, at } from '../src/sim/index';
const s = createNewGame(3, { name: 'Tester', appearance: { skin: '#e3b48f', hair: 'short', hairColor: '#3b2416', build: 'average' } });
hire(s, 'player', 'market', 'assistant_am', true);
while (s.minute < at(1, 7, 10)) step(s, Math.min(60, at(1,7,10) - s.minute));
const copy = (deserialize(serialize(s)) as any).state;
for (let i = 0; i < 10; i++) { step(s, 60); step(copy, 60); const a = JSON.stringify(s), b = JSON.stringify(copy); if (a !== b) { let k = 0; while (a[k] === b[k]) k++; console.log('diverged at minute', s.minute, a.slice(k - 300, k + 100), '\n---\n', b.slice(k - 300, k + 100)); break; } }
