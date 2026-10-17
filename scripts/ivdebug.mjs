import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(2000);
const ev = (f, a) => page.evaluate(f, a);
await ev(() => { const { game, sim } = window.__bigshot; const s = game.state; const v = Object.values(s.vacancies).find((x) => x.positionId === 'assistant_am'); sim.applyForJob(s, 'player', v.id, []); for (let i = 0; i < 150; i++) sim.step(s, 1); const a = Object.values(s.applications).find((x) => x.personId === 'player'); while (s.minute < a.interviewAt - 15) sim.step(s, 5); const h = s.people.p_harlan; game.player.pos = { x: h.pos.x + Math.sin(h.facing), z: h.pos.z + Math.cos(h.facing) }; game.player.facing = Math.atan2(h.pos.x - game.player.pos.x, h.pos.z - game.player.pos.z); });
await page.waitForTimeout(500);
console.log(JSON.stringify(await ev(() => ({ uiOpen: window.__bigshot.game.uiOpen, paused: window.__bigshot.game.paused, focus: window.__bigshot.game.focus?.options.map((o) => [o.label, o.enabled, o.type]) }))));
await page.keyboard.press('KeyE'); await page.waitForTimeout(400);
console.log('dialog hidden?', await ev(() => document.getElementById('dialog').hidden), await ev(() => document.getElementById('dialog').innerHTML.slice(0, 200)));
await browser.close();
