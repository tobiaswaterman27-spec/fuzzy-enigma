import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(2500);
const looks = JSON.parse(process.argv[3]);
let i = 0;
for (const l of looks) {
  await page.evaluate((l) => { const g = window.__bigshot.game; Object.assign(g.player.appearance, l.a); g.player.pos = { x: 20, z: 14 }; g.player.facing = Math.PI; g.overview = false; g.camYaw = 0; g.camPitch = l.pitch ?? 0.0; g.camDist = l.dist ?? 1.2; }, l);
  await page.waitForTimeout(1200);
  if (l.headCam) await page.evaluate(() => { const g = window.__bigshot.game; const v = g.views.people.get('player'); const h = new window.__bigshot.THREE.Vector3(); v.rig.bones.head.getWorldPosition(h); g.freeCam = true; g.camera.position.set(h.x, h.y + 0.08, h.z - 0.55); g.camera.lookAt(h.x, h.y + 0.08, h.z); g.renderer.render(g.scene, g.camera); });
  await page.screenshot({ path: `${out}/close${i++}.png` });
}
await browser.close();
