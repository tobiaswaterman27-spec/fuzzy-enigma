// The park and its trees: node scripts/parkshot.mjs <out.png>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 560 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(4000);
await page.evaluate(() => { const g = window.__bigshot.game; g.player.pos = { x: 56, z: 12 }; g.freeCam = true; g.camera.position.set(54, 2.2, 9.5); g.camera.lookAt(57, 3.2, 22); document.getElementById('hud').style.display = 'none'; });
for (let k = 0; k < 6; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
await page.screenshot({ path: process.argv[2], timeout: 300000 });
await browser.close();
