// Furnishes the flat with many seeds and checks every arrangement: required pieces present,
// everything usable reachable, no walking route through furniture.
import { getWorld, setHomeDesign, segIntersectsRect } from '../src/sim/world/layout';
import { defaultDesign } from '../src/sim/world/homes';
import { planRoute } from '../src/sim/world/nav';
let bad = 0;
for (let seed = 1; seed <= 60; seed++) {
  setHomeDesign({ ...defaultDesign(seed) });
  const w = getWorld();
  const problems: string[] = [];
  for (const id of ['bed', 'wardrobe', 'sofa', 'chair', 'kitchen', 'stove', 'shower']) {
    const it = w.interactables[id];
    if (!it) { problems.push(`missing ${id}`); continue; }
    if (w.colliders.some((r) => it.pos.x > r.x0 && it.pos.x < r.x1 && it.pos.z > r.z0 && it.pos.z < r.z1)) problems.push(`${id} stand point inside furniture`);
    if (!planRoute({ x: 16, z: 11.6 }, it.pos)) problems.push(`${id} unreachable`);
  }
  for (const [a, list] of Object.entries(w.edges)) for (const b of list) {
    const A = w.nodes[a], B = w.nodes[b];
    if (A.loc !== 'flat' && B.loc !== 'flat') continue;
    if (w.colliders.some((r) => segIntersectsRect(A, B, r, 0.2))) problems.push(`edge ${a}-${b} blocked`);
  }
  const kinds = w.obstacles.filter((o) => o.rect.x0 > 12 && o.rect.x1 < 30 && o.rect.z0 > 13.5 && o.rect.z1 < 26).map((o) => o.kind);
  if (problems.length) { bad++; console.log('seed', seed, problems.join('; ')); }
  else if (seed <= 3) console.log('seed', seed, 'ok:', [...new Set(kinds)].join(','));
}
console.log(bad ? `${bad} bad arrangements of 60` : 'all 60 arrangements valid');
