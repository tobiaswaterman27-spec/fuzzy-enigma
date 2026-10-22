// Out on the hire boat. node scripts/boatshot.mjs <out.png>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
console.log(await page.evaluate(() => {
  const g = window.__bigshot.game, S = window.__bigshot.sim, s = g.state;
  s.minute = Math.floor(s.minute / 1440) * 1440 + 15 * 60;
  S.transfer(s, { from: s.externalId, to: g.player.accountId, amount: 20000, reason: 'transfer', memo: 't' });
  const r = S.hireBoat(s, 'player');
  s.vehicles[S.BOAT_ID].pos = { x: 10, z: 110 }; s.vehicles[S.BOAT_ID].heading = 2.6;
  return r.msg;
}));
await page.keyboard.down('KeyW'); await page.waitForTimeout(4000); await page.keyboard.up('KeyW');
await page.waitForTimeout(3000);
await page.screenshot({ path: process.argv[2] });
await browser.close();
