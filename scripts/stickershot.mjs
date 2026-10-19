// Hygiene sticker by the Corner Market door: node scripts/stickershot.mjs <outdir>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
await page.evaluate(() => { const g = window.__bigshot.game; const s = g.state; (s.hygiene ??= {}).market = { nextAt: 1e9, rating: 4, history: [] }; g.freeCam = true; g.camera.position.set(20.6, 1.6, -7.4); g.camera.lookAt(19.35, 1.45, -10); document.getElementById('hud').style.display = 'none'; });
for (let k = 0; k < 6; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
await page.screenshot({ path: `${out}/sticker.png`, timeout: 300000 });
await browser.close();
