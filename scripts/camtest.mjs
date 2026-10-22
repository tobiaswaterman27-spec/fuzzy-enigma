// Camera: follows behind outside, looks down in a small room, mouse drag turns it: node scripts/camtest.mjs <outdir>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.addInitScript(() => { try { localStorage.setItem('bigshot.gfx', 'low'); } catch { /* */ } });
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(6000);
const frames = (n) => page.evaluate(async (n) => { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(() => r())); }, n);
// inside the flat
await frames(20);
console.log('flat', await page.evaluate(() => { const g = window.__bigshot.game; return JSON.stringify({ pitch: g.camPitch.toFixed(2), dist: g.camDist.toFixed(2), where: g.player.where }); }));
await page.screenshot({ path: `${out}/cam_flat.png` });
// drag to look around
await page.mouse.move(400, 250); await page.mouse.down(); await page.mouse.move(250, 230, { steps: 5 }); await page.mouse.up();
await frames(5);
await page.screenshot({ path: `${out}/cam_drag.png` });
console.log('after drag', await page.evaluate(() => window.__bigshot.game.camYaw.toFixed(2)));
// outside on the street
await page.evaluate(() => { const g = window.__bigshot.game; g.player.pos = { x: 20, z: 3 }; g.player.facing = -Math.PI / 2; g.player.where = 'outside'; });
await page.waitForTimeout(4500);
await page.keyboard.down('KeyW'); await frames(25); await page.keyboard.up('KeyW');
await frames(10);
console.log('street', await page.evaluate(() => { const g = window.__bigshot.game; return JSON.stringify({ yaw: g.camYaw.toFixed(2), facing: g.player.facing.toFixed(2), pitch: g.camPitch.toFixed(2) }); }));
await page.screenshot({ path: `${out}/cam_street.png` });
await browser.close();
