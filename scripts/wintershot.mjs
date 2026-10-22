// Winter: find a snowy day and look down the street. node scripts/wintershot.mjs <out.png> [autumn]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
console.log(await page.evaluate((autumn) => {
  const g = window.__bigshot.game, S = window.__bigshot.sim, s = g.state;
  if (autumn) { s.minute = 16 * 1440 + 13 * 60; return 'autumn'; }
  for (let d = 21; d < 28 * 6; d++) {
    if (d % 28 < 21) continue;
    for (let m = 8 * 60; m < 17 * 60; m += 30) { const t = d * 1440 + m; s.minute = t; if (S.snowing(s) && S.snowCover(s) > 0.3) return 'snow day ' + d + ' ' + S.weatherLabel(s); }
  }
  return 'no snow found';
}, process.argv[3] === 'autumn'));
await page.evaluate(() => { const g = window.__bigshot.game; g.player.pos = { x: 50, z: 6.5 }; g.player.where = 'outside'; g.player.facing = Math.PI / 2; });
await page.waitForTimeout(6000);
await page.evaluate(() => { const g = window.__bigshot.game; g.freeCam = true; g.camera.position.set(44, 3, 16); g.camera.lookAt(58, 1, 26); });
await page.waitForTimeout(2500);
await page.screenshot({ path: process.argv[2] });
await browser.close();
