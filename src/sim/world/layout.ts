// Static world definition for the Harbourside starting district.
// Geometry, colliders, interaction anchors and the pedestrian/vehicle graphs
// are built from code (not saved) and shared by simulation and renderer.
//
// Coordinate system: metres, x = east, z = south (so -z is "north").
// Facing angle θ: forward direction = (sin θ, cos θ); θ = 0 faces +z.
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
}

export type ObstacleKind =
  | 'gondola'
  | 'toilet'
  | 'stairs'
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
  | 'lampstand';

export interface Obstacle {
  kind: ObstacleKind;
  rect: Rect;
  height: number;
  rot?: number;
  color?: string;
  solid: boolean;
}

export type InteractKind =
  | 'shelf'
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
  | 'stove';

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
    id: 'flat', name: 'Marlow Court', category: 'functional', role: 'Block of flats - your Flat 1 is on the ground floor',
    rect: { x0: 12, z0: 10, x1: 30, z1: 26 }, height: 12.8, floors: 4, color: '#b5654a', trim: '#e6e1d6', roof: '#3d3f42',
    sign: { text: 'MARLOW COURT', side: 'zmin', color: '#222222', bg: '#e6e1d6' },
    doors: [
      { side: 'zmin', a: 15, b: 17, open: true },
      { side: 'zmin', a: 26, b: 28, open: false },
    ],
    interior: true, floorColor: '#a07850',
    // open-plan living/kitchen with a hall; bedroom and bathroom behind doorways;
    // the bin store behind the service door (closed) is walled off
    internalWalls: [
      // communal entrance lobby with the stairs; Flat 1's front door opens off it
      { x0: 12, z0: 13.45, x1: 16.2, z1: 13.75 },
      { x0: 17.2, z0: 13.45, x1: 18.15, z1: 13.75 },
      { x0: 17.85, z0: 10, x1: 18.15, z1: 13.45 },
      { x0: 25.35, z0: 10, x1: 25.65, z1: 14.4 },
      { x0: 25.35, z0: 15.6, x1: 25.65, z1: 17.65 },
      { x0: 25.65, z0: 12.85, x1: 30, z1: 13.15 },
      { x0: 22, z0: 17.35, x1: 22.9, z1: 17.65 },
      { x0: 24.1, z0: 17.35, x1: 30, z1: 17.65 },
      { x0: 21.85, z0: 17.65, x1: 22.15, z1: 26 },
    ],
  },
  {
    id: 'cafe', name: 'Tidewater Cafe', category: 'simplified', role: 'Cafe - buy a hot meal (simplified kitchen)',
    rect: { x0: -34, z0: 10, x1: -14, z1: 26 }, height: 4.5, floors: 1, color: '#f0e3c0', trim: '#7b2d26', roof: '#6b3a2e',
    sign: { text: 'TIDEWATER CAFE', side: 'zmin', color: '#ffffff', bg: '#7b2d26' },
    doors: [{ side: 'zmin', a: -26, b: -22, open: true }],
    interior: true, floorColor: '#b89f7a',
  },
  {
    id: 'wholesale', name: 'Harbour Wholesale', category: 'simplified', role: 'Wholesale supplier & depot (staff only)',
    rect: { x0: -66, z0: 14, x1: -40, z1: 40 }, height: 8, floors: 1, color: '#9aa3a8', trim: '#f4c20d', roof: '#6d7478',
    sign: { text: 'HARBOUR WHOLESALE', side: 'zmin', color: '#111111', bg: '#f4c20d' },
    doors: [
      { side: 'zmin', a: -58, b: -50, open: false },
      { side: 'zmin', a: -44, b: -42, open: false },
    ],
    interior: false,
  },
  {
    id: 'oldbank', name: 'Old Bank Building', category: 'decorative', role: 'Background building (not in service)',
    rect: { x0: -62, z0: -34, x1: -40, z1: -12 }, height: 10, floors: 3, color: '#d7cfc0', trim: '#8c7b63', roof: '#555a5e',
    doors: [{ side: 'zmax', a: -53, b: -49, open: false }], interior: false,
  },
  {
    id: 'chambers', name: 'Harbour Chambers', category: 'decorative', role: 'Office block (background, not yet in service)',
    rect: { x0: 44, z0: -38, x1: 70, z1: -12 }, height: 16, floors: 5, color: '#8fa3b0', trim: '#33434f', roof: '#3a4148',
    doors: [{ side: 'zmax', a: 55, b: 59, open: false }], interior: false,
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
      doors: [{ side: side === 'e' ? 'xmin' : 'xmax', a: zc - 0.8, b: zc + 0.8, open: false }], interior: false,
    });
  }
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
    till: 'till', terminal: 'terminal', cupboard: 'cupboard', bay: 'bay', kiosk: 'kiosk', backroom: 'market_backroom', bayContainer: 'market_bay',
    queue: QUEUE_SLOTS,
    dirtSpots: [{ x: 14.5, z: -19.5 }, { x: 19.5, z: -20.5 }, { x: 24.5, z: -23 }, { x: 29.5, z: -19 }, { x: 34.3, z: -22 }, { x: 19.5, z: -15.6 }, { x: 27, z: -15.6 }, { x: 17.5, z: -12.6 }],
    entrance: { x: 17.5, z: -11.4 }, standby: [{ x: 22, z: -15.1 }, { x: 27, z: -15.6 }], dropZone: { x: 24, z: -38.7 },
    vanOut: [], vanBack: [],
  },
  unit4: {
    id: 'unit4', shelves: U4_SECTIONS.map((x) => x.id), pallets: Object.fromEntries(U4_SECTIONS.map((x, i) => [x.id, `u4_p${i + 1}`])),
    till: 'u4_till', terminal: 'u4_terminal', cupboard: 'u4_cupboard', bay: 'u4_bay', kiosk: null, backroom: 'unit4_backroom', bayContainer: 'unit4_bay',
    queue: U4_QUEUE, dirtSpots: [{ x: 78.3, z: 22 }, { x: 82.5, z: 24 }, { x: 86.5, z: 21 }, { x: 82.5, z: 17.5 }],
    entrance: { x: 80.5, z: 13.4 }, standby: [{ x: 84.5, z: 16.1 }, { x: 82.5, z: 17.5 }], dropZone: { x: 90.5, z: 9.6 },
    vanOut: [], vanBack: [],
  },
};

export const shopOfLocation = (loc: string): ShopDef | null => SHOPS[loc] ?? null;

let cached: World | null = null;

export function getWorld(): World {
  if (cached) return cached;
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

  // ---- Flat interior (real furniture sizes)
  // bedroom
  obstacles.push({ kind: 'bed', rect: { x0: 27.75, z0: 20.6, x1: 29.85, z1: 22.2 }, height: 0.6, solid: true });
  add({ id: 'bed', kind: 'bed', label: 'Bed', pos: { x: 26.9, z: 21.4 }, facing: Math.PI / 2, obj: { x: 28.8, z: 21.4 }, locationId: 'flat', range: 1.8 });
  obstacles.push({ kind: 'wardrobe', rect: { x0: 22.15, z0: 22.0, x1: 22.85, z1: 24.2 }, height: 2.1, solid: true });
  add({ id: 'wardrobe', kind: 'wardrobe', label: 'Wardrobe', pos: { x: 23.7, z: 23.1 }, facing: -Math.PI / 2, obj: { x: 22.5, z: 23.1 }, locationId: 'flat' });
  obstacles.push({ kind: 'drawers', rect: { x0: 28.0, z0: 25.35, x1: 28.9, z1: 25.83 }, height: 0.85, solid: true });
  obstacles.push({ kind: 'rug', rect: { x0: 25.6, z0: 20.2, x1: 27.6, z1: 22.6 }, height: 0.01, solid: false, color: '#c9b79c' });
  // bathroom
  obstacles.push({ kind: 'shower', rect: { x0: 28.85, z0: 13.2, x1: 29.85, z1: 14.2 }, height: 2.1, solid: true });
  add({ id: 'shower', kind: 'shower', label: 'Shower', pos: { x: 28.2, z: 14.7 }, facing: Math.PI / 2, obj: { x: 29.35, z: 13.7 }, locationId: 'flat' });
  obstacles.push({ kind: 'tilefloor', rect: { x0: 25.65, z0: 13.15, x1: 29.85, z1: 17.35 }, height: 0.01, solid: false });
  obstacles.push({ kind: 'toilet', rect: { x0: 29.2, z0: 16.0, x1: 29.85, z1: 16.7 }, height: 0.8, solid: true });
  // living room
  obstacles.push({ kind: 'sofa', rect: { x0: 12.2, z0: 15.4, x1: 13.15, z1: 17.6 }, height: 0.85, solid: true });
  add({ id: 'sofa', kind: 'sofa', label: 'Sofa & TV', pos: { x: 13.8, z: 16.5 }, facing: Math.PI / 2, obj: { x: 12.7, z: 16.5 }, locationId: 'flat' });
  obstacles.push({ kind: 'tv', rect: { x0: 16.9, z0: 15.7, x1: 17.35, z1: 17.3 }, height: 0.5, solid: true });
  obstacles.push({ kind: 'rug', rect: { x0: 13.6, z0: 15.4, x1: 16.4, z1: 17.6 }, height: 0.01, solid: false });
  obstacles.push({ kind: 'coffee_table', rect: { x0: 14.75, z0: 15.95, x1: 15.3, z1: 17.05 }, height: 0.45, solid: true });
  obstacles.push({ kind: 'bookcase', rect: { x0: 12.2, z0: 19.8, x1: 12.52, z1: 20.7 }, height: 1.9, solid: true });
  // communal lobby
  obstacles.push({ kind: 'stairs', rect: { x0: 12.2, z0: 10.2, x1: 14.6, z1: 12.4 }, height: 3.2, solid: true });
  obstacles.push({ kind: 'mailboxes', rect: { x0: 17.4, z0: 11.0, x1: 17.85, z1: 12.6 }, height: 1.5, solid: true });
  obstacles.push({ kind: 'flatdoor', rect: { x0: 16.2, z0: 13.45, x1: 17.2, z1: 13.75 }, height: 2.1, solid: false });
  obstacles.push({ kind: 'plant', rect: { x0: 14.9, z0: 12.8, x1: 15.4, z1: 13.3 }, height: 1.2, solid: true });
  obstacles.push({ kind: 'lampstand', rect: { x0: 12.3, z0: 18.8, x1: 12.8, z1: 19.3 }, height: 1.6, solid: true });
  // dining table with the laptop
  obstacles.push({ kind: 'table', rect: { x0: 18.6, z0: 17.3, x1: 20.0, z1: 18.2 }, height: 0.75, solid: true });
  add({ id: 'chair', kind: 'chair', label: 'Chair', pos: { x: 19.3, z: 16.6 }, facing: 0, obj: { x: 19.3, z: 16.6 }, locationId: 'flat' });
  // kitchen run along the back wall
  obstacles.push({ kind: 'kitchen', rect: { x0: 12.2, z0: 25.2, x1: 17.6, z1: 25.85 }, height: 0.92, solid: true });
  add({ id: 'kitchen', kind: 'kitchen', label: 'Kitchen', pos: { x: 15.0, z: 24.4 }, facing: 0, obj: { x: 15.0, z: 25.5 }, locationId: 'flat' });
  obstacles.push({ kind: 'stove', rect: { x0: 17.6, z0: 25.2, x1: 18.2, z1: 25.85 }, height: 0.92, solid: true });
  add({ id: 'stove', kind: 'stove', label: 'Cooker', pos: { x: 17.9, z: 24.4 }, facing: 0, obj: { x: 17.9, z: 25.5 }, locationId: 'flat' });

  // ---- Job centre interior
  obstacles.push({ kind: 'board', rect: { x0: -27, z0: -27.85, x1: -21, z1: -27.5 }, height: 2.2, solid: true });
  add({ id: 'jobboard', kind: 'board', label: 'Vacancy board', pos: { x: -24, z: -26.3 }, facing: Math.PI, obj: { x: -24, z: -27.7 }, locationId: 'jobcentre', range: 2.0 });
  obstacles.push({ kind: 'desk', rect: { x0: -33, z0: -20, x1: -29, z1: -18.8 }, height: 0.9, solid: true });
  add({ id: 'advisor', kind: 'advisor', label: 'Employment advisor', pos: { x: -31, z: -17.6 }, facing: Math.PI, obj: { x: -31, z: -21 }, locationId: 'jobcentre', range: 2.0 });

  // ---- Cafe interior
  obstacles.push({ kind: 'counter', rect: { x0: -30, z0: 19.6, x1: -18, z1: 20.6 }, height: 1.0, solid: true, color: '#7b2d26' });
  add({ id: 'cafe_counter', kind: 'cafe_counter', label: 'Cafe counter', pos: { x: -24, z: 18.8 }, facing: 0, obj: { x: -24, z: 20.1 }, locationId: 'cafe', businessId: 'cafe', range: 1.8 });
  for (const [tx, tz] of [[-31, 14], [-17, 14]]) obstacles.push({ kind: 'table', rect: box(tx, tz, 1.4, 1.4), height: 0.75, solid: true });

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
  add({ id: 'u4_bay', kind: 'bay', label: 'Goods-in', pos: { x: 90.5, z: 10.8 }, facing: Math.PI, obj: { x: 90.5, z: 9.6 }, locationId: 'unit4', businessId: 'unit4', range: 2.2 });

  // ---- outdoor props
  const trees: Vec2[] = [
    { x: 46, z: 16 }, { x: 52, z: 30 }, { x: 64, z: 15 }, { x: 68, z: 35 }, { x: 44, z: 37 }, { x: 59, z: 26 },
    { x: -86, z: -2 + 46 }, { x: 30, z: 40 }, { x: 34, z: 56 }, { x: -30, z: 40 }, { x: -34, z: 58 }, { x: 26, z: 66 },
  ];
  for (const t of trees) obstacles.push({ kind: 'tree', rect: box(t.x, t.z, 0.6, 0.6), height: 5, solid: true });
  obstacles.push({ kind: 'bench', rect: box(50, 22, 2.0, 0.6), height: 0.5, solid: true });
  obstacles.push({ kind: 'bench', rect: box(62, 22, 2.0, 0.6), height: 0.5, solid: true });
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
    if (b.interior) colliders.push(...wallsFor(b));
    else colliders.push(b.rect);
  }
  for (const o of obstacles) if (o.solid) colliders.push(o.rect);
  // world boundary
  const bounds = { x0: -98, z0: -50, x1: 98, z1: 76 };
  colliders.push({ x0: bounds.x0 - 1, z0: bounds.z0, x1: bounds.x0, z1: bounds.z1 });
  colliders.push({ x0: bounds.x1, z0: bounds.z0, x1: bounds.x1 + 1, z1: bounds.z1 });
  colliders.push({ x0: bounds.x0, z0: bounds.z0 - 1, x1: bounds.x1, z1: bounds.z0 });
  colliders.push({ x0: bounds.x0, z0: bounds.z1, x1: bounds.x1, z1: bounds.z1 + 1 });

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
    hi++;
    N(`door_house_${hi}`, -9.3, zc, `house_${hi}`); L(`hs_w_${zc}`, `door_house_${hi}`);
  }
  N('hs_e_72', 6.5, 72); N('hs_w_72', -6.5, 72);
  L(prevE, 'hs_e_72'); L(prevW, 'hs_w_72'); L('hs_e_72', 'hs_w_72');

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

  // Job centre
  N('jc_out', -24, -8.6); N('jc_in', -24, -11.6, 'jobcentre'); N('jc_board', -24, -26.3, 'jobcentre'); N('jc_adv', -31, -17.6, 'jobcentre');
  N('jc_desk_back', -31, -21.4, 'jobcentre');
  L('nw_-24', 'jc_out', 'jc_in', 'jc_board'); L('jc_in', 'jc_adv');
  N('jc_mid', -26, -23, 'jobcentre'); L('jc_board', 'jc_mid', 'jc_desk_back');
  // Cafe
  N('cf_out', -24, 8.6); N('cf_in', -24, 11.6, 'cafe'); N('cf_counter', -24, 18.8, 'cafe'); N('cf_back', -24, 23, 'cafe');
  N('cf_seat_1', -31, 12.6, 'cafe'); N('cf_seat_2', -17, 12.6, 'cafe');
  L('sw_-24', 'cf_out', 'cf_in', 'cf_counter'); L('cf_in', 'cf_seat_1'); L('cf_in', 'cf_seat_2');
  N('cf_side', -31.5, 18.5, 'cafe'); L('cf_counter', 'cf_side');
  N('cf_kitchen', -31.5, 23, 'cafe'); L('cf_side', 'cf_kitchen', 'cf_back');
  // Flat (player only, but graph allows player-follow tests)
  N('fl_out', 16, 8.6); N('fl_in', 16, 11.6, 'flat');
  L('se_16', 'fl_out', 'fl_in');
  N('fl_c', 23.5, 14.5, 'flat'); N('fl_k', 15.5, 20, 'flat'); N('fl_bed', 23.5, 19.5, 'flat'); N('fl_bath', 27.2, 15.0, 'flat');
  N('fl_door_o', 16.7, 12.9, 'flat'); N('fl_door_i', 16.7, 14.4, 'flat');
  L('fl_in', 'fl_door_o', 'fl_door_i', 'fl_c', 'fl_bed'); L('fl_door_i', 'fl_k'); L('fl_c', 'fl_bath');
  // upstairs residents use the communal entrance
  N('door_upper', 16.6, 9.3, 'flat_upper'); L('se_16', 'door_upper');
  // Wholesale staff door
  N('door_wholesale', -43, 13.3, 'wholesale'); L('sw_-43', 'door_wholesale');
  // Park
  N('pk_gate', 56, 10.5, 'park'); N('pk_a', 52, 25, 'park'); N('pk_b', 62, 26, 'park'); N('pk_c', 56, 32, 'park');
  N('pk_bench_1', 50, 22.9, 'park'); N('pk_bench_2', 62, 22.9, 'park');
  L('se_56', 'pk_gate', 'pk_a', 'pk_c', 'pk_b', 'pk_gate'); L('pk_a', 'pk_bench_1'); L('pk_b', 'pk_bench_2');
  // bus stops (commute / ambient spawn)
  N('bus_w', -88, -6.5 + 0.01); L('nw_-88', 'bus_w');
  N('bus_e', 88, 6.6); L('se_88', 'bus_e');

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
    playerSpawn: { x: 20, z: 15 },
    spawnPoints: ['bus_w', 'bus_e', 'nend', 'hs_e_72'],
    bounds, lamps, parked,
  };
  return cached;
}

export function buildingAt(p: Vec2): BuildingDef | null {
  for (const b of getWorld().buildings) if (b.interior && insideRect(b.rect, p)) return b;
  return null;
}

export function locationOf(p: Vec2): string {
  const b = buildingAt(p);
  if (b) return b.id;
  if (insideRect({ x0: 40, z0: 8, x1: 72, z1: 42 }, p)) return 'park';
  return 'outside';
}
