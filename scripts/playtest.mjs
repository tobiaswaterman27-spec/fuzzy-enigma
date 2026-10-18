// Browser playtest: real keyboard input plus debug teleports for long walks.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 560 } });
await page.addInitScript(() => { try { localStorage.setItem('bigshot.gfx', 'low'); } catch { /* */ } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto('http://localhost:4173/?skipcreator');
await page.waitForTimeout(2000);
const ev = (f, a) => page.evaluate(f, a);
await ev(() => { window.__bigshot.game.camLocked = true; });
const tp = (x, z, facing) => ev(([x, z, f]) => { const g = window.__bigshot.game; const p = g.player; p.pos = { x, z }; if (f !== undefined) p.facing = f; }, [x, z, facing]);
const waitIdle = async () => { await ev(() => { window.__bigshot.game.speedMult = 20; }); try { await waitIdle0(); } finally { await ev(() => { window.__bigshot.game.speedMult = 1; }); } };
const waitIdle0 = async () => { for (let i = 0; i < 12 && !(await ev(() => !!window.__bigshot.game.player.action)); i++) await page.waitForTimeout(250); for (let i = 0; i < 160; i++) { if (!(await ev(() => !!window.__bigshot.game.player.action))) return; await page.waitForTimeout(250); } };
const settle = () => ev(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
const waitFocus = async (txt) => { for (let i = 0; i < 60; i++) { if (await ev((t) => !!window.__bigshot.game.focus?.options.some((o) => o.label.includes(t)), txt)) return true; await page.waitForTimeout(250); } console.log('focus never showed', txt); return false; };
const shot = async (n) => { await page.waitForTimeout(700); await page.screenshot({ path: `${out}/${n}.png`, timeout: 120000 }); };
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
// apply through the UI (no questions at this stage)
await page.click('[data-apply]');
await page.waitForTimeout(300);
await ev(() => window.__bigshot.ui.closePhone());
// fast-forward 2.5 hours: the employer invites us to an interview
await ev(() => { const g = window.__bigshot.game; for (let i = 0; i < 150; i++) window.__bigshot.sim.step(g.state, 1); });
const inv = await ev(() => { const s = window.__bigshot.game.state; const a = Object.values(s.applications).find((x) => x.personId === 'player'); return { status: a.status, at: a.interviewAt, who: a.interviewerId }; });
console.log('application', JSON.stringify(inv));
// dress smartly at the wardrobe first
await tp(23.7, 23.1, -Math.PI / 2); await waitFocus('Smart');
const smartIdx = await ev(() => window.__bigshot.game.focus?.options.findIndex((o) => o.label.includes('Smart')));
await page.keyboard.press(`Digit${smartIdx + 1}`); await page.waitForTimeout(300); await waitIdle();
// go to the shop at the interview time and talk to the manager in person
await ev((at) => { const g = window.__bigshot.game; const S = window.__bigshot.sim; while (g.state.minute < at - 15) S.step(g.state, 5); }, inv.at);
// Harlan may be walking, so stand in front of him until the interview option is in focus
for (let i = 0; i < 40; i++) {
  await ev((id) => { const g = window.__bigshot.game; const h = g.state.people[id]; g.player.pos = { x: h.pos.x + Math.sin(h.facing) * 1.0, z: h.pos.z + Math.cos(h.facing) * 1.0 }; g.player.facing = Math.atan2(h.pos.x - g.player.pos.x, h.pos.z - g.player.pos.z); g.camYaw = g.player.facing + Math.PI; }, 'p_harlan');
  await page.waitForTimeout(250);
  if (await ev(() => !!window.__bigshot.game.focus?.options.some((o) => o.label.startsWith('Attend')))) break;
}
console.log('focus', JSON.stringify(await ev(() => window.__bigshot.game.focus?.options.map((o) => o.label))));
await ev(() => window.__bigshot.ui.closePhone());
await shot('05-interview-approach');
console.log('before E', JSON.stringify(await ev(() => ({ ui: window.__bigshot.game.uiOpen, phone: window.__bigshot.ui.phoneOpen, menu: window.__bigshot.ui.menuOpen, dlg: document.getElementById('dialog').hidden, act: window.__bigshot.game.player.action?.type }))));
await page.keyboard.press('KeyE');
for (let i = 0; i < 80 && (await ev(() => document.getElementById('dialog').hidden)); i++) await page.waitForTimeout(250);
console.log('dialog open', await ev(() => document.getElementById('dialog').innerHTML.slice(0, 600)));
for (let i = 0; i < 3; i++) { await page.click('#dialog .answer[data-a="1"]', { timeout: 60000 }).catch(() => console.log('no answer button')); await page.waitForTimeout(200); }
await shot('06-interview-result');
await page.click('[data-acc]', { timeout: 60000 }).catch(() => console.log('no accept button'));
await page.waitForTimeout(300);
// put on uniform at the wardrobe
await tp(23.7, 23.1, -Math.PI / 2);
await waitFocus('Smart');
const opts = await ev(() => window.__bigshot.game.focus?.options.map((o) => o.label));
console.log('wardrobe options', opts);
const uniIdx = opts.findIndex((o) => /market/i.test(o));
console.log('uniform option', JSON.stringify(await ev((i) => window.__bigshot.game.focus?.options[i], uniIdx)), 'action', await ev(() => JSON.stringify(window.__bigshot.game.player.action)), await ev(() => JSON.stringify({ ui: window.__bigshot.game.uiOpen, dlg: document.getElementById('dialog').hidden ? '' : document.getElementById('dialog').innerText.slice(0, 300) })));
await page.keyboard.press(`Digit${uniIdx + 1}`);
await waitIdle();
console.log('outfit', await ev(() => window.__bigshot.game.player.appearance.outfit));
// jump to next morning 07:55 and go to the terminal
await ev(() => { const g = window.__bigshot.game; const S = window.__bigshot.sim; const c = g.state.contracts[g.player.contractId]; while (g.state.minute < S.at(c.startDay, 7, 55)) S.step(g.state, 30); });
await tp(13.1, -29.4, Math.PI);
await settle();
await page.keyboard.press('KeyE'); await page.waitForTimeout(300); await waitIdle();
console.log('on shift', await ev(() => !!window.__bigshot.sim.openAttendance(window.__bigshot.game.state, 'player')));
await ev(() => { const g = window.__bigshot.game; g.camDist = 11; g.camPitch = 0.95; g.camYaw = Math.PI * 0.75; });
await shot('07-storeroom');
// take a case of milk and stock the shelf
await tp(16, -33.6, Math.PI); await settle(); await page.keyboard.press('KeyE'); await page.waitForTimeout(300); await waitIdle();
console.log('hands', await ev(() => JSON.stringify(window.__bigshot.game.state.containers.hands_player.items)));
await tp(15.85, -23.75, Math.PI / 2); await settle();
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
