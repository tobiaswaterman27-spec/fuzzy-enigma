// The Saturday market in the park: node scripts/marketshot.mjs <out.png>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 560 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
console.log(await page.evaluate(() => { const g = window.__bigshot.game, S = window.__bigshot.sim; g.state.minute = S.at(5, 9, 0); while (g.state.minute < S.at(5, 11, 0)) S.step(g.state, 2); g.player.pos = { x: 56, z: 12.5 }; g.player.facing = 0; g.player.where = 'park'; g.camYaw = Math.PI; return S.marketOn(g.state); }));
await page.waitForTimeout(9000);
for (let k = 0; k < 10; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
await page.evaluate(() => { const g = window.__bigshot.game; g.freeCam = true; g.camera.position.set(56, 3.2, 9); g.camera.lookAt(57, 1.2, 19); document.getElementById('hud').style.display = 'none'; });
for (let k = 0; k < 4; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
await page.screenshot({ path: process.argv[2], timeout: 300000 });
await browser.close();
