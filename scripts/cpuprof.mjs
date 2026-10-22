// CPU profile of the game loop (self time by function): node scripts/cpuprof.mjs [x z]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
await page.addInitScript(() => { try { localStorage.setItem('bigshot.gfx', 'low'); } catch { /* */ } });
await page.goto(`http://localhost:${process.env.PORT ?? 4173}/?skipcreator`); await page.waitForTimeout(4000);
const [x, z] = process.argv.slice(2).map(Number);
// skip the GPU work so the profile shows the game's own CPU cost; run the tick by hand
await page.evaluate(([x, z]) => {
  const g = window.__bigshot.game;
  const S = window.__bigshot.sim; while (g.state.minute < S.at(0, 11, 0)) S.step(g.state, 2);
  if (!Number.isNaN(x)) { g.player.pos = { x, z }; g.player.where = window.__bigshot.sim.locationOf({ x, z }); }
  g.renderer.render = () => {}; if (g.composer) g.composer.render = () => {};
  g.speedMult = 4;
}, [x, z]);
const cdp = await page.context().newCDPSession(page);
await page.waitForTimeout(8000);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');
const ms = await page.evaluate(() => { const g = window.__bigshot.game; const t = performance.now(); for (let i = 0; i < 300; i++) g.tick(1 / 60); return (performance.now() - t) / 300; });
const { profile } = await cdp.send('Profiler.stop');
const self = new Map();
const dt = profile.timeDeltas; const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const counts = new Map(); for (const s of profile.samples) counts.set(s, (counts.get(s) ?? 0) + 1);
let total = 0;
for (const [id, n] of counts) { const node = byId.get(id); const f = node.callFrame; const k = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}`; self.set(k, (self.get(k) ?? 0) + n); total += n; }
console.log('ms per tick', ms.toFixed(2));
console.log([...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => `${(100 * v / total).toFixed(1)}% ${k}`).join('\n'));
await browser.close();
