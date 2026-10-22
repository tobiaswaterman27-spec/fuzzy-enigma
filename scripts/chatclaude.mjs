// The conversation flow through claude.ai's page sampling (faked): node scripts/chatclaude.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.addInitScript(() => {
  const calls = [];
  const fn = async () => ({ text: 'x' });
  fn.json = async (turns) => { calls.push(turns); return { reply: 'Alright? Do I know you?', emotion: 'neutral', attitude: 0, decision: null, action: 'none' }; };
  window.__calls = calls;
  window.claude = { use: async (n) => (n === 'sample' ? fn : null) };
});
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
await page.evaluate(() => { localStorage.removeItem('bigshot.openai'); const g = window.__bigshot.game, S = window.__bigshot.sim, s = g.state; S.initLife(s); const o = S.residents(s)[2]; o.visible = true; o.where = 'outside'; o.pos = { x: -2, z: 7 }; g.player.pos = { x: -2, z: 5.6 }; window.__bigshot.ui.openChat(o.id); });
await page.waitForTimeout(1500);
await page.fill('#chat-in', 'hello there'); await page.press('#chat-in', 'Enter'); await page.waitForTimeout(1200);
console.log(await page.evaluate(() => JSON.stringify({ n: window.__calls.length, first: window.__calls[0][0].role, last: window.__calls[1].slice(-1)[0], log: document.querySelector('#dialog .chatlog')?.textContent })));
await browser.close();
