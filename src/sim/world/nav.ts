// NavigationAndTransport: A* over the pedestrian graph plus collision helpers.
import type { Vec2 } from '../types';
import { getWorld, segIntersectsRect, type Rect } from './layout';
import { navDist, sameLevel } from './levels';

const d = navDist;

/** line of sight between two points against all colliders (with an agent radius) */
export function clearLine(a: Vec2, b: Vec2, radius = 0.25): boolean {
  if (!sameLevel(a, b)) return false;
  for (const r of getWorld().colliders) if (segIntersectsRect(a, b, r, radius)) return false;
  return true;
}

/** nearest graph node that can be reached in a straight line from p */
export function nearestNode(p: Vec2, preferLoc?: string): string | null {
  const w = getWorld();
  let best: string | null = null;
  let bestD = Infinity;
  for (const n of Object.values(w.nodes)) {
    let dd = d(p, n);
    if (preferLoc && n.loc !== preferLoc) dd += 30;
    if (dd < bestD && dd < 60 && clearLine(p, n, 0.15)) {
      bestD = dd;
      best = n.id;
    }
  }
  return best;
}

export function astar(start: string, goal: string): string[] | null {
  const w = getWorld();
  if (!w.nodes[start] || !w.nodes[goal]) return null;
  const open = new Set<string>([start]);
  const came: Record<string, string> = {};
  const g: Record<string, number> = { [start]: 0 };
  const f: Record<string, number> = { [start]: d(w.nodes[start], w.nodes[goal]) };
  while (open.size) {
    let cur = '';
    let best = Infinity;
    for (const id of open) if ((f[id] ?? Infinity) < best) { best = f[id]; cur = id; }
    if (cur === goal) {
      const path = [cur];
      while (came[cur]) { cur = came[cur]; path.unshift(cur); }
      return path;
    }
    open.delete(cur);
    for (const nb of w.edges[cur] ?? []) {
      const tg = g[cur] + d(w.nodes[cur], w.nodes[nb]);
      if (tg < (g[nb] ?? Infinity)) {
        came[nb] = cur;
        g[nb] = tg;
        f[nb] = tg + d(w.nodes[nb], w.nodes[goal]);
        open.add(nb);
      }
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
export function resolveCircle(p: Vec2, radius: number, colliders: Rect[] = getWorld().colliders): Vec2 {
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
