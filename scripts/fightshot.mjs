// A fight in the street: punch, knock someone down, blood, police. node scripts/fightshot.mjs <outdir>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
const frames = async (n) => { for (let k = 0; k < n; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r()))); };
console.log(await page.evaluate(() => {
  const g = window.__bigshot.game, S = window.__bigshot.sim, s = g.state;
  S.initLife(s);
  s.minute = Math.floor(s.minute / 1440) * 1440 + 13 * 60;
  const me = g.player;
  me.pos = { x: -2, z: 6 }; me.where = 'outside'; me.visible = true; me.facing = 0;
  me.weapon = 'bat';
  const v = S.residents(s).filter((p) => !p.dead)[1];
  v.visible = true; v.where = 'outside'; v.pos = { x: -2, z: 7 }; v.move = null; v.action = null; v.npc.plan = [];
  v.facing = Math.PI;
  S.hurt(s, v, 85, 'hit with a cricket bat', me.id, 0.3);
  S.splash(s, { x: -2.2, z: 7.4 }, 0.7);
  S.crime(s, 'assault with a weapon', 3, v.id);
  me.action = { type: 'attack', target: 'person:' + v.id, arg: 'bat', started: s.minute, progress: 0, unitTime: 0, duration: 99, units: 0 };
  return v.name + ' down=' + v.down + ' hp=' + v.health;
}));
await page.waitForTimeout(4000);
await frames(30);
await page.screenshot({ path: `${out}/fight.png` });
await page.evaluate(() => { const g = window.__bigshot.game; g.player.action = null; });
// let the police arrive
await page.evaluate(() => { const g = window.__bigshot.game; g.speedMult = 4; });
await page.waitForTimeout(9000);
await frames(20);
console.log(await page.evaluate(() => { const s = window.__bigshot.game.state; return JSON.stringify({ wanted: s.wanted, police: Object.values(s.people).filter((p) => p.police && p.visible).map((p) => [p.name, Math.round(p.pos.x), Math.round(p.pos.z)]), away: s.people.player.away }); }));
await page.screenshot({ path: `${out}/police.png` });
await browser.close();
