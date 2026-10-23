// Static world definition for the Harbourside starting district.
import { bikeDocksOf, HALTS, phoneBoxesOf, turnstilesOf } from './spots';
import { STALLS } from '../streetmarket';
import { defaultDesign, furnish, type HomeDesign, type PlacedItem } from './homes';
import { PLOTS } from './plots';
// Geometry, colliders, interaction anchors and the pedestrian/vehicle graphs
// are built from code (not saved) and shared by simulation and renderer.
//
// Coordinate system: metres, x = east, z = south (so -z is "north").
// Facing angle θ: forward direction = (sin θ, cos θ); θ = 0 faces +z.
import { LEVEL_DX, levelOf } from './levels';
import { buildCity, CITY, type City } from './city';
import { planVenues, type Venue, type VenueKind } from './venues';
import type { Vec2 } from '../types';
import { PRODUCTS } from '../items';

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export type BuildingCategory = 'functional' | 'simplified' | 'decorative';
export type Side = 'xmin' | 'xmax' | 'zmin' | 'zmax';

export interface DoorDef {
  side: Side;
  a: number; // start coordinate along the wall
  b: number; // end coordinate
  open: boolean; // walkable gap (true) or a closed door mesh (false)
}

export interface BuildingDef {
  id: string;
  name: string;
  category: BuildingCategory;
  /** short description shown to the player */
  role: string;
  rect: Rect;
  height: number;
  floors: number;
  color: string;
  trim: string;
  roof: string;
  sign?: { text: string; side: Side; color: string; bg: string };
  doors: DoorDef[];
  /** has a modelled interior the player can walk into */
  interior: boolean;
  floorColor?: string;
  internalWalls?: Rect[];
  /** an upper storey (see levels.ts): simulated LEVEL_DX * level metres east, drawn that high up */
  level?: number;
  /** another storey sits on top: no roof of its own */
  stacked?: boolean;
  /** part of a storey (a flat off the landing): a location of its own, drawn by the storey around it */
  unit?: boolean;
}

export type ObstacleKind =
  | 'bait_hut'
  | 'kennel_gate'
  | 'dartboard'
  | 'railing'
  | 'planter'
  | 'bin_store'
  | 'bike_shelter'
  | 'gondola'
  | 'toilet'
  | 'basin'
  | 'armchair'
  | 'sideboard'
  | 'bedside'
  | 'desk'
  | 'dining_table'
  | 'dining_chair'
  | 'laptop'
  | 'art'
  | 'floorfinish'
  | 'wallfinish'
  | 'lampstand'
  | 'plant'
  | 'rug'
  | 'stairs'
  | 'stairwell'
  | 'stairguard'
  | 'halt_sign'
  | 'phonebox'
  | 'bike_rack'
  | 'cellbars'
  | 'reception'
  | 'clothes_rack'
  | 'platform_edge'
  | 'track'
  | 'mirror'
  | 'vault'
  | 'gaming_table'
  | 'dancefloor'
  | 'treadmill'
  | 'celldoor'
  | 'unitdoor'
  | 'mailboxes'
  | 'flatdoor'
  | 'tilefloor'
  | 'drawers'
  | 'coffee_table'
  | 'bookcase'
  | 'counter'
  | 'pallet'
  | 'kiosk'
  | 'terminal'
  | 'cupboard'
  | 'bed'
  | 'kitchen'
  | 'table'
  | 'wardrobe'
  | 'board'
  | 'desk'
  | 'tree'
  | 'bench'
  | 'bin'
  | 'lamp'
  | 'car'
  | 'busstop'
  | 'rack'
  | 'sofa'
  | 'shower'
  | 'tv'
  | 'stove'
  | 'rug'
  | 'plant'
  | 'fridge'
  | 'shelfunit'
  | 'lampstand'
  | 'baler'
  | 'shopbin'
  | 'dumpster'
  | 'washer'
  | 'storage_shelf'
  | 'ironing_board'
  | 'laundry_basket'
  | 'drying_rack'
  | 'bike'
  | 'vacuum'
  | 'pallet_rack'
  | 'forklift'
  | 'roller_door'
  | 'pallet_load'
  | 'lane_marking'
  | 'waiting_chairs'
  | 'water_cooler'
  | 'leaflet_stand'
  | 'bistro_set'
  | 'site_fence'
  | 'site_house'
  | 'site_cabin'
  | 'site_pallet'
  | 'site_mixer';

export interface Obstacle {
  kind: ObstacleKind;
  rect: Rect;
  height: number;
  rot?: number;
  color?: string;
  solid: boolean;
  /** what it belongs to (a flat's front door names the flat) */
  ref?: string;
}

export type InteractKind =
  | 'shelf'
  | 'iv_chair'
  | 'iv_host'
  | 'pallet'
  | 'terminal'
  | 'till'
  | 'kiosk'
  | 'cupboard'
  | 'bay'
  | 'bed'
  | 'kitchen'
  | 'wardrobe'
  | 'chair'
  | 'board'
  | 'advisor'
  | 'cafe_counter'
  | 'bench'
  | 'spill'
  | 'person'
  | 'shower'
  | 'sofa'
  | 'stove'
  | 'rack'
  | 'staging'
  | 'home_counter'
  | 'meet_chair'
  | 'site_cabin'
  | 'site_pallet'
  | 'site_work'
  | 'cafe_grill'
  | 'vehicle'
  | 'study_desk'
  | 'stall'
  | 'baler'
  | 'shopbin'
  | 'dumpster'
  | 'sink'
  | 'washer'
  | 'housedoor'
  | 'shopdoor'
  | 'turnstile'
  | 'prison_food'
  | 'prison_laundry'
  | 'prison_wall'
  | 'prison_bunk'
  | 'payphone'
  | 'bike_dock'
  | 'chop_shop'
  | 'bus_stop'
  | 'hospital_door'
  | 'venue_till'
  | 'ticket_machine'
  | 'platform'
  | 'food_court'
  | 'jeweller'
  | 'cinema'
  | 'ae_desk'
  | 'council_desk'
  | 'pew'
  | 'venue_shelf'
  | 'venue_fridge'
  | 'clothes_rail'
  | 'barber_chair'
  | 'vault'
  | 'slots'
  | 'roulette'
  | 'blackjack'
  | 'dancefloor'
  | 'treadmill'
  | 'weights'
  | 'arcade'
  | 'police_desk'
  | 'cell_bench'
  | 'beat_board'
  | 'valuables'
  | 'fishing'
  | 'bait_shop'
  | 'boat_hire'
  | 'pub_bar'
  | 'darts'
  | 'kennel'
  | 'rescue_desk';

export interface Interactable {
  id: string;
  kind: InteractKind;
  label: string;
  pos: Vec2; // where an actor stands to use it
  facing: number;
  obj: Vec2; // the object's own position
  locationId: string;
  businessId?: string;
  product?: string;
  /** container id this interactable exposes (shelf, pallet...) */
  container?: string;
  /** for pallets: the shelf section whose product this pallet holds */
  shelf?: string;
  range: number;
}

export interface NavNode {
  id: string;
  x: number;
  z: number;
  /** building/location the node belongs to ('outside' for streets) */
  loc: string;
}

export interface RoadDef {
  rect: Rect;
  kind: 'road' | 'sidewalk' | 'lane' | 'forecourt' | 'grass' | 'plaza';
}

export interface World {
  buildings: BuildingDef[];
  obstacles: Obstacle[];
  colliders: Rect[];
  interactables: Record<string, Interactable>;
  nodes: Record<string, NavNode>;
  edges: Record<string, string[]>;
  roads: RoadDef[];
  vanRouteOut: Vec2[];
  vanRouteBack: Vec2[];
  depot: Vec2;
  bayParking: Vec2;
  dropZone: Vec2;
  playerSpawn: Vec2;
  /** the generated city round Harbourside */
  city: City;
  /** colliders bucketed by 16 m cells, for quick lookups near a point */
  grid: Map<string, Rect[]>;
  spawnPoints: string[]; // node ids where commuters/ambient shoppers appear
  bounds: Rect;
  lamps: Vec2[];
  parked: { pos: Vec2; rot: number; color: string }[];
}

export const WALL_T = 0.3;

// ------------------------------------------------------------ buildings
const B: BuildingDef[] = [
  {
    id: 'market', name: 'Corner Market', category: 'functional', role: 'Grocery shop - employer, customers, stock',
    rect: { x0: 12, z0: -36, x1: 36, z1: -10 }, height: 5, floors: 1, color: '#e8dcc4', trim: '#2e8b57', roof: '#5b5f63',
    sign: { text: 'CORNER MARKET', side: 'zmax', color: '#ffffff', bg: '#2e8b57' },
    doors: [
      { side: 'zmax', a: 16, b: 19, open: true },
      { side: 'zmin', a: 22, b: 26, open: true },
    ],
    interior: true, floorColor: '#d9d4c7',
    internalWalls: [
      { x0: 12, z0: -28.15, x1: 31, z1: -27.85 },
      { x0: 33, z0: -28.15, x1: 36, z1: -27.85 },
    ],
  },
  {
    id: 'jobcentre', name: 'Harbourside Job Centre', category: 'functional', role: 'Public employment service - vacancies',
    rect: { x0: -34, z0: -28, x1: -14, z1: -10 }, height: 4.5, floors: 1, color: '#c9d6e3', trim: '#1f4e79', roof: '#4a4f55',
    sign: { text: 'JOB CENTRE', side: 'zmax', color: '#ffffff', bg: '#1f4e79' },
    doors: [{ side: 'zmax', a: -26, b: -22, open: true }],
    interior: true, floorColor: '#cfd3d6',
  },
  {
    id: 'cafe', name: 'Tidewater Cafe', category: 'simplified', role: 'Cafe - buy a hot meal (simplified kitchen)',
    rect: { x0: -34, z0: 10, x1: -14, z1: 26 }, height: 4.5, floors: 1, color: '#f0e3c0', trim: '#7b2d26', roof: '#6b3a2e',
    sign: { text: 'TIDEWATER CAFE', side: 'zmin', color: '#ffffff', bg: '#7b2d26' },
    doors: [{ side: 'zmin', a: -26, b: -22, open: true }],
    interior: true, floorColor: '#b89f7a',
  },
  {
    id: 'wholesale', name: 'Harbour Wholesale', category: 'functional', role: 'Wholesale supplier & depot - pallet racking, picking and dispatch',
    rect: { x0: -66, z0: 14, x1: -40, z1: 40 }, height: 8, floors: 1, color: '#9aa3a8', trim: '#f4c20d', roof: '#6d7478',
    sign: { text: 'HARBOUR WHOLESALE', side: 'zmin', color: '#111111', bg: '#f4c20d' },
    doors: [
      { side: 'zmin', a: -58, b: -50, open: false },
      { side: 'zmin', a: -44, b: -42, open: true },
    ],
    interior: true, floorColor: '#9a9d9f',
  },
  {
    id: 'homestore', name: 'Harbour Home', category: 'functional', role: 'Furniture & decor store in the old bank - buy furniture, wallpaper, flooring and rugs for your home',
    rect: { x0: -62, z0: -34, x1: -40, z1: -12 }, height: 10, floors: 3, color: '#d7cfc0', trim: '#8c7b63', roof: '#555a5e',
    sign: { text: 'HARBOUR HOME', side: 'zmax', color: '#ffffff', bg: '#4d6b5c' },
    doors: [{ side: 'zmax', a: -53, b: -49, open: true }], interior: true, floorColor: '#b9a68a',
  },
  {
    id: 'police', name: 'Harbourside Police Station', category: 'functional', role: 'Police station - front desk, custody cells; jobs: Police Community Support Officer',
    rect: { x0: 44, z0: -38, x1: 70, z1: -12 }, height: 8, floors: 2, color: '#c3c8ce', trim: '#1f3a68', roof: '#3a4148',
    sign: { text: 'POLICE', side: 'zmax', color: '#ffffff', bg: '#1f3a68' },
    doors: [{ side: 'zmax', a: 55, b: 59, open: true }],
    interior: true, floorColor: '#b8bcc0',
    internalWalls: [
      // behind the front desk: the staff door at the east end
      { x0: 44, z0: -19.3, x1: 63.8, z1: -19.0 }, { x0: 65.2, z0: -19.3, x1: 70, z1: -19.0 },
      // custody suite (west) and the office (east)
      { x0: 56.0, z0: -38, x1: 56.3, z1: -23.0 }, { x0: 56.0, z0: -21.8, x1: 56.3, z1: -19.3 },
      // the cells: three along the back wall
      { x0: 47.85, z0: -38, x1: 48.15, z1: -31.3 }, { x0: 51.85, z0: -38, x1: 52.15, z1: -31.3 },
    ],
  },
  {
    id: 'terrace_w', name: 'Westway Terrace', category: 'decorative', role: 'Background housing',
    rect: { x0: -92, z0: -34, x1: -70, z1: -12 }, height: 7, floors: 2, color: '#a95c45', trim: '#e2d9c8', roof: '#3e3a38',
    doors: [{ side: 'zmax', a: -82, b: -80, open: false }], interior: false,
  },
  {
    id: 'garage_e', name: 'Eastgate Motors', category: 'decorative', role: 'Garage (background, mechanic jobs planned)',
    rect: { x0: 76, z0: -30, x1: 94, z1: -12 }, height: 6, floors: 1, color: '#c4c8cc', trim: '#c0392b', roof: '#54595e',
    sign: { text: 'EASTGATE MOTORS', side: 'zmax', color: '#ffffff', bg: '#c0392b' },
    doors: [{ side: 'zmax', a: 80, b: 88, open: false }], interior: false,
  },
  {
    id: 'flats_w', name: 'Quay View Flats', category: 'decorative', role: 'Background housing',
    rect: { x0: -92, z0: 12, x1: -72, z1: 34 }, height: 13, floors: 4, color: '#c2b8a3', trim: '#566573', roof: '#3b4045',
    doors: [{ side: 'zmin', a: -84, b: -80, open: false }], interior: false,
  },
  {
    id: 'unit4', name: 'Dockside Unit 4', category: 'functional', role: 'Vacant shop unit to let (lease it on your phone)',
    rect: { x0: 76, z0: 12, x1: 94, z1: 34 }, height: 6, floors: 1, color: '#c9cfd4', trim: '#2c3e50', roof: '#5d6d7e',
    sign: { text: 'UNIT 4', side: 'zmin', color: '#ffffff', bg: '#2c3e50' },
    doors: [
      { side: 'zmin', a: 79, b: 82, open: true },
      { side: 'zmin', a: 89, b: 92, open: true },
    ],
    interior: true, floorColor: '#d6d2c8',
    internalWalls: [
      { x0: 87.85, z0: 12, x1: 88.15, z1: 16 },
      { x0: 87.85, z0: 18.5, x1: 88.15, z1: 34 },
    ],
  },
];

/** the quay edge (north): beyond it, the harbour water */
export const QUAY_EDGE = 90;
export const FISH_SPOTS = [{ id: 'fish_1', x: -22 }, { id: 'fish_2', x: -4 }, { id: 'fish_3', x: 14 }, { id: 'fish_4', x: 34 }];
export const BAIT_HUT = { x: -34, z: 79 };

// Harbourside Dog Rescue, on the open ground east of the park
B.push({
  id: 'rescue', name: 'Harbourside Dog Rescue', category: 'functional', role: 'Dogs looking for a home: come in and meet them',
  rect: { x0: 76, z0: 46, x1: 92, z1: 60 }, height: 4, floors: 1, color: '#d8c9a8', trim: '#3b6b4a', roof: '#4a4a44',
  sign: { text: 'DOG RESCUE', side: 'xmin', color: '#ffffff', bg: '#3b6b4a' },
  doors: [{ side: 'xmin', a: 52, b: 54.2, open: true }], interior: true, floorColor: '#b9b2a2',
  internalWalls: [{ x0: 86.6, z0: 50.1, x1: 92, z1: 50.25 }, { x0: 86.6, z0: 53.6, x1: 92, z1: 53.75 }, { x0: 86.6, z0: 57.1, x1: 92, z1: 57.25 }],
});

// The Anchor: the pub at the east end of the quay
B.push({
  id: 'pub', name: 'The Anchor', category: 'functional', role: 'Pub: pints, darts, and half the town of an evening',
  rect: { x0: 64, z0: 72, x1: 82, z1: 86 }, height: 5, floors: 1, color: '#2f3e46', trim: '#e9e3d0', roof: '#3b2f2a',
  sign: { text: 'THE ANCHOR', side: 'xmin', color: '#e9d8a6', bg: '#2f3e46' },
  doors: [{ side: 'xmin', a: 77, b: 79.2, open: true }], interior: true, floorColor: '#6b4a32',
});

// NPC homes along Harbour Road (simplified: residents enter and are simulated off-screen)
const HOUSE_COLORS = ['#d8c3a5', '#a3b18a', '#c9ada7', '#e0c097', '#b7c4cf', '#d4a373'];
const houseZ = [38, 50, 62];
let hi = 0;
for (const zc of houseZ) {
  for (const side of ['e', 'w'] as const) {
    hi++;
    const rect = side === 'e' ? { x0: 10, z0: zc - 4.5, x1: 20, z1: zc + 4.5 } : { x0: -20, z0: zc - 4.5, x1: -10, z1: zc + 4.5 };
    B.push({
      id: `house_${hi}`, name: `${hi * 2 + (side === 'e' ? 0 : 1)} Harbour Road`, category: 'simplified', role: 'Private house (residents simulated)',
      rect, height: 6, floors: 2, color: HOUSE_COLORS[(hi - 1) % HOUSE_COLORS.length], trim: '#f4f1ea', roof: '#5a3e36',
      doors: [{ side: side === 'e' ? 'xmin' : 'xmax', a: zc - 0.6, b: zc + 0.6, open: true }], interior: true, floorColor: '#a8865f',
      // front room by the street door, kitchen-diner at the back, with a doorway between
      internalWalls: side === 'e'
        ? [{ x0: 15, z0: zc - 4.5, x1: 15.25, z1: zc - 0.7 }, { x0: 15, z0: zc + 0.7, x1: 15.25, z1: zc + 4.5 }]
        : [{ x0: -15.25, z0: zc - 4.5, x1: -15, z1: zc - 0.7 }, { x0: -15.25, z0: zc + 0.7, x1: -15, z1: zc + 4.5 }],
    });
  }
}

// ------------------------------------------------------------ Marlow Court
// Four storeys round one stair: the ground-floor lobby with the post boxes, Flats 1 and 2 and the bike
// store; Flats 3 and 4 on the first floor; your Flat 5 takes the whole second floor but the stair hall;
// Flats 6 and 7 at the top. Every floor has the same stair core: a flight up from the front landing on
// the ground and second floors, from the back landing on the first.
export const MARLOW = { x0: 12, z0: 10, x1: 30, z1: 26 };
export const MARLOW_LEVELS = ['marlow', 'mc_1', 'flat', 'mc_3'] as const;
export const STAIR_CORE = { x0: 12.15, z0: 11.3, x1: 14.75, z1: 16.3 };
/** the two lanes of the stair core: a flight in each, rising in turns */
const LANES = { a: { x0: 12.15, x1: 13.4 }, b: { x0: 13.5, x1: 14.75 } };
export interface Flight { x0: number; x1: number; bottom: number; top: number }
/** at storey k: the flight up from it, and the flight that comes up into it (plan coordinates) */
export function flightsAt(k: number): { up: Flight | null; down: Flight | null } {
  const up = (j: number): Flight | null => j < 0 || j > 2 ? null : j % 2 === 0 ? { ...LANES.a, bottom: STAIR_CORE.z0, top: STAIR_CORE.z1 } : { ...LANES.b, bottom: STAIR_CORE.z1, top: STAIR_CORE.z0 };
  return { up: up(k), down: up(k - 1) };
}
const onFlight = (f: Flight | null, x: number, z: number) => !!f && x > f.x0 && x < f.x1 && z >= Math.min(f.bottom, f.top) && z <= Math.max(f.bottom, f.top);
const isMarlow = (x: number, z: number) => x > STAIR_CORE.x0 - 1 && x < STAIR_CORE.x1 + 1 && z > STAIR_CORE.z0 - 2 && z < STAIR_CORE.z1 + 2;
/** how far above (or below) its storey's floor someone standing here is: part way up a flight of stairs */
export function stairY(p: Vec2): number {
  const k = levelOf(p.x), x = p.x - k * LEVEL_DX;
  if (!isMarlow(x, p.z) || k < 0 || k > 3) return 0;
  const { up, down } = flightsAt(k);
  const D = STAIR_CORE.z1 - STAIR_CORE.z0;
  if (up && onFlight(up, x, p.z)) return (3.2 * Math.abs(p.z - up.bottom)) / D;
  if (down && onFlight(down, x, p.z)) return (-3.2 * Math.abs(p.z - down.top)) / D;
  return 0;
}
/** walking off the top of a flight onto the floor above, or off the bottom onto the floor below */
export function stairCross(p: Vec2): Vec2 {
  const k = levelOf(p.x), x = p.x - k * LEVEL_DX;
  if (!isMarlow(x, p.z) || k < 0 || k > 3) return p;
  const { up, down } = flightsAt(k);
  if (up && onFlight(up, x, p.z) && Math.abs(p.z - up.top) < 0.45) return { x: p.x + LEVEL_DX, z: p.z };
  if (down && onFlight(down, x, p.z) && Math.abs(p.z - down.bottom) < 0.45) return { x: p.x - LEVEL_DX, z: p.z };
  return p;
}
/** what keeps you on the stairs: the wall between the flights, the rail on the open side, a rail where a
 * flight drops away, and the lane under a flight where there is no headroom */
function stairGuards(k: number): Rect[] {
  const { up, down } = flightsAt(k);
  const out: Rect[] = [{ x0: 13.4, x1: 13.5, z0: STAIR_CORE.z0, z1: STAIR_CORE.z1 }, { x0: 14.75, x1: 14.85, z0: STAIR_CORE.z0, z1: STAIR_CORE.z1 }];
  const endStrip = (f: Flight, z: number) => ({ x0: f.x0, x1: f.x1, z0: z === STAIR_CORE.z1 ? z : z - 0.1, z1: z === STAIR_CORE.z1 ? z + 0.1 : z });
  if (up) out.push(endStrip(up, up.top));
  if (down) out.push(endStrip(down, down.bottom));
  for (const lane of [LANES.a, LANES.b]) if (!(up && up.x0 === lane.x0) && !(down && down.x0 === lane.x0)) out.push({ ...lane, z0: STAIR_CORE.z0, z1: STAIR_CORE.z1 });
  return out;
}
/** the buildings whose public doors lock when they close (see breakins.ts) */
export const SHOP_IDS = ['market', 'cafe', 'homestore', 'pub', 'unit4', 'jobcentre'];
/** a building's public doorways, as the strips of wall a locked door fills, with where you stand outside */
export function publicDoors(b: BuildingDef): { lock: Rect; out: Vec2; facing: number; mid: Vec2 }[] {
  const { x0, z0, x1, z1 } = b.rect, h = WALL_T / 2;
  return b.doors.filter((d) => d.open).map((d) => {
    const m = (d.a + d.b) / 2;
    if (d.side === 'zmin') return { lock: { x0: d.a, z0: z0 - h, x1: d.b, z1: z0 + h }, out: { x: m, z: z0 - 1.0 }, facing: 0, mid: { x: m, z: z0 } };
    if (d.side === 'zmax') return { lock: { x0: d.a, z0: z1 - h, x1: d.b, z1: z1 + h }, out: { x: m, z: z1 + 1.0 }, facing: Math.PI, mid: { x: m, z: z1 } };
    if (d.side === 'xmin') return { lock: { x0: x0 - h, z0: d.a, x1: x0 + h, z1: d.b }, out: { x: x0 - 1.0, z: m }, facing: Math.PI / 2, mid: { x: x0, z: m } };
    return { lock: { x0: x1 - h, z0: d.a, x1: x1 + h, z1: d.b }, out: { x: x1 + 1.0, z: m }, facing: -Math.PI / 2, mid: { x: x1, z: m } };
  });
}
/** Marlow Court's flights of stairs, bottom node to top node */
export const FLIGHTS: [string, string][] = [['st0_fa', 'st1_ba'], ['st1_bb', 'st2_fb'], ['st2_fa', 'st3_ba']];
/** a copy of anything with coordinates, moved dx metres east (onto another storey) */
export function shiftX<T>(o: T, dx: number): T {
  if (Array.isArray(o)) return o.map((v) => shiftX(v, dx)) as T;
  if (!o || typeof o !== 'object') return o;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) out[k] = (k === 'x' || k === 'x0' || k === 'x1') && typeof v === 'number' ? v + dx : shiftX(v, dx);
  return out as T;
}
export interface FlatUnit { id: string; name: string; level: number; side: 'a' | 'b'; rect: Rect; door: Rect; doorPos: Vec2; inPos: Vec2 }
export const FLAT_UNITS: FlatUnit[] = [];
for (const [level, sides] of [[0, ['a', 'b']], [1, ['a', 'b']], [3, ['a', 'b']]] as const) {
  for (const side of sides) {
    const n = FLAT_UNITS.length + (level === 3 ? 2 : 1);
    const u: FlatUnit = side === 'a'
      ? { id: `mc_${level}a`, name: `Flat ${n}, Marlow Court`, level, side, rect: { x0: 12, z0: 18.05, x1: 21.45, z1: 26 }, door: { x0: 18.4, z0: 17.9, x1: 19.4, z1: 18.2 }, doorPos: { x: 18.9, z: 17.2 }, inPos: { x: 18.9, z: 19.0 } }
      : { id: `mc_${level}b`, name: `Flat ${n}, Marlow Court`, level, side, rect: { x0: 21.45, z0: level === 0 ? 13.45 : 10, x1: 30, z1: 26 }, door: { x0: 21.3, z0: 15.0, x1: 21.6, z1: 16.0 }, doorPos: { x: 20.6, z: 15.5 }, inPos: { x: 22.4, z: 15.5 } };
    FLAT_UNITS.push(shiftX(u, level * LEVEL_DX));
  }
}
export const FLAT_UNIT_IDS = FLAT_UNITS.map((u) => u.id);
for (const u of FLAT_UNITS) {
  B.push({ id: u.id, name: u.name, category: 'simplified', role: 'Private flat (residents simulated)', rect: u.rect, height: 3.2, floors: 1, color: '#e9e6df', trim: '#33373b', roof: '#5b5f63', doors: [], interior: true, unit: true, level: u.level, floorColor: '#a8865f' });
}
// the stair hall on your floor is not part of your flat
B.push({ id: 'mc_2h', name: 'Marlow Court, second floor landing', category: 'simplified', role: 'Stair hall', rect: shiftX({ x0: 12, z0: 10, x1: 16.55, z1: 18.05 }, 2 * LEVEL_DX), height: 3.2, floors: 1, color: '#e9e6df', trim: '#33373b', roof: '#5b5f63', doors: [], interior: true, unit: true, level: 2 });
{
  const unitWalls = (level: number): Rect[] => [
    { x0: 12, z0: 17.9, x1: 18.4, z1: 18.2 }, { x0: 19.4, z0: 17.9, x1: 21.6, z1: 18.2 },
    { x0: 21.3, z0: 10, x1: 21.6, z1: 15.0 }, { x0: 21.3, z0: 16.0, x1: 21.6, z1: 26 },
    // a stud wall closing each flat's bedroom off its living space
    { x0: 15.2, z0: 18.2, x1: 15.5, z1: 22.4 }, { x0: 21.6, z0: 21.6, x1: 25.4, z1: 21.9 },
    ...(level === 0 ? [{ x0: 21.6, z0: 13.3, x1: 30, z1: 13.6 }] : []),
  ];
  // your flat: hall off the stair hall, study and utility room at the front, bathroom, bedroom, and an
  // open-plan living room, dining area and kitchen across the back
  const flatWalls: Rect[] = [
    { x0: 16.4, z0: 10, x1: 16.7, z1: 15.0 }, { x0: 16.4, z0: 16.2, x1: 16.7, z1: 18.2 }, { x0: 12, z0: 17.9, x1: 16.4, z1: 18.2 },
    { x0: 16.7, z0: 13.3, x1: 18.5, z1: 13.6 }, { x0: 19.5, z0: 13.3, x1: 24.0, z1: 13.6 }, { x0: 25.0, z0: 13.3, x1: 30, z1: 13.6 },
    { x0: 22.6, z0: 10, x1: 22.9, z1: 13.3 },
    { x0: 25.7, z0: 13.6, x1: 26.0, z1: 14.8 }, { x0: 25.7, z0: 15.9, x1: 26.0, z1: 17.6 },
    { x0: 22.6, z0: 17.6, x1: 23.6, z1: 17.9 }, { x0: 24.6, z0: 17.6, x1: 30, z1: 17.9 },
    { x0: 22.6, z0: 17.9, x1: 22.9, z1: 26 },
  ];
  const common = { category: 'functional' as const, height: 3.2, floors: 1, trim: '#33373b', roof: '#3d3f42', interior: true };
  B.push({ ...common, id: 'marlow', name: 'Marlow Court', role: 'Block of flats - lobby and stairs; your Flat 5 is on the second floor', rect: MARLOW, color: '#9c5a44', stacked: true,
    sign: { text: 'MARLOW COURT', side: 'zmin', color: '#f2f2f2', bg: '#2f3337' },
    doors: [{ side: 'zmin', a: 15, b: 17, open: true }, { side: 'zmin', a: 26, b: 28, open: false }], floorColor: '#8a8f94', internalWalls: unitWalls(0) });
  B.push({ ...common, id: 'mc_1', name: 'Marlow Court, first floor', role: 'Landing - Flats 3 and 4', rect: shiftX(MARLOW, LEVEL_DX), color: '#e9e6df', level: 1, stacked: true, doors: [], floorColor: '#8a8f94', internalWalls: shiftX(unitWalls(1), LEVEL_DX) });
  B.push({ ...common, id: 'flat', name: 'Flat 5, Marlow Court', role: 'Your flat - the whole second floor', rect: shiftX(MARLOW, 2 * LEVEL_DX), color: '#e9e6df', level: 2, stacked: true, doors: [], floorColor: '#a07850', internalWalls: shiftX(flatWalls, 2 * LEVEL_DX) });
  B.push({ ...common, id: 'mc_3', name: 'Marlow Court, top floor', role: 'Landing - Flats 6 and 7', rect: shiftX(MARLOW, 3 * LEVEL_DX), color: '#e9e6df', level: 3, doors: [], floorColor: '#8a8f94', internalWalls: shiftX(unitWalls(3), 3 * LEVEL_DX) });
}

export const HOUSE_IDS = B.filter((b) => b.id.startsWith('house_')).map((b) => b.id);

// ------------------------------------------------------------ geometry helpers
export function wallsFor(b: BuildingDef): Rect[] {
  const { x0, z0, x1, z1 } = b.rect;
  const h = WALL_T / 2;
  const out: Rect[] = [];
  const sides: Side[] = ['xmin', 'xmax', 'zmin', 'zmax'];
  for (const s of sides) {
    const along = s === 'zmin' || s === 'zmax';
    const start = along ? x0 : z0;
    const end = along ? x1 : z1;
    const gaps = b.doors.filter((d) => d.side === s && d.open).sort((a, c) => a.a - c.a);
    let cur = start - (along ? h : h);
    const segs: [number, number][] = [];
    for (const g of gaps) {
      segs.push([cur, g.a]);
      cur = g.b;
    }
    segs.push([cur, end + h]);
    for (const [a, c] of segs) {
      if (c - a <= 0.01) continue;
      if (s === 'zmin') out.push({ x0: a, z0: z0 - h, x1: c, z1: z0 + h });
      if (s === 'zmax') out.push({ x0: a, z0: z1 - h, x1: c, z1: z1 + h });
      if (s === 'xmin') out.push({ x0: x0 - h, z0: a, x1: x0 + h, z1: c });
      if (s === 'xmax') out.push({ x0: x1 - h, z0: a, x1: x1 + h, z1: c });
    }
  }
  if (b.internalWalls) out.push(...b.internalWalls);
  return out;
}

const box = (cx: number, cz: number, w: number, d: number): Rect => ({ x0: cx - w / 2, z0: cz - d / 2, x1: cx + w / 2, z1: cz + d / 2 });

export const insideRect = (r: Rect, p: Vec2, pad = 0) => p.x >= r.x0 - pad && p.x <= r.x1 + pad && p.z >= r.z0 - pad && p.z <= r.z1 + pad;

export function segIntersectsRect(a: Vec2, b: Vec2, r: Rect, pad = 0): boolean {
  // Liang-Barsky clip of segment against an expanded rect
  const x0 = r.x0 - pad, x1 = r.x1 + pad, z0 = r.z0 - pad, z1 = r.z1 + pad;
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dz = b.z - a.z;
  const p = [-dx, dx, -dz, dz];
  const q = [a.x - x0, x1 - a.x, a.z - z0, z1 - a.z];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
  }
  return t0 <= t1;
}

// ------------------------------------------------------------ build world
export const SHELF_LAYOUT: { product: string; gx: number; zc: number }[] = [];
{
  const gondolas = [17, 22, 27, 32];
  PRODUCTS.forEach((p, i) => {
    const g = gondolas[Math.floor(i / 2)];
    SHELF_LAYOUT.push({ product: p, gx: g, zc: i % 2 === 0 ? -19.25 : -23.75 });
  });
}
export const PALLET_X = [13.5, 16, 18.5, 21, 27, 29.5, 32, 34.5];
export const QUEUE_SLOTS: Vec2[] = [
  { x: 22, z: -11.7 },
  { x: 25.2, z: -11.7 },
  { x: 27.4, z: -11.7 },
  { x: 29.6, z: -11.7 },
  { x: 31.8, z: -11.7 },
  { x: 34.0, z: -11.7 },
];

export interface ShopDef {
  id: string;
  /** shelf section interactable ids (also their container ids) */
  shelves: string[];
  /** shelf id -> pallet interactable in the store room */
  pallets: Record<string, string>;
  till: string;
  terminal: string;
  cupboard: string;
  bay: string;
  kiosk: string | null;
  /** cardboard baler, litter bin and outside dumpster (chores) */
  baler: string | null;
  bin: string | null;
  dumpster: string | null;
  backroom: string;
  bayContainer: string;
  queue: Vec2[];
  dirtSpots: Vec2[];
  entrance: Vec2;
  standby: Vec2[];
  dropZone: Vec2;
  vanOut: Vec2[];
  vanBack: Vec2[];
}

/** Harbour Wholesale racking: two rows of 2.7 m bays, products picked from the ground level */
export const WH_X0 = -64;
export const WH_BAY = 2.7;
export const WH_BAYS = 7;
export const WH_ROW_A = 23.4;
export const WH_ROW_B = 29.5;
export const WH_PRODUCTS = ['bread', 'milk', 'apples', 'soup', 'pasta', 'coffee', 'snacks', 'soap', 'cafe_supplies'];

export const U4_SECTIONS = [
  { id: 'u4_s1', gx: 80.5, zc: 21.5 }, { id: 'u4_s2', gx: 80.5, zc: 26.5 },
  { id: 'u4_s3', gx: 84.5, zc: 21.5 }, { id: 'u4_s4', gx: 84.5, zc: 26.5 },
];
export const U4_PALLET_Z = [20, 22.5, 25, 27.5];
export const U4_QUEUE: Vec2[] = [{ x: 84.5, z: 13.1 }, { x: 86.8, z: 13.1 }, { x: 86.8, z: 15.6 }];

export const SHOPS: Record<string, ShopDef> = {
  market: {
    id: 'market', shelves: SHELF_LAYOUT.map((x) => `shelf_${x.product}`),
    pallets: Object.fromEntries(PRODUCTS.map((p) => [`shelf_${p}`, `pallet_${p}`])),
    till: 'till', terminal: 'terminal', cupboard: 'cupboard', bay: 'bay', kiosk: 'kiosk', baler: 'baler', bin: 'shopbin', dumpster: 'dumpster', backroom: 'market_backroom', bayContainer: 'market_bay',
    queue: QUEUE_SLOTS,
    dirtSpots: [{ x: 14.5, z: -19.5 }, { x: 19.5, z: -20.5 }, { x: 24.5, z: -23 }, { x: 29.5, z: -19 }, { x: 34.3, z: -22 }, { x: 19.5, z: -15.6 }, { x: 27, z: -15.6 }, { x: 17.5, z: -12.6 }],
    entrance: { x: 17.5, z: -11.4 }, standby: [{ x: 22, z: -15.1 }, { x: 27, z: -15.6 }], dropZone: { x: 24, z: -38.7 },
    vanOut: [], vanBack: [],
  },
  unit4: {
    id: 'unit4', shelves: U4_SECTIONS.map((x) => x.id), pallets: Object.fromEntries(U4_SECTIONS.map((x, i) => [x.id, `u4_p${i + 1}`])),
    till: 'u4_till', terminal: 'u4_terminal', cupboard: 'u4_cupboard', bay: 'u4_bay', kiosk: null, baler: 'u4_baler', bin: 'u4_bin', dumpster: 'u4_dumpster', backroom: 'unit4_backroom', bayContainer: 'unit4_bay',
    queue: U4_QUEUE, dirtSpots: [{ x: 78.3, z: 22 }, { x: 82.5, z: 24 }, { x: 86.5, z: 21 }, { x: 82.5, z: 17.5 }],
    entrance: { x: 80.5, z: 13.4 }, standby: [{ x: 84.5, z: 16.1 }, { x: 82.5, z: 17.5 }], dropZone: { x: 90.5, z: 9.6 },
    vanOut: [], vanBack: [],
  },
};

export const shopOfLocation = (loc: string): ShopDef | null => SHOPS[loc] ?? null;

let cached: World | null = null;
let homeDesign: HomeDesign = defaultDesign();
let homeNodes: { id: string; pos: Vec2; hub: string }[] = [];

/** furnish the player's home with a design; the world (colliders, navigation, interactables) is rebuilt */
export function setHomeDesign(d: HomeDesign) {
  if (JSON.stringify(d) === JSON.stringify(homeDesign) && cached) return;
  homeDesign = JSON.parse(JSON.stringify(d));
  cached = null;
}
export const currentHomeDesign = () => homeDesign;

export function getWorld(): World {
  if (cached) return cached;
  // a design whose arrangement leaves something unreachable is re-arranged (next seed) until it works
  for (let attempt = 0; attempt < 40; attempt++) {
    const w = buildWorldData({ ...homeDesign, seed: homeDesign.seed + attempt * 7 });
    if (homeOK(w) || attempt === 39) { cached = w; break; }
  }
  return cached!;
}

/** every usable thing in the home is reachable from the flat's front door over the walking graph */
function homeOK(w: World): boolean {
  const seen = new Set<string>(['fl_door_i']);
  const q = ['fl_door_i'];
  while (q.length) { const a = q.pop()!; for (const b of w.edges[a] ?? []) if (!seen.has(b)) { seen.add(b); q.push(b); } }
  return homeNodes.every((h) => seen.has(h.id));
}

function buildWorldData(homeDesign: HomeDesign): World {
  let cached: World;
  // the city, and the buildings in it that open as shops, pubs, the bank...
  const venues = planVenues(buildCity(B.filter((b) => !b.unit && !b.level && !b.id.startsWith('v_')).map((b) => b.rect)));
  if (!B.some((b) => b.id.startsWith('v_'))) for (const v of venues) { B.push(venueBuilding(v)); if (v.kind !== 'prison') SHOP_IDS.push(v.id); }
  const obstacles: Obstacle[] = [];
  const I: Record<string, Interactable> = {};
  const add = (it: Omit<Interactable, 'range'> & { range?: number }) => {
    I[it.id] = { range: 1.6, ...it };
  };

  // ---- Corner Market interior
  for (const g of [17, 22, 27, 32]) obstacles.push({ kind: 'gondola', rect: { x0: g - 0.6, z0: -26, x1: g + 0.6, z1: -17 }, height: 1.8, solid: true });
  for (const s of SHELF_LAYOUT) {
    add({
      id: `shelf_${s.product}`, kind: 'shelf', label: `Shelf: ${s.product}`, pos: { x: s.gx - 1.15, z: s.zc }, facing: Math.PI / 2,
      obj: { x: s.gx, z: s.zc }, locationId: 'market', businessId: 'market', product: s.product, container: `shelf_${s.product}`,
    });
  }
  obstacles.push({ kind: 'counter', rect: { x0: 20, z0: -14, x1: 24, z1: -12.8 }, height: 1.0, solid: true });
  add({ id: 'till', kind: 'till', label: 'Checkout', pos: { x: 22, z: -15.1 }, facing: 0, obj: { x: 22, z: -13.4 }, locationId: 'market', businessId: 'market', range: 1.8 });
  obstacles.push({ kind: 'kiosk', rect: { x0: 12.3, z0: -13.6, x1: 13.1, z1: -12.4 }, height: 1.5, solid: true });
  add({ id: 'kiosk', kind: 'kiosk', label: 'Self-checkout', pos: { x: 13.9, z: -13 }, facing: -Math.PI / 2, obj: { x: 12.7, z: -13 }, locationId: 'market', businessId: 'market' });
  PRODUCTS.forEach((p, i) => {
    const px = PALLET_X[i];
    obstacles.push({ kind: 'pallet', rect: { x0: px - 0.6, z0: -35.7, x1: px + 0.6, z1: -34.5 }, height: 0.3, solid: true });
    add({
      id: `pallet_${p}`, kind: 'pallet', label: `Stock: ${p}`, pos: { x: px, z: -33.6 }, facing: Math.PI, obj: { x: px, z: -35.1 },
      locationId: 'market', businessId: 'market', product: p, container: 'market_backroom',
    });
  });
  obstacles.push({ kind: 'terminal', rect: { x0: 12.6, z0: -28.6, x1: 13.6, z1: -28.15 }, height: 1.4, solid: true });
  add({ id: 'terminal', kind: 'terminal', label: 'Staff terminal', pos: { x: 13.1, z: -29.4 }, facing: Math.PI, obj: { x: 13.1, z: -28.4 }, locationId: 'market', businessId: 'market' });
  obstacles.push({ kind: 'cupboard', rect: { x0: 35.2, z0: -31, x1: 35.85, z1: -29 }, height: 2.0, solid: true });
  add({ id: 'cupboard', kind: 'cupboard', label: 'Cleaning cupboard', pos: { x: 34.5, z: -30 }, facing: Math.PI / 2, obj: { x: 35.5, z: -30 }, locationId: 'market', businessId: 'market' });
  add({ id: 'bay', kind: 'bay', label: 'Loading bay', pos: { x: 24, z: -37.4 }, facing: Math.PI, obj: { x: 24, z: -38.7 }, locationId: 'market', businessId: 'market', range: 2.2 });
  // chores: a cardboard baler in the store room, a litter bin by the door and a dumpster out by the loading bay
  obstacles.push({ kind: 'baler', rect: { x0: 15.9, z0: -28.95, x1: 17.5, z1: -28.15 }, height: 1.9, solid: true, rot: Math.PI });
  add({ id: 'baler', kind: 'baler', label: 'Cardboard baler', pos: { x: 16.7, z: -29.8 }, facing: 0, obj: { x: 16.7, z: -28.55 }, locationId: 'market', businessId: 'market' });
  obstacles.push({ kind: 'shopbin', rect: { x0: 14.6, z0: -10.85, x1: 15.2, z1: -10.25 }, height: 0.95, solid: true, rot: Math.PI });
  add({ id: 'shopbin', kind: 'shopbin', label: 'Litter bin', pos: { x: 14.9, z: -11.6 }, facing: 0, obj: { x: 14.9, z: -10.55 }, locationId: 'market', businessId: 'market' });
  obstacles.push({ kind: 'dumpster', rect: { x0: 29.85, z0: -37.25, x1: 31.15, z1: -36.15 }, height: 1.3, solid: true, rot: Math.PI });
  add({ id: 'dumpster', kind: 'dumpster', label: 'Dumpster', pos: { x: 30.5, z: -38.1 }, facing: 0, obj: { x: 30.5, z: -36.7 }, locationId: 'outside', businessId: 'market', range: 1.8 });

  // ---- Flat 5 interior (the second floor): fixed fittings, then the occupant's design furnishes the rooms
  {
    const F = <T>(o: T): T => shiftX(o, 2 * LEVEL_DX);
    const kitchenRun: PlacedItem = { kind: 'kitchen', rect: { x0: 12.2, z0: 25.2, x1: 17.6, z1: 25.85 }, height: 0.92, solid: true, rot: Math.PI, room: 'kitchen' };
    const stove: PlacedItem = { kind: 'stove', rect: { x0: 17.6, z0: 25.2, x1: 18.2, z1: 25.85 }, height: 0.92, solid: true, rot: Math.PI, room: 'kitchen' };
    const shower: PlacedItem = { kind: 'shower', rect: { x0: 28.85, z0: 13.65, x1: 29.85, z1: 14.65 }, height: 2.1, solid: true, rot: -Math.PI / 2, room: 'bathroom' };
    const toilet: PlacedItem = { kind: 'toilet', rect: { x0: 29.2, z0: 16.6, x1: 29.85, z1: 17.3 }, height: 0.8, solid: true, rot: -Math.PI / 2, room: 'bathroom' };
    const washer: PlacedItem = { kind: 'washer', rect: { x0: 18.25, z0: 25.22, x1: 18.85, z1: 25.82 }, height: 0.85, solid: true, rot: Math.PI, room: 'kitchen' };
    const basin: PlacedItem = { kind: 'basin', rect: { x0: 27.0, z0: 13.65, x1: 27.6, z1: 14.1 }, height: 0.85, solid: true, rot: 0, room: 'bathroom' };
    const furnished = furnish(F({
      rooms: [
        { id: 'living', name: 'Living room', kind: 'living', rect: { x0: 16.7, z0: 17.6, x1: 22.6, z1: 23.6 }, doors: [], outside: [], open: [{ side: 'z0', from: 16.7, to: 22.6 }, { side: 'x0', from: 18.2, to: 23.6 }, { side: 'z1', from: 16.7, to: 22.6 }] },
        { id: 'dining', name: 'Dining area', kind: 'dining', rect: { x0: 12.15, z0: 18.2, x1: 16.7, z1: 23.6 }, doors: [], outside: ['x0'], open: [{ side: 'x1', from: 18.2, to: 23.6 }, { side: 'z1', from: 12, to: 16.7 }] },
        { id: 'spare', name: 'Study', kind: 'spare', rect: { x0: 16.7, z0: 10.15, x1: 22.6, z1: 13.3 }, doors: [{ x: 19.0, z: 13.3 }], outside: ['z0'] },
        { id: 'utility', name: 'Utility room', kind: 'utility', rect: { x0: 22.9, z0: 10.15, x1: 29.85, z1: 13.3 }, doors: [{ x: 24.5, z: 13.3 }], outside: ['z0', 'x1'] },
        { id: 'kitchen', name: 'Kitchen', kind: 'kitchen', rect: { x0: 12.15, z0: 23.6, x1: 22.6, z1: 25.85 }, doors: [], outside: ['x0', 'z1'], open: [{ side: 'z0', from: 12, to: 22.6 }] },
        { id: 'hall', name: 'Hall', kind: 'hall', rect: { x0: 16.7, z0: 13.6, x1: 25.7, z1: 17.6 }, doors: [{ x: 16.7, z: 15.6 }, { x: 19.0, z: 13.6 }, { x: 24.5, z: 13.6 }, { x: 25.7, z: 15.35 }, { x: 24.1, z: 17.6 }], outside: [], open: [{ side: 'z1', from: 16.7, to: 22.6 }] },
        { id: 'bedroom', name: 'Bedroom', kind: 'bedroom', rect: { x0: 22.9, z0: 17.9, x1: 29.85, z1: 25.85 }, doors: [{ x: 24.1, z: 17.9 }], outside: ['x1', 'z1'] },
        { id: 'bathroom', name: 'Bathroom', kind: 'bathroom', rect: { x0: 26.0, z0: 13.6, x1: 29.85, z1: 17.6 }, doors: [{ x: 26.0, z: 15.35 }], outside: ['x1'] },
      ],
      routes: [
        [{ x: 15.6, z: 15.6 }, { x: 17.2, z: 15.6 }], [{ x: 17.2, z: 15.6 }, { x: 21.0, z: 15.6 }], [{ x: 21.0, z: 15.6 }, { x: 24.1, z: 16.6 }], [{ x: 24.1, z: 16.6 }, { x: 24.1, z: 19.5 }],
        [{ x: 21.0, z: 15.6 }, { x: 19.0, z: 13.45 }], [{ x: 19.0, z: 13.45 }, { x: 19.6, z: 11.8 }], [{ x: 21.0, z: 15.6 }, { x: 24.5, z: 13.45 }], [{ x: 24.5, z: 13.45 }, { x: 25.5, z: 11.8 }],
        [{ x: 21.0, z: 15.6 }, { x: 27.3, z: 15.35 }], [{ x: 17.2, z: 15.6 }, { x: 17.2, z: 20.8 }], [{ x: 17.2, z: 20.8 }, { x: 15.0, z: 24.4 }], [{ x: 17.2, z: 20.8 }, { x: 17.9, z: 24.4 }], [{ x: 17.2, z: 20.8 }, { x: 18.6, z: 24.5 }],
      ],
      fixed: [kitchenRun, stove, washer, shower, toilet, basin],
      fixedUses: [
        { id: 'kitchen', kind: 'kitchen', label: 'Kitchen', pos: { x: 15.0, z: 24.4 }, facing: 0, obj: { x: 15.0, z: 25.5 } },
        { id: 'stove', kind: 'stove', label: 'Cooker', pos: { x: 17.9, z: 24.4 }, facing: 0, obj: { x: 17.9, z: 25.5 } },
        { id: 'washer', kind: 'washer', label: 'Washing machine', pos: { x: 18.6, z: 24.5 }, facing: 0, obj: { x: 18.55, z: 25.5 } },
        { id: 'shower', kind: 'shower', label: 'Shower', pos: { x: 28.3, z: 15.2 }, facing: Math.PI / 2, obj: { x: 29.35, z: 14.15 } },
      ],
      hubs: { living: 'fl_k', dining: 'fl_k', spare: 'fl_study', utility: 'fl_util', bedroom: 'fl_bed', bathroom: 'fl_bath', hall: 'fl_c', kitchen: 'fl_k' },
    }), homeDesign);
    for (const it of furnished.items) obstacles.push({ kind: it.kind as ObstacleKind, rect: it.rect, height: it.height, solid: it.solid, rot: it.rot, color: it.color });
    for (const u of furnished.uses) add({ ...u, kind: u.kind as InteractKind, locationId: 'flat' });
    homeNodes = furnished.nodes;
    obstacles.push({ kind: 'unitdoor', rect: F({ x0: 16.4, z0: 15.0, x1: 16.7, z1: 16.2 }), height: 2.1, solid: false, ref: 'flat' });
  }
  // ---- Harbourside Police Station: front desk and waiting area, custody desk and cells, the office
  obstacles.push({ kind: 'reception', rect: { x0: 50, z0: -18.0, x1: 62, z1: -17.3 }, height: 1.05, solid: true, color: '#2c3e50' });
  obstacles.push({ kind: 'waiting_chairs', rect: { x0: 44.4, z0: -16.4, x1: 45.0, z1: -13.0 }, height: 0.9, solid: true, rot: Math.PI / 2 });
  obstacles.push({ kind: 'leaflet_stand', rect: { x0: 68.9, z0: -14.0, x1: 69.6, z1: -13.4 }, height: 1.5, solid: true });
  obstacles.push({ kind: 'plant', rect: { x0: 52.6, z0: -13.0, x1: 53.1, z1: -12.5 }, height: 1.2, solid: true });
  obstacles.push({ kind: 'plant', rect: { x0: 60.9, z0: -13.0, x1: 61.4, z1: -12.5 }, height: 1.2, solid: true });
  add({ id: 'police_desk', kind: 'police_desk', label: 'Police front desk', pos: { x: 56, z: -16.3 }, facing: Math.PI, obj: { x: 56, z: -17.65 }, locationId: 'police', businessId: 'police', range: 1.8 });
  obstacles.push({ kind: 'reception', rect: { x0: 49.5, z0: -25.6, x1: 53.5, z1: -24.8 }, height: 1.05, solid: true, color: '#3d4d5c' });
  for (const [i, x0] of [44.15, 48.15, 52.15].entries()) {
    const x1 = x0 + 3.7, door = x0 + 1.35;
    obstacles.push({ kind: 'cellbars', rect: { x0, z0: -31.3, x1: door, z1: -31.1 }, height: 2.4, solid: true });
    obstacles.push({ kind: 'cellbars', rect: { x0: door + 1.0, z0: -31.3, x1, z1: -31.1 }, height: 2.4, solid: true });
    obstacles.push({ kind: 'celldoor', rect: { x0: door, z0: -31.3, x1: door + 1.0, z1: -31.1 }, height: 2.2, solid: false, ref: `cell_${i + 1}` });
    obstacles.push({ kind: 'bench', rect: { x0: x0 + 0.3, z0: -37.85, x1: x1 - 0.3, z1: -37.2 }, height: 0.5, solid: true, rot: 0 });
    add({ id: `cell_${i + 1}`, kind: 'cell_bench', label: `Cell ${i + 1}`, pos: { x: (x0 + x1) / 2, z: -36.4 }, facing: Math.PI, obj: { x: (x0 + x1) / 2, z: -37.5 }, locationId: 'police', range: 1.6 });
  }
  for (const [x0, z0] of [[58, -28], [62, -28], [58, -33], [62, -33]]) {
    obstacles.push({ kind: 'desk', rect: { x0, z0, x1: x0 + 2, z1: z0 + 1 }, height: 0.75, solid: true, rot: 0 });
    obstacles.push({ kind: 'laptop', rect: { x0: x0 + 0.8, z0: z0 + 0.3, x1: x0 + 1.2, z1: z0 + 0.6 }, height: 0.77, solid: false, rot: 0 });
  }
  obstacles.push({ kind: 'board', rect: { x0: 59, z0: -37.85, x1: 65, z1: -37.5 }, height: 2.2, solid: true });
  add({ id: 'beat_board', kind: 'beat_board', label: 'Briefing board', pos: { x: 62, z: -36.3 }, facing: Math.PI, obj: { x: 62, z: -37.7 }, locationId: 'police', businessId: 'police', range: 2.0 });
  for (let z = -37; z < -31; z += 1.1) obstacles.push({ kind: 'cupboard', rect: { x0: 69.2, z0: z, x1: 69.85, z1: z + 1.0 }, height: 2.0, solid: true, rot: -Math.PI / 2 });
  obstacles.push({ kind: 'terminal', rect: { x0: 69.4, z0: -24.5, x1: 69.85, z1: -23.5 }, height: 1.4, solid: true });
  add({ id: 'police_terminal', kind: 'terminal', label: 'Staff terminal', pos: { x: 68.6, z: -24 }, facing: Math.PI / 2, obj: { x: 69.6, z: -24 }, locationId: 'police', businessId: 'police' });
  // ---- bus stops: the two on Main Street and one at every shelter in the city
  for (const [id, n] of [['bus_w', { x: -88, z: -6.49 }], ['bus_e', { x: 88, z: 6.6 }]] as const) { add({ id: `stop_${id}`, kind: 'bus_stop', label: 'Bus stop', pos: n, facing: id === 'bus_w' ? Math.PI : 0, obj: { x: n.x, z: n.z + (id === 'bus_w' ? -0.8 : 0.8) }, locationId: 'outside', range: 2.0 }); }
  buildCity(B.filter((b) => !b.unit && !b.level).map((b) => b.rect)).props.filter((p) => p.kind === 'bus_stop').forEach((p, i) => add({ id: `stop_bus_${i}`, kind: 'bus_stop', label: 'Bus stop', pos: { x: p.x, z: p.z + 1.2 }, facing: Math.PI, obj: { x: p.x, z: p.z }, locationId: 'outside', range: 2.0 }));
  // ---- the railway halts out of town (the line itself runs behind Central Station)
  for (const h of HALTS) {
    add({ id: h.id, kind: 'platform', label: `${h.name} (rail halt)`, pos: h.pos, facing: Math.PI, obj: { x: h.pos.x, z: h.pos.z - 0.9 }, locationId: 'outside', range: 2.2 });
    obstacles.push({ kind: 'halt_sign', rect: { x0: h.pos.x - 1.4, z0: h.pos.z - 1.5, x1: h.pos.x + 1.4, z1: h.pos.z - 1.2 }, height: 3.0, solid: false });
  }
  // ---- red phone boxes (Vince is always at the other end)
  phoneBoxesOf(buildCity(B.filter((b) => !b.unit && !b.level).map((b) => b.rect))).forEach((b, i) => {
    obstacles.push({ kind: 'phonebox', rect: { x0: b.x - 0.5, z0: b.z - 0.5, x1: b.x + 0.5, z1: b.z + 0.5 }, height: 2.5, solid: false });
    add({ id: `payphone_${i}`, kind: 'payphone', label: 'Phone box', pos: { x: b.x, z: b.z + 1.0 }, facing: Math.PI, obj: { x: b.x, z: b.z }, locationId: 'outside', range: 1.8 });
  });
  // ---- Harbour Bikes docks
  bikeDocksOf(buildCity(B.filter((b) => !b.unit && !b.level).map((b) => b.rect))).forEach((d, i) => {
    obstacles.push({ kind: 'bike_rack', rect: { x0: d.x - 1.6, z0: d.z - 0.9, x1: d.x + 1.6, z1: d.z - 0.3 }, height: 1.0, solid: false });
    add({ id: `bikedock_${i}`, kind: 'bike_dock', label: 'Harbour Bikes dock', pos: { x: d.x, z: d.z + 0.6 }, facing: Math.PI, obj: { x: d.x, z: d.z - 0.6 }, locationId: 'outside', range: 2.0 });
  });
  // ---- the stadium's turnstiles
  { const t = turnstilesOf(buildCity(B.filter((b) => !b.unit && !b.level).map((b) => b.rect))); add({ id: 'turnstile', kind: 'turnstile', label: 'Harbour City Stadium turnstiles', pos: t, facing: Math.PI, obj: { x: t.x, z: t.z - 1.2 }, locationId: 'outside', range: 2.5 }); for (const dx of [-2.2, 1.4]) obstacles.push({ kind: 'kiosk', rect: { x0: t.x + dx, z0: t.z - 1.4, x1: t.x + dx + 0.8, z1: t.z - 0.7 }, height: 1.2, solid: true }); }
  // ---- Eastgate Motors' yard gate: stolen cars sold for parts
  add({ id: 'chop_shop', kind: 'chop_shop', label: 'Eastgate Motors (yard gate)', pos: { x: 84, z: -10.4 }, facing: Math.PI, obj: { x: 84, z: -12 }, locationId: 'outside', range: 1.6 });
  // ---- the city's venues, fitted out
  for (const v of venues) {
    for (const o of v.obstacles) obstacles.push({ ...o, kind: o.kind as ObstacleKind });
    for (const sp of v.spots) add({ ...sp, kind: sp.kind as InteractKind, locationId: v.id, range: sp.range ?? 1.6 });
  }
  // ---- shop doors: after hours they are locked, and can be forced
  for (const id of SHOP_IDS) {
    const b = B.find((x) => x.id === id);
    if (!b) continue;
    publicDoors(b).forEach((d, i) => add({ id: `${id}_door${i ? i + 1 : ''}`, kind: 'shopdoor', label: `${b.name} (locked)`, pos: d.out, facing: d.facing, obj: d.mid, locationId: 'outside', range: 1.3 }));
  }
  // ---- Marlow Court: the stair core on every floor, and the other flats (locked: knock, or force the door)
  for (let k = 0; k < 4; k++) {
    obstacles.push({ kind: 'stairwell', rect: shiftX(STAIR_CORE, k * LEVEL_DX), height: 3.2, solid: false, rot: k, color: k === 3 ? 'top' : undefined });
    for (const g of stairGuards(k)) obstacles.push({ kind: 'stairguard', rect: shiftX(g, k * LEVEL_DX), height: 1, solid: true, rot: k });
  }
  for (const u of FLAT_UNITS) {
    const P = <T>(o: T): T => shiftX(o, u.level * LEVEL_DX);
    const hue = ['#5b6b7a', '#7a4f3a', '#4f6d60', '#6a5a7a', '#8a7a5a', '#3f5a6f'][FLAT_UNITS.indexOf(u) % 6];
    const furniture: Obstacle[] = u.side === 'a' ? [
      { kind: 'bed', rect: { x0: 12.2, z0: 18.4, x1: 14.4, z1: 20.6 }, height: 0.6, solid: true, rot: 0 },
      { kind: 'bedside', rect: { x0: 14.5, z0: 18.3, x1: 15.0, z1: 18.8 }, height: 0.5, solid: true, rot: 0 },
      { kind: 'wardrobe', rect: { x0: 12.2, z0: 21.0, x1: 12.8, z1: 22.4 }, height: 2.0, solid: true, rot: Math.PI / 2 },
      { kind: 'sofa', rect: { x0: 20.5, z0: 21.5, x1: 21.25, z1: 23.7 }, height: 0.85, solid: true, rot: -Math.PI / 2, color: hue },
      { kind: 'coffee_table', rect: { x0: 19.2, z0: 22.1, x1: 19.9, z1: 23.1 }, height: 0.42, solid: true, rot: Math.PI / 2 },
      { kind: 'tv', rect: { x0: 15.55, z0: 22.6, x1: 16.0, z1: 24.0 }, height: 0.55, solid: true, rot: Math.PI / 2 },
      { kind: 'kitchen', rect: { x0: 12.2, z0: 25.2, x1: 16.4, z1: 25.85 }, height: 0.92, solid: true, rot: Math.PI },
      { kind: 'stove', rect: { x0: 16.4, z0: 25.2, x1: 17.0, z1: 25.85 }, height: 0.92, solid: true, rot: Math.PI },
      { kind: 'dining_table', rect: { x0: 18.6, z0: 24.0, x1: 19.8, z1: 25.0 }, height: 0.75, solid: true },
      { kind: 'drawers', rect: { x0: 20.75, z0: 18.6, x1: 21.25, z1: 19.4 }, height: 0.9, solid: true, rot: -Math.PI / 2 },
      { kind: 'plant', rect: { x0: 15.6, z0: 18.3, x1: 16.1, z1: 18.8 }, height: 1.1, solid: true },
      { kind: 'rug', rect: { x0: 17.6, z0: 21.6, x1: 20.2, z1: 23.6 }, height: 0.01, solid: false, color: '#8a3a2e' },
    ] : [
      { kind: 'sofa', rect: { x0: 22.2, z0: 17.6, x1: 24.4, z1: 18.5 }, height: 0.85, solid: true, rot: 0, color: hue },
      { kind: 'coffee_table', rect: { x0: 22.8, z0: 19.2, x1: 23.8, z1: 19.8 }, height: 0.42, solid: true },
      { kind: 'tv', rect: { x0: 22.5, z0: 21.15, x1: 24.0, z1: 21.55 }, height: 0.55, solid: true, rot: Math.PI },
      { kind: 'kitchen', rect: { x0: 29.2, z0: 17.5, x1: 29.85, z1: 21.4 }, height: 0.92, solid: true, rot: -Math.PI / 2 },
      { kind: 'stove', rect: { x0: 29.2, z0: 16.9, x1: 29.85, z1: 17.5 }, height: 0.92, solid: true, rot: -Math.PI / 2 },
      { kind: 'dining_table', rect: { x0: 26.8, z0: 14.4, x1: 28.0, z1: 15.4 }, height: 0.75, solid: true },
      { kind: 'bed', rect: { x0: 21.7, z0: 23.6, x1: 23.9, z1: 25.8 }, height: 0.6, solid: true, rot: Math.PI },
      { kind: 'bedside', rect: { x0: 24.0, z0: 25.3, x1: 24.5, z1: 25.8 }, height: 0.5, solid: true, rot: Math.PI },
      { kind: 'wardrobe', rect: { x0: 26.0, z0: 25.25, x1: 27.6, z1: 25.85 }, height: 2.0, solid: true, rot: Math.PI },
      { kind: 'drawers', rect: { x0: 21.65, z0: 22.2, x1: 22.15, z1: 23.0 }, height: 0.9, solid: true, rot: Math.PI / 2 },
      { kind: 'plant', rect: { x0: 29.3, z0: 24.6, x1: 29.8, z1: 25.1 }, height: 1.1, solid: true },
      { kind: 'rug', rect: { x0: 22.2, z0: 18.8, x1: 24.6, z1: 20.6 }, height: 0.01, solid: false, color: '#3f5a6f' },
    ];
    for (const o of furniture) obstacles.push(P(o));
    obstacles.push({ kind: 'unitdoor', rect: u.door, height: 2.1, solid: false, ref: u.id });
    const corridor = MARLOW_LEVELS[u.level];
    const toDoor = Math.atan2((u.door.x0 + u.door.x1) / 2 - u.doorPos.x, (u.door.z0 + u.door.z1) / 2 - u.doorPos.z);
    add({ id: `${u.id}_door`, kind: 'housedoor', label: `${u.name.split(',')[0]} (front door)`, pos: u.doorPos, facing: toDoor, obj: { x: (u.door.x0 + u.door.x1) / 2, z: (u.door.z0 + u.door.z1) / 2 }, locationId: corridor, range: 1.6 });
    if (u.side === 'a') add({ id: `${u.id}_valuables`, kind: 'valuables', label: 'Chest of drawers', pos: P({ x: 20.1, z: 19.0 }), facing: Math.PI / 2, obj: P({ x: 21.0, z: 19.0 }), locationId: u.id });
    else add({ id: `${u.id}_valuables`, kind: 'valuables', label: 'Chest of drawers', pos: P({ x: 22.9, z: 22.6 }), facing: -Math.PI / 2, obj: P({ x: 21.9, z: 22.6 }), locationId: u.id });
  }
  // ---- the houses on Harbour Road: a furnished ground floor, the door locked unless you are let in
  for (const id of HOUSE_IDS) {
    const b = B.find((x) => x.id === id)!;
    const east = b.rect.x0 > 0;
    const zc = (b.rect.z0 + b.rect.z1) / 2;
    // u: metres in from the street wall, v: metres along it from the door
    const R = (u0: number, u1: number, v0: number, v1: number): Rect => east ? { x0: 10 + u0, z0: zc + v0, x1: 10 + u1, z1: zc + v1 } : { x0: -10 - u1, z0: zc + v0, x1: -10 - u0, z1: zc + v1 };
    const P = (u: number, v: number): Vec2 => ({ x: east ? 10 + u : -10 - u, z: zc + v });
    const hue = ['#5b6b7a', '#7a4f3a', '#4f6d60', '#6a5a7a', '#8a7a5a', '#3f5a6f'][HOUSE_IDS.indexOf(id) % 6];
    obstacles.push({ kind: 'rug', rect: R(1.6, 3.8, -1.2, 1.2), height: 0.01, solid: false, color: '#8a3a2e' });
    obstacles.push({ kind: 'sofa', rect: R(1.4, 3.7, 3.35, 4.25), height: 0.85, solid: true, rot: Math.PI, color: hue });
    obstacles.push({ kind: 'coffee_table', rect: R(2.1, 3.1, 1.5, 2.2), height: 0.42, solid: true });
    obstacles.push({ kind: 'tv', rect: R(1.9, 3.2, -4.3, -3.8), height: 0.55, solid: true, rot: 0 });
    obstacles.push({ kind: 'drawers', rect: R(4.0, 4.8, -4.3, -3.85), height: 0.9, solid: true, rot: 0 });
    obstacles.push({ kind: 'plant', rect: R(4.3, 4.8, 3.8, 4.3), height: 1.1, solid: true });
    obstacles.push({ kind: 'kitchen', rect: R(5.9, 9.0, 3.6, 4.25), height: 0.92, solid: true, rot: Math.PI });
    obstacles.push({ kind: 'stove', rect: R(9.0, 9.6, 3.6, 4.25), height: 0.92, solid: true, rot: Math.PI });
    obstacles.push({ kind: 'dining_table', rect: R(6.6, 8.2, -1.0, 0.4), height: 0.75, solid: true });
    obstacles.push({ kind: 'bookcase', rect: R(6.0, 7.0, -4.3, -3.9), height: 1.8, solid: true, rot: 0 });
    add({ id: `${id}_door`, kind: 'housedoor', label: `${b.name} (front door)`, pos: P(-0.9, 0), facing: east ? Math.PI / 2 : -Math.PI / 2, obj: P(0, 0), locationId: 'outside', range: 1.6 });
    add({ id: `${id}_valuables`, kind: 'valuables', label: 'Chest of drawers', pos: P(4.4, -3.2), facing: Math.PI, obj: P(4.4, -4.05), locationId: id });
  }
  // ---- the dog rescue: the front desk, and four kennels along the back wall behind low gates
  obstacles.push({ kind: 'counter', rect: { x0: 78.6, z0: 47, x1: 79.6, z1: 50.5 }, height: 1.0, solid: true, color: '#3b6b4a' });
  for (const [i, zc] of [47.9, 51.85, 55.35, 58.6].entries()) {
    obstacles.push({ kind: 'kennel_gate', rect: { x0: 86.45, z0: zc - 1.4, x1: 86.6, z1: zc + 1.4 }, height: 1.0, solid: true });
    add({ id: `kennel_${i}`, kind: 'kennel', label: 'Kennel', pos: { x: 85.4, z: zc }, facing: Math.PI / 2, obj: { x: 88.5, z: zc }, locationId: 'rescue', range: 1.8 });
  }
  add({ id: 'rescue_desk', kind: 'rescue_desk', label: 'Rescue front desk', pos: { x: 80.6, z: 48.7 }, facing: -Math.PI / 2, obj: { x: 79.1, z: 48.7 }, locationId: 'rescue', range: 1.8 });
  // ---- The Anchor: the bar along the back wall, tables, and the dartboard on the north wall
  obstacles.push({ kind: 'counter', rect: { x0: 76.6, z0: 74, x1: 77.6, z1: 84 }, height: 1.05, solid: true, color: '#4a2f1e' });
  obstacles.push({ kind: 'kitchen', rect: { x0: 81.2, z0: 74.5, x1: 81.85, z1: 83.5 }, height: 0.95, solid: true, rot: -Math.PI / 2 });
  for (const [tx, tz] of [[67.5, 74.6], [71.5, 74.6], [67.5, 82.5]]) obstacles.push({ kind: 'table', rect: box(tx, tz, 1.3, 1.3), height: 0.75, solid: true });
  obstacles.push({ kind: 'bistro_set', rect: box(70.4, 81.6, 0.8, 1.6), height: 0.9, solid: true });
  obstacles.push({ kind: 'dartboard', rect: { x0: 73.6, z0: 85.75, x1: 74.4, z1: 85.85 }, height: 1.73, solid: false });
  for (const [px, pz] of [[64.6, 72.6], [64.6, 85.4]]) obstacles.push({ kind: 'plant', rect: box(px, pz, 0.5, 0.5), height: 1.2, solid: true });
  add({ id: 'pub_bar', kind: 'pub_bar', label: 'The bar', pos: { x: 75.6, z: 79 }, facing: Math.PI / 2, obj: { x: 77.1, z: 79 }, locationId: 'pub', range: 1.8 });
  add({ id: 'darts', kind: 'darts', label: 'Dartboard', pos: { x: 74, z: 83.3 }, facing: 0, obj: { x: 74, z: 85.8 }, locationId: 'pub', range: 1.6 });
  // ---- the quay: fishing spots at the edge, a bait and tackle hut, benches looking out to sea
  for (const f of FISH_SPOTS) add({ id: f.id, kind: 'fishing', label: 'Fishing spot', pos: { x: f.x, z: QUAY_EDGE - 1.2 }, facing: 0, obj: { x: f.x, z: QUAY_EDGE + 0.6 }, locationId: 'outside', range: 1.6 });
  obstacles.push({ kind: 'bait_hut', rect: { x0: BAIT_HUT.x - 2, z0: BAIT_HUT.z - 1.5, x1: BAIT_HUT.x + 2, z1: BAIT_HUT.z + 1.5 }, height: 2.6, solid: true });
  add({ id: 'boat_hire', kind: 'boat_hire', label: 'Harbour Boat Hire', pos: { x: 24, z: QUAY_EDGE - 1.2 }, facing: 0, obj: { x: 24, z: QUAY_EDGE + 0.4 }, locationId: 'outside', range: 1.8 });
  add({ id: 'bait_hut', kind: 'bait_shop', label: 'Bait & Tackle', pos: { x: BAIT_HUT.x, z: BAIT_HUT.z - 2.3 }, facing: 0, obj: { x: BAIT_HUT.x, z: BAIT_HUT.z - 1.5 }, locationId: 'outside', range: 1.8 });
  for (const x of [-42, -8, 22, 44]) obstacles.push({ kind: 'bench', rect: { x0: x - 0.9, z0: 86.2, x1: x + 0.9, z1: 86.8 }, height: 0.9, solid: true });
  // Marlow Court's front garden: railings with a gap for the path, planting, the bin store by the
  // service door and a covered bike stand at the side
  obstacles.push({ kind: 'railing', rect: { x0: 12, z0: 8.3, x1: 15.0, z1: 8.4 }, height: 1.0, solid: true });
  obstacles.push({ kind: 'railing', rect: { x0: 17.6, z0: 8.3, x1: 25.0, z1: 8.4 }, height: 1.0, solid: true });
  obstacles.push({ kind: 'planter', rect: { x0: 12.2, z0: 8.6, x1: 14.8, z1: 9.6 }, height: 0.55, solid: true });
  obstacles.push({ kind: 'planter', rect: { x0: 18.4, z0: 8.6, x1: 24.6, z1: 9.6 }, height: 0.55, solid: true });
  obstacles.push({ kind: 'bin_store', rect: { x0: 25.2, z0: 8.2, x1: 29.6, z1: 9.8 }, height: 1.5, solid: true });
  obstacles.push({ kind: 'bike_shelter', rect: { x0: 30.7, z0: 11.0, x1: 32.4, z1: 15.6 }, height: 2.1, solid: true });
  // communal lobby: post boxes by the door, a noticeboard and a bench
  obstacles.push({ kind: 'mailboxes', rect: { x0: 20.85, z0: 10.6, x1: 21.3, z1: 12.4 }, height: 1.5, solid: true });
  obstacles.push({ kind: 'plant', rect: { x0: 17.4, z0: 10.2, x1: 17.9, z1: 10.7 }, height: 1.2, solid: true });
  obstacles.push({ kind: 'bench', rect: { x0: 18.2, z0: 10.2, x1: 19.9, z1: 10.75 }, height: 0.9, solid: true });
  for (const k of [1, 3]) obstacles.push({ kind: 'plant', rect: shiftX({ x0: 20.7, z0: 10.2, x1: 21.2, z1: 10.7 }, k * LEVEL_DX), height: 1.2, solid: true });

  // ---- Job centre interior
  obstacles.push({ kind: 'board', rect: { x0: -27, z0: -27.85, x1: -21, z1: -27.5 }, height: 2.2, solid: true });
  add({ id: 'jobboard', kind: 'board', label: 'Vacancy board', pos: { x: -24, z: -26.3 }, facing: Math.PI, obj: { x: -24, z: -27.7 }, locationId: 'jobcentre', range: 2.0 });
  obstacles.push({ kind: 'desk', rect: { x0: -33, z0: -20, x1: -29, z1: -18.8 }, height: 0.9, solid: true });
  // training desk in the corner: courses for qualifications
  obstacles.push({ kind: 'desk', rect: { x0: -33.0, z0: -26.4, x1: -31.8, z1: -25.8 }, height: 0.75, solid: true, rot: 0 });
  add({ id: 'training', kind: 'study_desk', label: 'Training desk', pos: { x: -32.4, z: -24.75 }, facing: Math.PI, obj: { x: -32.4, z: -25.45 }, locationId: 'jobcentre', range: 1.6 });
  add({ id: 'advisor', kind: 'advisor', label: 'Employment advisor', pos: { x: -31, z: -17.6 }, facing: Math.PI, obj: { x: -31, z: -21 }, locationId: 'jobcentre', range: 2.0 });

  // waiting area: rows of seats along the east wall and facing the board, water, leaflets, plants
  obstacles.push({ kind: 'waiting_chairs', rect: { x0: -15.3, z0: -20.4, x1: -14.7, z1: -18.2 }, height: 0.9, solid: true, rot: -Math.PI / 2 });
  obstacles.push({ kind: 'waiting_chairs', rect: { x0: -15.3, z0: -24.4, x1: -14.7, z1: -22.2 }, height: 0.9, solid: true, rot: -Math.PI / 2 });
  obstacles.push({ kind: 'waiting_chairs', rect: { x0: -20.6, z0: -18.9, x1: -18.4, z1: -18.3 }, height: 0.9, solid: true, rot: Math.PI });
  obstacles.push({ kind: 'water_cooler', rect: { x0: -15.2, z0: -12.2, x1: -14.85, z1: -11.85 }, height: 1.5, solid: true });
  obstacles.push({ kind: 'leaflet_stand', rect: { x0: -20.5, z0: -11.4, x1: -20.0, z1: -11.1 }, height: 1.4, solid: true });
  for (const [px, pz] of [[-33.3, -27.3], [-14.7, -27.3], [-33.3, -10.7]]) obstacles.push({ kind: 'plant', rect: box(px, pz, 0.5, 0.5), height: 1.3, solid: true });

  // ---- Cafe interior
  obstacles.push({ kind: 'counter', rect: { x0: -30, z0: 19.6, x1: -18, z1: 20.6 }, height: 1.0, solid: true, color: '#7b2d26' });
  // the kitchen behind the counter: units along the back wall and the grill
  obstacles.push({ kind: 'kitchen', rect: { x0: -31.5, z0: 25.2, x1: -26.6, z1: 25.85 }, height: 0.92, solid: true, rot: Math.PI });
  obstacles.push({ kind: 'stove', rect: { x0: -26.6, z0: 25.2, x1: -25.4, z1: 25.85 }, height: 0.92, solid: true, rot: Math.PI });
  obstacles.push({ kind: 'terminal', rect: { x0: -33.98, z0: 21.5, x1: -33.55, z1: 22.5 }, height: 1.4, solid: true });
  add({ id: 'cafe_terminal', kind: 'terminal', label: 'Staff terminal', pos: { x: -32.8, z: 22 }, facing: -Math.PI / 2, obj: { x: -33.75, z: 22 }, locationId: 'cafe', businessId: 'cafe' });
  add({ id: 'cafe_grill', kind: 'cafe_grill', label: 'Grill', pos: { x: -26, z: 24.4 }, facing: 0, obj: { x: -26, z: 25.5 }, locationId: 'cafe', businessId: 'cafe' });
  add({ id: 'cafe_counter', kind: 'cafe_counter', label: 'Cafe counter', pos: { x: -24, z: 18.8 }, facing: 0, obj: { x: -24, z: 20.1 }, locationId: 'cafe', businessId: 'cafe', range: 1.8 });
  for (const [tx, tz] of [[-31, 14], [-17, 14]]) obstacles.push({ kind: 'table', rect: box(tx, tz, 1.4, 1.4), height: 0.75, solid: true });
  for (const [tx, tz] of [[-28.5, 16.4], [-20.5, 16.8]]) obstacles.push({ kind: 'bistro_set', rect: box(tx, tz, 0.8, 1.6), height: 0.9, solid: true });
  for (const [px, pz] of [[-33.3, 10.7], [-14.7, 10.7], [-14.7, 18.8]]) obstacles.push({ kind: 'plant', rect: box(px, pz, 0.5, 0.5), height: 1.2, solid: true });
  // job interviews happen over a coffee at the window table: candidate faces the counter, interviewer opposite
  add({ id: 'iv_chair', kind: 'iv_chair', label: 'Interview table', pos: { x: -17, z: 12.6 }, facing: 0, obj: { x: -17, z: 13.05 }, locationId: 'cafe', range: 1.6 });
  // meeting friends: the corner table by the other window
  add({ id: 'meet_chair', kind: 'meet_chair', label: 'Corner table', pos: { x: -31, z: 12.6 }, facing: 0, obj: { x: -31, z: 13.05 }, locationId: 'cafe', range: 1.6 });
  add({ id: 'meet_host', kind: 'meet_chair', label: 'Corner table', pos: { x: -31, z: 15.75 }, facing: Math.PI, obj: { x: -31, z: 14.95 }, locationId: 'cafe', range: 1.6 });
  add({ id: 'iv_host', kind: 'iv_host', label: 'Interview table', pos: { x: -17, z: 15.75 }, facing: Math.PI, obj: { x: -17, z: 14.95 }, locationId: 'cafe', range: 1.6 });

  // ---- Harbour Wholesale: pallet racking with a pick face per product, staging lanes by the loading door
  for (const z0 of [WH_ROW_A, WH_ROW_B]) obstacles.push({ kind: 'pallet_rack', rect: { x0: WH_X0, z0, x1: WH_X0 + WH_BAYS * WH_BAY, z1: z0 + 1.1 }, height: 4.2, solid: true });
  obstacles.push({ kind: 'pallet_rack', rect: { x0: WH_X0, z0: WH_ROW_B + 1.1, x1: WH_X0 + WH_BAYS * WH_BAY, z1: WH_ROW_B + 2.2 }, height: 4.2, solid: true, rot: 0 });
  obstacles.push({ kind: 'pallet_rack', rect: { x0: WH_X0, z0: 38.6, x1: WH_X0 + WH_BAYS * WH_BAY, z1: 39.7 }, height: 4.2, solid: true, rot: Math.PI });
  WH_PRODUCTS.forEach((p, i) => {
    const row = i < 5 ? WH_ROW_A : WH_ROW_B;
    const cx = WH_X0 + WH_BAY / 2 + (i < 5 ? i : i - 5) * WH_BAY;
    add({ id: `wh_rack_${p}`, kind: 'rack', label: `Racking: ${p}`, pos: { x: cx, z: row - 0.85 }, facing: 0, obj: { x: cx, z: row + 0.5 }, locationId: 'wholesale', businessId: 'wholesale', product: p, container: 'wholesale_stock', range: 1.8 });
  });
  add({ id: 'wh_stage', kind: 'staging', label: 'Dispatch staging lanes', pos: { x: -54, z: 18.6 }, facing: Math.PI, obj: { x: -54, z: 16.6 }, locationId: 'wholesale', businessId: 'wholesale', range: 2.6 });
  obstacles.push({ kind: 'terminal', rect: { x0: -40.6, z0: 16.5, x1: -40.15, z1: 17.5 }, height: 1.4, solid: true });
  add({ id: 'wh_terminal', kind: 'terminal', label: 'Staff terminal', pos: { x: -41.4, z: 17 }, facing: Math.PI / 2, obj: { x: -40.4, z: 17 }, locationId: 'wholesale', businessId: 'wholesale' });
  WH_PRODUCTS.forEach((_p, i) => {
    const row = i < 5 ? WH_ROW_A : WH_ROW_B;
    const cx = WH_X0 + WH_BAY / 2 + (i < 5 ? i : i - 5) * WH_BAY;
    for (const dx of [-0.68, 0.68]) obstacles.push({ kind: 'pallet', rect: { x0: cx + dx - 0.6, z0: row + 0.05, x1: cx + dx + 0.6, z1: row + 1.05 }, height: 0.15, solid: false });
  });
  for (let lane = 0; lane < 4; lane++) {
    const x0 = -58.6 + lane * 2.6;
    obstacles.push({ kind: 'lane_marking', rect: { x0, z0: 15.0, x1: x0 + 2.2, z1: 17.6 }, height: 0.01, solid: false });
    obstacles.push({ kind: 'pallet', rect: { x0: x0 + 0.4, z0: 15.8, x1: x0 + 1.6, z1: 16.8 }, height: 0.15, solid: false });
  }
  obstacles.push({ kind: 'roller_door', rect: { x0: -58, z0: 14.05, x1: -50, z1: 14.3 }, height: 4, solid: false, rot: Math.PI });
  // goods-in: imported pallets wait here (drawn live from the goods-in stock), the forklift parks nearby
  obstacles.push({ kind: 'lane_marking', rect: { x0: -44.2, z0: 34.2, x1: -40.6, z1: 39.4 }, height: 0.01, solid: false });

  // ---- Harbour Home showroom: room sets either side of a clear aisle to the sales counter
  {
    const O = (kind: ObstacleKind, x0: number, z0: number, x1: number, z1: number, height: number, rot?: number, solid = true, color?: string) => obstacles.push({ kind, rect: { x0, z0, x1, z1 }, height, solid, rot, color });
    // counter at the back with the assistant behind it
    O('desk', -53.5, -33.0, -48.5, -31.8, 0.9, 0);
    O('terminal', -56.0, -33.95, -55.0, -33.5, 1.4);
    add({ id: 'hh_terminal', kind: 'terminal', label: 'Staff terminal', pos: { x: -55.5, z: -33.0 }, facing: Math.PI, obj: { x: -55.5, z: -33.7 }, locationId: 'homestore', businessId: 'homestore' });
    add({ id: 'home_counter', kind: 'home_counter', label: 'Harbour Home sales counter', pos: { x: -51, z: -30.6 }, facing: Math.PI, obj: { x: -51, z: -32.4 }, locationId: 'homestore', businessId: 'homestore', range: 2.0 });
    // living room set (west side)
    O('rug', -60.6, -25.2, -56.2, -20.4, 0.01, 0, false, '#8a3e3a');
    O('sofa', -60.0, -25.2, -57.8, -24.25, 0.85, 0, true, '#4f6d60');
    O('coffee_table', -59.5, -23.3, -58.4, -22.7, 0.45, 0);
    O('armchair', -57.2, -22.6, -56.35, -21.75, 0.85, -Math.PI / 2, true, '#b8892b');
    O('tv', -59.7, -20.0, -58.1, -19.55, 0.5, Math.PI);
    O('lampstand', -61.2, -25.4, -60.8, -25.0, 1.6);
    O('plant', -61.4, -20.4, -60.9, -19.9, 1.3);
    // bookcases, sideboard and a desk along the west wall
    O('bookcase', -61.85, -31.9, -61.53, -31.0, 1.9, Math.PI / 2);
    O('bookcase', -61.85, -30.6, -61.53, -29.7, 1.9, Math.PI / 2);
    O('sideboard', -61.85, -28.6, -61.4, -27.2, 0.8, Math.PI / 2);
    O('desk', -58.6, -33.6, -57.4, -33.0, 0.75, 0);
    // bedroom set (east side)
    O('rug', -46.6, -28.2, -42.2, -23.4, 0.01, 0, false, '#4b6283');
    O('bed', -45.2, -28.3, -43.6, -26.2, 0.6, 0, true, '#2f3f5e');
    O('bedside', -45.75, -28.3, -45.3, -27.9, 0.5, 0);
    O('bedside', -43.5, -28.3, -43.05, -27.9, 0.5, 0);
    O('wardrobe', -40.85, -26.2, -40.15, -24.0, 2.1, -Math.PI / 2);
    O('drawers', -40.63, -22.6, -40.15, -21.7, 0.85, -Math.PI / 2);
    O('armchair', -42.6, -32.6, -41.8, -31.8, 0.85, Math.PI, true, '#c79b98');
    // dining set (east, near the windows)
    O('dining_table', -46.7, -16.0, -45.3, -15.1, 0.75, 0);
    O('dining_chair', -46.22, -16.77, -45.78, -16.33, 0.9, 0, false);
    O('dining_chair', -46.22, -14.77, -45.78, -14.33, 0.9, Math.PI, false);
    O('plant', -41.0, -13.1, -40.5, -12.6, 1.3);
    O('plant', -61.5, -13.1, -61.0, -12.6, 1.3);
    // framed prints, wallpaper and flooring samples on the walls
    for (const [x, color] of [[-58, '#c45a3c'], [-56, '#3c6e8c'], [-46, '#d9b44a'], [-44, '#5f8a5a']] as [number, string][]) O('art', x - 0.4, -33.96, x + 0.4, -33.92, 1.55, 0, false, color);
  }

  // ---- building sites at the end of Harbour Road: fenced plot, cabin, brick pallet, the house going up
  for (const pl of PLOTS) {
    const sgn = pl.front === 'x1' ? 1 : -1; // +1: west plot (front faces +x), -1: east plot
    const r = pl.rect, fx = pl.front === 'x1' ? r.x1 : r.x0, bx = pl.front === 'x1' ? r.x0 : r.x1;
    const F = (x0: number, z0: number, x1: number, z1: number) => obstacles.push({ kind: 'site_fence', rect: { x0: Math.min(x0, x1), z0, x1: Math.max(x0, x1), z1 }, height: 2.0, solid: true });
    F(r.x0, r.z0 - 0.05, r.x1, r.z0 + 0.05);
    F(r.x0, r.z1 - 0.05, r.x1, r.z1 + 0.05);
    F(bx - 0.05, r.z0, bx + 0.05, r.z1);
    // the front, with a gate opening onto the pavement
    F(fx - 0.05, r.z0, fx + 0.05, 70.6);
    F(fx - 0.05, 72.6, fx + 0.05, r.z1);
    obstacles.push({ kind: 'site_house', rect: pl.house, height: 6, solid: true, rot: pl.front === 'x1' ? Math.PI / 2 : -Math.PI / 2 });
    const cab = { x0: bx + sgn * 0.2, x1: bx + sgn * 2.6 };
    obstacles.push({ kind: 'site_cabin', rect: { x0: Math.min(cab.x0, cab.x1), z0: 67.6, x1: Math.max(cab.x0, cab.x1), z1: 68.9 }, height: 2.5, solid: true });
    const pal = bx + sgn * 4.0;
    obstacles.push({ kind: 'site_pallet', rect: { x0: pal - 0.55, z0: 67.75, x1: pal + 0.55, z1: 68.7 }, height: 0.9, solid: true });
    obstacles.push({ kind: 'site_mixer', rect: { x0: Math.min(fx - sgn * 1.0, fx - sgn * 2.1), z0: 74.6, x1: Math.max(fx - sgn * 1.0, fx - sgn * 2.1), z1: 75.6 }, height: 1.4, solid: true });
    const cabX = (cab.x0 + cab.x1) / 2;
    add({ id: `${pl.id}_cabin`, kind: 'site_cabin', label: 'Site cabin (tools)', pos: { x: cabX, z: 69.6 }, facing: Math.PI, obj: { x: cabX, z: 68.3 }, locationId: 'outside', businessId: 'builders' });
    add({ id: `${pl.id}_pallet`, kind: 'site_pallet', label: 'Brick pallet', pos: { x: pal, z: 69.6 }, facing: Math.PI, obj: { x: pal, z: 68.2 }, locationId: 'outside', businessId: 'builders' });
    add({ id: `${pl.id}_work`, kind: 'site_work', label: `Building ${pl.name}`, pos: { x: fx - sgn * 1.0, z: 72.4 }, facing: -sgn * Math.PI / 2, obj: { x: pl.front === 'x1' ? pl.house.x1 : pl.house.x0, z: 72.4 }, locationId: 'outside', businessId: 'builders', range: 2.2 });
  }

  // ---- Dockside Unit 4 (player-leasable shop)
  for (const gx of [80.5, 84.5]) obstacles.push({ kind: 'gondola', rect: { x0: gx - 0.6, z0: 19, x1: gx + 0.6, z1: 29 }, height: 1.8, solid: true });
  for (const sct of U4_SECTIONS) add({ id: sct.id, kind: 'shelf', label: 'Shelf section', pos: { x: sct.gx - 1.15, z: sct.zc }, facing: Math.PI / 2, obj: { x: sct.gx, z: sct.zc }, locationId: 'unit4', businessId: 'unit4', container: sct.id });
  obstacles.push({ kind: 'counter', rect: { x0: 83, z0: 14.1, x1: 86, z1: 15.2 }, height: 1.0, solid: true });
  add({ id: 'u4_till', kind: 'till', label: 'Checkout', pos: { x: 84.5, z: 16.1 }, facing: Math.PI, obj: { x: 84.5, z: 14.6 }, locationId: 'unit4', businessId: 'unit4', range: 1.8 });
  U4_SECTIONS.forEach((sct, i) => {
    obstacles.push({ kind: 'pallet', rect: { x0: 92.9, z0: U4_PALLET_Z[i] - 0.6, x1: 93.75, z1: U4_PALLET_Z[i] + 0.6 }, height: 0.3, solid: true });
    add({ id: `u4_p${i + 1}`, kind: 'pallet', label: 'Stock pallet', pos: { x: 91.9, z: U4_PALLET_Z[i] }, facing: Math.PI / 2, obj: { x: 93.3, z: U4_PALLET_Z[i] }, locationId: 'unit4', businessId: 'unit4', container: 'unit4_backroom', shelf: sct.id });
  });
  obstacles.push({ kind: 'terminal', rect: { x0: 88.15, z0: 30.5, x1: 88.6, z1: 31.5 }, height: 1.4, solid: true });
  add({ id: 'u4_terminal', kind: 'terminal', label: 'Staff terminal', pos: { x: 89.4, z: 31 }, facing: -Math.PI / 2, obj: { x: 88.4, z: 31 }, locationId: 'unit4', businessId: 'unit4' });
  obstacles.push({ kind: 'cupboard', rect: { x0: 93.2, z0: 31.5, x1: 93.85, z1: 33.5 }, height: 2.0, solid: true });
  add({ id: 'u4_cupboard', kind: 'cupboard', label: 'Cleaning cupboard', pos: { x: 92.5, z: 32.5 }, facing: Math.PI / 2, obj: { x: 93.5, z: 32.5 }, locationId: 'unit4', businessId: 'unit4' });
  obstacles.push({ kind: 'baler', rect: { x0: 88.15, z0: 26.5, x1: 88.95, z1: 28.1 }, height: 1.9, solid: true, rot: Math.PI / 2 });
  add({ id: 'u4_baler', kind: 'baler', label: 'Cardboard baler', pos: { x: 89.8, z: 27.3 }, facing: -Math.PI / 2, obj: { x: 88.55, z: 27.3 }, locationId: 'unit4', businessId: 'unit4' });
  obstacles.push({ kind: 'shopbin', rect: { x0: 77.0, z0: 12.25, x1: 77.6, z1: 12.85 }, height: 0.95, solid: true });
  add({ id: 'u4_bin', kind: 'shopbin', label: 'Litter bin', pos: { x: 77.3, z: 13.6 }, facing: Math.PI, obj: { x: 77.3, z: 12.55 }, locationId: 'unit4', businessId: 'unit4' });
  obstacles.push({ kind: 'dumpster', rect: { x0: 92.65, z0: 10.65, x1: 93.95, z1: 11.75 }, height: 1.3, solid: true, rot: Math.PI });
  add({ id: 'u4_dumpster', kind: 'dumpster', label: 'Dumpster', pos: { x: 93.3, z: 9.7 }, facing: 0, obj: { x: 93.3, z: 11.2 }, locationId: 'outside', businessId: 'unit4', range: 1.8 });
  add({ id: 'u4_bay', kind: 'bay', label: 'Goods-in', pos: { x: 90.5, z: 10.8 }, facing: Math.PI, obj: { x: 90.5, z: 9.6 }, locationId: 'unit4', businessId: 'unit4', range: 2.2 });

  // ---- outdoor props
  const trees: Vec2[] = [
    { x: 46, z: 16 }, { x: 52, z: 30 }, { x: 64, z: 15 }, { x: 68, z: 35 }, { x: 44, z: 37 }, { x: 59, z: 26 },
    { x: -86, z: -2 + 46 }, { x: 30, z: 40 }, { x: 34, z: 56 }, { x: -30, z: 40 }, { x: -34, z: 58 }, { x: 26, z: 66 },
  ];
  for (const t of trees) obstacles.push({ kind: 'tree', rect: box(t.x, t.z, 0.6, 0.6), height: 5, solid: true });
  obstacles.push({ kind: 'bench', rect: box(50, 22, 2.0, 0.6), height: 0.5, solid: true });
  obstacles.push({ kind: 'bench', rect: box(62, 22, 2.0, 0.6), height: 0.5, solid: true });
  // Saturday market stalls (only open on market days; see streetmarket.ts)
  for (const st of STALLS) add({ id: st.id, kind: 'stall', label: st.label, pos: st.pos, facing: 0, obj: st.obj, locationId: 'park', product: st.product, range: 1.8 });
  add({ id: 'bench_1', kind: 'bench', label: 'Park bench', pos: { x: 50, z: 22.9 }, facing: Math.PI, obj: { x: 50, z: 22 }, locationId: 'park' });
  add({ id: 'bench_2', kind: 'bench', label: 'Park bench', pos: { x: 62, z: 22.9 }, facing: Math.PI, obj: { x: 62, z: 22 }, locationId: 'park' });
  obstacles.push({ kind: 'busstop', rect: box(-86, -8.6, 3, 0.8), height: 2.5, solid: true });
  obstacles.push({ kind: 'busstop', rect: box(86, 8.6, 3, 0.8), height: 2.5, solid: true });
  for (const [bx, bz] of [[10, -9], [-10, 9], [40, 8.6]]) obstacles.push({ kind: 'bin', rect: box(bx, bz, 0.6, 0.6), height: 1, solid: true });

  const lamps: Vec2[] = [];
  for (const x of [-84, -60, -36, -12, 12, 36, 60, 84]) lamps.push({ x, z: -7.6 });
  for (const x of [-78, -36, -12, 12, 34, 72]) lamps.push({ x, z: 7.6 });
  for (const z of [20, 36, 52, 68]) lamps.push({ x: -7.6, z });
  for (const z of [28, 44, 60]) lamps.push({ x: 7.6, z });
  lamps.push({ x: 7.6, z: -24 });
  for (const l of lamps) obstacles.push({ kind: 'lamp', rect: box(l.x, l.z, 0.25, 0.25), height: 5, solid: true });

  // kerbside parking (lane centre 4.0 m from the road centre, clear of the van's 2.5 m line and of crossings)
  const E = Math.PI / 2, W = -Math.PI / 2;
  const parked = [
    { pos: { x: 30, z: 4 }, rot: E, color: '#b03a2e' },
    { pos: { x: 36, z: 4 }, rot: E, color: '#e5e7e9' },
    { pos: { x: 44, z: 4 }, rot: E, color: '#1b2631' },
    { pos: { x: -40, z: 4 }, rot: E, color: '#7d3c98' },
    { pos: { x: -46, z: 4 }, rot: E, color: '#a6acaf' },
    { pos: { x: -60, z: -4 }, rot: W, color: '#2e86c1' },
    { pos: { x: -32, z: -4 }, rot: W, color: '#f0f3f4' },
    { pos: { x: -15, z: -4 }, rot: W, color: '#943126' },
    { pos: { x: 26, z: -4 }, rot: W, color: '#212f3d' },
    { pos: { x: 64, z: -4 }, rot: W, color: '#d4ac0d' },
    { pos: { x: 72, z: -4 }, rot: W, color: '#5d6d7e' },
    { pos: { x: 4, z: 44 }, rot: 0, color: '#717d7e' },
    { pos: { x: 4, z: 26 }, rot: 0, color: '#c0392b' },
    { pos: { x: -4, z: 58 }, rot: Math.PI, color: '#1e8449' },
  ];
  for (const p of parked) obstacles.push({ kind: 'car', rect: p.rot === 0 || p.rot === Math.PI ? box(p.pos.x, p.pos.z, 1.9, 4.2) : box(p.pos.x, p.pos.z, 4.2, 1.9), height: 1.5, solid: true, color: p.color });

  // ---- colliders
  const colliders: Rect[] = [];
  for (const b of B) {
    if (b.unit) continue; // walled by the storey around it
    if (b.interior) colliders.push(...wallsFor(b));
    else colliders.push(b.rect);
  }
  for (const o of obstacles) if (o.solid) colliders.push(o.rect);
  // the city round about: its buildings, and the containers on the docks
  const city = buildCity(B.filter((b) => !b.unit && !b.level).map((b) => b.rect));
  for (const cb of city.buildings) colliders.push(cb.rect);
  for (const pr of city.props) if (pr.kind === 'container') colliders.push(pr.rot === 0 ? box(pr.x, pr.z, 6.1, 2.5) : box(pr.x, pr.z, 2.5, 6.1));
  // world boundary: the edge of the city, and the sea
  const bounds = { x0: CITY.x0, z0: CITY.z0, x1: CITY.x1, z1: QUAY_EDGE - 0.4 };
  colliders.push({ x0: bounds.x0 - 1, z0: bounds.z0, x1: bounds.x0, z1: bounds.z1 });
  colliders.push({ x0: bounds.x1, z0: bounds.z0, x1: bounds.x1 + 1, z1: bounds.z1 });
  colliders.push({ x0: bounds.x0, z0: bounds.z0 - 1, x1: bounds.x1, z1: bounds.z0 });
  colliders.push({ x0: bounds.x0, z0: bounds.z1, x1: bounds.x1, z1: bounds.z1 + 1 });

  const cgrid = colliderGrid(colliders);
  const near = (x0: number, z0: number, x1: number, z1: number) => collidersIn(x0, z0, x1, z1, { grid: cgrid } as World);

  // ---- pedestrian navigation graph
  const nodes: Record<string, NavNode> = {};
  const edges: Record<string, string[]> = {};
  const N = (id: string, x: number, z: number, loc = 'outside') => {
    nodes[id] = { id, x, z, loc };
    edges[id] = edges[id] ?? [];
  };
  const L = (...ids: string[]) => {
    for (let i = 0; i < ids.length - 1; i++) {
      const a = ids[i], b = ids[i + 1];
      if (!edges[a].includes(b)) edges[a].push(b);
      if (!edges[b].includes(a)) edges[b].push(a);
    }
  };
  // the city's pavements and crossings
  for (const n of city.nodes) N(n.id, n.x, n.z);
  for (const [a, b] of city.edges) L(a, b);
  // into each venue: off the pavement, through the door, and round the inside
  {
    const clearV = (a: Vec2, b: Vec2) => !near(Math.min(a.x, b.x) - 1, Math.min(a.z, b.z) - 1, Math.max(a.x, b.x) + 1, Math.max(a.z, b.z) + 1).some((r) => segIntersectsRect(a, b, r, 0.2));
    for (const v of venues) {
      N(`door_${v.id}`, v.outside.x, v.outside.z); N(`in_${v.id}`, v.inside.x, v.inside.z, v.id);
      // the prison gate is locked: no way in or out on foot
      if (v.kind !== 'prison') L(`door_${v.id}`, `in_${v.id}`);
      // the pavement's corner nodes either side along this street
      const row = city.nodes.filter((n) => Math.abs(n.z - v.outside.z) < 1.2 && Math.abs(n.x - v.outside.x) < 135);
      const west = row.filter((n) => n.x < v.outside.x).sort((a, b) => b.x - a.x)[0], east = row.filter((n) => n.x > v.outside.x).sort((a, b) => a.x - b.x)[0];
      if (v.path) {
        // a landmark's front path down to the pavement, and along it to the corners
        N(`walk_${v.id}`, v.path.x, v.path.z);
        L(`door_${v.id}`, `walk_${v.id}`);
        const prow = city.nodes.filter((n) => Math.abs(n.z - v.path!.z) < 1.2 && Math.abs(n.x - v.path!.x) < 135);
        for (const c of [prow.filter((n) => n.x < v.path!.x).sort((a, b) => b.x - a.x)[0], prow.filter((n) => n.x > v.path!.x).sort((a, b) => a.x - b.x)[0]]) if (c) L(`walk_${v.id}`, c.id);
      } else for (const c of [west, east]) if (c && clearV(c, v.outside)) L(`door_${v.id}`, c.id);
      // a walking grid over the floor (the aisles between the shelves and machines), joined up
      const r0 = v.rect, step = (r0.x1 - r0.x0) * (r0.z1 - r0.z0) > 900 ? 1.8 : 1.1, grid: string[] = [];
      const blocked = (x: number, z: number) => near(x - 1, z - 1, x + 1, z + 1).some((r) => x > r.x0 - 0.3 && x < r.x1 + 0.3 && z > r.z0 - 0.3 && z < r.z1 + 0.3);
      for (let i = 0; r0.x0 + 0.55 + i * step < r0.x1 - 0.3; i++) for (let j = 0; r0.z0 + 0.55 + j * step < r0.z1 - 0.3; j++) {
        const x = r0.x0 + 0.55 + i * step, z = r0.z0 + 0.55 + j * step;
        if (blocked(x, z)) continue;
        const id = `${v.id}_g${i}_${j}`; N(id, x, z, v.id); grid.push(id);
        for (const [di, dj] of [[-1, 0], [0, -1], [-1, -1], [1, -1]]) { const o = `${v.id}_g${i + di}_${j + dj}`; if (nodes[o] && clearV(nodes[o], nodes[id])) L(o, id); }
      }
      const join = (id: string) => {
        const nd = nodes[id];
        const cands = grid.map((g) => ({ g, d: Math.hypot(nodes[g].x - nd.x, nodes[g].z - nd.z) })).filter((c) => c.d < 2.4).sort((p1, p2) => p1.d - p2.d);
        let k = 0; for (const c of cands) { if (k >= 2) break; if (clearV(nd, nodes[c.g])) { L(id, c.g); k++; } }
      };
      join(`in_${v.id}`);
      v.nodes.forEach((p, i) => { if (blocked(p.x, p.z)) return; N(`${v.id}_n${i}`, p.x, p.z, v.id); join(`${v.id}_n${i}`); });
      for (const sp of v.spots) { N(`${sp.id}_at`, sp.pos.x, sp.pos.z, v.id); join(`${sp.id}_at`); }
      // floor cut off behind counters and fittings is not part of the walking graph
      const seen = new Set<string>([`in_${v.id}`]), q = [`in_${v.id}`];
      while (q.length) { const x = q.pop()!; for (const y of edges[x] ?? []) if (!seen.has(y)) { seen.add(y); q.push(y); } }
      for (const g of grid) if (!seen.has(g)) { for (const y of edges[g] ?? []) edges[y] = edges[y].filter((z) => z !== g); delete edges[g]; delete nodes[g]; }
    }
  }
  // north sidewalk (z=-6.5)
  const nS = [-88, -70, -50, -24, -6.5];
  nS.forEach((x) => N(`nw_${x}`, x, -6.5));
  L(...nS.map((x) => `nw_${x}`));
  const nE = [6.5, 17.5, 30, 57, 88];
  nE.forEach((x) => N(`ne_${x}`, x, -6.5));
  L(...nE.map((x) => `ne_${x}`));
  const sW = [-88, -70, -53, -43, -24, -6.5];
  sW.forEach((x) => N(`sw_${x}`, x, 6.5));
  L(...sW.map((x) => `sw_${x}`));
  const sE = [6.5, 16, 27, 40, 56, 80.5, 88];
  sE.forEach((x) => N(`se_${x}`, x, 6.5));
  L(...sE.map((x) => `se_${x}`));
  // crossings around the junction
  L('nw_-6.5', 'ne_6.5');
  L('sw_-6.5', 'se_6.5');
  L('nw_-6.5', 'sw_-6.5');
  L('ne_6.5', 'se_6.5');
  // mid-block crossings of Main Street
  L('nw_-24', 'sw_-24');
  L('ne_17.5', 'se_16');
  L('nw_-70', 'sw_-70');
  L('ne_57', 'se_56');
  // Harbour Road north, east sidewalk to back lane
  N('hn_e_25', 6.5, -25); N('hn_e_38', 6.5, -38);
  L('ne_6.5', 'hn_e_25', 'hn_e_38');
  N('hn_w_25', -6.5, -25); N('nend', -6.5, -46);
  L('nw_-6.5', 'hn_w_25', 'nend');
  // Harbour Road south sidewalks with house doors
  let prevE = 'se_6.5', prevW = 'sw_-6.5';
  hi = 0;
  for (const zc of houseZ) {
    N(`hs_e_${zc}`, 6.5, zc); N(`hs_w_${zc}`, -6.5, zc);
    L(prevE, `hs_e_${zc}`); L(prevW, `hs_w_${zc}`);
    prevE = `hs_e_${zc}`; prevW = `hs_w_${zc}`;
    hi++;
    N(`door_house_${hi}`, 9.3, zc, `house_${hi}`); L(`hs_e_${zc}`, `door_house_${hi}`);
    N(`in_house_${hi}`, 11.2, zc, `house_${hi}`); L(`door_house_${hi}`, `in_house_${hi}`);
    hi++;
    N(`door_house_${hi}`, -9.3, zc, `house_${hi}`); L(`hs_w_${zc}`, `door_house_${hi}`);
    N(`in_house_${hi}`, -11.2, zc, `house_${hi}`); L(`door_house_${hi}`, `in_house_${hi}`);
  }
  N('hs_e_72', 6.5, 72); N('hs_w_72', -6.5, 72);
  L(prevE, 'hs_e_72'); L(prevW, 'hs_w_72'); L('hs_e_72', 'hs_w_72');
  // along the quay, and out to the fishing spots at the edge
  N('q_c', 0, 82); N('q_w', -30, 82); N('q_e', 30, 82); N('q_ww', -52, 82); N('q_ee', 52, 82);
  L('hs_e_72', 'q_c'); L('hs_w_72', 'q_c'); L('q_ww', 'q_w', 'q_c', 'q_e', 'q_ee');
  for (const f of FISH_SPOTS) { N(`q_${f.id}`, f.x, QUAY_EDGE - 1.6); L(`q_${f.id}`, f.x < -15 ? 'q_w' : f.x > 15 ? 'q_e' : 'q_c'); }
  N('q_boat', 24, QUAY_EDGE - 1.6); L('q_boat', 'q_e');
  // to The Anchor, and about inside it
  N('pub_out', 62.4, 78.1); N('pub_in', 66, 78.1, 'pub'); N('pub_bar', 75.4, 79, 'pub'); N('pub_mid', 70, 78.1, 'pub'); N('pub_darts', 74, 83.2, 'pub'); N('pub_t', 69.5, 76.8, 'pub');
  L('q_ee', 'pub_out', 'pub_in', 'pub_mid', 'pub_bar'); L('pub_mid', 'pub_darts'); L('pub_mid', 'pub_t');
  // to the dog rescue, up the east side of the park
  N('res_a', 73, 10); N('res_b', 73, 40); N('res_out', 73.6, 53.1); N('res_in', 78, 53.1, 'rescue'); N('res_desk', 80.6, 50.4, 'rescue'); N('res_k', 84.6, 53.1, 'rescue');
  L('se_56', 'res_a', 'res_b', 'res_out', 'res_in', 'res_k'); L('res_in', 'res_desk'); N('res_pub', 63, 68); L('res_out', 'res_pub', 'pub_out');
  N('q_bait', BAIT_HUT.x, BAIT_HUT.z - 2.2); N('q_bait_c', BAIT_HUT.x + 4, BAIT_HUT.z - 2.2); L('q_bait', 'q_bait_c', 'q_w');

  // Corner Market: front door + interior
  N('mk_out', 17.5, -8.6); N('mk_in', 17.5, -11.4, 'market');
  L('ne_17.5', 'mk_out', 'mk_in');
  const aisleX = [14.5, 19.5, 24.5, 29.5, 34.3];
  for (const ax of aisleX) {
    N(`mk_f_${ax}`, ax, -15.5, 'market');
    N(`mk_m_${ax}`, ax, -21.5, 'market');
    N(`mk_r_${ax}`, ax, -27, 'market');
    L(`mk_f_${ax}`, `mk_m_${ax}`, `mk_r_${ax}`);
  }
  for (let i = 0; i < aisleX.length - 1; i++) {
    L(`mk_f_${aisleX[i]}`, `mk_f_${aisleX[i + 1]}`);
    L(`mk_r_${aisleX[i]}`, `mk_r_${aisleX[i + 1]}`);
  }
  L('mk_in', 'mk_f_14.5');
  L('mk_in', 'mk_f_19.5');
  N('mk_kiosk', 13.9, -13, 'market'); L('mk_in', 'mk_kiosk');
  N('mk_till', 22, -15.1, 'market'); L('mk_f_19.5', 'mk_till', 'mk_f_24.5');
  QUEUE_SLOTS.forEach((q, i) => N(`mk_q${i}`, q.x, q.z, 'market'));
  for (let i = 0; i < QUEUE_SLOTS.length - 1; i++) L(`mk_q${i}`, `mk_q${i + 1}`);
  L('mk_q0', 'mk_in');
  L('mk_f_29.5', 'mk_q3');
  L('mk_f_34.3', 'mk_q5');
  // shelf anchors become graph leaves from their aisle
  for (const s of SHELF_LAYOUT) {
    const it = I[`shelf_${s.product}`];
    const ax = aisleX.reduce((best, x) => (Math.abs(x - it.pos.x) < Math.abs(best - it.pos.x) ? x : best), aisleX[0]);
    N(`mk_shelf_${s.product}`, it.pos.x, it.pos.z, 'market');
    L(`mk_m_${ax}`, `mk_shelf_${s.product}`);
  }
  // backroom
  N('mk_bd1', 32, -27, 'market'); N('mk_bd2', 32, -29.4, 'market');
  L('mk_r_29.5', 'mk_bd1', 'mk_r_34.3'); L('mk_bd1', 'mk_bd2');
  const rowX = [13.5, 16, 18.5, 21, 24, 27, 29.5, 32, 34.5];
  rowX.forEach((x) => N(`mk_b_${x}`, x, -31.8, 'market'));
  L(...rowX.map((x) => `mk_b_${x}`));
  L('mk_bd2', 'mk_b_32');
  PRODUCTS.forEach((p, i) => { N(`mk_pallet_${p}`, PALLET_X[i], -33.6, 'market'); L(`mk_b_${PALLET_X[i]}`, `mk_pallet_${p}`); });
  N('mk_terminal', 13.1, -29.4, 'market'); L('mk_b_13.5', 'mk_terminal');
  N('mk_cupboard', 34.5, -30, 'market'); L('mk_b_34.5', 'mk_cupboard');
  N('mk_rd_in', 24, -34.8, 'market'); N('mk_bay', 24, -37.4, 'outside');
  L('mk_b_24', 'mk_rd_in', 'mk_bay', 'hn_e_38');
  N('mk_baler', 16.7, -29.8, 'market'); L('mk_b_16', 'mk_baler');
  N('mk_bin', 14.9, -11.6, 'market'); L('mk_in', 'mk_bin', 'mk_kiosk');
  N('mk_dump', 30.5, -38.1, 'outside'); L('mk_bay', 'mk_dump');

  // Dockside Unit 4
  N('u4_out', 80.5, 9.8); N('u4_in', 80.5, 13.4, 'unit4');
  L('se_80.5', 'u4_out', 'u4_in');
  N('u4_f1', 78.3, 17.5, 'unit4'); N('u4_f2', 82.5, 17.5, 'unit4'); N('u4_f3', 86.5, 17.5, 'unit4');
  N('u4_r1', 78.3, 30.5, 'unit4'); N('u4_r2', 82.5, 30.5, 'unit4'); N('u4_r3', 86.5, 30.5, 'unit4');
  N('u4_m1', 78.3, 24, 'unit4'); N('u4_m2', 82.5, 24, 'unit4'); N('u4_m3', 86.5, 24, 'unit4');
  L('u4_in', 'u4_f1'); L('u4_in', 'u4_f2'); L('u4_f1', 'u4_f2', 'u4_f3'); L('u4_r1', 'u4_r2', 'u4_r3');
  L('u4_f1', 'u4_m1', 'u4_r1'); L('u4_f2', 'u4_m2', 'u4_r2'); L('u4_f3', 'u4_m3', 'u4_r3');
  N('u4_till', 84.5, 16.1, 'unit4'); L('u4_f2', 'u4_till', 'u4_f3');
  U4_QUEUE.forEach((q, i) => N(`u4_q${i}`, q.x, q.z, 'unit4'));
  L('u4_q0', 'u4_q1', 'u4_q2'); L('u4_q0', 'u4_in'); L('u4_q2', 'u4_f3');
  for (const sct of U4_SECTIONS) { N(`u4_sh_${sct.id}`, sct.gx - 1.15, sct.zc, 'unit4'); L(sct.gx < 82 ? 'u4_m1' : 'u4_m2', `u4_sh_${sct.id}`); }
  N('u4_door_in', 89.5, 17.2, 'unit4'); L('u4_f3', 'u4_door_in');
  N('u4_b1', 91, 17.2, 'unit4'); N('u4_b2', 91, 31, 'unit4'); L('u4_door_in', 'u4_b1');
  U4_PALLET_Z.forEach((z, i) => { N(`u4_pal${i}`, 91.9, z, 'unit4'); });
  L('u4_b1', 'u4_pal0', 'u4_pal1', 'u4_pal2', 'u4_pal3', 'u4_b2');
  N('u4_term', 89.4, 31, 'unit4'); N('u4_cup', 92.5, 32.5, 'unit4'); L('u4_b2', 'u4_term'); L('u4_b2', 'u4_cup');
  N('u4_goods_in', 90.5, 13.4, 'unit4'); N('u4_goods_out', 90.5, 10.8);
  L('u4_b1', 'u4_goods_in', 'u4_goods_out', 'se_88');
  N('u4_baler', 89.8, 27.3, 'unit4'); L('u4_pal3', 'u4_baler');
  N('u4_bin', 77.3, 13.6, 'unit4'); L('u4_in', 'u4_bin');
  N('u4_dump', 93.3, 9.7); L('u4_goods_out', 'u4_dump');

  // Job centre
  N('jc_out', -24, -8.6); N('jc_in', -24, -11.6, 'jobcentre'); N('jc_board', -24, -26.3, 'jobcentre'); N('jc_adv', -31, -17.6, 'jobcentre');
  N('jc_desk_back', -31, -21.4, 'jobcentre');
  L('nw_-24', 'jc_out', 'jc_in', 'jc_board'); L('jc_in', 'jc_adv');
  N('jc_mid', -26, -23, 'jobcentre'); L('jc_board', 'jc_mid', 'jc_desk_back');
  N('jc_train', -32.4, -24.2, 'jobcentre'); L('jc_mid', 'jc_train');
  // Cafe
  N('cf_out', -24, 8.6); N('cf_in', -24, 11.6, 'cafe'); N('cf_counter', -24, 18.8, 'cafe'); N('cf_back', -24, 23, 'cafe');
  N('cf_seat_1', -31, 12.6, 'cafe'); N('cf_seat_2', -17, 12.6, 'cafe');
  N('cf_t2_a', -15.4, 12.6, 'cafe'); N('cf_t2_b', -15.4, 15.75, 'cafe'); N('cf_t2_far', -17, 15.75, 'cafe'); L('cf_seat_2', 'cf_t2_a', 'cf_t2_b', 'cf_t2_far');
  L('sw_-24', 'cf_out', 'cf_in', 'cf_counter'); L('cf_in', 'cf_seat_1'); L('cf_in', 'cf_seat_2');
  N('cf_side', -31.5, 18.5, 'cafe'); L('cf_counter', 'cf_side');
  N('cf_m_a', -32.7, 12.6, 'cafe'); N('cf_m_b', -32.7, 15.75, 'cafe'); N('cf_meet_far', -31, 15.75, 'cafe'); L('cf_seat_1', 'cf_m_a', 'cf_m_b', 'cf_meet_far');
  N('cf_kitchen', -31.5, 23, 'cafe'); L('cf_side', 'cf_kitchen', 'cf_back');
  N('cf_term', -32.8, 22, 'cafe'); L('cf_kitchen', 'cf_term');
  N('cf_grill', -26, 24.4, 'cafe'); L('cf_back', 'cf_grill'); L('cf_kitchen', 'cf_grill');
  N('cf_pass', -24, 21.3, 'cafe'); L('cf_back', 'cf_pass');
  // the police station: front door, round the end of the counter to the staff door, custody and office
  N('pol_out', 57, -9.5); N('pol_in', 57, -14, 'police'); N('pol_desk', 56, -16.3, 'police'); N('pol_end', 64.5, -16.3, 'police'); N('pol_staff', 64.5, -20.3, 'police');
  N('pol_hall', 60, -21.5, 'police'); N('pol_door', 56.15, -22.4, 'police'); N('pol_cust', 53, -22.4, 'police'); N('pol_cells', 50, -29.8, 'police');
  N('pol_office', 61, -30.5, 'police'); N('pol_board', 62, -36.3, 'police'); N('pol_term', 68.6, -24, 'police');
  L('ne_57', 'pol_out', 'pol_in', 'pol_desk'); N('pol_c2', 54.8, -24.0, 'police'); N('pol_c3', 54.8, -27.8, 'police');
  L('pol_in', 'pol_end', 'pol_staff', 'pol_hall', 'pol_door', 'pol_cust', 'pol_c2', 'pol_c3', 'pol_cells');
  L('pol_hall', 'pol_office', 'pol_board'); L('pol_hall', 'pol_term');
  for (const [i, x] of [46.0, 50.0, 54.0].entries()) { N(`cell_in_${i + 1}`, x, -34.5, 'police'); N(`cell_front_${i + 1}`, x, -29.8, 'police'); L('pol_cells', `cell_front_${i + 1}`, `cell_in_${i + 1}`); }
  // Marlow Court: in at the street door, the lobby, and the stairs up through every floor
  N('fl_out', 16, 8.6); N('fl_in', 16, 11.0, 'marlow');
  L('se_16', 'fl_out', 'fl_in');
  for (let k = 0; k < 4; k++) {
    const X = k * LEVEL_DX, loc = k === 2 ? 'mc_2h' : MARLOW_LEVELS[k];
    // front and back landings either side of the stair core, joined by the aisle beside it
    N(`st${k}_fa`, X + 12.8, 10.75, loc); N(`st${k}_fb`, X + 14.1, 10.75, loc); N(`st${k}_af`, X + 15.6, 10.9, loc);
    N(`st${k}_ba`, X + 12.8, 17.1, loc); N(`st${k}_bb`, X + 14.1, 17.1, loc); N(`st${k}_ab`, X + 15.6, 17.1, loc);
    L(`st${k}_fa`, `st${k}_fb`, `st${k}_af`, `st${k}_ab`, `st${k}_bb`, `st${k}_ba`);
    if (k !== 2) { N(`mc${k}_c`, X + 18.0, 14.2, loc); L(`st${k}_af`, `mc${k}_c`, `st${k}_ab`); }
  }
  // the flights: up from the front landing on the ground and second floors, from the back on the first
  for (const [a, b] of FLIGHTS) L(a, b);
  L('fl_in', 'st0_af'); L('fl_in', 'mc0_c');
  for (const u of FLAT_UNITS) {
    const X = u.level * LEVEL_DX;
    N(`door_${u.id}`, u.doorPos.x, u.doorPos.z, MARLOW_LEVELS[u.level]); N(`in_${u.id}`, u.inPos.x, u.inPos.z, u.id);
    L(`mc${u.level}_c`, `door_${u.id}`, `in_${u.id}`);
    if (u.side === 'a') { N(`${u.id}_m`, X + 17.0, 24.6, u.id); N(`${u.id}_t`, X + 13.8, 24.6, u.id); N(`${u.id}_bed`, X + 13.8, 21.4, u.id); N(`${u.id}_v`, X + 20.1, 19.0, u.id); L(`in_${u.id}`, `${u.id}_m`, `${u.id}_t`, `${u.id}_bed`); L(`in_${u.id}`, `${u.id}_v`); }
    else { N(`${u.id}_m`, X + 26.5, 17.0, u.id); N(`${u.id}_o`, X + 27.0, 21.75, u.id); N(`${u.id}_bed`, X + 25.0, 23.0, u.id); N(`${u.id}_v`, X + 22.9, 22.6, u.id); L(`in_${u.id}`, `${u.id}_m`, `${u.id}_o`, `${u.id}_bed`, `${u.id}_v`); }
  }
  // your flat, off the second-floor stair hall
  {
    const F = (x: number) => x + 2 * LEVEL_DX;
    N('fl_door_o', F(15.6), 15.6, 'mc_2h'); N('fl_door_i', F(17.2), 15.6, 'flat');
    N('fl_c', F(21.0), 15.6, 'flat'); N('fl_k', F(17.2), 20.8, 'flat'); N('fl_bed', F(24.1), 19.5, 'flat'); N('fl_bath', F(27.3), 15.35, 'flat');
    N('fl_study', F(19.6), 11.8, 'flat'); N('fl_util', F(25.5), 11.8, 'flat');
    N('fl_sd', F(19.0), 13.45, 'flat'); N('fl_ud', F(24.5), 13.45, 'flat'); N('fl_bd', F(24.1), 17.75, 'flat'); N('fl_bad', F(25.85), 15.35, 'flat');
    N('fl_sdi', F(19.0), 14.4, 'flat'); N('fl_udi', F(24.5), 14.4, 'flat'); N('fl_bdi', F(24.1), 16.6, 'flat');
    L('st2_af', 'fl_door_o', 'st2_ab'); L('fl_door_o', 'fl_door_i', 'fl_c', 'fl_bdi', 'fl_bd', 'fl_bed'); L('fl_door_i', 'fl_k');
    L('fl_c', 'fl_sdi', 'fl_sd', 'fl_study'); L('fl_c', 'fl_udi', 'fl_ud', 'fl_util'); L('fl_c', 'fl_bad', 'fl_bath');
  }
  // designed furniture: a node in front of each thing you use, linked to its room's hub
  // the home's furniture changes with its design, so its floor gets a fine walking grid: every free
  // spot links to its neighbours, and fixed nodes and the designed furniture's stand points join it
  {
    const H = shiftX({ x0: 12.2, z0: 10.2, x1: 29.8, z1: 25.8 }, 2 * LEVEL_DX);
    const step = 0.6;
    const blocked = (x: number, z: number) => near(x - 1, z - 1, x + 1, z + 1).some((r) => x > r.x0 - 0.28 && x < r.x1 + 0.28 && z > r.z0 - 0.28 && z < r.z1 + 0.28);
    const clear = (a: Vec2, b: Vec2) => !near(Math.min(a.x, b.x) - 1, Math.min(a.z, b.z) - 1, Math.max(a.x, b.x) + 1, Math.max(a.z, b.z) + 1).some((r) => segIntersectsRect(a, b, r, 0.2));
    const grid: string[] = [];
    for (let i = 0; H.x0 + 0.3 + i * step < H.x1; i++) for (let j = 0; H.z0 + 0.3 + j * step < H.z1; j++) {
      const x = H.x0 + 0.3 + i * step, z = H.z0 + 0.3 + j * step;
      if (blocked(x, z)) continue;
      // the stair hall is not part of the flat
      if (x < 2 * LEVEL_DX + 16.55 && z < 18.05) continue;
      const id = `flg_${i}_${j}`;
      N(id, x, z, 'flat');
      grid.push(id);
    }
    for (let a = 0; a < grid.length; a++) for (let b = a + 1; b < grid.length; b++) {
      const A = nodes[grid[a]], B = nodes[grid[b]];
      const d = Math.hypot(A.x - B.x, A.z - B.z);
      if (d < step * 1.5 && clear(A, B)) L(grid[a], grid[b]);
    }
    for (const hn of homeNodes) N(hn.id, hn.pos.x, hn.pos.z, 'flat');
    const joiners = [...homeNodes.map((h) => h.id), 'fl_door_i', 'fl_c', 'fl_k', 'fl_bed', 'fl_bath', 'fl_study', 'fl_util'];
    for (const id of joiners) {
      const nd = nodes[id];
      if (!nd) continue;
      const near = grid.map((g) => ({ g, d: Math.hypot(nodes[g].x - nd.x, nodes[g].z - nd.z) })).filter((c) => c.d < 1.6).sort((p1, p2) => p1.d - p2.d);
      let linked = 0;
      for (const c of near) { if (linked >= 3) break; if (clear(nd, nodes[c.g])) { L(id, c.g); linked++; } }
    }
    // pockets of floor cut off behind furniture are not part of the walking graph
    const seen = new Set<string>(['fl_door_i']);
    const q = ['fl_door_i'];
    while (q.length) { const a = q.pop()!; for (const b of edges[a] ?? []) if (!seen.has(b)) { seen.add(b); q.push(b); } }
    for (const g of grid) if (!seen.has(g)) {
      for (const b of edges[g] ?? []) edges[b] = edges[b].filter((x) => x !== g);
      delete edges[g];
      delete nodes[g];
    }
  }
  // Harbour Home: in through the door, down the aisle to the counter
  N('hh_out', -51, -9.0); N('hh_in', -51, -13.2, 'homestore'); N('hh_mid', -51, -22, 'homestore'); N('hh_counter', -51, -30.6, 'homestore');
  L('nw_-50', 'hh_out', 'hh_in', 'hh_mid', 'hh_counter');
  // staff go round the end of the counter to stand behind it
  N('hh_side', -47.6, -30.6, 'homestore'); N('hh_side_back', -47.6, -33.45, 'homestore'); N('hh_staff', -51, -33.45, 'homestore');
  L('hh_counter', 'hh_side', 'hh_side_back', 'hh_staff');
  N('hh_term_a', -55.5, -30.6, 'homestore'); N('hh_term', -55.5, -33.0, 'homestore'); L('hh_counter', 'hh_term_a', 'hh_term');
  // building sites: through the gate to the front of the house, and round to the yard
  for (const pl of PLOTS) {
    const sgn = pl.front === 'x1' ? 1 : -1, fx = pl.front === 'x1' ? pl.rect.x1 : pl.rect.x0, bx = pl.front === 'x1' ? pl.rect.x0 : pl.rect.x1;
    const side = pl.front === 'x1' ? 'w' : 'e';
    N(`${pl.id}_gate`, fx - sgn * 0.4, 71.6, 'outside'); L(`hs_${side}_72`, `${pl.id}_gate`);
    N(`${pl.id}_worknode`, fx - sgn * 1.0, 72.4, 'outside'); L(`${pl.id}_gate`, `${pl.id}_worknode`);
    N(`${pl.id}_yard`, fx - sgn * 2.4, 69.6, 'outside'); L(`${pl.id}_gate`, `${pl.id}_yard`);
    N(`${pl.id}_palnode`, bx + sgn * 4.0, 69.6, 'outside'); N(`${pl.id}_cabnode`, bx + sgn * 1.4, 69.6, 'outside');
    L(`${pl.id}_yard`, `${pl.id}_palnode`, `${pl.id}_cabnode`);
  }
  // Wholesale staff door, and the warehouse floor: front aisle, middle aisle, staging lanes
  N('door_wholesale', -43, 13.3); L('sw_-43', 'door_wholesale');
  N('wh_in', -43, 15.4, 'wholesale'); L('door_wholesale', 'wh_in');
  N('wh_term', -41.4, 17, 'wholesale'); L('wh_in', 'wh_term');
  N('wh_stage', -54, 18.6, 'wholesale'); N('wh_east_s', -44, 18.6, 'wholesale'); L('wh_in', 'wh_east_s', 'wh_stage');
  const bayX = Array.from({ length: WH_BAYS }, (_, k) => WH_X0 + WH_BAY / 2 + k * WH_BAY);
  bayX.forEach((x, k) => { N(`wh_fa_${k}`, x, WH_ROW_A - 1.6, 'wholesale'); N(`wh_ma_${k}`, x, (WH_ROW_A + 1.1 + WH_ROW_B) / 2, 'wholesale'); });
  N('wh_fa_e', -43.5, WH_ROW_A - 1.6, 'wholesale'); N('wh_ma_e', -43.5, (WH_ROW_A + 1.1 + WH_ROW_B) / 2, 'wholesale');
  L(...bayX.map((_, k) => `wh_fa_${k}`), 'wh_fa_e'); L(...bayX.map((_, k) => `wh_ma_${k}`), 'wh_ma_e');
  L('wh_east_s', 'wh_fa_e', 'wh_ma_e'); L('wh_stage', 'wh_fa_3'); L('wh_stage', 'wh_fa_4');
  WH_PRODUCTS.forEach((p, i) => { const k = i < 5 ? i : i - 5; N(`wh_pick_${p}`, bayX[k], (i < 5 ? WH_ROW_A : WH_ROW_B) - 0.85, 'wholesale'); L(i < 5 ? `wh_fa_${k}` : `wh_ma_${k}`, `wh_pick_${p}`); });
  // Park
  N('pk_gate', 56, 10.5, 'park'); N('pk_a', 52, 25, 'park'); N('pk_b', 62, 26, 'park'); N('pk_c', 56, 32, 'park');
  N('pk_bench_1', 50, 22.9, 'park'); N('pk_bench_2', 62, 22.9, 'park');
  for (const st of STALLS) N(`mk_${st.id}`, st.pos.x, st.pos.z, 'park');
  L('pk_gate', 'mk_stall_veg'); L('pk_gate', 'mk_stall_bread', 'mk_stall_coffee', 'pk_b');
  L('se_56', 'pk_gate', 'pk_a', 'pk_c', 'pk_b', 'pk_gate'); L('pk_a', 'pk_bench_1'); L('pk_b', 'pk_bench_2');
  // bus stops (commute / ambient spawn)
  N('bus_w', -88, -6.5 + 0.01); L('nw_-88', 'bus_w');
  N('bus_e', 88, 6.6); L('se_88', 'bus_e');

  for (const [a, b] of city.joins) if (nodes[a] && nodes[b]) L(a, b);
  // (the hospital, like the other landmarks, is a venue with its own front path)

  // ---- roads & ground
  const roads: RoadDef[] = [
    { rect: { x0: -98, z0: -5, x1: 98, z1: 5 }, kind: 'road' },
    { rect: { x0: -5, z0: -48, x1: 5, z1: 76 }, kind: 'road' },
    { rect: { x0: 5, z0: -46, x1: 45, z1: -40 }, kind: 'lane' },
    { rect: { x0: -98, z0: -8, x1: 98, z1: -5 }, kind: 'sidewalk' },
    { rect: { x0: -98, z0: 5, x1: 98, z1: 8 }, kind: 'sidewalk' },
    { rect: { x0: -8, z0: -40, x1: -5, z1: -8 }, kind: 'sidewalk' },
    { rect: { x0: 5, z0: -40, x1: 8, z1: -8 }, kind: 'sidewalk' },
    { rect: { x0: -8, z0: 8, x1: -5, z1: 76 }, kind: 'sidewalk' },
    { rect: { x0: 5, z0: 8, x1: 8, z1: 76 }, kind: 'sidewalk' },
    { rect: { x0: 8, z0: -40, x1: 40, z1: -36 }, kind: 'forecourt' },
    { rect: { x0: -66, z0: 8, x1: -40, z1: 14 }, kind: 'forecourt' },
    { rect: { x0: 40, z0: 8, x1: 72, z1: 42 }, kind: 'grass' },
    { rect: { x0: 8, z0: -10, x1: 40, z1: -8 }, kind: 'plaza' },
    { rect: { x0: 74, z0: 8, x1: 96, z1: 12 }, kind: 'forecourt' },
    // the quay: a stone promenade along the harbour at the north end of Harbour Road
    { rect: { x0: -60, z0: 76, x1: 60, z1: QUAY_EDGE }, kind: 'plaza' },
  ];

  // ---- vehicle routes (right-hand traffic)
  const depot = { x: -53, z: 10.8 };
  const bayParking = { x: 24, z: -42.4 };
  const vanRouteOut: Vec2[] = [depot, { x: -53, z: 2.5 }, { x: 2.5, z: 2.5 }, { x: 2.5, z: -42.4 }, bayParking];
  const vanRouteBack: Vec2[] = [bayParking, { x: 40, z: -42.4 }, { x: 40, z: -43.8 }, { x: -2.5, z: -43.8 }, { x: -2.5, z: -2.5 }, { x: -53, z: -2.5 }, { x: -53, z: 2.5 }, depot];

  SHOPS.market.vanOut = vanRouteOut;
  SHOPS.market.vanBack = vanRouteBack;
  SHOPS.unit4.vanOut = [depot, { x: -53, z: 2.5 }, { x: 90.5, z: 2.5 }, { x: 90.5, z: 4.4 }];
  SHOPS.unit4.vanBack = [{ x: 90.5, z: 4.4 }, { x: 94, z: 2.5 }, { x: 94, z: -2.5 }, { x: -53, z: -2.5 }, { x: -53, z: 2.5 }, depot];

  cached = {
    buildings: B, obstacles, colliders, interactables: I, nodes, edges, roads,
    vanRouteOut, vanRouteBack, depot, bayParking, dropZone: { x: 24, z: -38.7 },
    playerSpawn: { x: 2 * LEVEL_DX + 21, z: 15.6 },
    spawnPoints: ['bus_w', 'bus_e', 'nend', 'hs_e_72'],
    bounds, lamps, parked, city, grid: cgrid,
  };
  return cached;
}

/** every private home you can knock at or break into: Harbour Road's houses and the other flats in Marlow Court */
export const DWELLING_IDS: string[] = [...HOUSE_IDS, ...FLAT_UNIT_IDS];
/** a home's front door: where you stand outside it, just inside it, and the doorway (shut while it is locked) */
export function dwellingDoor(id: string): { out: Vec2; inside: Vec2; lock: Rect } | null {
  const w = getWorld();
  const o = w.nodes[`door_${id}`], i = w.nodes[`in_${id}`];
  if (!o || !i) return null;
  const u = FLAT_UNITS.find((f) => f.id === id);
  if (u) return { out: o, inside: i, lock: u.door };
  const b = w.buildings.find((x) => x.id === id);
  if (!b) return null;
  const zc = (b.rect.z0 + b.rect.z1) / 2, x = b.rect.x0 > 0 ? b.rect.x0 : b.rect.x1;
  return { out: o, inside: i, lock: { x0: x - 0.15, z0: zc - 0.65, x1: x + 0.15, z1: zc + 0.65 } };
}

const CELL = 16;
function colliderGrid(colliders: Rect[]): Map<string, Rect[]> {
  const g = new Map<string, Rect[]>();
  for (const r of colliders) {
    for (let i = Math.floor(r.x0 / CELL); i <= Math.floor(r.x1 / CELL); i++) for (let j = Math.floor(r.z0 / CELL); j <= Math.floor(r.z1 / CELL); j++) {
      const k = `${i},${j}`;
      const list = g.get(k);
      if (list) list.push(r); else g.set(k, [r]);
    }
  }
  return g;
}
/** the colliders touching an area (each once) */
export function collidersIn(x0: number, z0: number, x1: number, z1: number, w: World = getWorld()): Rect[] {
  const i0 = Math.floor(x0 / CELL), i1 = Math.floor(x1 / CELL), j0 = Math.floor(z0 / CELL), j1 = Math.floor(z1 / CELL);
  if (i0 === i1 && j0 === j1) return w.grid.get(`${i0},${j0}`) ?? [];
  const out = new Set<Rect>();
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const r of w.grid.get(`${i},${j}`) ?? []) out.add(r);
  return [...out];
}

const KIND_ROLE: Record<VenueKind, string> = {
  shop: 'Corner shop - snacks, drinks and groceries', cafe: 'Cafe - coffee and something to eat', takeaway: 'Takeaway - hot food to eat now', pub: 'Pub - pints, a seat, darts',
  clothes: 'Clothes shop - a new look', barber: 'Barber - a new haircut', bank: 'Bank - and a vault full of cash', casino: 'Casino - roulette, blackjack, slots',
  nightclub: 'Nightclub - drinks and dancing, late', gym: 'Gym - get fit', arcade: 'Amusement arcade', pawn: 'Pawnbroker - sells and buys anything',
  station: 'Railway station - trains to Westbay and Northfield', mall: 'Shopping centre - food court, jeweller, cinema, clothes', hospital: 'Hospital - A&E', cityhall: 'City Hall - council services and weddings', church: 'Church',
  prison: 'Prison',
};
function venueBuilding(v: Venue): BuildingDef {
  const side = v.front === 'n' ? 'zmin' : 'zmax';
  return {
    id: v.id, name: v.name, category: 'functional', role: KIND_ROLE[v.kind], rect: v.rect, height: Math.max(3.4, v.height), floors: Math.max(1, Math.round(v.height / 3.2)),
    color: v.kind === 'pub' || v.kind === 'barber' ? '#9c5a44' : v.kind === 'bank' ? '#d8d0bf' : '#e4dccb', trim: v.color, roof: '#4a4f55',
    sign: { text: v.name.toUpperCase(), side, color: '#ffffff', bg: v.color }, doors: [{ side, a: v.door.a, b: v.door.b, open: true }], interior: true,
    floorColor: v.kind === 'pub' ? '#6b4a32' : '#cfcac0',
  };
}

export function buildingAt(p: Vec2): BuildingDef | null {
  for (const b of getWorld().buildings) if (b.interior && insideRect(b.rect, p)) return b;
  return null;
}

/** the drawn building around a point (a flat's storey rather than the flat itself) */
export function shellAt(p: Vec2): BuildingDef | null {
  for (const b of getWorld().buildings) if (b.interior && !b.unit && insideRect(b.rect, p)) return b;
  return null;
}

export function locationOf(p: Vec2): string {
  const b = buildingAt(p);
  if (b) return b.id;
  if (insideRect({ x0: 40, z0: 8, x1: 72, z1: 42 }, p)) return 'park';
  return 'outside';
}
