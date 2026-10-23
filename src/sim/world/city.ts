// The city around Harbourside. A street grid 1.8 km across and 1.2 km deep, running up from the coast:
// the old harbour quarter in the middle of the waterfront, the towers of the city centre behind it,
// the Old Town's terraces to the west and the docks and works to the east along the shore, flats
// beyond them, and the suburbs of Northfield at the top with Kingsmere Park. Every block is built
// from its district's rules (deterministic: the same city every time). Most buildings are outsides
// only; the landmarks are named so the map and the people who live here can talk about them.
import type { Vec2 } from '../types';

export interface Rect { x0: number; z0: number; x1: number; z1: number }
export type District = 'harbourside' | 'centre' | 'midtown' | 'oldtown' | 'industrial' | 'docks' | 'beach' | 'uptown' | 'suburbs' | 'park';
export type Style = 'brick' | 'brick_dark' | 'render' | 'terrace' | 'shop' | 'office' | 'glass' | 'tower' | 'flats' | 'warehouse' | 'house' | 'civic' | 'hospital' | 'station' | 'stadium' | 'church' | 'mall' | 'school' | 'kiosk';

export interface CityBuilding {
  rect: Rect;
  height: number;
  style: Style;
  district: District;
  /** landmarks have names */
  name?: string;
  /** a pitched roof (houses, terraces) */
  pitched?: boolean;
  /** palette index, so neighbours differ */
  tint: number;
}

export interface CityProp { kind: 'tree' | 'lamp' | 'bench' | 'bin' | 'crane' | 'container' | 'boat' | 'bus_stop' | 'fountain' | 'goal' | 'parasol' | 'hut' | 'postbox'; x: number; z: number; rot: number; s?: number; color?: string }
export interface Ground { rect: Rect; kind: 'paving' | 'grass' | 'garden' | 'concrete' | 'sand' | 'water' | 'gravel' | 'pitch' | 'car_park' }
export interface Lane { from: Vec2; to: Vec2; axis: 'x' | 'z' }

export const CITY: Rect = { x0: -925, z0: -1110, x1: 925, z1: 92 };
/** north-south avenues and east-west streets, by their centre lines */
export const AVENUES = [-910, -780, -650, -520, -390, -260, -130, 0, 130, 260, 390, 520, 650, 780, 910];
export const STREETS = [0, -130, -260, -390, -520, -650, -780, -910, -1040];
export const ESPLANADE_Z = 70;
export const ROAD_HALF = 5;
export const WALK_W = 3;
/** the old harbour quarter, laid out by hand (layout.ts): the generator leaves it alone */
export const HARBOURSIDE: Rect = { x0: -122, z0: -122, x1: 122, z1: 92 };
const OLD_ROADS = { main: { x0: -98, x1: 98 }, harbour: { z0: -48 } };

export const STREET_NAMES: Record<number, string> = { 0: 'Main Street', [-130]: 'Chapel Road', [-260]: 'Victoria Street', [-390]: 'Market Way', [-520]: 'Kingsway', [-650]: 'Park Road', [-780]: 'Elm Grove', [-910]: 'Hillside Avenue', [-1040]: 'Northfield Road' };
export const AVENUE_NAMES: Record<number, string> = { [-910]: 'West End Road', [-780]: 'Lighthouse Lane', [-650]: 'Fisher Street', [-520]: 'Rope Walk', [-390]: 'Old Town Road', [-260]: 'Bridge Street', [-130]: 'Church Lane', 0: 'Harbour Road', 130: 'Station Road', 260: 'Commercial Road', 390: 'Foundry Lane', 520: 'Dock Road', 650: 'Wharf Street', 780: 'Saltmarsh Lane', 910: 'East End Road' };

export function districtAt(x: number, z: number): District {
  if (x > HARBOURSIDE.x0 && x < HARBOURSIDE.x1 && z > HARBOURSIDE.z0) return 'harbourside';
  if (z > 0) return x < 0 ? 'beach' : 'docks';
  if (Math.abs(x) < 130 && z < -520 && z > -780) return 'park';
  if (Math.abs(x) < 260 && z > -520) return 'centre';
  if (Math.abs(x) < 390 && z > -520) return 'midtown';
  if (z > -390) return x < 0 ? 'oldtown' : 'industrial';
  if (z > -650) return 'uptown';
  return 'suburbs';
}

export const DISTRICT_NAMES: Record<District, string> = {
  harbourside: 'Harbourside', centre: 'City Centre', midtown: 'Midtown', oldtown: 'Old Town', industrial: 'Foundry Works', docks: 'Eastern Docks', beach: 'Westbay', uptown: 'Uptown', suburbs: 'Northfield', park: 'Kingsmere Park',
};

/** a small deterministic random stream */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const overlaps = (a: Rect, b: Rect, pad = 0) => a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.z0 < b.z1 + pad && a.z1 > b.z0 - pad;

interface Landmark { block: [number, number]; build: (r: Rect) => { buildings: CityBuilding[]; ground: Ground[]; props: CityProp[] } }

export interface City {
  buildings: CityBuilding[];
  /** the buildings opened up as venues: drawn in detail near by, and as plain blocks from far off */
  opened?: CityBuilding[];
  ground: Ground[];
  props: CityProp[];
  /** road and pavement strips (outside Harbourside) */
  roads: { rect: Rect; kind: 'road' | 'sidewalk' }[];
  lanes: Lane[];
  /** junction centres: traffic gives way here */
  junctions: Vec2[];
  /** walking network: sidewalk corners and crossings */
  nodes: { id: string; x: number; z: number }[];
  edges: [string, string][];
  /** links from the city network into Harbourside's own nodes */
  joins: [string, string][];
}

let cached: City | null = null;

export function buildCity(avoid: Rect[]): City {
  if (cached) return cached;
  const buildings: CityBuilding[] = [];
  const ground: Ground[] = [];
  const props: CityProp[] = [];
  const roads: City['roads'] = [];
  const lanes: Lane[] = [];
  const junctions: Vec2[] = [];
  const nodes: City['nodes'] = [];
  const edges: [string, string][] = [];
  const joins: [string, string][] = [];
  const inHarbour = (x: number, z: number) => x > HARBOURSIDE.x0 && x < HARBOURSIDE.x1 && z > HARBOURSIDE.z0;
  const free = (r: Rect) => !avoid.some((a) => overlaps(a, r, 2)) && !buildings.some((b) => overlaps(b.rect, r, 0.3));
  const W = ROAD_HALF + WALK_W;

  // ---------------------------------------------------------------- roads
  const zTop = STREETS[STREETS.length - 1];
  for (const x of AVENUES) {
    // avenues run from the top of the town down to the esplanade (Harbour Road to the old quarter)
    const zEnd = x === 0 ? OLD_ROADS.harbour.z0 : Math.abs(x) <= 130 ? 0 : ESPLANADE_Z;
    const z0 = zTop - W, z1 = zEnd;
    roads.push({ rect: { x0: x - ROAD_HALF, z0, x1: x + ROAD_HALF, z1: z1 + (x === 0 ? 0 : ROAD_HALF) }, kind: 'road' });
    for (const s of [-1, 1]) roads.push({ rect: { x0: s < 0 ? x - W : x + ROAD_HALF, z0, x1: s < 0 ? x - ROAD_HALF : x + W, z1: z1 + (x === 0 ? 0 : W) }, kind: 'sidewalk' });
    // Harbour Road's traffic carries on down through the old quarter to the quay
    const zl = x === 0 ? 76 : z1;
    lanes.push({ from: { x: x + 2.5, z: zl }, to: { x: x + 2.5, z: z0 + 2 }, axis: 'z' });
    lanes.push({ from: { x: x - 2.5, z: z0 + 2 }, to: { x: x - 2.5, z: zl }, axis: 'z' });
  }
  const xL = AVENUES[0] - W, xR = AVENUES[AVENUES.length - 1] + W;
  for (const z of [...STREETS, ESPLANADE_Z]) {
    const pieces: [number, number][] = z === 0 ? [[xL, OLD_ROADS.main.x0], [OLD_ROADS.main.x1, xR]] : z === ESPLANADE_Z ? [[xL, -130 - ROAD_HALF], [130 + ROAD_HALF, xR]] : [[xL, xR]];
    for (const [a, b] of pieces) {
      roads.push({ rect: { x0: a, z0: z - ROAD_HALF, x1: b, z1: z + ROAD_HALF }, kind: 'road' });
      roads.push({ rect: { x0: a, z0: z - W, x1: b, z1: z - ROAD_HALF }, kind: 'sidewalk' });
      if (z !== ESPLANADE_Z) roads.push({ rect: { x0: a, z0: z + ROAD_HALF, x1: b, z1: z + W }, kind: 'sidewalk' });
    }
    // Main Street's traffic runs right through the old quarter on the same lanes
    const a = z === ESPLANADE_Z ? null : [xL, xR];
    if (a) { lanes.push({ from: { x: a[0], z: z + 2 }, to: { x: a[1], z: z + 2 }, axis: 'x' }); lanes.push({ from: { x: a[1], z: z - 2 }, to: { x: a[0], z: z - 2 }, axis: 'x' }); }
    else for (const [p, q] of pieces) { lanes.push({ from: { x: p, z: z + 2 }, to: { x: q, z: z + 2 }, axis: 'x' }); lanes.push({ from: { x: q, z: z - 2 }, to: { x: p, z: z - 2 }, axis: 'x' }); }
  }
  for (const x of AVENUES) for (const z of STREETS) junctions.push({ x, z });
  for (const x of AVENUES) if (Math.abs(x) > 130) junctions.push({ x, z: ESPLANADE_Z });

  // ---------------------------------------------------------------- the walking network
  const nid = (x: number, z: number) => `c_${Math.round(x * 10)}_${Math.round(z * 10)}`;
  const seen = new Set<string>();
  const node = (x: number, z: number) => { const id = nid(x, z); if (!seen.has(id)) { seen.add(id); nodes.push({ id, x, z }); } return id; };
  const link = (a: string, b: string) => edges.push([a, b]);
  const C = ROAD_HALF + WALK_W / 2; // pavement centre line
  const zRows = [...STREETS, ESPLANADE_Z].sort((p, q) => p - q);
  for (const x of AVENUES) for (const z of zRows) {
    if (inHarbour(x, z) && !(x === 0 && z === 0)) continue;
    if (z === ESPLANADE_Z && Math.abs(x) <= 130) continue;
    if (x === 0 && z === 0) continue; // Harbourside's own corner nodes
    const corners: [number, number][] = z === ESPLANADE_Z ? [[x - C, z - C], [x + C, z - C]] : [[x - C, z - C], [x + C, z - C], [x - C, z + C], [x + C, z + C]];
    const ids = corners.filter(([cx, cz]) => !inHarbour(cx, cz)).map(([cx, cz]) => node(cx, cz));
    // crossings: all four sides of the junction
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const A = nodes.find((n) => n.id === ids[i])!, B = nodes.find((n) => n.id === ids[j])!;
      if (Math.abs(A.x - B.x) < 0.1 || Math.abs(A.z - B.z) < 0.1) link(ids[i], ids[j]);
    }
  }
  // along the pavements, corner to corner
  const corner = (x: number, z: number) => (seen.has(nid(x, z)) ? nid(x, z) : null);
  for (const z of zRows) for (let i = 0; i + 1 < AVENUES.length; i++) for (const dz of [-C, C]) {
    const a = corner(AVENUES[i] + C, z + dz), b = corner(AVENUES[i + 1] - C, z + dz);
    if (a && b) link(a, b);
  }
  for (const x of AVENUES) for (let j = 0; j + 1 < zRows.length; j++) for (const dx of [-C, C]) {
    const a = corner(x + dx, zRows[j] + C), b = corner(x + dx, zRows[j + 1] - C);
    if (a && b && !(inHarbour(x + dx, zRows[j + 1] - C) && Math.abs(x) < 10)) link(a, b);
  }
  // into Harbourside: Main Street's pavements at either end, and up Harbour Road
  const j = (cx: number, cz: number, old: string) => { const id = corner(cx, cz); if (id) joins.push([id, old]); };
  j(-130 + C, -C, 'nw_-88'); j(-130 + C, C, 'sw_-88'); j(130 - C, -C, 'ne_88'); j(130 - C, C, 'se_88');
  j(C, -130 + C, 'hn_e_38'); j(-C, -130 + C, 'nend');

  // ---------------------------------------------------------------- blocks
  const blocks: { r: Rect; i: number; j: number }[] = [];
  for (let i = 0; i + 1 < AVENUES.length; i++) for (let jj = 0; jj < zRows.length; jj++) {
    const zA = jj === 0 ? CITY.z0 : zRows[jj - 1], zB = zRows[jj];
    if (jj === 0) continue;
    blocks.push({ r: { x0: AVENUES[i] + W, z0: zA + W, x1: AVENUES[i + 1] - W, z1: zB - W }, i, j: jj });
  }
  const landmarks: Landmark[] = [
    { block: [195, -195], build: (r) => civic(r, 'hospital', 'Harbourside General Hospital', 26, 'paving') },
    { block: [-65, -325], build: (r) => civic(r, 'station', 'Central Station', 16, 'paving') },
    { block: [-195, -195], build: (r) => civic(r, 'church', "St Mary's Church", 22, 'grass') },
    { block: [325, -325], build: (r) => civic(r, 'mall', 'Harbourgate Shopping Centre', 18, 'car_park') },
    { block: [585, -585], build: (r) => stadium(r) },
    { block: [-455, -845], build: (r) => civic(r, 'school', 'Northfield Academy', 10, 'pitch') },
    { block: [-65, -195], build: (r) => civic(r, 'civic', 'City Hall', 24, 'paving') },
  ];
  const lmAt = (r: Rect) => landmarks.find((l) => l.block[0] > r.x0 && l.block[0] < r.x1 && l.block[1] > r.z0 && l.block[1] < r.z1);

  function civic(r: Rect, style: Style, name: string, h: number, around: Ground['kind']) {
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    const w = (r.x1 - r.x0) * 0.62, d = (r.z1 - r.z0) * 0.5;
    const out: CityBuilding[] = [{ rect: { x0: cx - w / 2, z0: cz - d / 2 - 8, x1: cx + w / 2, z1: cz + d / 2 - 8 }, height: h, style, district: districtAt(cx, cz), name, tint: 0 }];
    if (style === 'church') { out[0].rect = { x0: cx - 12, z0: cz - 30, x1: cx + 12, z1: cz + 20 }; out.push({ rect: { x0: cx - 5, z0: cz + 20, x1: cx + 5, z1: cz + 30 }, height: 46, style: 'church', district: out[0].district, tint: 1 }); }
    if (style === 'hospital') out.push({ rect: { x0: cx - w / 2, z0: cz + d / 2 - 4, x1: cx - w / 2 + 30, z1: r.z1 - 6 }, height: 14, style: 'hospital', district: out[0].district, tint: 1 });
    const pr: CityProp[] = [];
    for (let x = r.x0 + 6; x < r.x1 - 4; x += 12) { pr.push({ kind: 'tree', x, z: r.z1 - 3, rot: x }); }
    return { buildings: out, ground: [{ rect: r, kind: around }], props: pr };
  }
  function stadium(r: Rect) {
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    const b: CityBuilding[] = [
      { rect: { x0: r.x0 + 4, z0: r.z0 + 4, x1: r.x1 - 4, z1: r.z0 + 16 }, height: 20, style: 'stadium', district: 'uptown', name: 'Harbour City Stadium', tint: 0 },
      { rect: { x0: r.x0 + 4, z0: r.z1 - 16, x1: r.x1 - 4, z1: r.z1 - 4 }, height: 20, style: 'stadium', district: 'uptown', tint: 0 },
      { rect: { x0: r.x0 + 4, z0: r.z0 + 16, x1: r.x0 + 16, z1: r.z1 - 16 }, height: 16, style: 'stadium', district: 'uptown', tint: 0 },
      { rect: { x0: r.x1 - 16, z0: r.z0 + 16, x1: r.x1 - 4, z1: r.z1 - 16 }, height: 16, style: 'stadium', district: 'uptown', tint: 0 },
    ];
    return { buildings: b, ground: [{ rect: r, kind: 'paving' as const }, { rect: { x0: r.x0 + 17, z0: r.z0 + 17, x1: r.x1 - 17, z1: r.z1 - 17 }, kind: 'pitch' as const }], props: [{ kind: 'goal' as const, x: cx, z: r.z0 + 19, rot: 0 }, { kind: 'goal' as const, x: cx, z: r.z1 - 19, rot: Math.PI }] };
    void cz;
  }

  for (const blk of blocks) {
    const { r } = blk;
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    const dist = districtAt(cx, cz);
    const rnd = rng(blk.i * 7919 + blk.j * 104729 + 17);
    if (dist === 'harbourside') continue;
    const lm = lmAt(r);
    if (lm) { const o = lm.build(r); buildings.push(...o.buildings); ground.push(...o.ground); props.push(...o.props); continue; }
    if (dist === 'park') { park(r, rnd, cx, cz); continue; }
    if (dist === 'beach') { beach(r, rnd); continue; }
    if (dist === 'docks') { docks(r, rnd); continue; }
    // a block lined with buildings on all four sides, a yard or gardens in the middle
    const spec = SPEC[dist];
    ground.push({ rect: r, kind: spec.ground });
    perimeter(r, rnd, dist);
    // street trees in the leafier districts
    if (dist === 'suburbs' || dist === 'uptown' || dist === 'centre') for (const side of [r.z0 - 1.2, r.z1 + 1.2]) for (let x = r.x0 + 5; x < r.x1 - 3; x += dist === 'suburbs' ? 11 : 16) props.push({ kind: 'tree', x, z: side, rot: x * 1.7, s: 0.8 + rnd() * 0.3 });
  }

  // the gaps in the old quarter's back streets: north of the police station and the market
  {
    const rnd = rng(4242);
    const strip = [{ x0: -122, z0: -122, x1: -10, z1: -58 }, { x0: 10, z0: -122, x1: 122, z1: -58 }];
    for (const r of strip) { ground.push({ rect: r, kind: 'paving' }); perimeter(r, rnd, 'midtown'); }
  }

  // ---------------------------------------------------------------- lamps along every pavement
  for (const rd of roads) if (rd.kind === 'sidewalk') {
    const along = rd.rect.x1 - rd.rect.x0 > rd.rect.z1 - rd.rect.z0;
    const len = along ? rd.rect.x1 - rd.rect.x0 : rd.rect.z1 - rd.rect.z0;
    for (let t = 12; t < len - 6; t += 32) {
      const x = along ? rd.rect.x0 + t : (rd.rect.x0 + rd.rect.x1) / 2, z = along ? (rd.rect.z0 + rd.rect.z1) / 2 : rd.rect.z0 + t;
      if (inHarbour(x, z)) continue;
      // the lamp stands at the kerb, its arm over the road
      const nearest = (v: number, list: number[]) => list.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
      const kerbIn = along ? (z < nearest(z, zRows) ? 1 : -1) : (x < nearest(x, AVENUES) ? 1 : -1);
      props.push({ kind: 'lamp', x: along ? x : x + kerbIn * 1.1, z: along ? z + kerbIn * 1.1 : z, rot: along ? (kerbIn > 0 ? 0 : Math.PI) : (kerbIn > 0 ? Math.PI / 2 : -Math.PI / 2) });
    }
  }
  // bus stops at the junctions of the main roads
  for (const x of [-520, -260, 0, 260, 520]) for (const z of [-130, -390, -650, -910]) props.push({ kind: 'bus_stop', x: x + 12, z: z - C - 0.3, rot: 0 });
  // red post boxes at the back of the pavement, every few blocks
  AVENUES.forEach((x, i) => STREETS.forEach((z, k) => { if ((i + k) % 3 === 0 && z !== 0 && Math.abs(x) > 140) props.push({ kind: 'postbox', x: x - 20, z: z + C + 1.0, rot: 0 }); }));

  cached = { buildings, ground, props, roads, lanes, junctions, nodes, edges, joins };
  return cached;

  // ---------------------------------------------------------------- generators
  function perimeter(r: Rect, rnd: () => number, dist: District) {
    const spec = SPEC[dist];
    const depthOf = () => spec.depth[0] + rnd() * (spec.depth[1] - spec.depth[0]);
    const setback = spec.setback;
    // north and south rows run the full width; east and west rows fill between them
    const rows: { side: 'n' | 's' | 'e' | 'w'; a: number; b: number }[] = [];
    const dN = depthOf(), dS = depthOf();
    rows.push({ side: 'n', a: r.x0, b: r.x1 }, { side: 's', a: r.x0, b: r.x1 });
    rows.push({ side: 'w', a: r.z0 + setback + dN + 1, b: r.z1 - setback - dS - 1 }, { side: 'e', a: r.z0 + setback + dN + 1, b: r.z1 - setback - dS - 1 });
    for (const row of rows) {
      let t = row.a + (spec.gap ? rnd() * spec.gap : 0);
      while (t < row.b - spec.width[0]) {
        let w = spec.width[0] + rnd() * (spec.width[1] - spec.width[0]);
        if (row.b - (t + w) < spec.width[0]) w = row.b - t;
        const d = row.side === 'n' ? dN : row.side === 's' ? dS : depthOf();
        let rect: Rect;
        if (row.side === 'n') rect = { x0: t, z0: r.z0 + setback, x1: t + w, z1: r.z0 + setback + d };
        else if (row.side === 's') rect = { x0: t, z0: r.z1 - setback - d, x1: t + w, z1: r.z1 - setback };
        else if (row.side === 'w') rect = { x0: r.x0 + setback, z0: t, x1: r.x0 + setback + d, z1: t + w };
        else rect = { x0: r.x1 - setback - d, z0: t, x1: r.x1 - setback, z1: t + w };
        const inset = spec.gap ? 0.6 + rnd() * spec.gap * 0.5 : 0;
        const fit: Rect = row.side === 'n' || row.side === 's' ? { ...rect, x1: rect.x1 - inset } : { ...rect, z1: rect.z1 - inset };
        if (fit.x1 - fit.x0 > 4 && fit.z1 - fit.z0 > 4 && free(fit)) {
          const style = spec.styles[Math.floor(rnd() * spec.styles.length)];
          const floors = spec.floors[0] + Math.floor(rnd() * (spec.floors[1] - spec.floors[0] + 1));
          const tall = dist === 'centre' && rnd() < 0.25 ? 2.2 + rnd() * 1.6 : 1;
          buildings.push({ rect: fit, height: Math.round(floors * tall) * 3.2 + (style === 'shop' ? 0.8 : 0), style, district: dist, pitched: spec.pitched, tint: Math.floor(rnd() * 8) });
          if (dist === 'suburbs') {
            // a front garden with a hedge, and a tree
            const front: Rect = row.side === 'n' ? { x0: fit.x0, z0: r.z0, x1: fit.x1, z1: fit.z0 } : row.side === 's' ? { x0: fit.x0, z0: fit.z1, x1: fit.x1, z1: r.z1 } : row.side === 'w' ? { x0: r.x0, z0: fit.z0, x1: fit.x0, z1: fit.z1 } : { x0: fit.x1, z0: fit.z0, x1: r.x1, z1: fit.z1 };
            ground.push({ rect: front, kind: 'garden' });
            if (rnd() < 0.5) props.push({ kind: 'tree', x: (front.x0 + front.x1) / 2 + (rnd() - 0.5) * 3, z: (front.z0 + front.z1) / 2, rot: rnd() * 6, s: 0.7 + rnd() * 0.3 });
          }
        }
        t += w + (spec.gap ? spec.gap * (0.4 + rnd()) : 0);
      }
    }
    // the inside of the block: back gardens, a car park or a yard
    if (dist === 'industrial') for (let k = 0; k < 6; k++) props.push({ kind: 'container', x: r.x0 + 30 + rnd() * (r.x1 - r.x0 - 60), z: r.z0 + 30 + rnd() * (r.z1 - r.z0 - 60), rot: rnd() < 0.5 ? 0 : Math.PI / 2, color: ['#b03a2e', '#2e86c1', '#1e8449', '#d4ac0d', '#5d6d7e'][k % 5] });
    if (dist === 'suburbs' || dist === 'oldtown') for (let k = 0; k < 5; k++) props.push({ kind: 'tree', x: r.x0 + 25 + rnd() * (r.x1 - r.x0 - 50), z: r.z0 + 25 + rnd() * (r.z1 - r.z0 - 50), rot: rnd() * 6, s: 0.8 + rnd() * 0.5 });
  }
  function park(r: Rect, rnd: () => number, cx: number, cz: number) {
    ground.push({ rect: r, kind: 'grass' });
    // a lake in one corner of the park, paths, benches and plenty of trees
    if (cx < 0 && cz > -650) ground.push({ rect: { x0: r.x0 + 20, z0: r.z0 + 20, x1: r.x1 - 30, z1: r.z1 - 40 }, kind: 'water' });
    ground.push({ rect: { x0: cx - 2, z0: r.z0, x1: cx + 2, z1: r.z1 }, kind: 'gravel' }, { rect: { x0: r.x0, z0: cz - 2, x1: r.x1, z1: cz + 2 }, kind: 'gravel' });
    if (cx > 0 && cz < -650) props.push({ kind: 'fountain', x: cx, z: cz, rot: 0 });
    if (cx > 0 && cz > -650) { ground.push({ rect: { x0: cx + 6, z0: cz + 6, x1: cx + 46, z1: cz + 34 }, kind: 'pitch' }); props.push({ kind: 'goal', x: cx + 8, z: cz + 20, rot: Math.PI / 2 }, { kind: 'goal', x: cx + 44, z: cz + 20, rot: -Math.PI / 2 }); }
    for (let k = 0; k < 40; k++) {
      const x = r.x0 + 4 + rnd() * (r.x1 - r.x0 - 8), z = r.z0 + 4 + rnd() * (r.z1 - r.z0 - 8);
      if (Math.abs(x - cx) < 4 || Math.abs(z - cz) < 4) continue;
      if (cx < 0 && cz > -650 && x > r.x0 + 18 && x < r.x1 - 28 && z > r.z0 + 18 && z < r.z1 - 38) continue;
      props.push({ kind: 'tree', x, z, rot: rnd() * 6, s: 0.8 + rnd() * 0.7 });
    }
    for (let k = -3; k <= 3; k++) props.push({ kind: 'bench', x: cx + 3.2, z: cz + k * 12 + 6, rot: -Math.PI / 2 });
  }
  function beach(r: Rect, rnd: () => number) {
    // the esplanade's seaward side: a promenade, sand, beach huts and parasols
    ground.push({ rect: { x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z0 + 30 }, kind: 'paving' });
    perimeterStrip(r, rnd);
    ground.push({ rect: { x0: r.x0 - 8, z0: ESPLANADE_Z + W, x1: r.x1 + 8, z1: CITY.z1 }, kind: 'sand' });
    for (let x = r.x0 + 4; x < r.x1 - 3; x += 4.2) props.push({ kind: 'hut', x, z: ESPLANADE_Z + W + 2.2, rot: Math.PI, color: ['#e74c3c', '#3498db', '#f1c40f', '#2ecc71', '#ecf0f1', '#e67e22'][Math.floor(rnd() * 6)] });
    for (let k = 0; k < 8; k++) props.push({ kind: 'parasol', x: r.x0 + 6 + rnd() * (r.x1 - r.x0 - 12), z: ESPLANADE_Z + 12 + rnd() * 6, rot: 0, color: ['#e74c3c', '#2980b9', '#f39c12'][k % 3] });
  }
  function perimeterStrip(r: Rect, rnd: () => number) {
    // a row of seafront cafes, B&Bs and arcades facing the sea
    let x = r.x0;
    while (x < r.x1 - 8) {
      const w = 9 + rnd() * 9;
      const rect = { x0: x, z0: r.z1 - 14, x1: Math.min(r.x1, x + w - 1), z1: r.z1 - 1 };
      if (free(rect)) buildings.push({ rect, height: (2 + Math.floor(rnd() * 3)) * 3.2, style: rnd() < 0.5 ? 'render' : 'shop', district: 'beach', tint: Math.floor(rnd() * 8) });
      x += w;
    }
  }
  function docks(r: Rect, rnd: () => number) {
    ground.push({ rect: r, kind: 'concrete' });
    ground.push({ rect: { x0: r.x0 - 8, z0: ESPLANADE_Z + W, x1: r.x1 + 8, z1: CITY.z1 }, kind: 'concrete' });
    // sheds along the road, stacks of containers on the quay, a crane at the water's edge
    let x = r.x0 + 4;
    while (x < r.x1 - 30) {
      const w = 28 + rnd() * 20;
      const rect = { x0: x, z0: r.z0 + 2, x1: Math.min(r.x1 - 4, x + w), z1: r.z0 + 26 };
      if (free(rect)) buildings.push({ rect, height: 8 + Math.floor(rnd() * 3) * 2, style: 'warehouse', district: 'docks', tint: Math.floor(rnd() * 8) });
      x += w + 6;
    }
    for (let k = 0; k < 14; k++) props.push({ kind: 'container', x: r.x0 + 8 + rnd() * (r.x1 - r.x0 - 16), z: r.z0 + 32 + rnd() * (r.z1 - r.z0 - 36), rot: 0, color: ['#b03a2e', '#2e86c1', '#1e8449', '#d4ac0d', '#5d6d7e', '#8e44ad'][k % 6] });
    props.push({ kind: 'crane', x: (r.x0 + r.x1) / 2, z: CITY.z1 - 6, rot: 0 });
    if (rnd() < 0.6) props.push({ kind: 'boat', x: (r.x0 + r.x1) / 2 + 20, z: CITY.z1 + 14, rot: Math.PI / 2 });
  }
}

const SPEC: Record<District, { ground: Ground['kind']; styles: Style[]; width: [number, number]; depth: [number, number]; floors: [number, number]; setback: number; gap: number; pitched?: boolean }> = {
  harbourside: { ground: 'paving', styles: ['brick'], width: [8, 12], depth: [10, 14], floors: [2, 3], setback: 0, gap: 0 },
  centre: { ground: 'paving', styles: ['office', 'glass', 'tower', 'glass', 'office', 'shop'], width: [18, 34], depth: [18, 30], floors: [6, 14], setback: 0, gap: 0 },
  midtown: { ground: 'paving', styles: ['office', 'brick', 'flats', 'shop', 'render'], width: [12, 24], depth: [14, 22], floors: [3, 7], setback: 0, gap: 0 },
  oldtown: { ground: 'paving', styles: ['terrace', 'terrace', 'brick', 'shop', 'brick_dark', 'render'], width: [6, 10], depth: [9, 13], floors: [2, 3], setback: 0, gap: 0, pitched: true },
  industrial: { ground: 'concrete', styles: ['warehouse', 'warehouse', 'brick_dark'], width: [24, 44], depth: [20, 34], floors: [2, 4], setback: 2, gap: 4 },
  docks: { ground: 'concrete', styles: ['warehouse'], width: [30, 50], depth: [24, 30], floors: [2, 3], setback: 4, gap: 6 },
  beach: { ground: 'paving', styles: ['render', 'shop'], width: [9, 16], depth: [10, 14], floors: [2, 4], setback: 0, gap: 0 },
  uptown: { ground: 'paving', styles: ['flats', 'flats', 'render', 'brick', 'office'], width: [16, 30], depth: [14, 20], floors: [4, 9], setback: 2, gap: 3 },
  suburbs: { ground: 'grass', styles: ['house', 'house', 'house', 'brick'], width: [9, 12], depth: [8, 10], floors: [2, 2], setback: 7, gap: 4, pitched: true },
  park: { ground: 'grass', styles: [], width: [10, 10], depth: [10, 10], floors: [1, 1], setback: 0, gap: 0 },
};

/** the street (or avenue) name nearest a point, for directions and the map */
export function streetAt(x: number, z: number): string {
  const ax = AVENUES.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a));
  const sz = STREETS.reduce((a, b) => (Math.abs(b - z) < Math.abs(a - z) ? b : a));
  return Math.abs(ax - x) < Math.abs(sz - z) ? AVENUE_NAMES[ax] : STREET_NAMES[sz];
}
