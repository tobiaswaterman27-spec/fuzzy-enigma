// Stills of the chore props: node scripts/choreshots.mjs <outdir>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 650 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
await page.evaluate(() => {
  const s = window.__bigshot.game.state;
  const b = s.businesses.market;
  b.cardboard = 9; b.binFill = 28; b.messy = Object.fromEntries(Object.keys(b.sections).map((k) => [k, 90]));
  const p = s.people.player;
  p.chores = { dishes: 11, mess: 80, wear: {}, washer: { items: ['outfit_smart'], until: s.minute + 60 } };
  p.equipment = 'rubbish';
});
const shots = [
  ['storeroom', [19.5, 2.6, -33.5, 15.5, 0.8, -28.6]],
  ['dumpster', [27, 2.2, -41.5, 30.5, 0.6, -36.7]],
  ['shelves', [15.2, 1.7, -24, 17, 0.9, -19]],
  ['kitchen', [17, 1.8, 21.8, 17, 0.8, 25.5]],
  ['living', [13, 2.6, 15, 18, 0.3, 20]],
  ['bedroom', [23, 2.6, 18.5, 27, 0.3, 23]],
];
for (const [name, v] of shots) {
  await page.evaluate((v) => { const g = window.__bigshot.game; g.freeCam = true; g.camera.position.set(v[0], v[1], v[2]); g.camera.lookAt(v[3], v[4], v[5]); }, v);
  for (let k = 0; k < 4; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 180000 });
}
// the player carrying the bin bag
await page.evaluate(() => { const g = window.__bigshot.game; const p = g.state.people.player; p.pos = { x: 28, z: -38.3 }; p.where = 'outside'; p.facing = Math.PI / 2; g.camera.position.set(28.6, 1.5, -40.4); g.camera.lookAt(28, 0.8, -38.3); });
for (let k = 0; k < 10; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
await page.screenshot({ path: `${out}/binbag.png`, timeout: 180000 });
await browser.close();
