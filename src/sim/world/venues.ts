// The city's places you can walk into: corner shops, cafes, takeaways, pubs, clothes shops, barbers,
// a bank, a casino, nightclubs, gyms, arcades and pawnbrokers. Each takes over one of the generated
// buildings whose front faces a street, is fitted out inside from its kind's template (counters,
// shelves, tables, machines...), and has someone behind the counter in opening hours.
import type { Vec2 } from '../types';
import type { City, CityBuilding, District } from './city';
import { STREETS, ESPLANADE_Z, ROAD_HALF, WALK_W } from './city';

export type VenueKind = 'shop' | 'cafe' | 'takeaway' | 'pub' | 'clothes' | 'barber' | 'bank' | 'casino' | 'nightclub' | 'gym' | 'arcade' | 'pawn';
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
};
const WANT: [VenueKind, number][] = [['shop', 8], ['cafe', 5], ['takeaway', 5], ['pub', 4], ['clothes', 3], ['barber', 3], ['bank', 1], ['casino', 1], ['nightclub', 2], ['gym', 2], ['arcade', 2], ['pawn', 2]];
const HOURS: Record<VenueKind, [number, number]> = {
  shop: [7 * 60, 23 * 60], cafe: [7 * 60, 18 * 60], takeaway: [16 * 60, 24 * 60], pub: [11 * 60, 23 * 60], clothes: [9 * 60, 18 * 60], barber: [9 * 60, 18 * 60],
  bank: [9 * 60, 17 * 60], casino: [18 * 60, 28 * 60], nightclub: [22 * 60, 28 * 60], gym: [6 * 60, 22 * 60], arcade: [10 * 60, 22 * 60], pawn: [9 * 60, 18 * 60],
};
const COLORS: Record<VenueKind, string> = {
  shop: '#2e7d4f', cafe: '#7b4a2d', takeaway: '#c0392b', pub: '#5b2a1e', clothes: '#2c3e50', barber: '#1f4e79', bank: '#0f3b5f', casino: '#7d1f1f', nightclub: '#4a148c', gym: '#212121', arcade: '#ff6f00', pawn: '#8d6e00',
};
const SIZE: Record<VenueKind, { w: number; d: number }> = {
  shop: { w: 9, d: 10 }, cafe: { w: 9, d: 10 }, takeaway: { w: 8, d: 9 }, pub: { w: 11, d: 11 }, clothes: { w: 10, d: 11 }, barber: { w: 7, d: 9 },
  bank: { w: 16, d: 16 }, casino: { w: 16, d: 16 }, nightclub: { w: 14, d: 14 }, gym: { w: 12, d: 12 }, arcade: { w: 10, d: 11 }, pawn: { w: 7, d: 9 },
};
/** where each kind belongs */
const SUITS: Record<VenueKind, District[]> = {
  shop: ['oldtown', 'midtown', 'uptown', 'beach', 'centre', 'industrial'], cafe: ['centre', 'oldtown', 'beach', 'midtown'], takeaway: ['oldtown', 'midtown', 'uptown', 'beach'],
  pub: ['oldtown', 'midtown', 'beach'], clothes: ['centre', 'midtown'], barber: ['oldtown', 'midtown', 'uptown'], bank: ['centre'], casino: ['centre', 'midtown', 'beach'],
  nightclub: ['midtown', 'centre', 'beach'], gym: ['midtown', 'uptown', 'industrial'], arcade: ['beach', 'midtown'], pawn: ['oldtown', 'industrial', 'midtown'],
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
  // the chosen buildings become proper buildings with insides: the generator's boxes go
  city.buildings = city.buildings.filter((b) => !taken.has(b));
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
      for (let u = 1.6; u + 1.2 < Wd - 1; u += 3) if (Math.abs(u + 0.6 - mid) > 1.6) ob('table', u, 3.0, u + 1.2, 4.2, 0.75, true);
      if (kind === 'cafe' && D > 11) for (let u = 1.6; u + 1.2 < Wd - 1; u += 3) if (Math.abs(u + 0.6 - mid) > 1.6) ob('table', u, 6.4, u + 1.2, 7.6, 0.75, true);
      break;
    }
    case 'pub': {
      counterBack(3.2);
      ob('kitchen', 1.5, D - 0.7, Wd - 1.5, D - 0.05, 0.95, true, backRot);
      for (let u = 1.6; u + 1.3 < Wd - 1; u += 3.2) if (Math.abs(u + 0.65 - mid) > 1.7) { ob('table', u, 2.6, u + 1.3, 3.9, 0.75, true); if (D > 12) ob('table', u, 6.0, u + 1.3, 7.3, 0.75, true); }
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
      staffUV = [3.6, 4.6];
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
      nodes.push(P(mid, D - 2.2));
      break;
    }
    case 'nightclub': {
      counterBack(2.8);
      ob('dancefloor', 2.5, 3.0, Wd - 2.5, D - 5.0, 0.02, false);
      spot('floor', 'dancefloor', 'Dance floor', mid, (3.0 + D - 5.0) / 2, mid, (3.0 + D - 5.0) / 2 + 0.6, 3.0);
      ob('desk', mid - 1.2, D - 2.4, mid + 1.2, D - 1.6, 1.0, true);
      staffUV = [mid, D - 1.6];
      break;
    }
    case 'gym': {
      counterFront(2.4);
      for (let u = 1.0; u + 0.9 < mid - 1.3; u += 1.6) ob('treadmill', u, 3.6, u + 0.9, 5.6, 1.4, true);
      spot('treadmill', 'treadmill', 'Treadmills', 1.45, 6.3, 1.45, 5.0);
      for (let u = 1.5; u + 2 < Wd - 1; u += 3.4) ob('bench', u, D - 3.0, u + 2.0, D - 2.4, 0.5, true, 0);
      spot('weights', 'weights', 'Weights bench', 2.5, D - 4.0, 2.5, D - 2.7);
      nodes.push(P(1.45, 6.3), P(2.5, D - 4.0));
      break;
    }
    case 'arcade': {
      counterFront(2.4);
      for (let v = 4.2; v < D - 1.5; v += 2.4) for (const u of [1.0, Wd / 2 - 0.5]) ob('kiosk', u, v, u + 1.0, v + 0.7, 1.7, true);
      spot('machines', 'arcade', 'Arcade machines', 2.8, 4.55, 1.5, 4.55);
      break;
    }
    case 'pawn': {
      counterFront(3.0);
      ob('reception', 0.6, 3.5, 1.4, D - 1.5, 1.0, true, undefined, '#6b5a2a');
      break;
    }
  }
  const staff = P(staffUV![0], staffUV![1]);
  const outside = front === 'n' ? { x: r.x0 + mid, z: r.z0 - 1.0 } : { x: r.x0 + mid, z: r.z1 + 1.0 };
  return {
    id, kind, name, rect: r, height: b.height, front, door: { a: r.x0 + mid - 1.1, b: r.x0 + mid + 1.1 },
    outside, inside: P(mid, 1.5), staff, staffFacing: outward, open: HOURS[kind], days: kind === 'bank' ? [0, 1, 2, 3, 4] : [0, 1, 2, 3, 4, 5, 6],
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
