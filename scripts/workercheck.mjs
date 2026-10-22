// Bodies are built in the background worker and people appear: node scripts/workercheck.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
const logs = [];
page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
page.on('pageerror', (e) => logs.push('pageerror ' + e.message));
await page.addInitScript(() => { try { localStorage.setItem('bigshot.gfx', 'low'); } catch { /* */ } });
await page.goto('http://localhost:4173/?skipcreator');
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(2000);
  console.log(await page.evaluate(() => { const g = window.__bigshot?.game; if (!g) return 'loading'; const P = Object.values(g.state.people); const b = window.__bigshot.bodies; return `views ${g.views.people.size} / visible ${P.filter((p) => p.visible).length} / people ${P.length}, built ${P.filter((p) => b.hasHumanBuild(p.appearance)).length}, worker ${b.workerActive()}, frame ${g.frameMs.toFixed(1)} ms`; }));
}
// worst frame gap over 5 s of play
const worst = await page.evaluate(async () => { let last = performance.now(), worst = 0; const end = last + 5000; while (performance.now() < end) { await new Promise((r) => requestAnimationFrame(() => r())); const t = performance.now(); worst = Math.max(worst, t - last); last = t; } return worst; });
console.log('worst frame gap', Math.round(worst), 'ms');
await page.screenshot({ path: process.argv[2] ?? '/tmp/claude-0/-home-user-fuzzy-enigma/fdd99bf2-52f8-534d-9b3e-8326d778c101/scratchpad/wk.png' });
console.log(logs.filter((l) => !l.startsWith('log')).slice(0, 10).join('\n'));
await browser.close();
