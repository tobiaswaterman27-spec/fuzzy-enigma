// CPU time per frame by subsystem at a few places in town: node scripts/profile.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.addInitScript(() => { try { localStorage.setItem('bigshot.gfx', 'low'); } catch { /* */ } });
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
await page.evaluate(() => {
  const g = window.__bigshot.game;
  const T = (window.__T = {});
  const wrap = (obj, name, key) => { const f = obj[name].bind(obj); obj[name] = (...a) => { const t = performance.now(); const r = f(...a); T[key] = (T[key] ?? 0) + performance.now() - t; return r; }; };
  wrap(g.views, 'update', 'views'); wrap(g.traffic, 'update', 'traffic'); wrap(g.world, 'update', 'world'); wrap(g.sites, 'update', 'sites');
  wrap(g.renderer, 'render', 'render'); if (g.composer) wrap(g.composer, 'render', 'composer');
  const S = window.__bigshot.sim; const st = S.step;
  wrap(g, 'tick', 'tick');
});
const places = [['street', 20, 3], ['market', 24, -20], ['flat', 20, 18], ['park', 56, 25], ['wholesale', -60, 20]];
for (const [name, x, z] of places) {
  await page.evaluate(([x, z]) => { const g = window.__bigshot.game; g.player.pos = { x, z }; g.player.where = window.__bigshot.sim.locationOf({ x, z }); g.player.action = null; for (const k in window.__T) window.__T[k] = 0; }, [x, z]);
  for (let k = 0; k < 10; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await page.evaluate(() => { for (const k in window.__T) window.__T[k] = 0; });
  const N = 30;
  for (let k = 0; k < N; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  const r = await page.evaluate((N) => { const g = window.__bigshot.game; const i = g.renderer.info.render; return { ...Object.fromEntries(Object.entries(window.__T).map(([k, v]) => [k, +(v / N).toFixed(2)])), calls: i.calls, tris: i.triangles }; }, N);
  console.log(name, JSON.stringify(r));
}
await browser.close();
