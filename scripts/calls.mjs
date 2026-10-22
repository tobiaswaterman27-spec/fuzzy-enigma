// Draw calls and triangles actually rendered at a few spots: node scripts/calls.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.addInitScript(() => { try { localStorage.setItem('bigshot.gfx', 'low'); } catch { /* */ } });
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(4000);
for (const [name, x, z, f] of [['street', 20, 3, 0], ['street_w', 0, 3, -1.57], ['market', 24, -20, 3.14], ['flat', 20, 18, 0], ['park', 56, 25, 0], ['wholesale', -60, 20, 3.14]]) {
  const r = await page.evaluate(async ([x, z, f]) => {
    const g = window.__bigshot.game, S = window.__bigshot.sim;
    g.player.pos = { x, z }; g.player.facing = f; g.player.where = S.locationOf({ x, z }); g.camYaw = f + Math.PI;
    const info = g.renderer.info; info.autoReset = false;
    await new Promise((r) => requestAnimationFrame(() => r()));
    await new Promise((r) => requestAnimationFrame(() => r()));
    info.reset();
    const t = performance.now();
    await new Promise((r) => requestAnimationFrame(() => r()));
    const out = { calls: info.render.calls, tris: info.render.triangles, ms: Math.round(performance.now() - t) };
    info.autoReset = true;
    return out;
  }, [x, z, f]);
  console.log(name, JSON.stringify(r));
}
await browser.close();
