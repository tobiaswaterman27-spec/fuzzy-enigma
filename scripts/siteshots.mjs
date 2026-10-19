// The building site at each stage: node scripts/siteshots.mjs <outdir>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 520 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
const shots = process.env.FEW ? [['s3b', 3, 0.9], ['s6', 6, 0]] : [['s0', 0, 0.6], ['s1', 1, 0.8], ['s2', 2, 0.5], ['s3a', 3, 0.3], ['s3b', 3, 0.9], ['s4', 4, 0.7], ['s6', 6, 0]];
for (const [name, stage, prog] of shots) {
  await page.evaluate(([stage, prog]) => {
    const g = window.__bigshot.game, s = g.state;
    const units = [60, 40, 480, 60, 16, 50];
    if (stage >= 6) { s.build.plot = 1; s.build.stage = 0; s.build.done = 0; } else { s.build.plot = 0; s.build.stage = stage; s.build.done = Math.floor(units[stage] * prog); }
    s.minute = 12 * 60 + 1440; g.freeCam = true; g.camera.position.set(-3, 5, 79); g.camera.lookAt(-15, 2.5, 72);
  }, [stage, prog]);
  for (let k = 0; k < 6; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 300000 });
  console.log('shot', name);
}
await browser.close();
