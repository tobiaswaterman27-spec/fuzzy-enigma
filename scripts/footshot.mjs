// Football in the park. node scripts/footshot.mjs <out.png>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
const msgs = [];
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
await page.evaluate(() => { const g = window.__bigshot.game; g.player.pos = { x: 56.8, z: 38 }; g.player.where = 'park'; g.player.facing = -Math.PI / 2; g.onToast = (m) => (window.__msgs ??= []).push(m); });
await page.waitForTimeout(3000);
await page.keyboard.press('KeyF');
await page.waitForTimeout(400);
await page.evaluate(() => { const g = window.__bigshot.game; g.freeCam = true; g.camera.position.set(58, 2.2, 42); g.camera.lookAt(52, 0.5, 37); });
await page.waitForTimeout(900);
await page.screenshot({ path: process.argv[2] });
// simulate the rest of the flight
await page.evaluate(() => { const g = window.__bigshot.game; for (let i = 0; i < 300; i++) g.football.update(g.state, 0.016, { x: 70, z: 20, vx: 0, vz: 0, facing: 0 }); });
console.log(JSON.stringify(await page.evaluate(() => [window.__msgs, window.__bigshot.game.football.score])));
await browser.close();
