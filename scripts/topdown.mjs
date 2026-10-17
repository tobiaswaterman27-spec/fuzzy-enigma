// Top-down view of a building interior (roof hidden): node scripts/topdown.mjs <out.png> <buildingId>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const [out, id] = process.argv.slice(2);
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
await page.addInitScript(() => localStorage.setItem('bigshot.gfx', 'low'));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(2500);
await page.evaluate((id) => {
  const g = window.__bigshot.game; const T = window.__bigshot.THREE;
  const c = g.world.cutaway.get(id); for (const r of c.roof) r.visible = false;
  const b = window.__bigshot.sim.getWorld ? null : null;
  g.freeCam = true; g.paused = true;
  const box = new T.Box3(); for (const w of c.walls) box.expandByObject(w);
  const ctr = box.getCenter(new T.Vector3()), sz = box.getSize(new T.Vector3());
  g.camera.fov = 40; g.camera.updateProjectionMatrix();
  g.camera.position.set(ctr.x, Math.max(sz.x, sz.z) * 1.25 + 3, ctr.z + 0.01); g.camera.lookAt(ctr.x, 0, ctr.z);
}, id);
for (let k = 0; k < 3; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
await page.screenshot({ path: out, timeout: 180000 });
await browser.close();
