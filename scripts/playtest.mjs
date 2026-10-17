// Browser playtest: real keyboard input plus debug teleports for long walks.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto('http://localhost:4173/?skipcreator');
await page.waitForTimeout(2000);
const ev = (f, a) => page.evaluate(f, a);
const tp = (x, z, facing) => ev(([x, z, f]) => { const g = window.__bigshot.game; const p = g.player; p.pos = { x, z }; if (f !== undefined) p.facing = f; }, [x, z, facing]);
const waitIdle = async () => { for (let i = 0; i < 80; i++) { if (!(await ev(() => !!window.__bigshot.game.player.action))) return; await page.waitForTimeout(250); } };
const shot = async (n) => { await page.waitForTimeout(700); await page.screenshot({ path: `${out}/${n}.png` }); };
// walk with real keys out of the flat
await page.keyboard.down('KeyW'); await page.waitForTimeout(1500); await page.keyboard.up('KeyW');
const pos1 = await ev(() => window.__bigshot.game.player.pos);
console.log('after walking', pos1);
// street view
await tp(16, 4); await ev(() => { const g = window.__bigshot.game; g.camYaw = 0.6; g.camPitch = 0.45; g.camDist = 18; });
await shot('03-street');
// job centre board
await tp(-24, -25.6, Math.PI); await ev(() => { const g = window.__bigshot.game; g.camDist = 9; g.camPitch = 0.8; g.camYaw = 0; });
await shot('04-jobcentre');
await page.keyboard.press('KeyE');
await page.waitForTimeout(600);
await shot('05-phone-jobs');
// apply through the UI
await page.click('[data-apply]');
for (let i = 0; i < 3; i++) { await page.waitForTimeout(200); await page.click('#dialog .answer[data-a="1"]'); }
await page.waitForTimeout(300);
await page.keyboard.press('Tab');
// fast-forward 2.5 hours of game time
await ev(() => { const g = window.__bigshot.game; for (let i = 0; i < 150; i++) window.__bigshot.sim.step(g.state, 1); });
await page.keyboard.press('Tab'); await page.waitForTimeout(500);
await shot('06-offer');
await page.click('[data-accept]').catch(() => console.log('no offer button'));
await page.waitForTimeout(300);
await page.keyboard.press('Tab');
// put on uniform at the wardrobe
await tp(28.5, 11.9, Math.PI);
await page.waitForTimeout(400);
const opts = await ev(() => window.__bigshot.game.focus?.options.map((o) => o.label));
console.log('wardrobe options', opts);
await page.keyboard.press('Digit3'); await page.waitForTimeout(300); await waitIdle();
console.log('outfit', await ev(() => window.__bigshot.game.player.appearance.outfit));
// jump to next morning 07:55 and go to the terminal
await ev(() => { const g = window.__bigshot.game; const S = window.__bigshot.sim; while (g.state.minute < S.at(1, 7, 55)) S.step(g.state, 30); });
await tp(13.1, -29.4, Math.PI);
await page.waitForTimeout(400);
await page.keyboard.press('KeyE'); await page.waitForTimeout(300); await waitIdle();
console.log('on shift', await ev(() => !!window.__bigshot.sim.openAttendance(window.__bigshot.game.state, 'player')));
await ev(() => { const g = window.__bigshot.game; g.camDist = 11; g.camPitch = 0.95; g.camYaw = Math.PI * 0.75; });
await shot('07-storeroom');
// take a case of milk and stock the shelf
await tp(16, -33.6, Math.PI); await page.waitForTimeout(400); await page.keyboard.press('KeyE'); await page.waitForTimeout(300); await waitIdle();
console.log('hands', await ev(() => JSON.stringify(window.__bigshot.game.state.containers.hands_player.items)));
await tp(15.85, -23.75, Math.PI / 2); await page.waitForTimeout(400);
await page.keyboard.press('KeyE'); await page.waitForTimeout(400);
await ev(() => { const g = window.__bigshot.game; g.camDist = 7; g.camPitch = 0.6; g.camYaw = -Math.PI * 0.6; });
await shot('08-stocking');
await waitIdle();
console.log('milk shelf', await ev(() => window.__bigshot.game.state.containers.shelf_milk.items.milk));
// till view
await tp(22, -15.1, 0); await ev(() => { const g = window.__bigshot.game; g.camDist = 9; g.camPitch = 0.75; g.camYaw = Math.PI * 1.2; });
await shot('09-till');
await ev(() => { const g = window.__bigshot.game; g.camDist = 22; g.camPitch = 1.0; g.camYaw = Math.PI; });
await shot('10-shopfloor');
console.log('errors', JSON.stringify(errors.slice(0, 10)));
await browser.close();
