// A hold-up at the Corner Market till, mid-way. node scripts/robshot.mjs <outdir>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
console.log(await page.evaluate(() => {
  const g = window.__bigshot.game, S = window.__bigshot.sim, s = g.state;
  s.minute = Math.floor(s.minute / 1440) * 1440 + 11 * 60;
  const till = S.getWorld().interactables.till;
  const clerk = Object.values(s.people).find((p) => p.contractId && s.contracts[p.contractId].businessId === 'market' && !p.isPlayer);
  clerk.visible = true; clerk.where = 'market'; clerk.pos = { x: till.obj.x + (till.obj.x - till.pos.x) * 0.9, z: till.obj.z + (till.obj.z - till.pos.z) * 0.9 }; clerk.action = null; clerk.move = null;
  g.player.pos = { ...till.pos }; g.player.where = 'market'; g.player.weapon = 'knife'; g.player.facing = till.facing;
  window.__till = till;
  return JSON.stringify(S.startAction(s, 'player', 'till', 'rob'));
}));
await page.waitForTimeout(6000);
await page.evaluate(() => { const g = window.__bigshot.game, S = window.__bigshot.sim; S.step(g.state, 0.5); const t = window.__till; g.freeCam = true; g.camera.position.set(t.pos.x - 2.2, 2.0, t.pos.z - 1.6); g.camera.lookAt(t.obj.x, 1.1, t.obj.z); });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/rob1.png`, timeout: 200000 });
await page.evaluate(() => { const g = window.__bigshot.game, S = window.__bigshot.sim; S.step(g.state, 0.5); });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/rob2.png`, timeout: 200000 });
console.log(await page.evaluate(() => { const g = window.__bigshot.game, S = window.__bigshot.sim; S.step(g.state, 1); return JSON.stringify({ wanted: g.state.wanted, money: g.state.ledger.accounts[g.player.accountId].balance }); }));
await browser.close();
