// Harbourside Police Station: outside, the front desk, and a night in the cells. node scripts/stationshot.mjs <outdir>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
const shot = async (name, setup, wait = 7000) => { await page.evaluate(setup); await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png` }); };
await page.evaluate(() => { const s = window.__bigshot.game.state; s.minute = Math.floor(s.minute / 1440) * 1440 + 13 * 60; });
await shot('p1_outside', () => { const g = window.__bigshot.game; g.freeCam = true; g.player.pos = { x: 57, z: -4 }; g.player.where = 'outside'; g.camera.position.set(42, 7, 2); g.camera.lookAt(57, 3, -14); }, 9000);
await shot('p2_desk', () => { const g = window.__bigshot.game; g.freeCam = false; g.player.pos = { x: 56, z: -14.5 }; g.player.where = 'police'; g.player.facing = Math.PI; });
await shot('p3_cells', () => { const g = window.__bigshot.game; g.player.pos = { x: 50, z: -27.5 }; g.player.where = 'police'; g.player.facing = Math.PI + 0.3; });
await shot('p4_office', () => { const g = window.__bigshot.game; g.player.pos = { x: 60.5, z: -22 }; g.player.where = 'police'; g.player.facing = Math.PI - 0.2; });
await browser.close();
