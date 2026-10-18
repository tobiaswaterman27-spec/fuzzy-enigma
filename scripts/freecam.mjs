// Free-camera stills: node scripts/freecam.mjs <out.png> camX camY camZ lookX lookY lookZ [low]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const [out, ...nums] = process.argv.slice(2);
const v = nums.map(Number);
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
if (process.env.LOW) await page.addInitScript(() => localStorage.setItem('bigshot.gfx', 'low'));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(2500);
await page.evaluate((v) => { const g = window.__bigshot.game; g.freeCam = true; g.camera.position.set(v[0], v[1], v[2]); g.camera.lookAt(v[3], v[4], v[5]); if (v[6] !== undefined && !Number.isNaN(v[6])) window.__bigshot.sim.step(g.state, v[6]); }, v);
for (let k = 0; k < 4; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
await page.screenshot({ path: out, timeout: 180000 });
await browser.close();
