// Inside Harbourside Dog Rescue: the kennels with their dogs. node scripts/rescueshot.mjs <out.png>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
await page.evaluate(() => {
  const g = window.__bigshot.game, s = g.state;
  g.player.pos = { x: 84.6, z: 51.9 }; g.player.where = 'rescue'; g.player.facing = Math.PI / 2;
  s.minute = Math.floor(s.minute / 1440) * 1440 + 12 * 60;
});
await page.waitForTimeout(9000);
await page.evaluate(() => { const g = window.__bigshot.game; g.freeCam = true; g.camera.position.set(81.5, 2.6, 50.5); g.camera.lookAt(88, 0.4, 53.5); });
await page.waitForTimeout(2500);
await page.screenshot({ path: process.argv[2] });
await browser.close();
