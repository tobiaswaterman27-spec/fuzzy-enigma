// Marlow Court from the street and the corner: node scripts/flatshot.mjs <outdir> [prefix]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2], pre = process.argv[3] ?? 'flat';
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(5000);
await page.evaluate(() => { document.getElementById('hud').style.display = 'none'; const g = window.__bigshot.game; g.player.pos = { x: 21, z: 4 }; g.freeCam = true; });
const shots = [['front', [21, 2.2, -4.5, 21, 5, 14]], ['corner', [4, 3, -2, 20, 5, 16]], ['side', [38, 3, 18, 28, 5, 18]], ['high', [21, 22, -18, 21, 4, 18]]];
for (const [name, c] of shots) {
  await page.evaluate((c) => { const g = window.__bigshot.game; g.camera.position.set(c[0], c[1], c[2]); g.camera.lookAt(c[3], c[4], c[5]); }, c);
  for (let k = 0; k < 4; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await page.screenshot({ path: `${out}/${pre}_${name}.png`, timeout: 300000 });
}
await browser.close();
