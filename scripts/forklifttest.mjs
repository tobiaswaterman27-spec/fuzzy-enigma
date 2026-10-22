// Forklift Driver in the browser: get on, drive to goods-in, lift, take it to the bay: node scripts/forklifttest.mjs <outdir>
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
console.log(await ev(() => {
  const g = window.__bigshot.game, S = window.__bigshot.sim, s = g.state, p = g.player;
  p.quals = ['forklift']; S.hire(s, 'player', 'wholesale', 'forklift', true); p.appearance.outfit = 'uniform_wholesale';
  s.containers.wholesale_stock.items.milk = 20;
  while (s.minute < S.at(1, 5, 10)) S.step(s, 5);
  const t = S.getWorld().interactables.wh_terminal; p.pos = { ...t.pos }; p.where = 'wholesale';
  S.startAction(s, 'player', 'wh_terminal', 'clock_in'); let k = 0; while (p.action && k++ < 4000) S.step(s, 0.25);
  const it = S.interactable(s, 'forklift:' + S.FORKLIFT_ID); p.pos = { ...it.pos }; p.facing = it.facing;
  return 'pallets ' + S.palletsWaiting(s);
}));
await page.waitForTimeout(1500);
console.log('interact', JSON.stringify(await ev(() => window.__bigshot.game.interact(0))));
await ev(() => { window.__bigshot.game.speedMult = 10; }); for (let i = 0; i < 60 && (await ev(() => window.__bigshot.game.player.where)) !== 'vehicle'; i++) await page.waitForTimeout(250); await ev(() => { window.__bigshot.game.speedMult = 1; });
console.log('state', await ev(() => { const g = window.__bigshot.game; return JSON.stringify({ where: g.player.where, action: g.player.action, v: g.state.vehicles.forklift_1.state, news: g.state.news.slice(-3).map((n) => n.title) }); }));
const drive = (keys, secs) => ev(([keys, secs]) => { const g = window.__bigshot.game; for (const k of keys) g.keys.add(k); for (let i = 0; i < secs * 20; i++) g.updateDriving(0.05); for (const k of keys) g.keys.delete(k); }, [keys, secs]);
await ev(() => { const g = window.__bigshot.game, S = window.__bigshot.sim; const v = g.state.vehicles[S.FORKLIFT_ID]; v.heading = 0; });
await drive(['KeyW'], 2.0);
console.log('pos', await ev(() => JSON.stringify(window.__bigshot.game.state.vehicles.forklift_1.pos)));
for (let k = 0; k < 15; k++) await ev(() => new Promise((r) => requestAnimationFrame(() => r())));
await page.screenshot({ path: `${out}/fork1.png` });
await page.keyboard.press('KeyE'); await page.waitForTimeout(300);
console.log('lift', await ev(() => JSON.stringify(window.__bigshot.game.state.containers.forklift_1_forks.items)));
for (let k = 0; k < 10; k++) await ev(() => new Promise((r) => requestAnimationFrame(() => r())));
await page.screenshot({ path: `${out}/fork2.png` });
console.log('errors', JSON.stringify(errors.slice(0, 5)));
await browser.close();
