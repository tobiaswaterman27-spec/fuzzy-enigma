// The city: aerial views and street level. node scripts/cityshot.mjs <outdir>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text().slice(0, 200)); });
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(4000);
const shot = async (name, setup, wait = 7000) => { await page.evaluate(setup); await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png`, timeout: 240000 }); };
await page.evaluate(() => { const s = window.__bigshot.game.state; s.minute = Math.floor(s.minute / 1440) * 1440 + 14 * 60; });
await shot('c1_aerial', () => { const g = window.__bigshot.game; g.freeCam = true; g.player.pos = { x: 0, z: -130 }; g.player.where = 'outside'; g.camera.position.set(-300, 260, 240); g.camera.lookAt(80, 0, -380); }, 10000);
await shot('c2_centre', () => { const g = window.__bigshot.game; g.camera.position.set(-40, 40, -150); g.camera.lookAt(60, 25, -330); }, 6000);
await shot('c3_street', () => { const g = window.__bigshot.game; g.freeCam = false; g.player.pos = { x: -300, z: -126 }; g.player.where = 'outside'; g.player.facing = Math.PI / 2; }, 9000);
await shot('c4_suburb', () => { const g = window.__bigshot.game; g.player.pos = { x: -600, z: -786 }; g.player.facing = -Math.PI / 2; }, 9000);
await shot('c5_beach', () => { const g = window.__bigshot.game; g.freeCam = true; g.player.pos = { x: -500, z: 60 }; g.camera.position.set(-560, 18, 110); g.camera.lookAt(-480, 2, 40); }, 7000);
await shot('c6_docks', () => { const g = window.__bigshot.game; g.camera.position.set(420, 30, 120); g.camera.lookAt(560, 5, 30); }, 7000);
const fps = await page.evaluate(() => document.body.innerText.match(/(\d+\.\d) ms/)?.[1]);
console.log('frame ms', fps);
await browser.close();
