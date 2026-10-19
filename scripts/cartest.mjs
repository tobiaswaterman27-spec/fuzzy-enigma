// Own car in the browser: buy, get in with E, drive, park with E. node scripts/cartest.mjs <outdir>
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
console.log('buy', await ev(() => {
  const g = window.__bigshot.game, S = window.__bigshot.sim, s = g.state;
  S.transfer(s, { from: s.externalId, to: g.player.accountId, amount: 1000000, reason: 'transfer', memo: 'test', key: 'cartest' });
  const r = S.buyCar(s, 'player', 'saloon', '#5d6d7e');
  const car = S.playerCar(s, 'player');
  const it = S.interactable(s, 'car:' + car.id); g.player.pos = { ...it.pos }; g.player.facing = it.facing; g.player.where = 'outside';
  return r.msg;
}));
for (let k = 0; k < 10; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
await page.screenshot({ path: `${out}/car0.png`, timeout: 300000 });
for (let i = 0; i < 20 && !(await ev(() => window.__bigshot.game.focus?.options.some((o) => o.type === 'drive_car' && o.enabled))); i++) await page.waitForTimeout(250);
console.log('interact', JSON.stringify(await ev(() => window.__bigshot.game.interact(0))));
await ev(() => { window.__bigshot.game.speedMult = 10; }); for (let i = 0; i < 80 && (await ev(() => window.__bigshot.game.player.where)) !== 'vehicle'; i++) await page.waitForTimeout(250); await ev(() => { window.__bigshot.game.speedMult = 1; });
console.log('in', await ev(() => window.__bigshot.game.player.where));
const drive = (keys, secs) => ev(([keys, secs]) => { const g = window.__bigshot.game; for (const k of keys) g.keys.add(k); for (let i = 0; i < secs * 20; i++) g.updateDriving(0.05); for (const k of keys) g.keys.delete(k); }, [keys, secs]);
await drive(['KeyW', 'KeyA'], 1.4); await drive(['KeyW', 'KeyD'], 1.4); await drive(['KeyW'], 3);
console.log('after', await ev(() => { const v = window.__bigshot.sim.playerCar(window.__bigshot.game.state, 'player'); return JSON.stringify({ pos: v.pos, odo: v.odometer }); }));
for (let k = 0; k < 10; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
await page.screenshot({ path: `${out}/car1.png`, timeout: 300000 });
await drive([], 4);
await page.keyboard.press('KeyE');
await page.waitForTimeout(300);
console.log('out', await ev(() => [window.__bigshot.game.player.where, window.__bigshot.game.player.visible]));
for (let k = 0; k < 10; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
await page.screenshot({ path: `${out}/car2.png`, timeout: 300000 });
console.log('errors', JSON.stringify(errors.slice(0, 5)));
await browser.close();
