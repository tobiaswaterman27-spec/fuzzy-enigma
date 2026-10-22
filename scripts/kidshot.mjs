// A parent out with their children. node scripts/kidshot.mjs <out.png>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
await page.evaluate(() => {
  const g = window.__bigshot.game, S = window.__bigshot.sim, s = g.state;
  const p = S.residents(s)[1];
  p.children = [{ name: 'Leo', born: s.minute - 6 * 28 * 1440 }, { name: 'Isla', born: s.minute - 11 * 28 * 1440 }];
  p.visible = true; p.where = 'outside'; p.pos = { x: -2, z: 7 }; p.facing = Math.PI; p.action = null; p.move = null;
  p.npc.goal = 'leisure'; p.npc.plan = [{ kind: 'wait', until: s.minute + 99 }]; p.npc.nextDecision = s.minute + 99;
  g.player.pos = { x: -6, z: 7 }; g.player.where = 'outside'; g.player.facing = Math.PI / 2; g.camYaw = -Math.PI / 2 - 0.2; g.zoom = 0.9;
});
await page.waitForTimeout(16000);
await page.evaluate(() => { const g = window.__bigshot.game; g.freeCam = true; g.camera.position.set(-6.5, 1.3, 7.4); g.camera.lookAt(-2.2, 0.8, 7.2); });
await page.waitForTimeout(1500);
console.log(await page.evaluate(() => { const v = window.__bigshot.game.views; return JSON.stringify([...v.kids.entries()].map(([id, k]) => [id, !!k.view, k.p.appearance.height, Math.round(k.p.pos.x*10)/10, Math.round(k.p.pos.z*10)/10, k.view?.rig.root.visible])); }));
await page.screenshot({ path: process.argv[2] });
await browser.close();
