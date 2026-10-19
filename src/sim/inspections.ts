// Town events: council food-hygiene inspections of the shops and the cafe, and the occasional power
// cut that closes a business for an hour or two.
import type { Business, GameState, Id } from './types';
import { at, dayIndex, fmtDate, minuteOfDay } from './clock';
import { clamp, fmtMoney, rand } from './core';
import { transfer } from './ledger';
import { news } from './events';
import { BIN_CAPACITY, CARDBOARD_AT, cleanliness, FACE_AT, isOpen } from './retail';

export interface Inspection { day: number; score: number; rating: number; notes: string[] }
export interface HygieneRecord { nextAt: number; rating: number | null; history: Inspection[] }

const INSPECTED: ReadonlySet<string> = new Set(['retail', 'cafe']);
export const FINE = 25000;

export const RATING_LABEL = ['Urgent improvement necessary', 'Major improvement necessary', 'Improvement necessary', 'Generally satisfactory', 'Good', 'Very good'];

function records(state: GameState): Record<Id, HygieneRecord> {
  return (state.hygiene ??= {});
}

/** next visit: unannounced, on an opening day between 10:00 and 15:00, `days` days or so from now */
function schedule(state: GameState, days: number): number {
  const d = dayIndex(state.minute) + days + Math.floor(rand(state) * 5);
  return at(d, 10 + Math.floor(rand(state) * 5), Math.floor(rand(state) * 60));
}

export function hygieneOf(state: GameState, bid: Id): HygieneRecord | undefined {
  return state.hygiene?.[bid];
}

/** demand multiplier from the rating in the window (no rating yet: neutral) */
export function hygieneFactor(state: GameState, bid: Id): number {
  const r = state.hygiene?.[bid]?.rating;
  if (r === null || r === undefined) return 1;
  return [0.6, 0.72, 0.85, 0.95, 1.0, 1.05][r];
}

/** what the inspector sees right now */
export function inspect(state: GameState, b: Business): Inspection {
  const notes: string[] = [];
  let score = 100;
  if (b.kind === 'retail') {
    const clean = cleanliness(state, b.id);
    if (clean < 95) { score -= (100 - clean) * 0.6; notes.push(`Spills on the shop floor (cleanliness ${Math.round(clean)}%)`); }
    const messy = Object.values(b.messy ?? {});
    const untidy = messy.filter((m) => m >= FACE_AT).length;
    if (untidy) { score -= untidy * 4; notes.push(`${untidy} untidy shelf section${untidy > 1 ? 's' : ''}`); }
    if ((b.cardboard ?? 0) >= CARDBOARD_AT) { score -= 10; notes.push('Cardboard piled up in the store room (fire risk)'); }
    if ((b.binFill ?? 0) >= BIN_CAPACITY) { score -= 12; notes.push('Overflowing litter bin at the door'); }
  } else {
    // the cafe kitchen: clean when it is staffed and busy enough to keep on top of things
    const rep = b.reputation;
    score -= Math.max(0, 70 - rep) * 0.8;
    if (rep < 70) notes.push('Kitchen surfaces and storage need attention');
    score -= rand(state) * 12;
  }
  score = clamp(Math.round(score), 0, 100);
  const rating = score >= 90 ? 5 : score >= 78 ? 4 : score >= 62 ? 3 : score >= 45 ? 2 : score >= 25 ? 1 : 0;
  if (!notes.length) notes.push('Clean and well kept');
  return { day: dayIndex(state.minute), score, rating, notes };
}

function involved(state: GameState, b: Business): boolean {
  const p = state.people[state.playerId];
  if (!p) return false;
  return b.ownerId === p.id || (!!p.contractId && state.contracts[p.contractId]?.businessId === b.id) || (b.shares?.[p.id] ?? 0) > 0;
}

export function inspectionsTick(state: GameState) {
  const recs = records(state);
  for (const b of Object.values(state.businesses)) {
    if (!INSPECTED.has(b.kind)) continue;
    const rec = (recs[b.id] ??= { nextAt: schedule(state, 3), rating: null, history: [] });
    if (state.minute < rec.nextAt) continue;
    if (!isOpen(b, state.minute)) {
      // closed when the inspector called: try again tomorrow
      rec.nextAt = schedule(state, 1);
      continue;
    }
    const r = inspect(state, b);
    rec.rating = r.rating;
    rec.history.push(r);
    if (rec.history.length > 8) rec.history.shift();
    b.reputation = clamp(b.reputation + [-10, -6, -3, 0, 1, 3][r.rating], 0, 100);
    if (r.rating <= 1) {
      transfer(state, { from: b.accountId, to: state.businesses[state.governmentId].accountId, amount: FINE, reason: 'public_service', memo: `Hygiene improvement notice: ${b.name}`, key: `hyg_fine:${b.id}:${r.day}` });
    }
    // poor ratings are re-checked within a week; good ones every two to three weeks
    rec.nextAt = schedule(state, r.rating <= 2 ? 5 : 14);
    const mine = involved(state, b);
    news(state, r.rating >= 4 ? (mine ? 'good' : 'world') : r.rating <= 2 ? (mine ? 'bad' : 'world') : 'world', `Hygiene rating: ${b.name} ${r.rating}/5`,
      `${RATING_LABEL[r.rating]}. ${r.notes.join('. ')}.${r.rating <= 1 ? ` Fined ${fmtMoney(FINE)}.` : ''}${r.rating <= 2 ? ' The inspector will be back within a week.' : ''}`, mine);
  }
}

// ------------------------------------------------------------------ power cuts
const OUTAGE_CHANCE_PER_DAY = 0.08;

export function powerCutTick(state: GameState) {
  const now = state.minute;
  const mod = minuteOfDay(now);
  const day = dayIndex(now);
  if (mod !== 9 * 60) return;
  if (state.processed[`outage_roll:${day}`]) return;
  state.processed[`outage_roll:${day}`] = now;
  if (rand(state) >= OUTAGE_CHANCE_PER_DAY) return;
  const cands = Object.values(state.businesses).filter((b) => INSPECTED.has(b.kind) || b.kind === 'store');
  if (!cands.length) return;
  const b = cands[Math.floor(rand(state) * cands.length)];
  const start = at(day, 10 + Math.floor(rand(state) * 6), Math.floor(rand(state) * 60));
  b.outage = { from: start, until: start + 60 + Math.floor(rand(state) * 90) };
  news(state, 'world', `Power cut expected on ${b.name}'s street`, `Engineers will work on the supply from ${fmtDate(start)} for about ${Math.round((b.outage.until - b.outage.from) / 60 * 10) / 10} hours. ${b.name} will close while the power is off.`, involved(state, b));
}

export function inOutage(b: Business, minute: number): boolean {
  return !!b.outage && minute >= b.outage.from && minute < b.outage.until;
}
