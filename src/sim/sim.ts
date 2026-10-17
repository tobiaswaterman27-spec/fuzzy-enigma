// WorldSimulation: the single entry point that advances the world.
// Fine-grained movement/actions run in sub-steps; economic and scheduled
// systems run once per whole game minute so nothing is skipped when the
// clock is accelerated (sleeping, fast-forward).
import type { GameState, Person } from './types';
import { MIN_PER_DAY, minuteOfDay, dayIndex } from './clock';
import { tickNeeds } from './needs';
import { enforceLocationRules, tickAction } from './actions';
import { employmentTick, processApplications, refreshVacancies, runPayroll } from './employment';
import { autoReorder, dailyClose, retailTick } from './retail';
import { logisticsTick, retryInvoices, wholesaleImports } from './logistics';
import { rentTick } from './housing';
import { npcJobSearch, npcPostAction, npcTick, tickMovement } from './npc';
import { cafeReorder, dailyEconomy, economyTick } from './economy';
import { tickObjectives } from './objectives';
import { compactLedger } from './ledger';
import { news } from './events';
import { syncReorderRules, UNIT4 } from './enterprise';

export const SUBSTEP = 0.25;

export interface StepEvents {
  /** messages produced by the player's own actions (for UI toasts) */
  player: string[];
}

export function step(state: GameState, dtMinutes: number, ev: StepEvents = { player: [] }): StepEvents {
  let remaining = Math.min(dtMinutes, 24 * 60);
  while (remaining > 1e-9) {
    const prev = state.minute;
    const nextWhole = Math.floor(prev) + 1;
    const dt = Math.min(SUBSTEP, remaining, nextWhole - prev);
    state.minute = prev + dt;
    remaining -= dt;
    substep(state, dt, ev);
    if (Math.floor(state.minute + 1e-9) > Math.floor(prev + 1e-9)) {
      state.minute = Math.round(state.minute * 1e6) / 1e6;
      minuteTick(state);
    }
  }
  return ev;
}

function substep(state: GameState, dt: number, ev: StepEvents) {
  for (const p of Object.values(state.people)) {
    if (p.action) {
      const msg = tickAction(state, p, dt);
      if (msg && p.isPlayer) ev.player.push(msg);
    }
    if (p.move) tickMovement(state, p, dt);
    tickNeeds(state, p, dt);
    if (p.visible) enforceLocationRules(state, p);
  }
  logisticsTick(state, dt);
}

const once = (state: GameState, key: string) => {
  if (state.processed[key] !== undefined) return false;
  state.processed[key] = state.minute;
  return true;
};

export function minuteTick(state: GameState) {
  const now = Math.floor(state.minute);
  const mod = minuteOfDay(now);
  const day = dayIndex(now);
  for (const b of Object.values(state.businesses)) if (b.kind === 'retail') retailTick(state, b);
  npcTick(state);
  for (const p of Object.values(state.people)) if (p.npc) npcPostAction(state, p);
  economyTick(state);
  employmentTick(state);
  rentTick(state);
  if (now % 10 === 0) processApplications(state);
  if (mod >= 5 * 60 && once(state, `imports:${day}`)) wholesaleImports(state, state.businesses.wholesale);
  if (mod >= 6 * 60 && once(state, `vacancies:${day}`)) refreshVacancies(state);
  if (mod >= 8 * 60 && once(state, `invoices:${day}`)) retryInvoices(state);
  if (mod >= 10 * 60 && once(state, `cafe_order:${day}`)) cafeReorder(state);
  if (mod >= 10 * 60 && once(state, `jobsearch:${day}`)) npcJobSearch(state);
  if (mod >= 15 * 60 && once(state, `jobsearch2:${day}`)) npcJobSearch(state);
  if (mod >= 16 * 60 && once(state, `reorder:${day}`)) {
    for (const b of Object.values(state.businesses)) {
      if (b.kind !== 'retail') continue;
      if (b.id === UNIT4) syncReorderRules(b);
      const msg = autoReorder(state, b);
      if (msg.startsWith('Ordered')) news(state, 'info', `${b.name} placed a stock order`, msg, b.ownerId === state.playerId);
    }
  }
  if (mod >= 22 * 60 && once(state, `payroll:${day}`)) runPayroll(state);
  if (mod >= 23 * 60 + 30 && once(state, `close:${day}`)) {
    for (const b of Object.values(state.businesses)) dailyClose(state, b);
    dailyEconomy(state);
    compactLedger(state, 14 * MIN_PER_DAY);
    for (const k of Object.keys(state.processed)) if (state.processed[k] < now - 3 * MIN_PER_DAY) delete state.processed[k];
  }
  tickObjectives(state);
}

export const player = (state: GameState): Person => state.people[state.playerId];
