// The conversation flow end to end, with OpenAI mocked: node scripts/chattest.mjs <outdir>
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2];
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
const seen = [];
let n = 0;
await page.route('https://api.openai.com/**', async (route) => {
  const body = JSON.parse(route.request().postData());
  const last = body.messages[body.messages.length - 1].content;
  seen.push(last.slice(0, 160));
  const replies = [
    { reply: "Oh, hello. Can I help you?", emotion: 'neutral', attitude: 0, decision: null, action: 'none' },
    { reply: "Sorry, what? That's not even words.", emotion: 'confused', attitude: -1, decision: null, action: 'none' },
    { reply: "Lend you money? I've only just met you. No chance.", emotion: 'laugh', attitude: -1, decision: { type: 'lend', accept: false, amount: 50 }, action: 'none' },
    { note: 'A stranger mashed the keyboard at me and then asked for fifty quid.' },
  ];
  const r = replies[Math.min(n++, replies.length - 1)];
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(r) } }] }) });
});
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(3000);
const id = await page.evaluate(() => {
  localStorage.setItem('bigshot.openai', 'sk-test');
  const g = window.__bigshot.game, S = window.__bigshot.sim, s = g.state;
  S.initLife(s);
  const o = S.residents(s)[2];
  o.visible = true; o.where = 'outside'; o.pos = { x: -2, z: 7 }; o.move = null; o.action = null; o.npc.plan = [];
  g.player.pos = { x: -2, z: 5.6 }; g.player.where = 'outside'; g.player.facing = 0;
  window.__bigshot.ui.openChat(o.id);
  return o.id;
});
await page.waitForTimeout(1500);
for (const t of ['sdfkjhsdfkjh', 'can you lend me 50 quid?']) {
  await page.fill('#chat-in', t);
  await page.press('#chat-in', 'Enter');
  await page.waitForTimeout(1500);
}
await page.screenshot({ path: `${out}/chat.png` });
await page.click('[data-bye]');
await page.waitForTimeout(1000);
console.log(JSON.stringify(seen, null, 1));
console.log(await page.evaluate((id) => JSON.stringify(window.__bigshot.game.state.people[id].knowsYou), id));
await browser.close();
