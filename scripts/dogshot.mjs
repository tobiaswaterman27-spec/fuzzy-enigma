// You and a neighbour out with your dogs. node scripts/dogshot.mjs <out.png>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
await page.evaluate(() => {
  const g = window.__bigshot.game, S = window.__bigshot.sim, s = g.state;
  S.transfer(s, { from: s.externalId, to: g.player.accountId, amount: 50000, reason: 'transfer', memo: 't' });
  S.adoptDog(s, 'player', 'Rex');
  const p = S.residents(s)[1];
  p.dog = { name: 'Bonnie', color: '#3b2a1e', size: 1.1, since: 0, happy: 80 };
  p.visible = true; p.where = 'outside'; p.pos = { x: -1, z: 9 }; p.facing = Math.PI; p.action = null; p.move = null;
  p.npc.goal = 'leisure'; p.npc.plan = [{ kind: 'wait', until: s.minute + 99 }]; p.npc.nextDecision = s.minute + 99;
  g.player.pos = { x: -3, z: 6 }; g.player.where = 'outside'; g.player.facing = 0.3;
});
await page.waitForTimeout(8000);
await page.evaluate(() => { const g = window.__bigshot.game; g.freeCam = true; g.camera.position.set(-6, 1.6, 4.2); g.camera.lookAt(-2, 0.4, 8); });
await page.waitForTimeout(2000);
await page.screenshot({ path: process.argv[2] });
await browser.close();
