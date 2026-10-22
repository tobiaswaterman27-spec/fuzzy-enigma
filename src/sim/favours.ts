// Favours: ask someone if they need a hand and, depending on who they are, they will want some
// shopping fetched, a parcel taken to a neighbour, a fresh fish for their tea, or their dog walked.
// Do it and they pay you and think better of you; leave it too long and they are let down.
import type { GameState, Id, Person } from './types';
import { clamp, dist, fmtMoney, nextId } from './core';
import { lifeEvent, news } from './events';
import { addItems, count, removeItems } from './inventory';
import { itemName } from './items';
import { transfer } from './ledger';
import { HOUSE_IDS } from './world/layout';

export type FavourKind = 'fetch' | 'deliver' | 'fish' | 'walk_dog';
export interface Favour { id: Id; from: Id; kind: FavourKind; item?: string; to?: Id; reward: number; until: number; status: 'open' | 'done' | 'failed'; since: number; text: string }

const GROCERIES = ['bread', 'milk', 'apples', 'coffee', 'soup', 'snacks'];
const first = (p: Person) => p.name.split(' ')[0];
const hash = (s: string) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

export const openFavour = (state: GameState, fromId?: Id) => (state.favours ?? []).find((f) => f.status === 'open' && (!fromId || f.from === fromId)) ?? null;

/** what they would like doing (depends on who they are and the day) */
export function askFavour(state: GameState, playerId: Id, fromId: Id): { ok: boolean; msg: string } {
  const p = state.people[fromId], me = state.people[playerId];
  if (!p) return { ok: false, msg: '' };
  if (openFavour(state, fromId)) return { ok: false, msg: `You are already doing something for ${first(p)}.` };
  if ((state.favours ?? []).filter((f) => f.status === 'open').length >= 3) return { ok: false, msg: 'You have enough on your plate.' };
  const last = (state.favours ?? []).filter((f) => f.from === fromId).pop();
  if (last && state.minute - last.since < 1440) return { ok: false, msg: `${first(p)} doesn't need anything else today.` };
  const day = Math.floor(state.minute / 1440);
  const kinds: FavourKind[] = ['fetch', 'deliver'];
  if (p.dog) kinds.push('walk_dog');
  if ((p.age ?? 40) > 50 || p.traits.thrift > 0.6) kinds.push('fish');
  const kind = kinds[hash(p.id + day) % kinds.length];
  const f: Favour = { id: nextId(state, 'fav'), from: fromId, kind, reward: 0, until: state.minute + 8 * 60, status: 'open', since: state.minute, text: '' };
  if (kind === 'fetch') {
    f.item = GROCERIES[hash(p.id + 'g' + day) % GROCERIES.length];
    f.reward = 800;
    f.text = `Fetch ${first(p)} some ${itemName(f.item).toLowerCase()} from Corner Market`;
  } else if (kind === 'deliver') {
    const others = Object.values(state.people).filter((o) => o.homeId && HOUSE_IDS.includes(o.homeId) && o.id !== fromId && !o.dead && !o.left && !o.isPlayer);
    const to = others[hash(p.id + 'd' + day) % Math.max(1, others.length)];
    if (!to) return { ok: false, msg: `${first(p)} can't think of anything.` };
    f.to = to.id; f.item = 'parcel'; f.reward = 600;
    addItems(state.containers[me.bagId], 'parcel', 1);
    f.text = `Take ${first(p)}'s parcel to ${to.name} (${to.homeId!.replace('house_', 'No. ')} Harbour Road, or wherever they are)`;
  } else if (kind === 'fish') {
    f.reward = 1200;
    f.text = `Catch ${first(p)} a fresh fish for their tea (the quay)`;
  } else {
    f.reward = 1000;
    f.until = state.minute + 4 * 60;
    f.text = `Walk ${first(p)}'s dog ${p.dog!.name} for half an hour, then bring them back`;
    (me as any).borrowedDog = { owner: fromId, since: state.minute, dog: p.dog };
  }
  (state.favours ??= []).push(f);
  news(state, 'info', `Favour for ${first(p)}`, `${f.text}. They will give you ${fmtMoney(f.reward)}.`, true);
  return { ok: true, msg: `${f.text} (${fmtMoney(f.reward)}).` };
}

/** can the favour be handed in to this person right now? */
export function canComplete(state: GameState, playerId: Id, personId: Id): Favour | null {
  const me = state.people[playerId];
  const bag = state.containers[me.bagId];
  for (const f of state.favours ?? []) {
    if (f.status !== 'open') continue;
    if (f.kind === 'deliver' && f.to === personId && count(bag, 'parcel') > 0) return f;
    if (f.from !== personId) continue;
    if (f.kind === 'fetch' && count(bag, f.item!) > 0) return f;
    if (f.kind === 'fish' && ['fish_mackerel', 'fish_pollock', 'fish_bass', 'fish_cod'].some((k) => count(bag, k) > 0)) return f;
    if (f.kind === 'walk_dog' && state.minute - ((me as any).borrowedDog?.since ?? state.minute) >= 30) return f;
  }
  return null;
}

export function completeFavour(state: GameState, playerId: Id, personId: Id): string {
  const f = canComplete(state, playerId, personId);
  if (!f) return '';
  const me = state.people[playerId], p = state.people[f.from], bag = state.containers[me.bagId];
  if (f.kind === 'fetch') removeItems(bag, f.item!, 1);
  if (f.kind === 'deliver') removeItems(bag, 'parcel', 1);
  if (f.kind === 'fish') { const k = ['fish_bass', 'fish_cod', 'fish_pollock', 'fish_mackerel'].find((x) => count(bag, x) > 0)!; removeItems(bag, k, 1); }
  if (f.kind === 'walk_dog') (me as any).borrowedDog = undefined;
  // the person who asked pays (or the one you delivered to tips you, if it was a parcel)
  const payer = p && (state.ledger.accounts[p.accountId]?.balance ?? 0) > f.reward ? p.accountId : state.externalId;
  transfer(state, { from: payer, to: me.accountId, amount: f.reward, reason: 'transfer', memo: `Favour for ${p?.name}`, key: `favour:${f.id}` });
  f.status = 'done';
  me.favoursDone = (me.favoursDone ?? 0) + 1;
  for (const id of [f.from, f.to]) { const o = id ? state.people[id] : null; if (o) { o.relations[me.id] = clamp((o.relations[me.id] ?? 0) + 8, 0, 100); me.relations[o.id] = o.relations[me.id]; } }
  if (p) lifeEvent(state, p, `${me.name} did them a favour`);
  return `${p ? first(p) : 'They'} ${f.kind === 'deliver' ? 'will be pleased the parcel arrived' : 'is really grateful'}: ${fmtMoney(f.reward)}.`;
}

/** every minute: favours left too long go sour */
export function favoursTick(state: GameState) {
  for (const f of state.favours ?? []) {
    if (f.status !== 'open' || state.minute < f.until) continue;
    f.status = 'failed';
    const p = state.people[f.from], me = state.people[state.playerId];
    if (p) { p.relations[me.id] = clamp((p.relations[me.id] ?? 0) - 6, 0, 100); lifeEvent(state, p, `${me.name} let them down`); }
    if (f.kind === 'walk_dog') (me as any).borrowedDog = undefined;
    if (f.kind === 'deliver') removeItems(state.containers[me.bagId], 'parcel', 1);
    news(state, 'bad', `You let ${p ? first(p) : 'someone'} down`, `${f.text}: too late now.`, true);
  }
  if ((state.favours?.length ?? 0) > 30) state.favours = state.favours!.slice(-30);
}

export const favourNear = (me: Person, p: Person) => dist(me.pos, p.pos) < 3;
