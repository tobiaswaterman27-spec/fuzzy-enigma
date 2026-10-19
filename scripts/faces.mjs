// Face close-ups for several looks: node scripts/faces.mjs <outdir>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 520, height: 520 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
await page.evaluate(() => { for (const el of document.querySelectorAll('#hud')) el.style.display = 'none'; });
const looks = [
  ['m', 1.6, { frame: 'm', hair: 'short', hairColor: '#2a1b10', skin: '#c58c6a', outfit: 'outfit_casual', build: 'average' }],
  ['f', 1.5, { frame: 'f', hair: 'long', hairColor: '#a8743f', skin: '#f1d3b6', outfit: 'uniform_market', build: 'average' }],
  ['d', 1.6, { frame: 'm', hair: 'curly', hairColor: '#111', skin: '#6b4026', outfit: 'outfit_smart', build: 'broad' }],
].filter(([n]) => !process.env.ONLY || process.env.ONLY.includes(n));
for (const [name, hy, ap] of looks) {
  await page.evaluate((ap) => { const g = window.__bigshot.game; const p = g.player; Object.assign(p.appearance, ap); p.pos = { x: 20, z: 3.0 }; p.facing = 0; p.where = 'outside'; }, ap);
  for (let k = 0; k < 25; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  for (const [view, cam] of [['front', [20, hy + 0.03, 3.5, 20, hy, 3.0]], ['side', [20.35, hy + 0.03, 3.38, 20, hy, 3.0]]]) {
    await page.evaluate((v) => { const g = window.__bigshot.game; g.freeCam = true; g.camera.position.set(v[0], v[1], v[2]); g.camera.lookAt(v[3], v[4], v[5]); }, cam);
    for (let k = 0; k < 3; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
    await page.screenshot({ path: `${out}/face_${name}_${view}.png`, timeout: 300000 });
  }
  console.log('done', name);
}
await browser.close();
