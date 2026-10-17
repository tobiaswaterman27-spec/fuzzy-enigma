import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(2000);
const ev = (f, a) => page.evaluate(f, a);
const setp = (x, z, yaw, pitch = 0.22) => ev(([x, z, yaw, pitch]) => { const g = window.__bigshot.game; g.player.pos = { x, z }; g.camYaw = yaw; g.camPitch = pitch; }, [x, z, yaw, pitch]);
const shots = (process.argv[3] ?? '').split(';').filter(Boolean);
let i = 0;
for (const spec of shots) { const [x, z, yaw, pitch, name] = spec.split(','); await setp(+x, +z, +yaw, +pitch); await page.waitForTimeout(900); await page.screenshot({ path: `${out}/${name ?? 'cam' + i++}.png` }); }
console.log('errors', JSON.stringify(errors.slice(0, 5)));
await browser.close();
