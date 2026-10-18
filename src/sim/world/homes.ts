// HomeDesigner: furnishes a home's rooms from a design (seed + the occupant's choices).
// Nothing about a home interior is fixed: a different seed gives a different, sensible arrangement.
// Rules: furniture backs onto walls and faces into the room, tall pieces stay off window walls,
// doorways and walking routes stay clear, and everything you use has room to stand in front of it.
import type { Vec2 } from '../types';

export interface Rect { x0: number; z0: number; x1: number; z1: number }

export type RoomKind = 'living' | 'kitchen' | 'bedroom' | 'bathroom' | 'hall' | 'dining' | 'spare' | 'utility';

export interface RoomDef {
  id: string;
  name: string;
  kind: RoomKind;
  rect: Rect;
  /** door / opening centres that must stay clear */
  doors: Vec2[];
  /** room edges on the outside of the building (they have windows) */
  outside: ('x0' | 'x1' | 'z0' | 'z1')[];
  /** stretches of an edge with no wall (open-plan): nothing can stand against them */
  open?: { side: 'x0' | 'x1' | 'z0' | 'z1'; from: number; to: number }[];
}

/** what the occupant has chosen; everything has a sensible default */
export interface HomeDesign {
  seed: number;
  sofa: string;
  bedding: string;
  wallpaper: Record<string, string>;
  floor: Record<string, string>;
  rug: Record<string, string | null>;
  /** optional pieces the occupant has added */
  extras: string[];
}

export const WALLPAPERS: Record<string, { name: string; base: string; pattern: 'plain' | 'stripe' | 'damask' | 'geo' | 'panel' | 'brick'; accent: string }> = {
  cream: { name: 'Cream paint', base: '#e8dfcf', pattern: 'plain', accent: '#e8dfcf' },
  white: { name: 'Warm white paint', base: '#f1eee8', pattern: 'plain', accent: '#f1eee8' },
  sage: { name: 'Sage green paint', base: '#b9c4ad', pattern: 'plain', accent: '#b9c4ad' },
  navy: { name: 'Navy feature wall', base: '#34465f', pattern: 'plain', accent: '#34465f' },
  stripe: { name: 'Regency stripe', base: '#e3dccb', pattern: 'stripe', accent: '#c7b994' },
  damask: { name: 'Damask', base: '#d9cdb7', pattern: 'damask', accent: '#bba985' },
  geo: { name: 'Geometric', base: '#e6e2da', pattern: 'geo', accent: '#7f9aa8' },
  panel: { name: 'Wood panelling', base: '#a67c52', pattern: 'panel', accent: '#7d5a3a' },
  brick: { name: 'Exposed brick', base: '#a5583e', pattern: 'brick', accent: '#d8cbb8' },
  tile: { name: 'White wall tiles', base: '#eef1f2', pattern: 'geo', accent: '#d5dcdf' },
};

export const FLOORS: Record<string, { name: string; kind: 'wood' | 'carpet' | 'tiles'; a: string; b: string }> = {
  oak: { name: 'Oak boards', kind: 'wood', a: '#a0784e', b: '#a0784e' },
  walnut: { name: 'Walnut boards', kind: 'wood', a: '#6b4a32', b: '#6b4a32' },
  ash: { name: 'Pale ash boards', kind: 'wood', a: '#c9ad86', b: '#c9ad86' },
  grey: { name: 'Grey laminate', kind: 'wood', a: '#8d8a85', b: '#8d8a85' },
  beige: { name: 'Beige carpet', kind: 'carpet', a: '#c8b89a', b: '#c8b89a' },
  blue: { name: 'Blue carpet', kind: 'carpet', a: '#5c6f86', b: '#5c6f86' },
  checker: { name: 'Checker tiles', kind: 'tiles', a: '#e9e6df', b: '#3b3d40' },
  bathtile: { name: 'White tiles', kind: 'tiles', a: '#eef0f1', b: '#e2e6e8' },
  slate: { name: 'Slate tiles', kind: 'tiles', a: '#59606a', b: '#4b5158' },
};

export const FABRICS: Record<string, string> = {
  green: '#4f6d60', grey: '#6b6e73', navy: '#2f3f5e', mustard: '#b8892b', rust: '#9a4a32', cream: '#d8cfbd', blush: '#c79b98',
};

export const RUGS: Record<string, string> = { sand: '#c9b79c', red: '#8a3e3a', blue: '#4b6283', green: '#5f7a5c', charcoal: '#3c3f44' };

export const EXTRAS: Record<string, { name: string; room: RoomKind }> = {
  armchair: { name: 'Armchair', room: 'living' },
  bookcase: { name: 'Bookcase', room: 'living' },
  plant_big: { name: 'Large plant', room: 'living' },
  sideboard: { name: 'Sideboard', room: 'living' },
  desk: { name: 'Desk & chair', room: 'bedroom' },
  plant_bed: { name: 'Bedroom plant', room: 'bedroom' },
  art: { name: 'Pictures on the walls', room: 'living' },
};

export function defaultDesign(seed = 1): HomeDesign {
  return {
    seed, sofa: 'green', bedding: 'navy',
    wallpaper: { living: 'cream', kitchen: 'white', bedroom: 'sage', bathroom: 'tile', hall: 'cream' },
    floor: { living: 'oak', kitchen: 'checker', bedroom: 'beige', bathroom: 'bathtile', hall: 'oak' },
    rug: { living: 'red', bedroom: 'sand' },
    extras: ['armchair', 'bookcase', 'plant_big', 'sideboard', 'art', 'plant_bed', 'desk'],
  };
}

// ---------------------------------------------------------------- output
export interface PlacedItem {
  kind: string;
  rect: Rect;
  height: number;
  solid: boolean;
  /** direction the front faces (radians, 0 = +z) */
  rot: number;
  color?: string;
  room: string;
}
export interface PlacedUse {
  id: string;
  kind: string;
  label: string;
  pos: Vec2;
  facing: number;
  obj: Vec2;
  range?: number;
}
export interface Furnished {
  items: PlacedItem[];
  uses: PlacedUse[];
  /** extra walking-graph nodes (id, position) to link to the room hub */
  nodes: { id: string; pos: Vec2; hub: string }[];
}

// ---------------------------------------------------------------- geometry
const inside = (r: Rect, o: Rect, m = 0) => o.x0 >= r.x0 + m - 1e-6 && o.x1 <= r.x1 - m + 1e-6 && o.z0 >= r.z0 + m - 1e-6 && o.z1 <= r.z1 - m + 1e-6;
const overlap = (a: Rect, b: Rect, pad = 0) => a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.z0 < b.z1 + pad && a.z1 > b.z0 - pad;
const grow = (r: Rect, d: number): Rect => ({ x0: r.x0 - d, z0: r.z0 - d, x1: r.x1 + d, z1: r.z1 + d });
function segHitsRect(a: Vec2, b: Vec2, r: Rect): boolean {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dz = b.z - a.z;
  const p = [-dx, dx, -dz, dz], q = [a.x - r.x0, r.x1 - a.x, a.z - r.z0, r.z1 - a.z];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return false; continue; }
    const t = q[i] / p[i];
    if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}

type Side = 'x0' | 'x1' | 'z0' | 'z1';
/** inward normal of a room side */
const NORMAL: Record<Side, Vec2> = { x0: { x: 1, z: 0 }, x1: { x: -1, z: 0 }, z0: { x: 0, z: 1 }, z1: { x: 0, z: -1 } };
const rotOf = (n: Vec2) => Math.atan2(n.x, n.z);

/** rect for an item of width w (along the wall) and depth d standing against side s at position t (0..1) */
function againstWall(room: Rect, s: Side, w: number, d: number, t: number, gap = 0.02): Rect | null {
  const horiz = s === 'z0' || s === 'z1';
  const len = horiz ? room.x1 - room.x0 : room.z1 - room.z0;
  if (w > len) return null;
  const a = (horiz ? room.x0 : room.z0) + w / 2 + t * (len - w);
  if (s === 'z0') return { x0: a - w / 2, x1: a + w / 2, z0: room.z0 + gap, z1: room.z0 + gap + d };
  if (s === 'z1') return { x0: a - w / 2, x1: a + w / 2, z0: room.z1 - gap - d, z1: room.z1 - gap };
  if (s === 'x0') return { z0: a - w / 2, z1: a + w / 2, x0: room.x0 + gap, x1: room.x0 + gap + d };
  return { z0: a - w / 2, z1: a + w / 2, x0: room.x1 - gap - d, x1: room.x1 - gap };
}

function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// ---------------------------------------------------------------- designer
export interface DesignContext {
  rooms: RoomDef[];
  /** walking routes that must stay clear (segments) */
  routes: [Vec2, Vec2][];
  /** fixed pieces that are part of the building (kitchen run, bathroom suite): placed as given */
  fixed: PlacedItem[];
  fixedUses: PlacedUse[];
  /** the walking-graph node each room's new nodes connect to */
  hubs: Record<string, string>;
}

export function furnish(ctx: DesignContext, design: HomeDesign): Furnished {
  const rnd = rng(design.seed);
  const items: PlacedItem[] = [...ctx.fixed];
  const uses: PlacedUse[] = [...ctx.fixedUses];
  const nodes: Furnished['nodes'] = [];
  const keepClear: Rect[] = [];
  for (const r of ctx.rooms) for (const d of r.doors) keepClear.push({ x0: d.x - 0.75, x1: d.x + 0.75, z0: d.z - 0.75, z1: d.z + 0.75 });
  for (const u of ctx.fixedUses) keepClear.push(grow({ x0: u.pos.x, x1: u.pos.x, z0: u.pos.z, z1: u.pos.z }, 0.4));

  const solidOK = (r: Rect, room: RoomDef, opts: { tall?: boolean; side?: Side; front?: number; low?: boolean } = {}) => {
    if (!inside(room.rect, r, 0.0)) return false;
    for (const it of items) if (it.solid && overlap(it.rect, r, opts.low ? 0.02 : 0.08)) return false;
    for (const k of keepClear) if (overlap(k, r)) return false;
    for (const [a, b] of ctx.routes) if (segHitsRect(a, b, grow(r, 0.42))) return false;
    if (opts.tall && opts.side && room.outside.includes(opts.side)) return false; // would cover a window
    if (opts.front && opts.side) {
      // room to stand in front of it
      const n = NORMAL[opts.side];
      const f = opts.front;
      const fr: Rect = n.x ? { x0: n.x > 0 ? r.x1 : r.x0 - f, x1: n.x > 0 ? r.x1 + f : r.x0, z0: r.z0, z1: r.z1 } : { z0: n.z > 0 ? r.z1 : r.z0 - f, z1: n.z > 0 ? r.z1 + f : r.z0, x0: r.x0, x1: r.x1 };
      if (!inside(room.rect, fr)) return false;
      for (const it of items) if (it.solid && overlap(it.rect, fr)) return false;
    }
    return true;
  };

  /** try sides and positions in a seeded random order; returns the first that fits */
  const placeAgainst = (room: RoomDef, kind: string, w: number, d: number, h: number, opts: { tall?: boolean; front?: number; sides?: Side[]; color?: string; prefer?: (r: Rect, s: Side) => number } = {}): { rect: Rect; side: Side } | null => {
    const sides = (opts.sides ?? (['x0', 'x1', 'z0', 'z1'] as Side[])).map((s) => [rnd(), s] as const).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    const cands: { rect: Rect; side: Side; score: number }[] = [];
    for (const s of sides) for (let k = 0; k <= 20; k++) {
      const r = againstWall(room.rect, s, w, d, k / 20);
      if (r && room.open?.some((o) => o.side === s && (s === 'z0' || s === 'z1' ? r.x0 < o.to && r.x1 > o.from : r.z0 < o.to && r.z1 > o.from))) continue;
      if (r && solidOK(r, room, { tall: opts.tall, side: s, front: opts.front })) cands.push({ rect: r, side: s, score: (opts.prefer?.(r, s) ?? 0) + rnd() * 0.5 });
    }
    if (!cands.length) return null;
    cands.sort((a, b) => b.score - a.score);
    const c = cands[0];
    items.push({ kind, rect: c.rect, height: h, solid: true, rot: rotOf(NORMAL[c.side]), color: opts.color, room: room.id });
    return c;
  };
  const front = (r: Rect, s: Side, dist: number): Vec2 => {
    const n = NORMAL[s], cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    const half = n.x ? (r.x1 - r.x0) / 2 : (r.z1 - r.z0) / 2;
    return { x: cx + n.x * (half + dist), z: cz + n.z * (half + dist) };
  };
  const center = (r: Rect): Vec2 => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });
  const addUse = (u: PlacedUse, room: RoomDef) => { uses.push(u); nodes.push({ id: `home_${u.id}`, pos: u.pos, hub: ctx.hubs[room.id] }); };

  for (const room of ctx.rooms) {
    const R = room.rect;
    const has = (x: string) => design.extras.includes(x);
    if (room.kind === 'living') {
      // lounge: TV unit against a wall, sofa facing it about 3 m away (against the opposite wall if the
      // room is narrow enough, otherwise free-standing with its back to the room), coffee table and rug between
      for (let attempt = 0; attempt < 40; attempt++) {
        const mark = items.length;
        const tv = placeAgainst(room, 'tv', 1.6, 0.45, 0.5, { front: 2.6, prefer: (_r, s) => (room.outside.includes(s) ? 0.3 : 1) });
        if (!tv) break;
        const n = NORMAL[tv.side];
        const tc = center(tv.rect);
        const horiz = tv.side === 'z0' || tv.side === 'z1';
        const distTv = 2.9 + rnd() * 0.6;
        const sc = { x: tc.x + n.x * distTv, z: tc.z + n.z * distTv };
        const sofaR: Rect = horiz ? { x0: sc.x - 1.1, x1: sc.x + 1.1, z0: sc.z - 0.475, z1: sc.z + 0.475 } : { x0: sc.x - 0.475, x1: sc.x + 0.475, z0: sc.z - 1.1, z1: sc.z + 1.1 };
        const sofaFace = { x: -n.x, z: -n.z };
        // stand point in front of the sofa (towards the TV)
        const standP = { x: sc.x + sofaFace.x * 0.95, z: sc.z + sofaFace.z * 0.95 };
        if (!solidOK(sofaR, room) || items.some((it) => it.solid && overlap(it.rect, grow({ x0: standP.x, x1: standP.x, z0: standP.z, z1: standP.z }, 0.35)))) { items.length = mark; continue; }
        items.push({ kind: 'sofa', rect: sofaR, height: 0.85, solid: true, rot: rotOf(sofaFace), color: FABRICS[design.sofa] ?? FABRICS.green, room: room.id });
        const ctc = { x: tc.x + n.x * (distTv - 1.35), z: tc.z + n.z * (distTv - 1.35) };
        const ct: Rect = horiz ? { x0: ctc.x - 0.55, x1: ctc.x + 0.55, z0: ctc.z - 0.28, z1: ctc.z + 0.28 } : { x0: ctc.x - 0.28, x1: ctc.x + 0.28, z0: ctc.z - 0.55, z1: ctc.z + 0.55 };
        if (solidOK(ct, room, { low: true }) && !overlap(ct, grow({ x0: standP.x, x1: standP.x, z0: standP.z, z1: standP.z }, 0.3))) items.push({ kind: 'coffee_table', rect: ct, height: 0.45, solid: true, rot: rotOf(sofaFace), room: room.id });
        if (design.rug.living) {
          const rc = { x: tc.x + n.x * (distTv - 1.2), z: tc.z + n.z * (distTv - 1.2) };
          items.push({ kind: 'rug', rect: horiz ? { x0: rc.x - 1.4, x1: rc.x + 1.4, z0: rc.z - 1.0, z1: rc.z + 1.0 } : { x0: rc.x - 1.0, x1: rc.x + 1.0, z0: rc.z - 1.4, z1: rc.z + 1.4 }, height: 0.01, solid: false, rot: 0, color: RUGS[design.rug.living] ?? design.rug.living, room: room.id });
        }
        addUse({ id: 'sofa', kind: 'sofa', label: 'Sofa & TV', pos: standP, facing: rotOf({ x: -sofaFace.x, z: -sofaFace.z }), obj: sc }, room);
        break;
      }
      if (!ctx.rooms.some((r) => r.kind === 'dining')) placeDining(room);
      // side tables at the ends of the sofa, a lamp beside it
      const sofa = items.find((it) => it.kind === 'sofa' && it.room === room.id);
      if (sofa) {
        const along = sofa.rect.x1 - sofa.rect.x0 > sofa.rect.z1 - sofa.rect.z0;
        for (const sgn of [-1, 1]) {
          const r = sofa.rect;
          const st: Rect = along
            ? { x0: sgn < 0 ? r.x0 - 0.5 : r.x1 + 0.05, x1: sgn < 0 ? r.x0 - 0.05 : r.x1 + 0.5, z0: (r.z0 + r.z1) / 2 - 0.22, z1: (r.z0 + r.z1) / 2 + 0.22 }
            : { z0: sgn < 0 ? r.z0 - 0.5 : r.z1 + 0.05, z1: sgn < 0 ? r.z0 - 0.05 : r.z1 + 0.5, x0: (r.x0 + r.x1) / 2 - 0.22, x1: (r.x0 + r.x1) / 2 + 0.22 };
          if (solidOK(st, room)) items.push({ kind: 'bedside', rect: st, height: 0.5, solid: true, rot: sofa.rot, room: room.id });
        }
      }
      if (has('armchair')) for (let k = 0; k < 2; k++) placeAgainst(room, 'armchair', 0.85, 0.85, 0.85, { color: FABRICS[design.sofa] ?? FABRICS.grey, front: 0.6 });
      placeAgainst(room, 'bookcase', 0.9, 0.32, 1.9, { tall: true });
      if (has('bookcase')) placeAgainst(room, 'bookcase', 0.9, 0.32, 1.9, { tall: true });
      if (has('sideboard')) placeAgainst(room, 'sideboard', 1.4, 0.45, 0.8, { front: 0.5 });
      placeAgainst(room, 'drawers', 0.9, 0.45, 0.85, { front: 0.5 });
      for (let k = 0; k < (has('plant_big') ? 3 : 1); k++) placeAgainst(room, 'plant', 0.5, 0.5, 1.3, {});
      for (let k = 0; k < 2; k++) placeAgainst(room, 'lampstand', 0.4, 0.4, 1.6, {});
      if (has('art')) for (let k = 0; k < 3; k++) placeArt(room);
    } else if (room.kind === 'bedroom') {
      // bed with its head against a wall (not under a window if possible), bedside tables either side
      const bedC = placeAgainst(room, 'bed', 1.6, 2.1, 0.6, { color: FABRICS[design.bedding] ?? FABRICS.navy, front: 0.8, prefer: (_r, s) => (room.outside.includes(s) ? 0 : 1.5) });
      if (bedC) {
        const n = NORMAL[bedC.side];
        const horiz = bedC.side === 'z0' || bedC.side === 'z1';
        for (const sgn of [-1, 1]) {
          const r = bedC.rect;
          const bt: Rect = horiz
            ? { x0: sgn < 0 ? r.x0 - 0.5 : r.x1 + 0.05, x1: sgn < 0 ? r.x0 - 0.05 : r.x1 + 0.5, z0: n.z > 0 ? r.z0 : r.z1 - 0.42, z1: n.z > 0 ? r.z0 + 0.42 : r.z1 }
            : { z0: sgn < 0 ? r.z0 - 0.5 : r.z1 + 0.05, z1: sgn < 0 ? r.z0 - 0.05 : r.z1 + 0.5, x0: n.x > 0 ? r.x0 : r.x1 - 0.42, x1: n.x > 0 ? r.x0 + 0.42 : r.x1 };
          if (solidOK(bt, room)) items.push({ kind: 'bedside', rect: bt, height: 0.5, solid: true, rot: rotOf(n), room: room.id });
        }
        const sideMid = front(bedC.rect, bedC.side, -1.05); // middle of the bed
        // you get in from the side with more space
        const perp = horiz ? [{ x: 1, z: 0 }, { x: -1, z: 0 }] : [{ x: 0, z: 1 }, { x: 0, z: -1 }];
        const halfW = 0.8;
        const opts = perp.map((p) => ({ p, pos: { x: sideMid.x + p.x * (halfW + 0.55), z: sideMid.z + p.z * (halfW + 0.55) } })).filter((o) => o.pos.x > R.x0 + 0.3 && o.pos.x < R.x1 - 0.3 && o.pos.z > R.z0 + 0.3 && o.pos.z < R.z1 - 0.3 && !items.some((it) => it.solid && overlap(it.rect, grow({ x0: o.pos.x, x1: o.pos.x, z0: o.pos.z, z1: o.pos.z }, 0.3))));
        const g = opts[0] ?? { p: perp[0], pos: front(bedC.rect, bedC.side, 0.5) };
        if (design.rug.bedroom) items.push({ kind: 'rug', rect: grow({ x0: g.pos.x, x1: g.pos.x, z0: g.pos.z, z1: g.pos.z }, 0.6), height: 0.01, solid: false, rot: 0, color: RUGS[design.rug.bedroom] ?? design.rug.bedroom, room: room.id });
        addUse({ id: 'bed', kind: 'bed', label: 'Bed', pos: g.pos, facing: Math.atan2(-g.p.x, -g.p.z), obj: sideMid, range: 1.8 }, room);
      }
      const wd = placeAgainst(room, 'wardrobe', 2.2, 0.7, 2.1, { tall: true, front: 0.9 });
      if (wd) { const n = NORMAL[wd.side]; addUse({ id: 'wardrobe', kind: 'wardrobe', label: 'Wardrobe', pos: front(wd.rect, wd.side, 0.6), facing: rotOf({ x: -n.x, z: -n.z }), obj: center(wd.rect) }, room); }
      placeAgainst(room, 'drawers', 0.9, 0.48, 0.85, { front: 0.5 });
      if (has('desk')) placeAgainst(room, 'desk', 1.2, 0.6, 0.75, { front: 0.7 });
      // a reading corner and a chest of drawers fill the rest of a big bedroom
      placeAgainst(room, 'armchair', 0.8, 0.8, 0.85, { color: FABRICS[design.bedding] ?? FABRICS.grey, front: 0.6 });
      placeAgainst(room, 'lampstand', 0.4, 0.4, 1.6, {});
      placeAgainst(room, 'bookcase', 0.9, 0.32, 1.9, { tall: true });
      placeAgainst(room, 'sideboard', 1.2, 0.45, 0.8, { front: 0.5 });
      for (let k = 0; k < (has('plant_bed') ? 2 : 1); k++) placeAgainst(room, 'plant', 0.45, 0.45, 1.1, {});
      if (!design.rug.bedroom && bedC) {
        // a runner at the foot of the bed
        const f = front(bedC.rect, bedC.side, 0.55);
        const horiz = bedC.side === 'z0' || bedC.side === 'z1';
        items.push({ kind: 'rug', rect: horiz ? { x0: f.x - 1.0, x1: f.x + 1.0, z0: f.z - 0.4, z1: f.z + 0.4 } : { x0: f.x - 0.4, x1: f.x + 0.4, z0: f.z - 1.0, z1: f.z + 1.0 }, height: 0.01, solid: false, rot: 0, color: '#9c8a74', room: room.id });
      }
      if (has('art')) placeArt(room);
    }
    else if (room.kind === 'dining') {
      placeDining(room);
      placeAgainst(room, 'sideboard', 1.2, 0.45, 0.8, { front: 0.5 });
      placeAgainst(room, 'plant', 0.45, 0.45, 1.2, {});
      if (has('art')) placeArt(room);
    } else if (room.kind === 'spare') {
      // spare room / study: a single guest bed, a desk to work at, shelves and a comfy chair
      placeAgainst(room, 'bed', 1.0, 2.0, 0.55, { color: FABRICS[design.bedding] ?? FABRICS.grey, front: 0.6, prefer: (_r, s) => (room.outside.includes(s) ? 0 : 1) });
      placeAgainst(room, 'desk', 1.2, 0.6, 0.75, { front: 0.7, prefer: (_r, s) => (room.outside.includes(s) ? 1 : 0) });
      placeAgainst(room, 'bookcase', 0.9, 0.32, 1.9, { tall: true });
      placeAgainst(room, 'armchair', 0.8, 0.8, 0.85, { color: FABRICS[design.sofa] ?? FABRICS.grey, front: 0.5 });
      placeAgainst(room, 'plant', 0.45, 0.45, 1.1, {});
      placeAgainst(room, 'lampstand', 0.4, 0.4, 1.6, {});
      const c = center(room.rect);
      items.push({ kind: 'rug', rect: { x0: c.x - 0.9, x1: c.x + 0.9, z0: c.z - 0.6, z1: c.z + 0.6 }, height: 0.01, solid: false, rot: 0, color: RUGS[design.rug.bedroom ?? 'sand'] ?? '#c9b79c', room: room.id });
      if (has('art')) placeArt(room);
    } else if (room.kind === 'utility') {
      // storage and laundry: shelving with boxes, an ironing board, the laundry basket, a drying rack and a bike
      for (let k = 0; k < 2; k++) placeAgainst(room, 'storage_shelf', 1.0, 0.45, 1.85, { tall: true });
      placeAgainst(room, 'bike', 1.75, 0.5, 1.0, {});
      placeAgainst(room, 'ironing_board', 1.3, 0.4, 0.9, {});
      placeAgainst(room, 'laundry_basket', 0.5, 0.38, 0.5, {});
      placeAgainst(room, 'drying_rack', 1.2, 0.55, 1.0, { front: 0.4 });
      placeAgainst(room, 'vacuum', 0.35, 0.35, 1.05, {});
    }
    // finishes: floor and wallpaper for every room
    const fk = room.kind === 'dining' ? 'living' : room.kind === 'spare' ? 'bedroom' : room.kind;
    const fl = room.kind === 'utility' ? 'grey' : design.floor[fk] ?? design.floor[room.id];
    if (fl) items.push({ kind: 'floorfinish', rect: R, height: 0.01, solid: false, rot: 0, color: fl, room: room.id });
    const wp = room.kind === 'utility' ? 'white' : design.wallpaper[fk] ?? design.wallpaper[room.id];
    if (wp) items.push({ kind: 'wallfinish', rect: R, height: 3.2, solid: false, rot: 0, color: wp, room: room.id });
  }

  /** dining table with two chairs (the laptop lives here) */
  function placeDining(room: RoomDef) {
    const R = room.rect;
    for (let attempt = 0; attempt < 60; attempt++) {
      const cx = R.x0 + 1.2 + rnd() * (R.x1 - R.x0 - 2.4), cz = R.z0 + 1.4 + rnd() * (R.z1 - R.z0 - 2.8);
      const along = rnd() < 0.5;
      const t: Rect = along ? { x0: cx - 0.7, x1: cx + 0.7, z0: cz - 0.45, z1: cz + 0.45 } : { x0: cx - 0.45, x1: cx + 0.45, z0: cz - 0.7, z1: cz + 0.7 };
      const foot = along ? { ...t, z0: t.z0 - 0.65, z1: t.z1 + 0.65 } : { ...t, x0: t.x0 - 0.65, x1: t.x1 + 0.65 };
      if (!solidOK(foot, room)) continue;
      items.push({ kind: 'dining_table', rect: t, height: 0.75, solid: true, rot: along ? 0 : Math.PI / 2, room: room.id });
      const seat = along ? { x: cx, z: t.z0 - 0.35 } : { x: t.x0 - 0.35, z: cz };
      const seat2 = along ? { x: cx, z: t.z1 + 0.35 } : { x: t.x1 + 0.35, z: cz };
      items.push({ kind: 'dining_chair', rect: { x0: seat.x - 0.22, x1: seat.x + 0.22, z0: seat.z - 0.22, z1: seat.z + 0.22 }, height: 0.9, solid: false, rot: Math.atan2(cx - seat.x, cz - seat.z), room: room.id });
      items.push({ kind: 'dining_chair', rect: { x0: seat2.x - 0.22, x1: seat2.x + 0.22, z0: seat2.z - 0.22, z1: seat2.z + 0.22 }, height: 0.9, solid: false, rot: Math.atan2(cx - seat2.x, cz - seat2.z), room: room.id });
      items.push({ kind: 'laptop', rect: { x0: cx - 0.2, x1: cx + 0.2, z0: cz - 0.15, z1: cz + 0.15 }, height: 0.77, solid: false, rot: Math.atan2(seat.x - cx, seat.z - cz), room: room.id });
      addUse({ id: 'chair', kind: 'chair', label: 'Chair', pos: seat, facing: Math.atan2(cx - seat.x, cz - seat.z), obj: seat }, room);
      return;
    }
  }

  function placeArt(room: RoomDef) {
    // a framed picture at eye level on a wall with nothing tall in front of it
    const R = room.rect;
    for (let k = 0; k < 30; k++) {
      const s = (['x0', 'x1', 'z0', 'z1'] as Side[])[Math.floor(rnd() * 4)];
      if (room.outside.includes(s)) continue;
      const r = againstWall(R, s, 0.8, 0.04, 0.15 + rnd() * 0.7, 0.0);
      if (!r) continue;
      // open-plan edges have no wall to hang it on
      if (room.open?.some((o) => o.side === s && (s === 'z0' || s === 'z1' ? r.x0 < o.to + 0.3 && r.x1 > o.from - 0.3 : r.z0 < o.to + 0.3 && r.z1 > o.from - 0.3))) continue;
      if (items.some((it) => it.solid && it.height > 1.2 && overlap(it.rect, r, 0.3))) continue;
      if (items.some((it) => it.kind === 'art' && overlap(it.rect, r, 0.6))) continue;
      if (ctx.rooms.some((rm) => rm.doors.some((d) => Math.hypot(d.x - (r.x0 + r.x1) / 2, d.z - (r.z0 + r.z1) / 2) < 1.0))) continue;
      items.push({ kind: 'art', rect: r, height: 1.55, solid: false, rot: rotOf(NORMAL[s]), color: ['#c45a3c', '#3c6e8c', '#d9b44a', '#5f8a5a', '#8a5f8a'][Math.floor(rnd() * 5)], room: room.id });
      return;
    }
  }

  return { items, uses, nodes };
}
