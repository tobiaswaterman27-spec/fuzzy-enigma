// Side-on frames of a person animating, tiled into one strip: node scripts/animstrip.mjs <out.png> <mode: walk|run|idle|sit|pickup|carry> [outfit]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const [out, mode = 'walk', outfit = 'outfit_casual'] = process.argv.slice(2);
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 360, height: 520 } });
await page.addInitScript(() => localStorage.setItem('bigshot.gfx', 'low'));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(2500);
const shots = [];
await page.evaluate(([mode, outfit]) => {
  const g = window.__bigshot.game; g.paused = true; g.freeCam = true;
  const p = g.player; p.appearance.outfit = outfit; p.pos = { x: 16, z: 4 }; p.facing = Math.PI / 2;
  const v = g.views.people.get('player');
  for (const el of document.body.children) if (el.tagName !== 'CANVAS' && !el.querySelector('canvas')) el.style.visibility = 'hidden';
  document.querySelectorAll('body *').forEach((el) => { if (el.tagName !== 'CANVAS' && !el.querySelector('canvas')) el.style.visibility = 'hidden'; });
  g.world.group.visible = false; const T = window.__bigshot.THREE; const fl = new T.Mesh(new T.PlaneGeometry(40, 40), new T.MeshStandardMaterial({ color: '#8d8a84' })); fl.rotation.x = -Math.PI / 2; fl.receiveShadow = true; g.scene.add(fl);
  window.__strip = { v, mode };
}, [mode, outfit]);
for (let i = 0; i < 6; i++) {
  await page.evaluate(([i]) => {
    const g = window.__bigshot.game; const { v, mode } = window.__strip;
    const speed = mode === 'walk' ? 1.7 : mode === 'run' ? 3.4 : mode === 'carry' ? 0.9 : 0;
    const action = { sit: 'sit', pickup: 'take_case', mop: 'clean', cook: 'cook', wash: 'shower', dress: 'change_outfit', place: 'stock_shelf', type: 'clock_in', eat: 'eat' }[mode] ?? null;
    const dt = mode === 'walk' || mode === 'carry' ? 1.0 / 6 : mode === 'run' ? 0.72 / 6 : 0.45;
    for (let k = 0; k < 6; k++) v.anim.update(dt / 6, speed, mode === 'carry', action);
    v.rig.root.position.set(16, 0, 4); v.rig.root.rotation.y = Math.PI / 2;
    g.camera.fov = 35; g.camera.updateProjectionMatrix();
    g.camera.position.set(16, 1.0, -3); g.camera.lookAt(16, 0.95, 4);
    g.views.update = () => {}; // keep our pose
  }, [i]);
  for (let k = 0; k < 2; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  const f = `${out}.${i}.png`;
  await page.screenshot({ path: f, clip: { x: 60, y: 20, width: 240, height: 480 }, timeout: 120000 });
  shots.push(f);
}
await browser.close();
console.log(shots.join(' '));
