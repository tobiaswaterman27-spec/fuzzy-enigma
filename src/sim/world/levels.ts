// Storeys. The simulation is flat (x, z), so each upper floor of a building lives in its own copy of
// the plane, LEVEL_DX metres east per storey: floor k of a block at (x, z) is simulated at
// (x + k * LEVEL_DX, z) and drawn at (x, k * LEVEL_H, z). Walking, colliders and rooms work unchanged;
// stairs are graph edges between the copies, climbed over STAIR_RUN metres of walking.
import type { Vec2 } from '../types';

export const LEVEL_DX = 1000;
export const LEVEL_H = 3.2;
/** how far a flight of stairs counts as, in metres walked */
export const STAIR_RUN = 5.5;

export const levelOf = (x: number) => Math.round(x / LEVEL_DX);
/** the ground-plane x of a simulated x (its storey removed) */
export const planX = (x: number) => x - levelOf(x) * LEVEL_DX;
export const sameLevel = (a: Vec2, b: Vec2) => levelOf(a.x) === levelOf(b.x);

/** where a simulated point is drawn */
export function sceneOf(p: Vec2, y = 0): { x: number; y: number; z: number } {
  const k = levelOf(p.x);
  return { x: p.x - k * LEVEL_DX, y: y + k * LEVEL_H, z: p.z };
}

/** walking distance between two points: straight on one storey; a flight of stairs between storeys */
export function navDist(a: Vec2, b: Vec2): number {
  const ka = levelOf(a.x), kb = levelOf(b.x);
  const flat = Math.hypot(a.x - ka * LEVEL_DX - (b.x - kb * LEVEL_DX), a.z - b.z);
  return ka === kb ? flat : flat + Math.abs(ka - kb) * STAIR_RUN;
}
