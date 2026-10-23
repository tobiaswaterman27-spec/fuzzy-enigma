// The city at street level, by day and at night. node scripts/cityshot2.mjs <outdir>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(4000);
const shot = async (name, setup, wait = 9000) => { await page.evaluate(setup); await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png`, timeout: 240000 }); };
await page.evaluate(() => { const s = window.__bigshot.game.state; s.minute = Math.floor(s.minute / 1440) * 1440 + 14 * 60; });
await shot('d1_suburb', () => { const g = window.__bigshot.game; g.player.pos = { x: -600, z: -774 }; g.player.where = 'outside'; g.player.facing = -Math.PI / 2; });
await shot('d2_main_west', () => { const g = window.__bigshot.game; g.player.pos = { x: -110, z: -6.5 }; g.player.facing = -Math.PI / 2; });
await shot('d3_night', () => { const g = window.__bigshot.game, s = g.state; s.minute = Math.floor(s.minute / 1440) * 1440 + 22 * 60; g.player.pos = { x: 60, z: -136 }; g.player.facing = Math.PI; }, 12000);
await browser.close();
