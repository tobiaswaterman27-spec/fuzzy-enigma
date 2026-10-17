import { createNewGame, step, fmtClock, demandFactors } from '../src/sim/index';
const s = createNewGame(42, { name: 'Test', appearance: { skin: '#e3b48f', hair: 'short', hairColor: '#3b2416', build: 'average' } });
for (let i = 0; i < 300; i++) {
  step(s, 1);
  if (i % 20 === 0) {
    const amb = Object.values(s.people).filter(p => p.npc?.ambient);
    console.log(fmtClock(s.minute), 'acc', s.districts.harbourside.demandAccumulator.toFixed(2), JSON.stringify(demandFactors(s, s.businesses.market)), amb.map(p => `${p.npc!.goal}/${p.npc!.step}/${p.move?.destLabel ?? p.action?.type ?? '-'}`).join(' '));
  }
}
const a = s.people.amb_1; console.log(a.npc?.log);
