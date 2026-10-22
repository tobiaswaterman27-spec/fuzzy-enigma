// New Year fireworks over the harbour. node scripts/nyeshot.mjs <out.png>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
console.log(await page.evaluate(() => {
  const g = window.__bigshot.game, S = window.__bigshot.sim, s = g.state;
  s.minute = 27 * 1440 + 23 * 60 + 56;
  g.player.pos = { x: 0, z: 85 }; g.player.where = 'outside'; g.player.facing = 0;
  return S.newYearShow(s);
}));
await page.evaluate(() => { const g = window.__bigshot.game; g.freeCam = true; g.camera.position.set(0, 2, 80); g.camera.lookAt(0, 14, 120); });
// let rockets climb and burst (the page runs slowly here, so step the show by hand)
await page.evaluate(() => { const g = window.__bigshot.game; for (let i = 0; i < 160; i++) { g.fireworks.next = 0; g.fireworks.update(g.state, 0.033, g.camera.position); } });
await page.waitForTimeout(1500);
await page.screenshot({ path: process.argv[2] });
await browser.close();
