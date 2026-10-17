// InventorySystem: containers hold item counts. All moves are validated and atomic.
import type { Container, ContainerKind, GameState, Id } from './types';
import { nextId } from './core';

export function createContainer(
  state: GameState,
  kind: ContainerKind,
  ownerId: Id,
  locationId: Id,
  capacity: number,
  filter?: string,
  id?: Id,
): Container {
  const cid = id ?? nextId(state, 'ctr');
  const c: Container = { id: cid, kind, ownerId, locationId, capacity, items: {} };
  if (filter) c.filter = filter;
  state.containers[cid] = c;
  return c;
}

export const count = (c: Container | undefined, item: string) => (c ? c.items[item] ?? 0 : 0);
export const total = (c: Container | undefined) => (c ? Object.values(c.items).reduce((a, b) => a + b, 0) : 0);
export const isEmpty = (c: Container | undefined) => total(c) === 0;

export function spaceFor(c: Container, item: string): number {
  if (c.filter && c.filter !== item) return 0;
  return Math.max(0, c.capacity - total(c));
}

/** Add items from outside the inventory system (production, imports, initial stock). */
export function addItems(c: Container, item: string, qty: number): number {
  const n = Math.min(qty, spaceFor(c, item));
  if (n > 0) c.items[item] = (c.items[item] ?? 0) + n;
  return n;
}

/** Remove items leaving the inventory system (consumption). Returns removed amount. */
export function removeItems(c: Container, item: string, qty: number): number {
  const have = c.items[item] ?? 0;
  const n = Math.min(have, qty);
  if (n <= 0) return 0;
  if (have - n === 0) delete c.items[item];
  else c.items[item] = have - n;
  return n;
}

/** Move up to qty units between containers. Returns units moved (never creates or destroys items). */
export function moveItems(state: GameState, fromId: Id, toId: Id, item: string, qty: number): number {
  const from = state.containers[fromId];
  const to = state.containers[toId];
  if (!from || !to || qty <= 0) return 0;
  const n = Math.min(qty, from.items[item] ?? 0, spaceFor(to, item));
  if (n <= 0) return 0;
  removeItems(from, item, n);
  to.items[item] = (to.items[item] ?? 0) + n;
  return n;
}

export function moveAll(state: GameState, fromId: Id, toId: Id): number {
  const from = state.containers[fromId];
  if (!from) return 0;
  let n = 0;
  for (const item of Object.keys(from.items)) n += moveItems(state, fromId, toId, item, from.items[item]);
  return n;
}

export function firstItem(c: Container | undefined): string | null {
  if (!c) return null;
  for (const [k, v] of Object.entries(c.items)) if (v > 0) return k;
  return null;
}

/** total units of an item across the whole world - used by conservation tests */
export function worldCount(state: GameState, item: string): number {
  let n = 0;
  for (const c of Object.values(state.containers)) n += c.items[item] ?? 0;
  return n;
}
