// People on the street mid-morning (worker-built bodies): node scripts/crowdshot.mjs <out.png>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
await page.evaluate(() => { const g = window.__bigshot.game, S = window.__bigshot.sim; while (g.state.minute < S.at(0, 8, 40)) S.step(g.state, 2); g.player.pos = { x: 10, z: -7.5 }; g.player.facing = -Math.PI / 2; g.player.where = 'outside'; g.camYaw = Math.PI / 2; });
await page.waitForTimeout(9000);
for (let k = 0; k < 10; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
console.log(await page.evaluate(() => `views ${window.__bigshot.game.views.people.size}, visible ${Object.values(window.__bigshot.game.state.people).filter((p) => p.visible).length}`));
await page.screenshot({ path: process.argv[2], timeout: 300000 });
await browser.close();
