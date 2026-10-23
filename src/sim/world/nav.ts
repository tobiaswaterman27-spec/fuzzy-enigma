// NavigationAndTransport: A* over the pedestrian graph plus collision helpers.
import type { Vec2 } from '../types';
import { collidersIn, getWorld, segIntersectsRect, type Rect } from './layout';
import { navDist, sameLevel } from './levels';

const d = navDist;

/** line of sight between two points against all colliders (with an agent radius) */
export function clearLine(a: Vec2, b: Vec2, radius = 0.25): boolean {
  if (!sameLevel(a, b)) return false;
  for (const r of collidersIn(Math.min(a.x, b.x) - radius - 1, Math.min(a.z, b.z) - radius - 1, Math.max(a.x, b.x) + radius + 1, Math.max(a.z, b.z) + radius + 1)) if (segIntersectsRect(a, b, r, radius)) return false;
  return true;
}

/** graph nodes bucketed by 30 m cells */
let nodeGridOf: unknown = null;
let nodeGrid = new Map<string, string[]>();
function nodesNear(p: Vec2, r: number): string[] {
  const w = getWorld();
  if (nodeGridOf !== w) {
    nodeGrid = new Map();
    for (const n of Object.values(w.nodes)) { const k = `${Math.floor(n.x / 30)},${Math.floor(n.z / 30)}`; const l = nodeGrid.get(k); if (l) l.push(n.id); else nodeGrid.set(k, [n.id]); }
    nodeGridOf = w;
  }
  const out: string[] = [];
  for (let i = Math.floor((p.x - r) / 30); i <= Math.floor((p.x + r) / 30); i++) for (let j = Math.floor((p.z - r) / 30); j <= Math.floor((p.z + r) / 30); j++) out.push(...(nodeGrid.get(`${i},${j}`) ?? []));
  return out;
}

/** nearest graph node that can be reached in a straight line from p */
export function nearestNode(p: Vec2, preferLoc?: string): string | null {
  const w = getWorld();
  // nearest first, so the line-of-sight checks stop at the first that is clear
  const cands = nodesNear(p, 60).map((id) => { const n = w.nodes[id]; let dd = d(p, n); if (preferLoc && n.loc !== preferLoc) dd += 30; return { id, dd, n }; }).filter((c) => c.dd < 60).sort((a, b) => a.dd - b.dd);
  for (const c of cands) if (clearLine(p, c.n, 0.15)) return c.id;
  return null;
}

export function astar(start: string, goal: string): string[] | null {
  const w = getWorld();
  if (!w.nodes[start] || !w.nodes[goal]) return null;
  // a binary heap keeps this quick over the whole city's pavements
  const heap: [number, string][] = [];
  const push = (f: number, id: string) => { heap.push([f, id]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0]; const last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  const came: Record<string, string> = {};
  const g: Record<string, number> = { [start]: 0 };
  const done = new Set<string>();
  push(d(w.nodes[start], w.nodes[goal]), start);
  while (heap.length) {
    const [, cur] = pop();
    if (done.has(cur)) continue;
    if (cur === goal) {
      const path = [cur];
      let c = cur;
      while (came[c]) { c = came[c]; path.unshift(c); }
      return path;
    }
    done.add(cur);
    for (const nb of w.edges[cur] ?? []) {
      if (done.has(nb)) continue;
      const tg = g[cur] + d(w.nodes[cur], w.nodes[nb]);
      if (tg < (g[nb] ?? Infinity)) { came[nb] = cur; g[nb] = tg; push(tg + d(w.nodes[nb], w.nodes[goal]), nb); }
    }
  }
  return null;
}

/** Plan a walking route from a position to a destination point. Returns waypoints (excluding start). */
export function planRoute(from: Vec2, to: Vec2): Vec2[] | null {
  if (d(from, to) < 0.05) return [to];
  if (d(from, to) < 12 && clearLine(from, to)) return [to];
  const w = getWorld();
  const s = nearestNode(from);
  const g = nearestNode(to);
  if (!s || !g) return null;
  const ids = astar(s, g);
  if (!ids) return null;
  const pts: Vec2[] = ids.map((id) => ({ x: w.nodes[id].x, z: w.nodes[id].z }));
  pts.push({ x: to.x, z: to.z });
  // string-pull: skip the first node if we can head straight to the second
  while (pts.length > 1 && clearLine(from, pts[1])) pts.shift();
  return pts;
}

export function routeLength(from: Vec2, pts: Vec2[]): number {
  let len = 0;
  let prev = from;
  for (const p of pts) { len += d(prev, p); prev = p; }
  return len;
}

/** Resolve a circle against all colliders (used by the player controller). */
export function resolveCircle(p: Vec2, radius: number, colliders?: Rect[]): Vec2 {
  colliders ??= collidersIn(p.x - radius - 1, p.z - radius - 1, p.x + radius + 1, p.z + radius + 1);
  let x = p.x, z = p.z;
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const r of colliders) {
      const cx = Math.max(r.x0, Math.min(x, r.x1));
      const cz = Math.max(r.z0, Math.min(z, r.z1));
      const dx = x - cx, dz = z - cz;
      const dd = dx * dx + dz * dz;
      if (dd < radius * radius) {
        if (dd > 1e-9) {
          const l = Math.sqrt(dd);
          x = cx + (dx / l) * radius;
          z = cz + (dz / l) * radius;
        } else {
          // centre inside rect: push out along the smallest axis
          const pens = [x - r.x0, r.x1 - x, z - r.z0, r.z1 - z];
          const m = Math.min(...pens);
          if (m === pens[0]) x = r.x0 - radius;
          else if (m === pens[1]) x = r.x1 + radius;
          else if (m === pens[2]) z = r.z0 - radius;
          else z = r.z1 + radius;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
  return { x, z };
}
