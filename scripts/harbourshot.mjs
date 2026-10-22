// Fishing off the quay. node scripts/harbourshot.mjs <out.png>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
console.log(await page.evaluate(() => {
  const g = window.__bigshot.game, S = window.__bigshot.sim, s = g.state;
  s.minute = Math.floor(s.minute / 1440) * 1440 + 18 * 60 + 30;
  S.transfer(s, { from: s.externalId, to: g.player.accountId, amount: 20000, reason: 'transfer', memo: 't' });
  S.buyTackle(s, g.player, 'rod'); S.buyTackle(s, g.player, 'bait');
  const it = S.getWorld().interactables.fish_2;
  g.player.pos = { ...it.pos }; g.player.where = 'outside'; g.player.facing = 0;
  return JSON.stringify(S.startAction(s, 'player', 'fish_2', 'fish'));
}));
await page.waitForTimeout(8000);
await page.evaluate(() => { const g = window.__bigshot.game; g.freeCam = true; g.camera.position.set(-9, 3.2, 82); g.camera.lookAt(0, 0, 96); });
await page.waitForTimeout(2500);
await page.screenshot({ path: process.argv[2] });
await browser.close();
