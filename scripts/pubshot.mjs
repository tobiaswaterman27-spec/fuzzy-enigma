// Inside The Anchor of an evening, then a game of darts. node scripts/pubshot.mjs <outdir>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 620 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
await page.evaluate(() => {
  const g = window.__bigshot.game, S = window.__bigshot.sim, s = g.state;
  S.initLife(s);
  s.minute = Math.floor(s.minute / 1440) * 1440 + 20 * 60;
  S.pubTick(s);
  const spots = [[69, 76.5], [70.5, 77.8], [68.2, 81], [72, 82.5], [73.2, 79.6]];
  S.residents(s).slice(0, 5).forEach((p, i) => { p.visible = true; p.where = 'pub'; p.pos = { x: spots[i][0], z: spots[i][1] }; p.action = null; p.move = null; p.sleeping = false; p.npc.plan = [{ kind: 'wait', until: s.minute + 99 }]; p.npc.nextDecision = s.minute + 99; p.npc.goal = 'leisure'; p.facing = i * 1.3; });
  g.player.pos = { x: 74, z: 80.5 }; g.player.where = 'pub'; g.player.facing = Math.PI / 2;
});
await page.waitForTimeout(12000);
await page.evaluate(() => { const g = window.__bigshot.game; g.freeCam = true; g.camera.position.set(65.5, 2.3, 74); g.camera.lookAt(76, 1.1, 81); });
await page.waitForTimeout(2000);
await page.screenshot({ path: `${out}/pub.png` });
await page.evaluate(() => { const g = window.__bigshot.game; g.freeCam = false; window.__bigshot.ui.darts(); });
await page.waitForTimeout(1500);
for (let i = 0; i < 3; i++) { await page.keyboard.press('Space'); await page.waitForTimeout(500); }
await page.screenshot({ path: `${out}/darts.png` });
await browser.close();
