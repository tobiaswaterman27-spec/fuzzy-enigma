// Inside the player's flat from a few spots: node scripts/flatinside.mjs <outdir>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 560 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(5000);
await page.evaluate(() => { document.getElementById('hud').style.display = 'none'; const g = window.__bigshot.game; g.freeCam = true; });
const shots = [['living', [26.5, 1.7, 15.2, 19, 0.9, 22]], ['kitchen', [21, 1.7, 17, 16, 1.0, 22]], ['bedroom', [21, 1.7, 21, 26, 0.7, 24]], ['top', [21, 9, 18, 21, 0, 18.2]]];
for (const [name, c] of shots) {
  await page.evaluate((c) => { const g = window.__bigshot.game; g.camera.position.set(c[0], c[1], c[2]); g.camera.lookAt(c[3], c[4], c[5]); if (c[1] > 5) { for (const [id, cw] of g.world.cutaway) if (id === 'flat') { cw.roof.forEach((r) => (r.visible = false)); } } }, c);
  for (let k = 0; k < 4; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await page.screenshot({ path: `${out}/in_${name}.png`, timeout: 300000 });
}
await browser.close();
