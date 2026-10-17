import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:4173/'); await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/h1-creator.png` });
await page.evaluate(() => { const g = window.__bigshot.game; g.camDist = 1.4; g.camPitch = 0.05; });
await page.waitForTimeout(800); await page.screenshot({ path: `${out}/h2-face.png` });
await page.evaluate(() => { const g = window.__bigshot.game; const a = g.player.appearance; a.frame = 'f'; a.hair = 'long'; a.hairColor = '#a8743f'; a.skin = '#f1d3b6'; a.outfit = 'uniform_market'; g.camDist = 2.6; });
await page.waitForTimeout(1200); await page.screenshot({ path: `${out}/h3-fem.png` });
await page.evaluate(() => { const g = window.__bigshot.game; const a = g.player.appearance; a.frame = 'm'; a.hair = 'curly'; a.skin = '#7a4a2e'; a.outfit = 'outfit_smart'; a.build = 'broad'; g.camYaw = Math.PI * 0.6; });
await page.waitForTimeout(1200); await page.screenshot({ path: `${out}/h4-smart.png` });
console.log('errors', JSON.stringify(errors.slice(0, 5)));
await browser.close();
