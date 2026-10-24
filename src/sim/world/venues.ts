// The city's places you can walk into: corner shops, cafes, takeaways, pubs, clothes shops, barbers,
// a bank, a casino, nightclubs, gyms, arcades and pawnbrokers. Each takes over one of the generated
// buildings whose front faces a street, is fitted out inside from its kind's template (counters,
// shelves, tables, machines...), and has someone behind the counter in opening hours.
import type { Vec2 } from '../types';
import type { City, CityBuilding, District } from './city';
import { STREETS, ESPLANADE_Z, ROAD_HALF, WALK_W } from './city';

export type VenueKind = 'shop' | 'cafe' | 'takeaway' | 'pub' | 'clothes' | 'barber' | 'bank' | 'casino' | 'nightclub' | 'gym' | 'arcade' | 'pawn' | 'station' | 'mall' | 'hospital' | 'cityhall' | 'church' | 'prison' | 'bakery' | 'florist' | 'bookshop';
export interface Rect { x0: number; z0: number; x1: number; z1: number }

export interface VenueObstacle { kind: string; rect: Rect; height: number; solid: boolean; rot?: number; color?: string; ref?: string }
export interface VenueSpot { id: string; kind: string; label: string; pos: Vec2; facing: number; obj: Vec2; range?: number }
export interface Venue {
  id: string;
  kind: VenueKind;
  name: string;
  rect: Rect;
  height: number;
  /** the street side: 'n' is the low-z wall, 's' the high-z wall */
  front: 'n' | 's';
  door: { a: number; b: number };
  /** outside the door on the pavement, and just inside it */
  outside: Vec2;
  inside: Vec2;
  /** where the person serving stands, and which way they face */
  staff: Vec2;
  staffFacing: number;
  /** opening hours, minutes of the day (end may pass midnight) and the days (0 = Monday) */
  open: [number, number];
  days: number[];
  obstacles: VenueObstacle[];
  spots: VenueSpot[];
  /** walking points inside: the door, the middle, the counter */
  nodes: Vec2[];
  color: string;
  /** a landmark set back from the street: the point on the pavement its front path leads to */
  path?: Vec2;
}

const NAMES: Record<VenueKind, string[]> = {
  shop: ['Kwik Stop', 'Handy Stores', 'Late Night Larder', 'Bargain Basket', 'Corner Stop', 'Daily Needs', 'Open All Hours', 'Mini Mart'],
  cafe: ['Bean There', 'The Daily Grind', 'Crumbs', 'Steam & Toast', 'The Teapot'],
  takeaway: ['Golden Dragon', 'The Codfather', "Mario's Pizza", 'Kebab King', 'Curry Corner'],
  pub: ['The Red Lion', 'The Crown', 'The Ship Inn', 'The Fox & Hounds'],
  clothes: ['Threads', 'Stitch & Co', 'Urban Rack'],
  barber: ['Sharp Cuts', 'Fade Away', 'The Chop Shop'],
  bank: ['Harbour City Bank'],
  casino: ['The Golden Anchor Casino'],
  nightclub: ['Pulse', 'Neon Nights'],
  gym: ['Iron Works Gym', 'FitZone'],
  arcade: ['Pier Amusements', 'Game Zone'],
  pawn: ['Cash 4 Gold', 'Harbour Pawnbrokers'],
  bakery: ['Upper Crust Bakery', 'The Bread Bin'], florist: ['Petal & Stem', 'Bloom'], bookshop: ['Chapter & Verse'],
  station: ['Central Station'], mall: ['Harbourgate Shopping Centre'], hospital: ['Harbourside General Hospital'], cityhall: ['City Hall'], church: ["St Mary's Church"],
  prison: ['HMP Harbourside'],
};
const WANT: [VenueKind, number][] = [['shop', 8], ['cafe', 5], ['takeaway', 5], ['pub', 4], ['clothes', 3], ['barber', 3], ['bank', 1], ['casino', 1], ['nightclub', 2], ['gym', 2], ['arcade', 2], ['pawn', 2], ['bakery', 2], ['florist', 2], ['bookshop', 1]];
const HOURS: Record<VenueKind, [number, number]> = {
  shop: [7 * 60, 23 * 60], cafe: [7 * 60, 18 * 60], takeaway: [16 * 60, 24 * 60], pub: [11 * 60, 23 * 60], clothes: [9 * 60, 18 * 60], barber: [9 * 60, 18 * 60],
  bank: [9 * 60, 17 * 60], casino: [18 * 60, 28 * 60], nightclub: [22 * 60, 28 * 60], gym: [6 * 60, 22 * 60], arcade: [10 * 60, 22 * 60], pawn: [9 * 60, 18 * 60],
  bakery: [7 * 60, 17 * 60], florist: [9 * 60, 17 * 60 + 30], bookshop: [9 * 60, 18 * 60],
  station: [5 * 60, 25 * 60], mall: [9 * 60, 21 * 60], hospital: [0, 24 * 60], cityhall: [9 * 60, 17 * 60], church: [7 * 60, 20 * 60], prison: [0, 24 * 60],
};
const COLORS: Record<VenueKind, string> = {
  station: '#7b2d26', mall: '#2c3e50', hospital: '#2f6fb0', cityhall: '#3d4d5c', church: '#5a4a3a', prison: '#3b4148',
  shop: '#2e7d4f', cafe: '#7b4a2d', takeaway: '#c0392b', pub: '#5b2a1e', clothes: '#2c3e50', barber: '#1f4e79', bank: '#0f3b5f', casino: '#7d1f1f', nightclub: '#4a148c', gym: '#212121', arcade: '#ff6f00', pawn: '#8d6e00',
  bakery: '#c58b3a', florist: '#c2477a', bookshop: '#2f5a3a',
};
const SIZE: Record<VenueKind, { w: number; d: number }> = {
  shop: { w: 9, d: 10 }, cafe: { w: 9, d: 10 }, takeaway: { w: 8, d: 9 }, pub: { w: 11, d: 11 }, clothes: { w: 10, d: 11 }, barber: { w: 7, d: 9 },
  station: { w: 30, d: 20 }, mall: { w: 30, d: 20 }, hospital: { w: 30, d: 20 }, cityhall: { w: 30, d: 20 }, church: { w: 16, d: 30 }, prison: { w: 30, d: 20 },
  bank: { w: 16, d: 16 }, casino: { w: 16, d: 16 }, nightclub: { w: 14, d: 14 }, gym: { w: 12, d: 12 }, arcade: { w: 10, d: 11 }, pawn: { w: 7, d: 9 },
  bakery: { w: 7, d: 9 }, florist: { w: 7, d: 9 }, bookshop: { w: 8, d: 10 },
};
/** where each kind belongs */
const SUITS: Record<VenueKind, District[]> = {
  shop: ['oldtown', 'midtown', 'uptown', 'beach', 'centre', 'industrial'], cafe: ['centre', 'oldtown', 'beach', 'midtown'], takeaway: ['oldtown', 'midtown', 'uptown', 'beach'],
  pub: ['oldtown', 'midtown', 'beach'], clothes: ['centre', 'midtown'], barber: ['oldtown', 'midtown', 'uptown'], bank: ['centre'], casino: ['centre', 'midtown', 'beach'],
  station: [], mall: [], hospital: [], cityhall: [], church: [], prison: [],
  nightclub: ['midtown', 'centre', 'beach'], gym: ['midtown', 'uptown', 'industrial'], arcade: ['beach', 'midtown'], pawn: ['oldtown', 'industrial', 'midtown'],
  bakery: ['oldtown', 'midtown', 'uptown', 'beach'], florist: ['centre', 'uptown', 'oldtown'], bookshop: ['centre', 'oldtown', 'uptown'],
};

let cached: Venue[] | null = null;

/** pick the buildings and fit them out (deterministic) */
export function planVenues(city: City): Venue[] {
  if (cached) return cached;
  const W = ROAD_HALF + WALK_W;
  const streetRows = [...STREETS, ESPLANADE_Z];
  // the side of a building on a street: its low-z wall 8 m south of a street, or its high-z wall 8 m north of one
  const frontOf = (b: CityBuilding): 'n' | 's' | null => {
    if (streetRows.some((z) => Math.abs(b.rect.z0 - (z + W)) < 0.6)) return 'n';
    if (streetRows.some((z) => Math.abs(b.rect.z1 - (z - W)) < 0.6)) return 's';
    return null;
  };
  const cands = city.buildings.filter((b) => !b.name && ['shop', 'brick', 'render', 'terrace', 'office', 'brick_dark', 'flats', 'warehouse'].includes(b.style) && frontOf(b))
    .sort((a, b) => Math.hypot((a.rect.x0 + a.rect.x1) / 2, (a.rect.z0 + a.rect.z1) / 2) - Math.hypot((b.rect.x0 + b.rect.x1) / 2, (b.rect.z0 + b.rect.z1) / 2));
  const taken = new Set<CityBuilding>();
  const out: Venue[] = [];
  const spaced = (b: CityBuilding) => out.every((v) => Math.hypot((v.rect.x0 + v.rect.x1) / 2 - (b.rect.x0 + b.rect.x1) / 2, (v.rect.z0 + v.rect.z1) / 2 - (b.rect.z0 + b.rect.z1) / 2) > 45);
  // the rare kinds first (they need the big buildings), then round-robin so every kind spreads out
  const order = [...WANT].sort((a, b) => a[1] - b[1]);
  const counts = new Map<VenueKind, number>();
  for (let round = 0; round < 8; round++) for (const [kind, n] of order) {
    if ((counts.get(kind) ?? 0) >= n || (counts.get(kind) ?? 0) > round) continue;
    const sz = SIZE[kind];
    const b = cands.find((c) => !taken.has(c) && SUITS[kind].includes(c.district) && c.rect.x1 - c.rect.x0 >= sz.w && c.rect.z1 - c.rect.z0 >= sz.d && spaced(c));
    if (!b) continue;
    taken.add(b);
    const i = counts.get(kind) ?? 0;
    counts.set(kind, i + 1);
    out.push(fitOut(`v_${out.length}`, kind, NAMES[kind][i % NAMES[kind].length], b, frontOf(b)!));
  }
  // the landmarks open too: their doors face the street to the south, down a path
  const LM: [VenueKind, string][] = [['station', 'station'], ['mall', 'mall'], ['hospital', 'hospital'], ['cityhall', 'civic'], ['church', 'church']];
  for (const [kind, style] of LM) {
    const b = city.buildings.find((c) => c.style === style && !!c.name);
    if (!b) continue;
    taken.add(b);
    const v = fitOut(`v_${out.length}`, kind, b.name!, b, 's');
    // the front path out to the pavement of the street to the south
    const sz = Math.ceil(b.rect.z1 / 130) * 130 - ROAD_HALF - WALK_W / 2;
    v.path = { x: v.outside.x, z: sz };
    out.push(v);
  }
  // and the prison, in a big brick block out among the works
  // (works buildings stand back from the street a little; nobody walks in through its gate anyway)
  const frontLoose = (b: CityBuilding): 'n' | 's' | null => streetRows.some((z) => Math.abs(b.rect.z0 - (z + W)) < 2.6) ? 'n' : streetRows.some((z) => Math.abs(b.rect.z1 - (z - W)) < 2.6) ? 's' : null;
  const jailOk = (c: CityBuilding) => !taken.has(c) && !c.name && (c.district === 'industrial' || c.district === 'docks') && c.rect.x1 - c.rect.x0 >= SIZE.prison.w && c.rect.z1 - c.rect.z0 >= SIZE.prison.d && !!frontLoose(c) && spaced(c);
  const jail = city.buildings.find((c) => jailOk(c) && c.style === 'brick_dark') ?? city.buildings.find(jailOk);
  if (jail) { taken.add(jail); out.push(fitOut(`v_${out.length}`, 'prison', NAMES.prison[0], jail, frontLoose(jail)!)); }
  // the petrol station's kiosk: a corner shop at the back of the forecourt, door onto the pumps
  const kiosk = city.buildings.find((c) => c.style === 'shop' && c.name === 'Harbour Fuel');
  if (kiosk) {
    taken.add(kiosk);
    const v = fitOut(`v_${out.length}`, 'shop', kiosk.name!, kiosk, 's');
    v.path = { x: v.outside.x, z: Math.ceil(kiosk.rect.z1 / 130) * 130 - ROAD_HALF - WALK_W / 2 };
    out.push(v);
  }
  // the chosen buildings become proper buildings with insides: the generator's boxes go
  city.buildings = city.buildings.filter((b) => !taken.has(b));
  city.opened = [...taken];
  cached = out;
  return out;
}

function fitOut(id: string, kind: VenueKind, name: string, b: CityBuilding, front: 'n' | 's'): Venue {
  const r = b.rect, Wd = r.x1 - r.x0, D = r.z1 - r.z0;
  // local coordinates: u along the street front (from the low-x end), v in from the front wall
  const P = (u: number, v: number): Vec2 => ({ x: r.x0 + u, z: front === 'n' ? r.z0 + v : r.z1 - v });
  const R = (u0: number, v0: number, u1: number, v1: number): Rect => { const a = P(u0, v0), c = P(u1, v1); return { x0: Math.min(a.x, c.x), z0: Math.min(a.z, c.z), x1: Math.max(a.x, c.x), z1: Math.max(a.z, c.z) }; };
  const inward = front === 'n' ? 0 : Math.PI, outward = inward + Math.PI;
  const mid = Wd / 2;
  const obstacles: VenueObstacle[] = [];
  const spots: VenueSpot[] = [];
  const nodes: Vec2[] = [P(mid, 1.5), P(mid, Math.min(D - 3, D / 2))];
  const ob = (kind2: string, u0: number, v0: number, u1: number, v1: number, height: number, solid = true, rot?: number, color?: string) => obstacles.push({ kind: kind2, rect: R(u0, v0, u1, v1), height, solid, rot, color });
  // a spot to use: stand at (u, v), facing the thing at (ou, ov)
  const spot = (sid: string, skind: string, label: string, u: number, v: number, ou: number, ov: number, range = 1.6) => {
    const pos = P(u, v), obj = P(ou, ov);
    spots.push({ id: `${id}_${sid}`, kind: skind, label, pos, facing: Math.atan2(obj.x - pos.x, obj.z - pos.z), obj, range });
  };
  // the counter with the person serving behind it (front right, or across the back)
  let staffUV: [number, number];
  const counterFront = (len = 3.6) => {
    ob('reception', Wd - 1 - len, 2.0, Wd - 1, 2.8, 1.05, true, undefined, COLORS[kind]);
    staffUV = [Wd - 1 - len / 2, 3.6];
    spot('till', 'venue_till', `${name} (counter)`, Wd - 1 - len / 2, 1.1, Wd - 1 - len / 2, 2.4);
    nodes.push(P(Wd - 1 - len / 2, 1.1));
  };
  const counterBack = (depth = 3.4) => {
    ob('reception', 1.5, D - depth - 0.8, Wd - 1.5, D - depth, 1.05, true, undefined, COLORS[kind]);
    staffUV = [mid, D - depth + 1.0];
    spot('till', 'venue_till', `${name} (counter)`, mid, D - depth - 1.8, mid, D - depth - 0.4);
    nodes.push(P(mid, D - depth - 1.8));
  };
  staffUV = [mid, D - 2];
  const backRot = front === 'n' ? Math.PI : 0;
  switch (kind) {
    case 'shop': {
      counterFront();
      for (let u = 1.6; u + 1.2 < Wd - 5.2; u += 2.8) {
        ob('gondola', u, 4.2, u + 1.1, D - 2.4, 1.6, true, undefined, COLORS.shop);
        spot(`shelf${Math.round(u)}`, 'venue_shelf', 'Shelves', u + 1.7, (4.2 + D - 2.4) / 2, u + 0.55, (4.2 + D - 2.4) / 2, 1.8);
      }
      ob('kitchen', 1, D - 0.7, Wd - 1, D - 0.05, 0.92, true, backRot);
      spot('fridge', 'venue_fridge', 'Drinks fridge', mid, D - 1.6, mid, D - 0.4);
      nodes.push(P(mid, D - 1.6));
      break;
    }
    case 'cafe': case 'takeaway': {
      counterBack(kind === 'takeaway' ? 3.0 : 3.4);
      ob('kitchen', 1.2, D - 0.7, Wd - 1.2, D - 0.05, 0.92, true, backRot);
      // tables in rows down the room, an aisle up the middle to the counter
      for (let v = 3.0; v + 1.2 < D - 5.2; v += 3.4) for (let u = 1.6; u + 1.2 < Wd - 1; u += 3) if (Math.abs(u + 0.6 - mid) > 1.6) ob(kind === 'cafe' && v > 3 && (u * 7 + v) % 3 < 1 ? 'bistro_set' : 'table', u, v, u + 1.2, v + 1.2, 0.75, true);
      if (Wd > 9) ob('plant', 0.3, 0.3, 1.0, 1.0, 1.4, true);
      break;
    }
    case 'pub': {
      counterBack(3.2);
      ob('kitchen', 1.5, D - 0.7, Wd - 1.5, D - 0.05, 0.95, true, backRot);
      for (let v = 2.6; v + 1.3 < D - 5.0; v += 3.4) for (let u = 1.6; u + 1.3 < Wd - 1; u += 3.2) if (Math.abs(u + 0.65 - mid) > 1.7) ob('table', u, v, u + 1.3, v + 1.3, 0.75, true);
      // a fruit machine by the door and a comfy corner
      ob('kiosk', Wd - 1.2, 0.4, Wd - 0.3, 1.1, 1.7, true);
      if (D > 14) ob('sofa', 0.2, D - 9, 1.1, D - 6.6, 0.9, true, Math.PI / 2, '#6b2a2a');
      ob('dartboard', 0.05, D - 6, 0.15, D - 5.2, 1.73, false);
      break;
    }
    case 'clothes': {
      counterFront(2.8);
      for (let v = 4.4; v < D - 2.5; v += 3) {
        ob('clothes_rack', 1.4, v, Wd / 2 - 1.2, v + 0.5, 1.6, true, undefined, ['#7a2f2f', '#2f4f7a', '#3d3d3d', '#c9b27a'][Math.floor(v) % 4]);
        spot(`rail${Math.round(v)}`, 'clothes_rail', 'Clothes rail', Wd / 2 - 2.4, v + 1.3, Wd / 2 - 2.4, v + 0.25);
      }
      ob('wardrobe', Wd - 1.5, D - 4, Wd - 0.9, D - 1.5, 2.0, true, -Math.PI / 2);
      ob('mirror', Wd - 0.2, 4.5, Wd - 0.1, 6, 2, false);
      break;
    }
    case 'barber': {
      for (const [i, v] of [3.4, 5.9].entries()) {
        if (v + 1.2 > D - 1) break;
        ob('armchair', 0.9, v, 1.9, v + 1.0, 0.9, true, Math.PI / 2, '#7a1f1f');
        ob('mirror', 0.05, v, 0.15, v + 1.0, 1.9, false);
        spot(`chair${i}`, 'barber_chair', 'Barber chair', 2.6, v + 0.5, 1.4, v + 0.5);
      }
      ob('waiting_chairs', Wd - 1.0, 3.0, Wd - 0.4, 5.6, 0.9, true, -Math.PI / 2);
      // more chairs and mirrors down the wall, a sofa and magazines for the queue, product shelves
      for (let v = 8.4; v + 1.2 < D - 1.5; v += 2.5) { ob('armchair', 0.9, v, 1.9, v + 1.0, 0.9, true, Math.PI / 2, '#7a1f1f'); ob('mirror', 0.05, v, 0.15, v + 1.0, 1.9, false); }
      if (D > 9) { ob('sofa', Wd - 1.2, 6.4, Wd - 0.3, 8.6, 0.9, true, -Math.PI / 2, '#3a3a3a'); ob('coffee_table', Wd - 2.4, 6.9, Wd - 1.6, 8.1, 0.45, true); }
      if (D > 12) ob('storage_shelf', Wd - 0.7, 10, Wd - 0.2, Math.min(D - 1.5, 13), 1.8, true, -Math.PI / 2);
      ob('plant', Wd - 1.0, 0.3, Wd - 0.3, 1.0, 1.4, true);
      // in a big shop: a reception desk, a second waiting area and some greenery
      if (Wd > 10) {
        ob('reception', mid + 1.2, 2.2, mid + 3.6, 2.9, 1.05, true, undefined, '#2b3b55');
        if (D > 12) { ob('sofa', mid - 1.2, D - 2.2, mid + 1.2, D - 1.2, 0.9, true, backRot, '#2b3b55'); ob('coffee_table', mid - 0.6, D - 3.4, mid + 0.6, D - 2.7, 0.45, true); }
        for (const v of [4.5, D - 4.5]) ob('plant', mid - 0.35, v, mid + 0.35, v + 0.7, 1.5, true);
      }
      break;
    }
    case 'bank': {
      counterBack(6.0);
      ob('vault', mid - 1.4, D - 0.5, mid + 1.4, D - 0.1, 2.6, true, undefined, '#9aa3a8');
      spot('vault', 'vault', 'The vault', mid, D - 1.6, mid, D - 0.3);
      // round the end of the counter to the vault
      nodes.push(P(Wd - 1.0, D - 8.0), P(Wd - 0.85, D - 6.4), P(Wd - 1.2, D - 4), P(mid, D - 2.2));
      ob('waiting_chairs', 0.5, 3.0, 1.1, 6.0, 0.9, true, Math.PI / 2);
      ob('plant', Wd - 1.2, 0.6, Wd - 0.6, 1.2, 1.2, true);
      // the queue: rope posts zig-zagging to the counter, leaflets, cash machines on the side wall
      for (let v = 4.0; v + 0.3 < D - 8.5; v += 1.6) ob('waiting_chairs', mid - 3.2, v, mid - 0.8, v + 0.25, 0.95, true, 0, '#8a6a2a');
      ob('leaflet_stand', Wd - 1.0, 3.0, Wd - 0.4, 3.6, 1.4, true);
      for (let v = 5.0; v + 1 < D - 8; v += 2.2) ob('terminal', Wd - 0.7, v, Wd - 0.15, v + 0.8, 1.7, true, -Math.PI / 2);
      for (const v of [D - 8.6, 3.0]) ob('plant', 1.4, v, 2.0, v + 0.6, 1.3, true);
      break;
    }
    case 'casino': {
      counterFront(3.0);
      for (let u = 1.2; u < Wd - 1.5; u += 1.6) { ob('kiosk', u, D - 1.1, u + 1.0, D - 0.4, 1.7, true); }
      spot('slots', 'slots', 'Slot machines', mid, D - 2.2, mid, D - 0.8);
      for (const [i, u] of [3.0, Wd - 7.0].entries()) {
        ob('gaming_table', u, 6.0, u + 3.2, 8.0, 0.8, true, undefined, '#1d6b3a');
        spot(i ? 'blackjack' : 'roulette', i ? 'blackjack' : 'roulette', i ? 'Blackjack table' : 'Roulette wheel', u + 1.6, 5.1, u + 1.6, 7.0);
      }
      // more tables further in, and banks of slot machines down both sides
      for (let v = 11.0; v + 2 < D - 3.5; v += 4.5) for (const u of [3.0, Wd - 7.0]) ob('gaming_table', u, v, u + 3.2, v + 2.0, 0.8, true, undefined, v % 2 ? '#7a1f2b' : '#1d6b3a');
      for (let v = 4.0; v + 1 < D - 2.5; v += 1.4) { ob('kiosk', 0.3, v, 1.0, v + 1.0, 1.7, true); ob('kiosk', Wd - 1.0, v, Wd - 0.3, v + 1.0, 1.7, true); }
      nodes.push(P(mid, D - 2.2));
      break;
    }
    case 'nightclub': {
      counterBack(2.8);
      ob('dancefloor', 2.5, 3.0, Wd - 2.5, D - 5.0, 0.02, false);
      spot('floor', 'dancefloor', 'Dance floor', mid, (3.0 + D - 5.0) / 2, mid, (3.0 + D - 5.0) / 2 + 0.6, 3.0);
      ob('desk', mid - 1.2, D - 2.4, mid + 1.2, D - 1.6, 1.0, true);
      // booths round the edge of the floor
      for (let v = 3.5; v + 2.4 < D - 5.5; v += 3.2) { ob('sofa', 0.2, v, 1.1, v + 2.4, 0.9, true, Math.PI / 2, '#2a1a3a'); ob('sofa', Wd - 1.1, v, Wd - 0.2, v + 2.4, 0.9, true, -Math.PI / 2, '#2a1a3a'); }
      staffUV = [mid, D - 1.6];
      break;
    }
    case 'gym': {
      counterFront(2.4);
      for (let u = 1.0; u + 0.9 < mid - 1.3; u += 1.6) ob('treadmill', u, 3.6, u + 0.9, 5.6, 1.4, true);
      for (let u = mid + 1.3; u + 0.9 < Wd - 1; u += 1.6) ob('treadmill', u, 3.6, u + 0.9, 5.6, 1.4, true);
      spot('treadmill', 'treadmill', 'Treadmills', 1.45, 6.3, 1.45, 5.0);
      for (let u = 1.5; u + 2 < Wd - 1; u += 3.4) ob('bench', u, D - 3.0, u + 2.0, D - 2.4, 0.5, true, 0);
      // weights benches in rows across the middle, dumbbell racks along the walls
      for (let v = 8.0; v + 1 < D - 4.5; v += 3.0) for (let u = 1.5; u + 2 < Wd - 1; u += 3.4) if (Math.abs(u + 1 - mid) > 1.6) ob('bench', u, v, u + 2.0, v + 0.6, 0.5, true, 0);
      for (let v = 7.0; v + 2.5 < D - 4; v += 4) { ob('storage_shelf', 0.2, v, 0.7, v + 2.4, 1.2, true, Math.PI / 2); ob('storage_shelf', Wd - 0.7, v, Wd - 0.2, v + 2.4, 1.2, true, -Math.PI / 2); }
      spot('weights', 'weights', 'Weights bench', 2.5, D - 4.0, 2.5, D - 2.7);
      nodes.push(P(1.45, 6.3), P(2.5, D - 4.0));
      break;
    }
    case 'arcade': {
      counterFront(2.4);
      for (let v = 4.2; v < D - 1.5; v += 2.4) for (const u of [1.0, Wd / 2 - 0.5]) ob('kiosk', u, v, u + 1.0, v + 0.7, 1.7, true);
      // and more machines in rows across the rest of the floor, back to back
      for (let u = Wd / 2 + 2.2; u + 1 < Wd - 0.6; u += 2.6) for (let v = 4.2; v + 1.5 < D - 1.5; v += 3.2) { ob('kiosk', u, v, u + 1.0, v + 0.7, 1.7, true); ob('kiosk', u, v + 0.75, u + 1.0, v + 1.45, 1.7, true); }
      spot('machines', 'arcade', 'Arcade machines', 2.8, 4.55, 1.5, 4.55);
      break;
    }
    case 'station': {
      // the concourse at the front; the platform at the back, with the tracks walled off past its edge
      ob('board', mid - 4, 8.0, mid + 4, 8.3, 3.0, true);
      for (let u = 4; u < 16 && u < Wd - 4; u += 2.2) ob('kiosk', u, 3.2, u + 1.0, 3.9, 1.7, true);
      spot('tickets', 'ticket_machine', 'Ticket machines', 4.5, 4.6, 4.5, 3.6);
      for (let u = mid + 6; u + 2 < Wd - 3; u += 5) ob('bench', u, 5, u + 2, 5.6, 0.9, true, 0);
      if (Wd > 30) {
        // seats across the concourse, a coffee stand and a newsagent, bins and planters
        for (let v = 12; v + 0.6 < D - 13; v += 4) for (let u = 6; u + 2 < Wd - 6; u += 5) if (Math.abs(u + 1 - mid) > 5) ob('bench', u, v, u + 2, v + 0.6, 0.9, true, 0);
        ob('kiosk', mid + 8, 9, mid + 11, 10.2, 2.4, true);
        ob('kiosk', mid - 11, 9, mid - 8, 10.2, 2.4, true);
        for (let u = 4; u < Wd - 4; u += 9) ob('plant', u, D - 12.5, u + 0.8, D - 11.7, 1.3, true);
      }
      ob('platform_edge', 1, D - 9, Wd - 1, D - 8.7, 1.0, true);
      ob('track', 1, D - 8.7, Wd - 1, D - 1, 0.2, true);
      spot('platform', 'platform', 'Platform 1', mid, D - 10.2, mid, D - 8.6, 2.5);
      nodes.push(P(mid, D - 10.2), P(4.5, 4.6));
      staffUV = [4.5, 2.0];
      break;
    }
    case 'mall': {
      // a long arcade of units: the food court, the jeweller, the cinema, a clothes shop
      ob('reception', 4, D - 8, 14, D - 7.2, 1.05, true, undefined, '#c0392b');
      for (let u = 4; u + 1.2 < 14; u += 3) ob('table', u, D - 13, u + 1.2, D - 11.8, 0.75, true);
      spot('food', 'food_court', 'Food court', 9, D - 9.2, 9, D - 7.6);
      ob('reception', mid - 3, D - 8, mid + 3, D - 7.2, 1.05, true, undefined, '#b8860b');
      ob('reception', mid - 3, D - 5, mid + 3, D - 4.2, 1.3, true, undefined, '#b8860b');
      spot('jeweller', 'jeweller', 'Glitter & Gold (jewellers)', mid, D - 9.2, mid, D - 7.6);
      ob('board', Wd - 14, D - 0.4, Wd - 4, D - 0.1, 3.0, false);
      spot('cinema', 'cinema', 'Harbourgate Cinema', Wd - 9, D - 3.0, Wd - 9, D - 0.5, 2.5);
      for (let v2 = 6; v2 < D - 15; v2 += 6) for (const u of [mid - 8, mid + 6]) ob('plant', u, v2, u + 0.8, v2 + 0.8, 1.4, true);
      for (let v2 = 5; v2 < D - 16; v2 += 3) ob('clothes_rack', 3, v2, 9, v2 + 0.5, 1.6, true, undefined, '#7a2f2f');
      if (Wd > 30) {
        // more of the centre: shop fittings in blocks down both sides, a longer food court,
        // and an avenue of benches and planters up the middle
        for (let v2 = 5; v2 + 2 < D - 16; v2 += 4) for (const u of [Wd - 16, Wd - 12]) ob('gondola', u, v2, u + 1.2, v2 + 2.4, 1.5, true, undefined, ['#2f4f7a', '#7a5a2f', '#2f7a4f'][Math.floor(v2) % 3]);
        for (let v2 = 5; v2 < D - 16; v2 += 3) ob('clothes_rack', 13, v2, 19, v2 + 0.5, 1.6, true, undefined, ['#3d3d3d', '#c9b27a', '#2f4f7a'][Math.floor(v2) % 3]);
        for (let u = 17; u + 1.2 < mid - 5; u += 3) for (const v2 of [D - 13, D - 16]) ob('table', u, v2, u + 1.2, v2 + 1.2, 0.75, true);
        for (let v2 = 8; v2 < D - 18; v2 += 6) for (const u of [mid - 4, mid + 2]) ob('bench', u, v2 + 2.5, u + 2, v2 + 3.1, 0.9, true, 0);
        for (const u of [Wd - 22, 24]) ob('kiosk', u, 6, u + 2.4, 7.2, 2.2, true);
      }
      spot('rail', 'clothes_rail', 'Clothes rail', 6, 3.6, 6, 4.8);
      nodes.push(P(9, D - 9.2), P(mid, D - 9.2), P(Wd - 9, D - 3.0), P(6, 3.6));
      staffUV = [9, D - 6.4];
      break;
    }
    case 'hospital': {
      // reception and the A&E waiting area at the front; a ward of beds behind
      ob('reception', mid - 4, 5, mid + 4, 5.8, 1.05, true, undefined, '#2f6fb0');
      spot('ae', 'ae_desk', 'A&E reception', mid, 3.8, mid, 5.4);
      for (const u of [3, 6, 9]) ob('waiting_chairs', u, 3, u + 2.4, 3.6, 0.9, true, 0);
      for (let u = 3; u + 2.2 < Wd - 3; u += 3.4) { ob('bed', u, D - 3.2, u + 1.1, D - 1, 0.6, true, Math.PI); }
      ob('waiting_chairs', Wd - 4, 3, Wd - 1.6, 3.6, 0.9, true, 0);
      if (Wd > 30) {
        // the waiting room proper: rows of seats either side, drinks machines, plants
        for (let v = 8; v < 15; v += 2.2) for (const u of [3, 6, 9, Wd - 12, Wd - 9, Wd - 6]) ob('waiting_chairs', u, v, u + 2.4, v + 0.6, 0.9, true, 0);
        for (const u of [mid - 9, mid - 7.8]) ob('kiosk', u, 8, u + 1.0, 8.7, 1.8, true);
        for (const u of [mid - 5, mid + 4.2]) ob('plant', u, 9, u + 0.8, 9.8, 1.5, true);
        // the wards: bays of beds with cabinets, a nurses' station in the middle of each
        for (let v = 19; v + 3 < D - 6; v += 8) {
          for (let u = 3; u + 1.1 < Wd - 3; u += 3.4) { if (Math.abs(u + 0.55 - mid) < 4) continue; ob('bed', u, v, u + 1.1, v + 2.2, 0.6, true, 0); ob('storage_shelf', u + 1.3, v, u + 1.8, v + 0.6, 1.0, true, 0); }
          ob('reception', mid - 2.5, v + 0.6, mid + 2.5, v + 1.4, 1.05, true, undefined, '#2f6fb0');
        }
      }
      nodes.push(P(mid, 3.8), P(mid, D - 5));
      staffUV = [mid, 6.6];
      break;
    }
    case 'cityhall': {
      ob('reception', mid - 5, 7, mid + 5, 7.8, 1.05, true, undefined, '#3d4d5c');
      spot('desk', 'council_desk', 'Council services', mid, 5.8, mid, 7.4);
      for (let u = 4; u < Wd - 4; u += 6) ob('plant', u, 1, u + 0.8, 1.8, 1.4, true);
      ob('board', 3, D - 0.4, 11, D - 0.1, 2.2, false);
      for (let v2 = 12; v2 < D - 4; v2 += 2.2) ob('bench', mid - 5, v2, mid - 1, v2 + 0.6, 0.9, true, Math.PI);
      if (Wd > 30) {
        for (let v2 = 12; v2 < D - 4; v2 += 2.2) ob('bench', mid + 1, v2, mid + 5, v2 + 0.6, 0.9, true, Math.PI);
        // clerks' desks down both sides, leaflets, waiting chairs
        for (let v2 = 12; v2 + 2 < D - 6; v2 += 5) for (const u of [4, Wd - 7]) { ob('desk', u, v2, u + 2.4, v2 + 1.0, 0.76, true); ob('dining_chair', u + 0.8, v2 + 1.1, u + 1.6, v2 + 1.8, 0.9, true); }
        for (const u of [mid - 9, mid + 8]) ob('leaflet_stand', u, 4, u + 0.6, 4.6, 1.4, true);
        for (const u of [mid - 14, mid + 11]) ob('waiting_chairs', u, 4, u + 2.4, 4.6, 0.9, true, 0);
      }
      nodes.push(P(mid, 5.8));
      staffUV = [mid, 8.8];
      break;
    }
    case 'church': {
      // pews down both sides of the aisle, the altar at the far end
      for (let v2 = 5; v2 < D - 8; v2 += 1.8) { ob('bench', 1.5, v2, mid - 1.2, v2 + 0.6, 0.9, true, 0); ob('bench', mid + 1.2, v2, Wd - 1.5, v2 + 0.6, 0.9, true, 0); }
      ob('reception', mid - 2, D - 4, mid + 2, D - 3.2, 1.05, true, undefined, '#e8e0cc');
      spot('pew', 'pew', 'A pew', mid - 0.6, 9, mid - 2, 9);
      nodes.push(P(mid, D - 6));
      staffUV = [mid, D - 2.4];
      break;
    }
    case 'prison': {
      // a locked gate inside the front door, the officers' desk, and bars between that and the wing
      ob('celldoor', mid - 1.8, 0.35, mid + 1.8, 0.55, 3.0, true);
      ob('reception', mid - 3, 3, mid + 3, 3.8, 1.05, true, undefined, '#3b4148');
      ob('cellbars', 0.4, 6, mid - 1.6, 6.12, 3.0, true);
      ob('cellbars', mid + 1.6, 6, Wd - 0.4, 6.12, 3.0, true);
      staffUV = [mid, 4.6];
      // the canteen: a hatch to collect a tray from, tables with benches
      ob('reception', 1.5, 7.0, 8.5, 7.8, 1.05, true, undefined, '#8d99a6');
      spot('food', 'prison_food', 'The canteen hatch', 5, 8.9, 5, 7.4);
      for (const u of [2.5, 6.5, 10.5]) { ob('table', u, 10.4, u + 1.4, 12.4, 0.75, true); ob('bench', u - 0.6, 10.4, u - 0.15, 12.4, 0.45, true, Math.PI / 2); ob('bench', u + 1.55, 10.4, u + 2.0, 12.4, 0.45, true, -Math.PI / 2); }
      // the gym corner and the laundry
      ob('bench', 2.5, D - 2.6, 5.5, D - 2.0, 0.5, true, 0);
      spot('weights', 'weights', 'Weights bench', 4, D - 3.4, 4, D - 2.3);
      for (let u = 9.5; u < 15; u += 0.9) ob('washer', u, D - 1.3, u + 0.7, D - 0.6, 0.9, true, backRot);
      spot('laundry', 'prison_laundry', 'The prison laundry (work)', 12, D - 2.6, 12, D - 0.9);
      // a loose vent cover low on the side wall: the way out, if nobody is looking
      ob('board', 0.05, 15, 0.2, 16.2, 1.0, false);
      spot('vent', 'prison_wall', 'A loose vent cover', 1.0, 15.6, 0.1, 15.6, 1.3);
      // a row of cells along the back: bars and a doorway at the front of each, a bunk inside
      let c = 0;
      for (let u0 = 18; u0 + 3 <= Wd - 0.4; u0 += 3.2, c++) {
        ob('cellbars', u0, D - 4.6, u0 + 1.8, D - 4.48, 3.0, true);
        ob('cellbars', u0 - 0.06, D - 4.6, u0 + 0.06, D - 0.05, 3.0, true);
        ob('bed', u0 + 0.3, D - 2.5, u0 + 1.25, D - 0.3, 0.6, true, backRot, '#5d6268');
        if (c === 0) spot('bunk', 'prison_bunk', 'Your bunk', u0 + 2.2, D - 1.6, u0 + 0.8, D - 1.4, 1.4);
        nodes.push(P(u0 + 2.4, D - 2.6), P(u0 + 2.4, D - 5.6));
      }
      ob('cellbars', Wd - 0.5, D - 4.6, Wd - 0.38, D - 0.05, 3.0, true);
      nodes.push(P(5, 8.9), P(4, D - 3.4), P(12, D - 2.6), P(1.0, 15.6), P(mid, 7.5));
      break;
    }
    case 'bakery': {
      // the glass counter of cakes and pasties across the shop, ovens behind; bread racks down one
      // side and a few little tables for a coffee and a pastry by the window
      counterBack(3.0);
      ob('kitchen', 1.2, D - 0.7, Wd - 1.2, D - 0.05, 0.92, true, backRot);
      for (let v = 3.2; v < D - 4.6; v += 2.2) ob('gondola', 0.3, v, 0.95, v + 1.8, 1.5, true, Math.PI / 2, '#c58b3a');
      for (let u = 2.6; u + 1.2 < Wd - 1.4; u += 2.8) if (Math.abs(u + 0.6 - mid) > 1.6) for (let v = 2.4; v < D - 5.2; v += 2.8) ob('bistro_set', u, v, u + 1.3, v + 1.3, 0.75, true);
      break;
    }
    case 'florist': {
      counterFront(2.6);
      // buckets of flowers down both sides, and staging down the middle with more on
      for (let v = 3.6; v < D - 1.2; v += 1.4) { ob('flowers', 0.4, v, 1.1, v + 0.7, 0.75, true); ob('flowers', Wd - 1.1, v + 0.7, Wd - 0.4, v + 1.4, 0.75, true); }
      for (let u = 3.2; u + 1.6 < Wd - 3; u += 3.6) if (Math.abs(u + 0.8 - mid) > 1.4) for (let v = 4.4; v + 1.6 < D - 2; v += 3.4) {
        // an island of buckets, the back row raised on a step so every bunch shows
        ob('flowers', u, v, u + 0.75, v + 0.75, 0.8, true);
        ob('flowers', u + 0.85, v, u + 1.6, v + 0.75, 0.8, true);
        ob('flowers', u, v + 0.85, u + 0.75, v + 1.6, 1.15, true);
        ob('flowers', u + 0.85, v + 0.85, u + 1.6, v + 1.6, 1.15, true);
      }
      ob('plant', Wd - 1.3, 0.3, Wd - 0.5, 1.1, 1.6, true);
      break;
    }
    case 'bookshop': {
      counterFront(2.6);
      for (let v = 3.8; v < D - 1.5; v += 2.4) {
        ob('bookcase', 0.3, v, 0.75, v + 1.6, 1.9, true, Math.PI / 2);
        spot(`books${Math.round(v)}`, 'venue_shelf', 'Bookshelves', 1.6, v + 0.8, 0.5, v + 0.8);
      }
      ob('bookcase', Wd - 0.75, 4, Wd - 0.3, D - 1.5, 1.9, true, -Math.PI / 2);
      // free-standing bookcases back to back in rows down the shop, a reading corner at the back
      for (let u = 3.0; u + 1.8 < Wd - 2.4; u += 3.4) if (Math.abs(u + 0.9 - mid) > 1.5) for (let v = 4.6; v + 0.9 < D - 3.6; v += 3.0) {
        ob('bookcase', u, v, u + 1.8, v + 0.42, 1.6, true, backRot);
        ob('bookcase', u, v + 0.46, u + 1.8, v + 0.88, 1.6, true, backRot + Math.PI);
      }
      ob('armchair', mid - 1.6, D - 2.4, mid - 0.6, D - 1.4, 0.9, true, Math.PI, '#5a3a2a');
      ob('armchair', mid + 0.6, D - 2.4, mid + 1.6, D - 1.4, 0.9, true, Math.PI, '#2f4a3a');
      ob('coffee_table', mid - 0.45, D - 3.4, mid + 0.45, D - 2.7, 0.45, true);
      break;
    }
    case 'pawn': {
      counterFront(3.0);
      ob('reception', 0.6, 3.5, 1.4, D - 1.5, 1.0, true, undefined, '#6b5a2a');
      // racks of second-hand everything: tellies, tools, bikes, boxes of this and that
      for (let u = 3.4; u + 2.4 < Wd - 0.6; u += 2.8) ob('storage_shelf', u, D - 0.7, u + 2.4, D - 0.15, 2.0, true, backRot);
      for (let v = 5.0; v + 2 < D - 2.4; v += 3.2) for (let u = 3.2; u + 1.1 < Wd - 1.6; u += 3.0) if (Math.abs(u + 0.55 - mid) > 1.3) ob('gondola', u, v, u + 1.1, v + 2.0, 1.4, true, undefined, '#6b5a2a');
      if (D > 8) ob('tv', Wd - 1.2, 4.2, Wd - 0.3, 5.4, 1.2, true, -Math.PI / 2);
      break;
    }
  }
  const staff = P(staffUV![0], staffUV![1]);
  // the church's tower stands in front of the middle of its west end: the door is to one side
  const du = kind === 'church' ? 3.5 : mid;
  const outside = front === 'n' ? { x: r.x0 + du, z: r.z0 - 1.0 } : { x: r.x0 + du, z: r.z1 + 1.0 };
  return {
    id, kind, name, rect: r, height: b.height, front, door: { a: r.x0 + du - (kind === 'church' || kind === 'hospital' || kind === 'station' || kind === 'mall' || kind === 'cityhall' ? 1.8 : 1.1), b: r.x0 + du + (kind === 'church' || kind === 'hospital' || kind === 'station' || kind === 'mall' || kind === 'cityhall' ? 1.8 : 1.1) },
    outside, inside: P(du, 1.5), staff, staffFacing: outward, open: HOURS[kind], days: kind === 'bank' ? [0, 1, 2, 3, 4] : [0, 1, 2, 3, 4, 5, 6],
    obstacles, spots, nodes, color: COLORS[kind],
  };
}

export function venueOpen(v: Venue, minute: number): boolean {
  const m = minute % 1440, day = Math.floor(minute / 1440) % 7;
  const [a, b] = v.open;
  if (b <= 1440) return v.days.includes(day) && m >= a && m < b;
  // open past midnight: the evening's opening, or the small hours after it
  return (v.days.includes(day) && m >= a) || (v.days.includes((day + 6) % 7) && m < b - 1440);
}
