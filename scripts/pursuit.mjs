// Wanted while driving: a police car comes after you. node scripts/pursuit.mjs <outdir>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
await page.evaluate(() => { const g = window.__bigshot.game, S = window.__bigshot.sim; g.player.pos = { x: 30, z: 2 }; g.player.where = 'outside'; S.stealCar(g.state, 'player', { x: 30, z: 2 }, Math.PI / 2, '#2b4f8c', 'sports'); });
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(2000);
  const r = await page.evaluate(() => { const g = window.__bigshot.game, s = g.state; return JSON.stringify({ w: s.wanted?.level, away: s.people.player.away?.place, pc: g.police.rect() && [Math.round(g.police.rect().x0), Math.round(g.police.rect().z0)] }); });
  console.log(r);
  if (i === 5) await page.screenshot({ path: `${out}/pursuit.png` });
}
await page.screenshot({ path: `${out}/pursuit2.png` });
await browser.close();
