// Knock on a friend's door: they come and open it. node scripts/knockshot.mjs <outdir>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
await page.evaluate(() => {
  const g = window.__bigshot.game, S = window.__bigshot.sim, s = g.state;
  S.initLife(s);
  s.minute = Math.floor(s.minute / 1440) * 1440 + 14 * 60;
  for (const p of S.residents(s)) if (p.homeId === 'house_1') { p.where = 'house_1'; p.visible = false; p.sleeping = false; p.move = null; p.action = null; p.npc.plan = []; p.npc.nextDecision = s.minute + 600; p.relations.player = 60; }
  g.player.pos = { x: 8.4, z: 38 }; g.player.where = 'outside'; g.player.facing = Math.PI / 2;
  g.camYaw = -Math.PI / 2 - 0.9; g.zoom = 0.8;
  console.log(JSON.stringify(S.startAction(s, 'player', 'house_1_door', 'knock')));
});
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/knock1.png` });
await page.evaluate(() => { const g = window.__bigshot.game, S = window.__bigshot.sim; for (let i = 0; i < 8; i++) S.step(g.state, 0.25); });
await page.waitForTimeout(3000);
console.log(await page.evaluate(() => JSON.stringify(window.__bigshot.game.state.doorCall)));
await page.screenshot({ path: `${out}/knock2.png` });
await browser.close();
