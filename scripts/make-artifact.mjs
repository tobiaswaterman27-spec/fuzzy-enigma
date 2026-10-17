// Turns dist/ into an artifact page: inlines CSS, gives the bundle a stable name.
import fs from 'fs';
const out = process.argv[2];
let html = fs.readFileSync('dist/index.html', 'utf8');
html = html.replace(/<!doctype html>/i, '').replace(/<\/?html[^>]*>/gi, '').replace(/<\/?head>/gi, '').replace(/<\/?body>/gi, '').replace(/<meta charset[^>]*>/i, '').replace(/<meta name="viewport"[^>]*>/i, '');
html = html.replace('<title>THE BIGSHOT</title>', '<title>THE BIGSHOT</title>\n<meta name="claude:viewport-fit-sides" content="cover">');
html = html.replace(/<link rel="stylesheet" crossorigin href="\.\/assets\/([^"]+\.css)">/, (_, f) => `<style>\n${fs.readFileSync(`dist/assets/${f}`, 'utf8')}\n</style>`);
const js = fs.readdirSync('dist/assets').find((f) => f.endsWith('.js'));
html = html.replace(/<script type="module" crossorigin src="\.\/assets\/[^"]+\.js"><\/script>/, '<script type="module" src="./game.js"></script>');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(`${out}/bigshot.html`, html.trim() + '\n');
fs.copyFileSync(`dist/assets/${js}`, `${out}/game.js`);
// artifacts do not serve .bin, so the body mesh also ships as base64 text
fs.mkdirSync(`${out}/assets/human`, { recursive: true });
for (const f of ['body.json', 'skin_masks.png']) fs.copyFileSync(`dist/assets/human/${f}`, `${out}/assets/human/${f}`);
fs.writeFileSync(`${out}/assets/human/body.bin.txt`, fs.readFileSync('dist/assets/human/body.bin').toString('base64'));
fs.mkdirSync(`${out}/assets/models`, { recursive: true });
for (const f of fs.readdirSync('dist/assets/models')) if (f.endsWith('.glb')) fs.writeFileSync(`${out}/assets/models/${f}.txt`, fs.readFileSync(`dist/assets/models/${f}`).toString('base64'));
console.log('ok', js);
