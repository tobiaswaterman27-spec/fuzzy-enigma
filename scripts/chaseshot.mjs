// A five-star police chase: patrol cars and the helicopter. node scripts/chaseshot.mjs <out.png>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(4000);
await page.evaluate(() => {
  const g = window.__bigshot.game, S = window.__bigshot.sim, s = g.state;
  s.minute = Math.floor(s.minute / 1440) * 1440 + 21 * 60;
  g.player.pos = { x: 200, z: -132 }; g.player.where = 'outside'; g.player.visible = true;
  S.stealCar(s, 'player', { x: 200, z: -132 }, Math.PI / 2, '#c0392b', 'sports');
  s.wanted = { level: 5, unseen: 0, crime: 'test' };
});
await page.waitForTimeout(25000);
await page.evaluate(() => { const g = window.__bigshot.game; g.freeCam = true; const p = g.player.pos; g.camera.position.set(p.x - 20, 35, p.z + 25); g.camera.lookAt(p.x, 0, p.z); });
await page.waitForTimeout(3000);
console.log(await page.evaluate(() => { const g = window.__bigshot.game, P = g.police; const me = g.player.pos; return JSON.stringify({ cars: P.cars.map((c) => Math.round(Math.hypot(c.pos.x - me.x, c.pos.y - me.z))), heli: !!P.heli && Math.round(P.heli.position.y), me }); }));
await page.screenshot({ path: process.argv[2], timeout: 240000 });
await browser.close();
