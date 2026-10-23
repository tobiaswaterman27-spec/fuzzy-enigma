// Marlow Court: outside, the lobby and stairs, a landing, your flat, and someone on the stairs.
// node scripts/marlowshot.mjs <outdir>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
const shot = async (name, setup, wait = 6000) => {
  await page.evaluate(setup);
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${out}/${name}.png` });
};
await page.evaluate(() => { const s = window.__bigshot.game.state; s.minute = Math.floor(s.minute / 1440) * 1440 + 13 * 60; });
await shot('m1_outside', () => { const g = window.__bigshot.game; g.freeCam = true; g.player.pos = { x: 21, z: 2 }; g.player.where = 'outside'; g.camera.position.set(4, 9, -8); g.camera.lookAt(21, 5, 18); }, 9000);
await shot('m2_lobby', () => { const g = window.__bigshot.game; g.freeCam = false; g.player.pos = { x: 19, z: 16.5 }; g.player.where = 'marlow'; g.player.facing = Math.PI * 1.25; });
await shot('m3_landing1', () => { const g = window.__bigshot.game; g.player.pos = { x: 10015.6, z: 12.0 }; g.player.where = 'mc_1'; g.player.facing = Math.PI / 2 + 0.3; });
await shot('m4_flat', () => { const g = window.__bigshot.game; g.player.pos = { x: 20018.0, z: 16.2 }; g.player.where = 'flat'; g.player.facing = 0.5; });
await shot('m5_unit', () => { const g = window.__bigshot.game, s = g.state; s.houseOpen = { mc_1b: s.minute + 60 }; g.player.pos = { x: 10022.6, z: 15.5 }; g.player.where = 'mc_1b'; g.player.facing = 1.2; });
await shot('m6_climb', () => { const g = window.__bigshot.game; g.player.pos = { x: 12.8, z: 10.75 }; g.player.where = 'marlow'; g.player.facing = 0; g.player.move = { path: [{ x: 10012.8, z: 17.1 }], idx: 0, dest: { x: 10012.8, z: 17.1 }, destLabel: 'stairs', stuckTime: 0, lastDist: 1e9, replans: 0, climb: 0 }; }, 1500);
await browser.close();
