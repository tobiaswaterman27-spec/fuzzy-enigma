// Where some of the city's street furniture stands, worked out from the city plan alone (no other sim
// modules), so the world builder can place it without import cycles.
import type { Vec2 } from '../types';
import { ESPLANADE_Z, ROAD_HALF, WALK_W } from './city';

type CityLike = { buildings: { style: string; rect: { x0: number; z0: number; x1: number; z1: number } }[]; props: { kind: string; x: number; z: number }[] };

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
