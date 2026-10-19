// A rainy street: node scripts/rainshot.mjs out.png
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
console.log(await page.evaluate(() => {
  const g = window.__bigshot.game, S = window.__bigshot.sim, s = g.state;
  // first daytime minute with heavy rain
  let m = s.minute; while (!(S.rainAt(s.seed, m) > 0.55 && (m % 1440) > 600 && (m % 1440) < 960) && m < s.minute + 1440 * 30) m += 10;
  s.minute = m; g.player.pos = { x: 20, z: 6.5 }; g.player.where = 'outside';
  g.freeCam = true; g.camera.position.set(26, 2.4, 9); g.camera.lookAt(14, 1.5, -4);
  return `minute ${m} rain ${S.rainAt(s.seed, m).toFixed(2)}`;
}));
for (let k = 0; k < 8; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
await page.screenshot({ path: process.argv[2], timeout: 300000 });
await browser.close();
