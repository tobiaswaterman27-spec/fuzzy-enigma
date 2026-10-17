import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(2500);
const info = await page.evaluate(() => { const g = window.__bigshot.game; let meshes = 0, tris = 0; g.scene.traverse((o) => { if (o.isMesh) { meshes++; } }); const r = g.renderer.info.render; return { meshes, calls: r.calls, triangles: r.triangles, lights: (() => { let n = 0; g.scene.traverse((o) => { if (o.isLight) n++; }); return n; })(), frameMs: g.frameMs }; });
console.log(JSON.stringify(info));
await browser.close();
