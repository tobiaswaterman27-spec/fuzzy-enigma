// Steps the real game loop at 30 fps with rendering stubbed, pressing keys, and samples movement and animation.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
await page.addInitScript(() => localStorage.setItem('bigshot.gfx', 'low'));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
const log = await page.evaluate(() => {
  const g = window.__bigshot.game;
  g.start = () => {}; g.renderer.render = () => {}; g.composer = null;
  g.player.pos = { x: 20, z: 2 }; g.player.facing = Math.PI; g.camYaw = 0;
  const out = [];
  const seq = [['idle', [], 1.5], ['W', ['KeyW'], 3], ['stop', [], 1.5], ['D', ['KeyD'], 3], ['WD', ['KeyW', 'KeyD'], 2], ['S', ['KeyS'], 2], ['stop', [], 1.5]];
  for (const [tag, keys, secs] of seq) {
    g.keys.clear(); for (const k of keys) g.keys.add(k);
    for (let i = 0; i < secs * 30; i++) {
      g.tick(1 / 30);
      if (i % 8 === 7) { const v = g.views.people.get('player'); out.push(`${tag.padEnd(5)} pos ${g.player.pos.x.toFixed(2)},${g.player.pos.z.toFixed(2)} face ${g.player.facing.toFixed(2)} clip ${v.anim.state.padEnd(10)} anim-speed ${v.speed.toFixed(2)} cam ${g.camYaw.toFixed(2)}`); }
    }
  }
  return out;
});
console.log(log.join('\n'));
await browser.close();
