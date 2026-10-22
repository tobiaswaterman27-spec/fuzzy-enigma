// Inside a house on Harbour Road with the residents at home. node scripts/houseshot.mjs <outdir>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
console.log(await page.evaluate(() => {
  const g = window.__bigshot.game, S = window.__bigshot.sim, s = g.state;
  S.initLife(s);
  const h = 'house_1';
  (s.houseOpen ??= {})[h] = s.minute + 600;
  for (const p of S.residents(s)) if (p.homeId === h) { p.where = h; p.visible = false; p.sleeping = false; p.action = null; p.move = null; if (p.npc) { p.npc.plan = []; p.npc.nextDecision = s.minute + 600; } }
  g.player.pos = { x: 9.0, z: 38 }; g.player.where = 'outside'; g.player.facing = Math.PI / 2;
  return S.residents(s).filter((p) => p.homeId === h).map((p) => p.name).join(', ');
}));
await page.keyboard.down('KeyW'); await page.waitForTimeout(1500); await page.keyboard.up('KeyW');
await page.evaluate(() => { const g = window.__bigshot.game; g.player.pos = { x: 13.8, z: 37 }; g.player.facing = Math.PI / 2; g.camYaw = -Math.PI / 2 - 0.6; g.manualUntil = performance.now() + 60000; });
await page.waitForTimeout(6000);
console.log(await page.evaluate(() => { const s = window.__bigshot.game.state; return JSON.stringify(Object.values(s.people).filter((p) => p.homeId === 'house_1').map((p) => [p.name, p.visible, p.where, p.pos])); }));
await page.screenshot({ path: `${out}/house.png` });
await browser.close();
