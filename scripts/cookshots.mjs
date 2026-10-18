// Cooking sequence stills: node scripts/cookshots.mjs <outdir>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 520 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
const r = await page.evaluate(() => {
  const g = window.__bigshot.game, S = window.__bigshot.sim, s = g.state, p = s.people.player;
  S.addItems(s.containers[p.pantryId], 'pasta', 2);
  const it = S.getWorld().interactables.stove; p.pos = { ...it.pos }; p.where = 'flat';
  return S.startAction(s, 'player', 'stove', 'cook', 'pasta');
});
console.log(JSON.stringify(r));
for (const f of [0.06, 0.2, 0.6, 0.95]) {
  await page.evaluate((f) => { const g = window.__bigshot.game; const a = g.state.people.player.action; if (a) a.progress = a.duration * f; g.freeCam = true; g.camera.position.set(18.2, 2.3, 21.2); g.camera.lookAt(15.2, 0.9, 25); }, f);
  for (let k = 0; k < 90; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await page.screenshot({ path: `${out}/cook_${f}.png`, timeout: 300000 });
  console.log('shot', f);
}
await browser.close();
