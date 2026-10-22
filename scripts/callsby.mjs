// Which objects produce the draw calls (main and shadow passes): node scripts/callsby.mjs [x z facing]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
await page.addInitScript(() => { try { localStorage.setItem('bigshot.gfx', 'low'); } catch { /* */ } });
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(4000);
const [x, z, f] = process.argv.slice(2).map(Number);
const r = await page.evaluate(async ([x, z, f]) => {
  const g = window.__bigshot.game, S = window.__bigshot.sim;
  if (!Number.isNaN(x)) { g.player.pos = { x, z }; g.player.facing = f; g.player.where = S.locationOf({ x, z }); g.camYaw = f + Math.PI; }
  await new Promise((r) => requestAnimationFrame(() => r()));
  const people = new Set(); for (const v of g.views.people.values()) v.rig.root.traverse((o) => people.add(o));
  const world = new Set(); g.world.group.traverse((o) => world.add(o));
  const process_detail = true;
  const cat = (o) => {
    if (people.has(o)) return 'person:' + (o.material?.name || o.material?.type || '?');
    for (let q = o; q; q = q.parent) if (q.userData?.model) return 'model:' + q.userData.model;
    if (world.has(o)) { let dyn = false; for (let q = o; q; q = q.parent) if (q.userData?.dynamic) dyn = true; return (dyn ? 'world-dyn:' : 'world:') + (process_detail ? (o.material?.name || o.material?.color?.getHexString?.() || '') : ''); }
    return 'other:' + (o.isInstancedMesh ? 'instanced' : o.type) + ':' + (o.material?.type ?? '');
  };
  const tally = {};
  const R = g.renderer, orig = R.renderBufferDirect.bind(R);
  let pass = 'main';
  R.renderBufferDirect = (camera, scene, geometry, material, object, group) => {
    const k = (camera.isOrthographicCamera ? 'shadow ' : 'main ') + cat(object);
    const t = tally[k] ??= [0, 0];
    t[0]++; t[1] += (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3 * (object.isInstancedMesh ? object.count : 1);
    return orig(camera, scene, geometry, material, object, group);
  };
  await new Promise((r) => requestAnimationFrame(() => r()));
  R.renderBufferDirect = orig;
  return Object.entries(tally).sort((a, b) => b[1][0] - a[1][0]).slice(0, 45).map(([k, v]) => `${v[0]} calls ${Math.round(v[1] / 1000)}k tris  ${k}`);
}, [x, z, f]);
console.log(r.join('\n'));
await browser.close();
