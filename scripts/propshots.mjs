// Stills of fixtures and street furniture: node scripts/propshots.mjs <outdir>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 650 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
const shots = [
  ['street', [20, 3.5, -2, 40, 1.5, 12]],
  ['jobcentre', [-24, 2.2, -13, -28, 1.2, -24]],
  ['cafe', [-20, 2.3, 11.5, -26, 0.8, 19]],
  ['storeroom2', [20, 2.4, -32, 14, 1.0, -28.5]],
  ['kiosk', [16, 2.0, -15.5, 12.7, 1.0, -12.5]],
  ['park', [56, 3, 14, 56, 1.5, 26]],
];
for (const [name, v] of shots) {
  await page.evaluate((v) => { const g = window.__bigshot.game; g.freeCam = true; g.camera.position.set(v[0], v[1], v[2]); g.camera.lookAt(v[3], v[4], v[5]); }, v);
  for (let k = 0; k < 4; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 300000 });
  console.log('shot', name);
}
await browser.close();
