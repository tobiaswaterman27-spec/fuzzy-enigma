// Street with traffic after it has run a while: node scripts/trafficshot.mjs out.png
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
// let the traffic run for a simulated minute
await page.evaluate(() => { const g = window.__bigshot.game; for (let i = 0; i < 1200; i++) g.traffic.update(g.state, 0.05); g.freeCam = true; g.camera.position.set(10, 6, 14); g.camera.lookAt(-5, 0, 0); });
for (let k = 0; k < 4; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
console.log(await page.evaluate(() => JSON.stringify(window.__bigshot.game.traffic.cars.map((c) => [Math.round(c.obj.position.x), Math.round(c.obj.position.z), +c.speed.toFixed(1)]))));
await page.screenshot({ path: process.argv[2], timeout: 300000 });
await browser.close();
