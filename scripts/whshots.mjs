// Stills of Harbour Wholesale: node scripts/whshots.mjs <outdir>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 650 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
await page.evaluate(() => { const s = window.__bigshot.game.state; s.containers.wholesale_staging.items = { bread: 300, milk: 200 }; });
const shots = [['wh_aisle', [-44, 2.4, 21.8, -60, 1.0, 24]], ['wh_stage', [-46, 3.2, 20.5, -56, 0.3, 15.5]], ['wh_outside', [-53, 4, 2, -53, 3, 14]]];
for (const [name, v] of shots) {
  await page.evaluate((v) => { const g = window.__bigshot.game; g.freeCam = true; g.camera.position.set(v[0], v[1], v[2]); g.camera.lookAt(v[3], v[4], v[5]); }, v);
  for (let k = 0; k < 4; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 300000 });
  console.log('shot', name);
}
await browser.close();
