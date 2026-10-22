// Stand in the road, a car stops, take it with G and drive off. node scripts/carjack.mjs <outdir>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
await page.evaluate(() => { const g = window.__bigshot.game; const c = g.traffic.cars.filter((c) => c.lane === 0 && c.obj.position.x > -60 && c.obj.position.x < 60)[0]; g.player.pos = { x: c.obj.position.x + 7, z: 2 }; g.player.where = 'outside'; });
let res = '';
for (let i = 0; i < 40 && !res.startsWith('You drag'); i++) {
  await page.waitForTimeout(500);
  res = await page.evaluate(() => { const g = window.__bigshot.game; const msgs = []; const o = g.onToast; g.onToast = (m) => msgs.push(m); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG' })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyG' })); g.onToast = o; return msgs.join('|'); });
}
console.log('G:', res);
await page.keyboard.down('KeyW'); await page.waitForTimeout(2500); await page.keyboard.up('KeyW');
console.log(await page.evaluate(() => { const s = window.__bigshot.game.state; return JSON.stringify({ wanted: s.wanted, v: Object.values(s.vehicles).filter((v) => v.stolen).map((v) => [v.id, Math.round(v.pos.x), Math.round(v.pos.z), v.state]) }); }));
await page.screenshot({ path: `${out}/carjack.png` });
await browser.close();
