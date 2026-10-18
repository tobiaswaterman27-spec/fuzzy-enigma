// Delivery driver in the browser: get in the van with E and drive with W/A/D. node scripts/drivetest.mjs <outdir>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('bigshot.gfx', 'low'); } catch { /* */ } });
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
const ev = (f, a) => page.evaluate(f, a);
await ev(() => {
  const g = window.__bigshot.game, S = window.__bigshot.sim, s = g.state;
  S.hire(s, 'player', 'wholesale', 'driver', true);
  g.player.appearance.outfit = 'uniform_wholesale';
  const o = S.placeOrder(s, 'market', 'wholesale', { milk: 24 });
  while (s.minute < o.dispatchAt - 20) S.step(s, 5);
  const t = S.getWorld().interactables.wh_terminal; g.player.pos = { ...t.pos }; g.player.where = 'wholesale';
  S.startAction(s, 'player', 'wh_terminal', 'clock_in');
  for (let k = 0; k < 10; k++) S.step(s, 0.25);
  while (s.minute < o.dispatchAt + 1) S.step(s, 1);
  const it = S.interactable(s, 'van:van_1'); g.player.pos = { ...it.pos }; g.player.facing = it.facing; g.player.where = 'outside';
});
console.log('van', await ev(() => window.__bigshot.game.state.vehicles.van_1.state));
for (let i = 0; i < 20 && !(await ev(() => window.__bigshot.game.focus?.options.some((o) => o.type === 'drive_van' && o.enabled))); i++) await page.waitForTimeout(250);
console.log('interact', JSON.stringify(await ev(() => window.__bigshot.game.interact(0))));
console.log('action', JSON.stringify(await ev(() => window.__bigshot.game.player.action)));
await ev(() => { window.__bigshot.game.speedMult = 10; }); for (let i = 0; i < 80 && (await ev(() => window.__bigshot.game.player.where)) !== 'vehicle'; i++) await page.waitForTimeout(250); await ev(() => { window.__bigshot.game.speedMult = 1; });
console.log('in', await ev(() => [window.__bigshot.game.player.where, window.__bigshot.game.state.vehicles.van_1.state]));
// drive with simulated keys at 20 steps a second: straight out, right onto the road, along it
const drive = (keys, secs) => ev(([keys, secs]) => { const g = window.__bigshot.game; for (const k of keys) g.keys.add(k); for (let i = 0; i < secs * 20; i++) g.updateDriving(0.05); for (const k of keys) g.keys.delete(k); }, [keys, secs]);
await drive(['KeyW'], 2.5);
console.log('after straight', await ev(() => JSON.stringify(window.__bigshot.game.state.vehicles.van_1.pos)));
await drive(['KeyW', 'KeyD'], 1.6);
await drive(['KeyW'], 5);
console.log('after turn', await ev(() => { const v = window.__bigshot.game.state.vehicles.van_1; return JSON.stringify({ pos: v.pos, heading: v.heading }); }));
for (let k = 0; k < 6; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
console.log('pos', await ev(() => JSON.stringify(window.__bigshot.game.state.vehicles.van_1.pos)));
await page.screenshot({ path: `${out}/drive1.png`, timeout: 300000 });
console.log('errors', JSON.stringify(errors));
await browser.close();
