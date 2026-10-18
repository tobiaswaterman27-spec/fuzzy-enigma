// Neckline / face close-ups: node scripts/neck.mjs <outdir> outfit...
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 700, height: 500 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
for (const outfit of process.argv.slice(3)) {
  await page.evaluate((o) => { const g = window.__bigshot.game; const p = g.player; p.appearance.outfit = o; p.pos = { x: 20, z: 3.0 }; p.facing = 0; p.where = 'outside'; g.freeCam = true; g.camera.position.set(20.15, 1.55, 3.85); g.camera.lookAt(20, 1.45, 3.0); }, outfit);
  for (let k = 0; k < 20; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await page.screenshot({ path: `${out}/neck_${outfit}.png`, timeout: 300000 });
  console.log('done', outfit);
}
await browser.close();
