// Launches the built game in Chromium, drives it, and saves screenshots.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2] ?? 'shots';
const url = process.argv[3] ?? 'http://localhost:4173/';
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(url);
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/01-creator.png` });
await page.click('#cc-start');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/02-flat.png` });
console.log(JSON.stringify(errors.slice(0, 20), null, 1));
await browser.close();
