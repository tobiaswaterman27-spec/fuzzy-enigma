// Training desk at the Job Centre: node scripts/studyshot.mjs <outdir>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 520 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
console.log(await page.evaluate(() => {
  const g = window.__bigshot.game, S = window.__bigshot.sim, s = g.state;
  S.transfer(s, { from: s.externalId, to: g.player.accountId, amount: 100000, reason: 'transfer', memo: 'test', key: 'studyshot' });
  S.enrol(s, 'player', 'driving');
  while (s.minute < S.at(0, 10, 0)) S.step(s, 5);
  const it = S.getWorld().interactables.training; g.player.pos = { ...it.pos }; g.player.facing = it.facing; g.player.where = 'jobcentre';
  return JSON.stringify(S.startAction(s, 'player', 'training', 'study'));
}));
for (let k = 0; k < 40; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
await page.screenshot({ path: `${out}/study1.png`, timeout: 300000 });
await page.evaluate(() => { const g = window.__bigshot.game; g.freeCam = true; g.camera.position.set(-30.2, 1.9, -23.2); g.camera.lookAt(-32.4, 0.8, -25.6); });
for (let k = 0; k < 4; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
await page.screenshot({ path: `${out}/study2.png`, timeout: 300000 });
await browser.close();
