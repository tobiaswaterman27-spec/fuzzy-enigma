// Walking up Marlow Court's stairs: half way up a flight, and the opening in the floor above. node scripts/stairshot.mjs <outdir>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(4000);
const shot = async (name, setup, wait = 8000) => { await page.evaluate(setup); await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png`, timeout: 240000 }); };
await page.evaluate(() => { const s = window.__bigshot.game.state; s.minute = Math.floor(s.minute / 1440) * 1440 + 13 * 60; });
await shot('s1_halfway', () => { const g = window.__bigshot.game; g.player.pos = { x: 12.8, z: 14.0 }; g.player.where = 'marlow'; g.player.facing = 0; });
await shot('s2_hole', () => { const g = window.__bigshot.game; g.player.pos = { x: 10015.6, z: 17.0 }; g.player.where = 'mc_1'; g.player.facing = Math.PI + 0.6; });
// walk W from the foot of the flight on the ground floor: does it carry on up to the first floor?
const walked = await page.evaluate(async () => {
  const g = window.__bigshot.game; g.player.pos = { x: 12.8, z: 10.8 }; g.player.facing = 0; g.camYaw = Math.PI;
  g.keys.add('KeyW'); await new Promise((r) => setTimeout(r, 14000)); g.keys.delete('KeyW');
  return JSON.stringify(g.player.pos);
});
console.log('after walking up', walked);
await page.screenshot({ path: `${out}/s3_top.png`, timeout: 240000 });
await browser.close();
