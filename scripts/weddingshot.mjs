// A wedding in the park. node scripts/weddingshot.mjs <outdir> [kind]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2], kind = process.argv[3] ?? 'wedding';
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
console.log(await page.evaluate((kind) => {
  const g = window.__bigshot.game, S = window.__bigshot.sim, s = g.state;
  S.initLife(s);
  s.minute = Math.floor(s.minute / 1440) * 1440 + 11 * 60;
  const [a, b, ...rest] = S.residents(s);
  for (const r of rest.slice(0, 9)) r.relations[a.id] = 50;
  const gt = S.scheduleGathering(s, kind, kind === 'birthday' ? [a] : [a, b], 'test', 0, 11);
  S.step(s, 1);
  for (const id of [...gt.hosts, ...gt.guests]) { const p = s.people[id]; const pl = S.placeFor(gt, id); p.pos = { ...pl.pos }; p.visible = true; p.where = 'park'; p.move = null; p.npc.plan = [{ kind: 'wait', until: gt.until }]; p.facing = pl.facing; }
  S.step(s, 2);
  g.player.pos = { x: 56, z: 26 }; g.player.where = 'park'; g.player.facing = 0; g.camYaw = Math.PI + 0.25; g.zoom = 1.5;
  return gt.guests.length + ' guests';
}, kind));
await page.waitForTimeout(9000);
await page.screenshot({ path: `${out}/${kind}.png` });
await browser.close();
