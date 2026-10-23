// Inside the city's venues. node scripts/venueshot.mjs <outdir>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(4000);
const kinds = (process.argv[3] ?? 'shop,bank,nightclub,casino,pub,gym').split(',');
for (const k of kinds) {
  await page.evaluate((k) => {
    const g = window.__bigshot.game, s = g.state, w = window.__bigshot.sim.getWorld();
    const v = (w.buildings.find((b) => b.id.startsWith('v_') && b.role.toLowerCase().startsWith({ shop: 'corner', bank: 'bank', nightclub: 'nightclub', casino: 'casino', pub: 'pub', gym: 'gym', clothes: 'clothes', barber: 'barber', cafe: 'cafe', arcade: 'amusement', takeaway: 'takeaway', pawn: 'pawn' }[k])));
    const day = Math.floor(s.minute / 1440) * 1440;
    s.minute = day + (k === 'nightclub' || k === 'casino' ? 23 * 60 : 13 * 60);
    const front = v.doors[0].side === 'zmin';
    const x = (v.rect.x0 + v.rect.x1) / 2, z = front ? v.rect.z0 + 1.6 : v.rect.z1 - 1.6;
    g.player.pos = { x, z }; g.player.where = v.id; g.player.facing = front ? 0 : Math.PI; g.camAt = null;
    window.__shotName = v.name;
  }, k);
  await page.waitForTimeout(9000);
  await page.screenshot({ path: `${out}/v_${k}.png`, timeout: 240000 });
  console.log(k, await page.evaluate(() => window.__shotName));
}
await browser.close();
