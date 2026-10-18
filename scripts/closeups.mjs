// Close-ups of people (face, body, feet): node scripts/closeups.mjs <outdir>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
const looks = [
  ['m_casual', { frame: 'm', hair: 'short', hairColor: '#2a1b10', skin: '#c58c6a', outfit: 'outfit_casual', build: 'average' }],
  ['f_long', { frame: 'f', hair: 'long', hairColor: '#a8743f', skin: '#f1d3b6', outfit: 'uniform_market', build: 'average' }],
  ['m_smart', { frame: 'm', hair: 'curly', hairColor: '#111', skin: '#6b4026', outfit: 'outfit_smart', build: 'broad' }],
];
for (const [name, ap] of looks) {
  await page.evaluate((ap) => { const g = window.__bigshot.game; const p = g.player; Object.assign(p.appearance, ap); p.pos = { x: 20, z: 3.0 }; p.facing = 0; p.where = 'outside'; }, ap);
  for (let k = 0; k < 30; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  for (const [view, cam] of [['face', [20, 1.62, 3.75, 20, 1.58, 3.0]], ['body', [20.6, 1.1, 5.6, 20, 0.95, 3.0]], ['feet', [20.4, 0.35, 4.1, 20, 0.08, 3.0]]]) {
    await page.evaluate((v) => { const g = window.__bigshot.game; g.freeCam = true; g.camera.position.set(v[0], v[1], v[2]); g.camera.lookAt(v[3], v[4], v[5]); }, cam);
    for (let k = 0; k < 3; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
    await page.screenshot({ path: `${out}/${name}_${view}.png`, timeout: 300000 });
  }
  console.log('done', name);
}
await browser.close();
