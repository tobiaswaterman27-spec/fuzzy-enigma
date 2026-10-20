// Two townspeople chatting in the park: node scripts/chatshot.mjs <outdir>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 520 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
console.log(await page.evaluate(() => {
  const g = window.__bigshot.game, S = window.__bigshot.sim, s = g.state;
  for (let i = 0; i < 3 * 1440; i++) { S.step(s, 1); if (Object.values(s.people).some((p) => p.action?.type === 'talk' && p.action.arg === 'long')) break; }
  const t = Object.values(s.people).find((p) => p.action?.type === 'talk' && p.action.arg === 'long');
  if (!t) return 'none';
  g.player.pos = { x: t.pos.x + 3, z: t.pos.z + 3 }; g.player.where = 'park';
  return t.name + ' ' + JSON.stringify(t.pos);
}));
await page.waitForTimeout(3500);
for (let k = 0; k < 20; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
await page.screenshot({ path: `${out}/chat.png`, timeout: 300000 });
await browser.close();
