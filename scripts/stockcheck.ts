// Prints shelf stock of the Corner Market at a few times of day over two days.
import { createNewGame } from '../src/sim/newgame';
import { step } from '../src/sim/sim';
import { count } from '../src/sim/inventory';
import { PRODUCTS } from '../src/sim/items';
const s = createNewGame(7, { name: 'T', appearance: { frame: 'm', skin: '#c58c6a', hair: 'short', hairColor: '#222', build: 'average', height: 1, outfit: 'outfit_casual' } } as any);
for (let k = 0; k < 8; k++) {
  console.log(`day ${Math.floor(s.minute / 1440) + 1} ${String(Math.floor((s.minute % 1440) / 60)).padStart(2, '0')}:00`, PRODUCTS.map((p) => `${p}:${count(s.containers[`shelf_${p}`], p)}`).join(' '));
  for (let m = 0; m < 360; m += 5) step(s, 5);
}
