// Where some of the city's street furniture stands, worked out from the city plan alone (no other sim
// modules), so the world builder can place it without import cycles.
import type { Vec2 } from '../types';
import { ESPLANADE_Z, ROAD_HALF, WALK_W } from './city';

type CityLike = { buildings: { style: string; rect: { x0: number; z0: number; x1: number; z1: number } }[]; props: { kind: string; x: number; z: number }[]; nodes?: { x: number; z: number }[] };

export interface TrainStop { id: string; name: string; pos: Vec2 }
const C = ROAD_HALF + WALK_W / 2;
/** the railway halts, on the pavement by the line's footbridge */
export const HALTS: TrainStop[] = [
  { id: 'halt_west', name: 'Westbay (seafront)', pos: { x: -630, z: ESPLANADE_Z - C } },
  { id: 'halt_north', name: 'Northfield Parkway', pos: { x: -200, z: -1040 - C } },
];

/** the stadium turnstiles: in front of the south stand, facing the street */
export function turnstilesOf(city: CityLike): Vec2 {
  const st = city.buildings.filter((b) => b.style === 'stadium');
  const s = st.reduce((a, b) => (b.rect.z1 > a.rect.z1 ? b : a), st[0]);
  return { x: (s.rect.x0 + s.rect.x1) / 2, z: s.rect.z1 + 1.4 };
}

/** the red phone boxes: beside some of the bus shelters */
export const phoneBoxesOf = (city: CityLike): Vec2[] => city.props.filter((p) => p.kind === 'bus_stop').filter((_, i) => i % 3 === 0).map((p) => ({ x: p.x + 4.5, z: p.z + 0.6 }));

/** Harbour Bikes docks: beside some of the bus shelters */
export const bikeDocksOf = (city: CityLike): Vec2[] => city.props.filter((p) => p.kind === 'bus_stop').filter((_, i) => i % 4 === 2).map((p) => ({ x: p.x - 5, z: p.z + 0.4 }));

/** stunt ramps across the middle of the road on some long straight streets: the foot of the ramp, the way
 * it faces (along x, +1 or -1), the length up to the lip and the height of the lip */
export interface Ramp { id: number; x: number; z: number; dir: 1 | -1; len: number; h: number }
export const RAMPS: Ramp[] = [
  { id: 0, x: -830, z: -260, dir: 1, len: 6, h: 1.3 },
  { id: 1, x: -460, z: -520, dir: -1, len: 6, h: 1.5 },
  { id: 2, x: 70, z: -650, dir: 1, len: 7, h: 1.6 },
  { id: 3, x: 450, z: -780, dir: -1, len: 6, h: 1.3 },
  { id: 4, x: 700, z: -390, dir: 1, len: 7, h: 1.8 },
  { id: 5, x: -200, z: -910, dir: 1, len: 6, h: 1.4 },
  { id: 6, x: 320, z: ESPLANADE_Z, dir: 1, len: 8, h: 2.0 },
  { id: 7, x: -720, z: ESPLANADE_Z, dir: -1, len: 7, h: 1.6 },
];

/** ice cream vans: pulled up on the park lawn and along the seafront, just in from the corner (the van, and
 * which way it faces) */
export function iceCreamVansOf(_city: CityLike): { x: number; z: number; rot: number }[] {
  return [{ x: 16, z: -664, rot: Math.PI / 2 }, { x: -505, z: 30, rot: Math.PI / 2 }, { x: 401, z: 45, rot: Math.PI / 2 }];
}
