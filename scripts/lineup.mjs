// Eight townspeople in a row (clothing and faces): node scripts/lineup.mjs <out.png>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 560 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
await page.evaluate(() => {
  const g = window.__bigshot.game, s = g.state;
  const ppl = Object.values(s.people).filter((p) => !p.isPlayer && !p.npc?.ambient).slice(0, 8);
  ppl.forEach((p, i) => { p.appearance.outfit = i % 4 === 3 ? 'outfit_smart' : 'outfit_casual'; p.visible = true; p.where = 'outside'; p.pos = { x: 14 + i * 1.1, z: 4.9 }; p.facing = Math.PI; p.action = null; p.move = null; p.sleeping = false; });
  g.player.pos = { x: 10, z: 2 };
  document.getElementById('hud').style.display = 'none';
  window.__line = ppl.map((p) => p.id);
});
await page.waitForTimeout(8000);
await page.evaluate(() => { const g = window.__bigshot.game; g.paused = true; g.freeCam = true; g.camera.position.set(17.9, 1.5, 0.8); g.camera.lookAt(17.9, 1.0, 4.9); });
for (let k = 0; k < 8; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
await page.screenshot({ path: process.argv[2], timeout: 300000 });
await browser.close();
