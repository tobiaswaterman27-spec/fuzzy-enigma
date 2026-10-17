// Full-body turnaround shots of the player for checking garments: node scripts/bodycam.mjs <outdir> '<json looks>'
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2];
const looks = JSON.parse(process.argv[3] ?? '[{}]');
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
await page.addInitScript(() => localStorage.setItem('bigshot.gfx', 'low'));
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(2500);
let i = 0;
for (const l of looks) {
  await page.evaluate((l) => { const g = window.__bigshot.game; Object.assign(g.player.appearance, l); g.player.pos = { x: 16, z: 4 }; g.player.facing = 0; g.paused = true; }, l);
  for (let k = 0; k < 6; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  // front, side and back, each a separate frame from the free camera
  const views = [[0, 1], [1, 0], [0, -1]];
  for (const [j, [dx, dz]] of views.entries()) {
    await page.evaluate(([dx, dz, h, d]) => { const g = window.__bigshot.game; g.freeCam = true; g.camera.fov = 30; g.camera.updateProjectionMatrix(); g.camera.position.set(16 + dx * d, h, 4 + dz * d); g.camera.lookAt(16, h - 0.05 * d / 3.4, 4); }, [dx, dz, l.camH ?? 0.95, l.dist ?? 3.4]);
    for (let k = 0; k < 3; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
    await page.screenshot({ path: `${out}/body${i}_${j}.png`, clip: { x: 400, y: 30, width: 400, height: 660 }, timeout: 120000 });
  }
  i++;

}
await browser.close();
