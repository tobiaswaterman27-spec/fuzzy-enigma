// Where triangles and draw calls come from (no heavy rendering): node scripts/scenestats.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.addInitScript(() => { try { localStorage.setItem('bigshot.gfx', 'low'); } catch { /* */ } });
await page.goto('http://localhost:4173/?skipcreator'); await page.waitForTimeout(4000);
const r = await page.evaluate(() => {
  const g = window.__bigshot.game, THREE = window.__bigshot.THREE;
  g.paused = true;
  const out = {};
  const vis = (o) => { for (let q = o; q; q = q.parent) if (!q.visible) return false; return true; };
  const people = new Set(); for (const v of g.views.people.values()) v.rig.root.traverse((o) => people.add(o));
  const world = new Set(); g.world.group.traverse((o) => world.add(o));
  g.scene.traverse((o) => {
    if (!o.isMesh || !vis(o)) return;
    const geo = o.geometry; const n = (geo.index ? geo.index.count : geo.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
    const cat = people.has(o) ? 'people' : world.has(o) ? 'world' : 'other';
    out[cat] ??= { meshes: 0, tris: 0 }; out[cat].meshes++; out[cat].tris += n;
  });
  out.peopleVisible = [...g.views.people.values()].filter((v) => vis(v.rig.root)).length;
  // biggest single world meshes
  const big = []; g.world.group.traverse((o) => { if (o.isMesh) { const geo = o.geometry; big.push([(geo.index ? geo.index.count : geo.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1), o.name || o.parent?.name || geo.type]); } });
  big.sort((a, b) => b[0] - a[0]);
  out.bigWorld = big.slice(0, 12);
  const byModel = {};
  g.scene.traverse((o) => {
    if (!o.isMesh || !vis(o)) return;
    let m = 'procedural'; for (let q = o; q; q = q.parent) if (q.userData?.model) { m = q.userData.model; break; }
    if (people.has(o)) m = 'person';
    const geo = o.geometry; const n = (geo.index ? geo.index.count : geo.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
    byModel[m] ??= [0, 0]; byModel[m][0]++; byModel[m][1] += n;
  });
  out.byModel = Object.entries(byModel).sort((a, b) => b[1][1] - a[1][1]).slice(0, 30).map(([k, v]) => `${k}: ${v[0]} meshes, ${Math.round(v[1] / 1000)}k tris`);
  let mats = new Set(); g.world.group.traverse((o) => { if (o.isMesh) mats.add(o.material); }); out.worldMaterials = mats.size;
  const occ = new Set(g.world.occluders); let nOcc = 0, nArr = 0, nDyn = 0, nInst = 0, nCut = 0, trisOcc = 0, trisMerged = 0, nMerged = 0, trisCut = 0;
  const cut = new Set(); for (const c of g.world.cutaway.values()) { c.roof.forEach((o) => o.traverse((x) => cut.add(x))); c.walls.forEach((o) => cut.add(o)); }
  g.world.group.traverse((o) => { if (!o.isMesh) return; const geo = o.geometry; const n = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    if (occ.has(o)) { nOcc++; trisOcc += n; } else if (cut.has(o)) { nCut++; trisCut += n; } else if (Array.isArray(o.material)) nArr++; else if (o.userData.dynamic) nDyn++; else if (o.isInstancedMesh) nInst++; else { nMerged++; trisMerged += n; } });
  const mm = []; g.world.group.traverse((o) => { if (!o.isMesh || occ.has(o) || cut.has(o) || o.userData.dynamic || Array.isArray(o.material)) return; const geo = o.geometry; mm.push([Math.round((geo.index ? geo.index.count : geo.attributes.position.count) / 3), (o.material.name || '') + ' #' + o.material.color?.getHexString() + (o.material.map ? ' map' : '')]); });
  mm.sort((a, b) => b[0] - a[0]); out.topMerged = mm.slice(0, 25).map((x) => x.join(' '));
  out.breakdown = { nOcc, trisOcc, nCut, trisCut, nArr, nDyn, nInst, nMerged, trisMerged };
  return out;
});
delete r.bigWorld; console.log(JSON.stringify(r, null, 1));
await browser.close();
