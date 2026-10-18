// SaveLoadSystem: versioned JSON, validation, migration, safe writes.
import type { GameState } from './types';
import { makeBusiness, SAVE_VERSION } from './newgame';
import { auditLedger } from './ledger';
import { getWorld, setHomeDesign } from './world/layout';
import { defaultDesign } from './world/homes';

export interface SaveFile {
  format: 'bigshot-save';
  version: number;
  savedAt: string;
  summary: string;
  state: GameState;
}

export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** migrations from version N to N+1 */
const MIGRATIONS: Record<number, (s: any) => void> = {
  1: (s) => {
    // v1 -> v2: shipments gained `paid`, districts gained `cafeAccumulator`
    for (const sh of Object.values<any>(s.shipments ?? {})) if (sh.paid === undefined) sh.paid = sh.status === 'received';
    for (const d of Object.values<any>(s.districts ?? {})) if (d.cafeAccumulator === undefined) d.cafeAccumulator = 0;
  },
  2: (s) => {
    // v2 -> v3: hygiene & mood needs, relationships, business sections/equipment, per-shop demand
    for (const p of Object.values<any>(s.people ?? {})) { p.needs.hygiene ??= 80; p.needs.mood ??= 60; p.relations ??= {}; }
    for (const b of Object.values<any>(s.businesses ?? {})) { b.sections ??= {}; b.equipment ??= {}; }
    if (s.businesses?.market && !Object.keys(s.businesses.market.sections).length) for (const k of ['bread', 'milk', 'apples', 'soup', 'pasta', 'coffee', 'snacks', 'soap']) s.businesses.market.sections[`shelf_${k}`] = k;
    for (const d of Object.values<any>(s.districts ?? {})) d.shopDemand ??= { market: d.demandAccumulator ?? 0 };
  },
  3: (s) => {
    // v3 -> v4: shelves hold 64 units; the flat was divided into rooms, so whoever was inside goes back to the hall
    for (const c of Object.values<any>(s.containers ?? {})) {
      if (c.kind === 'shelf' && c.capacity === 30) c.capacity = 64;
      if (c.kind === 'loading_bay' && c.capacity < 1500) c.capacity = 1500; // a bay takes a full van
    }
    const spawn = getWorld().playerSpawn;
    for (const p of Object.values<any>(s.people ?? {})) if (p.where === 'flat' && p.visible) p.pos = { ...spawn };
  },
  4: (s) => {
    // v4 -> v5: homes are furnished from a design; the flat keeps its occupant in the hall while it is refurnished
    s.homeDesigns ??= { flat: defaultDesign(1) };
    const spawn = getWorld().playerSpawn;
    for (const p of Object.values<any>(s.people ?? {})) if (p.where === 'flat' && p.visible && !p.sleeping) p.pos = { ...spawn };
  },
  5: (s) => {
    // v5 -> v6: Harbour Wholesale is a walkable warehouse; picked orders wait in staging lanes; the flat has more rooms
    if (!s.containers.wholesale_staging) {
      s.containers.wholesale_staging = { id: 'wholesale_staging', kind: 'warehouse', ownerId: 'wholesale', locationId: 'wholesale', capacity: 3000, items: {} };
      s.businesses.wholesale?.stockContainers.push('wholesale_staging');
    }
    const spawn = getWorld().playerSpawn;
    for (const p of Object.values<any>(s.people ?? {})) if (p.where === 'flat' && p.visible && !p.sleeping) p.pos = { ...spawn };
  },
  6: (s) => {
    // v6 -> v7: the old bank reopens as Harbour Home, the furniture & decor store
    if (!s.businesses.homestore) {
      makeBusiness(s, {
        id: 'homestore', name: 'Harbour Home', kind: 'store', ownerId: 'external', locationId: 'homestore', open: [{ days: [0, 1, 2, 3, 4, 5], start: 9 * 60, end: 18 * 60 }],
        positions: [{ id: 'sales', title: 'Sales Assistant', wage: 1300, shifts: [{ days: [0, 1, 2, 3, 4, 5], start: 9 * 60, end: 18 * 60 }], payEvery: 'daily', headcount: 1, requires: {}, uniform: null, playable: false, description: 'Helps customers choose furniture and decor and takes their orders at the counter.', duties: [] }],
        prices: {}, reputation: 60, supplierId: null, reorder: {}, rentDue: 0, utilitiesPerDay: 1200, stockContainers: [], cashReserve: 400000, cash: 500000,
      });
    }
  },
};

export function serialize(state: GameState, summary = ''): string {
  const f: SaveFile = { format: 'bigshot-save', version: SAVE_VERSION, savedAt: new Date().toISOString(), summary, state };
  return JSON.stringify(f);
}

export function validate(state: GameState): string[] {
  const errs: string[] = [];
  const req = ['minute', 'ledger', 'containers', 'people', 'businesses', 'contracts', 'attendance', 'tills', 'vehicles', 'leases', 'districts'] as const;
  for (const k of req) if ((state as any)[k] === undefined) errs.push(`missing ${k}`);
  if (errs.length) return errs;
  if (!state.people[state.playerId]) errs.push('player missing');
  for (const p of Object.values(state.people)) {
    for (const c of [p.handsId, p.bagId, p.basketId, p.pantryId, p.wardrobeId]) if (c && !state.containers[c]) errs.push(`${p.id}: container ${c} missing`);
    if (!state.ledger.accounts[p.accountId]) errs.push(`${p.id}: account missing`);
    if (p.contractId && !state.contracts[p.contractId]) errs.push(`${p.id}: contract missing`);
    if (p.contractId && state.contracts[p.contractId]?.personId !== p.id) errs.push(`${p.id}: contract belongs to someone else`);
  }
  for (const c of Object.values(state.contracts)) {
    if (!state.people[c.personId]) errs.push(`contract ${c.id}: person missing`);
    if (!state.businesses[c.businessId]) errs.push(`contract ${c.id}: business missing`);
  }
  for (const b of Object.values(state.businesses)) {
    if (!state.ledger.accounts[b.accountId]) errs.push(`${b.id}: account missing`);
    for (const c of b.stockContainers) if (!state.containers[c]) errs.push(`${b.id}: container ${c} missing`);
  }
  for (const s of Object.values(state.shipments)) if (!state.businesses[s.buyerId] || !state.businesses[s.supplierId]) errs.push(`shipment ${s.id}: party missing`);
  for (const c of Object.values(state.containers)) for (const [k, n] of Object.entries(c.items)) if (!Number.isFinite(n) || n < 0) errs.push(`container ${c.id}: bad quantity ${k}=${n}`);
  const bad = auditLedger(state);
  if (bad.length) errs.push(`ledger inconsistent for ${bad.join(', ')}`);
  const w = getWorld();
  for (const t of Object.values(state.tills)) if (!w.interactables[t.id]) errs.push(`till ${t.id} not in world`);
  return errs;
}

export function deserialize(text: string): { ok: true; state: GameState; migrated: boolean } | { ok: false; error: string } {
  let f: any;
  try {
    f = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Save file is not valid JSON.' };
  }
  if (f?.format !== 'bigshot-save' || typeof f.version !== 'number' || !f.state) return { ok: false, error: 'Not a BIGSHOT save file.' };
  if (f.version > SAVE_VERSION) return { ok: false, error: `Save is from a newer version (${f.version}).` };
  const s = f.state;
  let migrated = false;
  for (let v = f.version; v < SAVE_VERSION; v++) {
    const m = MIGRATIONS[v];
    if (!m) return { ok: false, error: `No migration from version ${v}.` };
    m(s);
    migrated = true;
  }
  s.version = SAVE_VERSION;
  const errs = validate(s);
  if (errs.length) return { ok: false, error: `Save failed validation: ${errs.slice(0, 5).join('; ')}` };
  // derived/transient state is reconstructed rather than trusted
  for (const p of Object.values<any>(s.people)) if (p.move && !Array.isArray(p.move.path)) p.move = null;
  // the world's furniture follows the loaded home design
  if (s.homeDesigns?.flat) setHomeDesign(s.homeDesigns.flat);
  return { ok: true, state: s, migrated };
}

/** write to a temp slot, verify it round-trips, then promote it and keep a backup */
export function safeWrite(kv: KV, slot: string, state: GameState, summary: string): { ok: boolean; error?: string } {
  const errs = validate(state);
  if (errs.length) return { ok: false, error: `Refusing to save invalid state: ${errs[0]}` };
  const text = serialize(state, summary);
  try {
    kv.set(`${slot}.tmp`, text);
    const back = kv.get(`${slot}.tmp`);
    const check = back ? deserialize(back) : null;
    if (!check || !check.ok) return { ok: false, error: 'Verification of written save failed.' };
    const prev = kv.get(slot);
    if (prev) kv.set(`${slot}.bak`, prev);
    kv.set(slot, text);
    kv.remove(`${slot}.tmp`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Storage error: ${(e as Error).message}` };
  }
}

export function loadSlot(kv: KV, slot: string) {
  const text = kv.get(slot);
  if (!text) return { ok: false as const, error: 'No save in this slot.' };
  const r = deserialize(text);
  if (!r.ok) {
    const bak = kv.get(`${slot}.bak`);
    if (bak) {
      const rb = deserialize(bak);
      if (rb.ok) return { ...rb, recoveredFromBackup: true };
    }
  }
  return r;
}
