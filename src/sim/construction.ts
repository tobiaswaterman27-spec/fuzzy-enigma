// Harbour Build Co.: builds houses on the plots at the end of Harbour Road, stage by stage, from the
// labour of whoever is on shift (you or NPC labourers). Tools come from the site cabin; bricks are
// carried from the pallet to the wall and laid one by one. A housing investor pays
// for each stage as it is finished; a finished house is let to a new household.
import type { GameState } from './types';
import { fmtMoney } from './core';
import { transfer } from './ledger';
import { news } from './events';
import { count, moveAll } from './inventory';
import { endContract, statsFor } from './employment';
import { PLOTS, type Plot } from './world/plots';
export { PLOTS, type Plot };

export const BUILDER = 'builders';

/** units of work per stage; minutes = labour-minutes the whole stage takes (two labourers halve the time) */
export interface Stage { id: string; label: string; units: number; minutes: number; tool: string | null; pay: number; xpPerUnit: number }
export const STAGES: Stage[] = [
  { id: 'ground', label: 'Groundworks: dig the foundation trenches', units: 60, minutes: 720, tool: 'spade', pay: 180000, xpPerUnit: 1 },
  { id: 'found', label: 'Foundations: shovel concrete into the trenches', units: 40, minutes: 600, tool: 'shovel', pay: 220000, xpPerUnit: 1 },
  { id: 'walls', label: 'Brickwork: lay the walls course by course', units: 480, minutes: 2400, tool: null, pay: 600000, xpPerUnit: 0.25 },
  { id: 'roof', label: 'Roof: fix the trusses, felt and tiles', units: 60, minutes: 1440, tool: 'hammer', pay: 380000, xpPerUnit: 1 },
  { id: 'windows', label: 'Fit the windows and doors', units: 16, minutes: 480, tool: 'drill', pay: 240000, xpPerUnit: 2 },
  { id: 'finish', label: 'Plaster, paint and landscaping', units: 50, minutes: 960, tool: 'roller', pay: 260000, xpPerUnit: 1 },
];
/** cost of materials for a stage, paid by the builder to suppliers when the stage starts */
const MATERIALS: Record<string, number> = { ground: 20000, found: 90000, walls: 220000, roof: 160000, windows: 140000, finish: 60000 };

export interface Build { plot: number; stage: number; done: number; startedAt: number; finishedAt: number | null }

export const currentPlot = (state: GameState): Plot | null => (state.build && state.build.plot < PLOTS.length ? PLOTS[state.build.plot] : null);
export const currentStage = (state: GameState): Stage | null => (state.build && state.build.plot < PLOTS.length ? STAGES[state.build.stage] ?? null : null);
export const plotFinished = (state: GameState, i: number) => !!state.build && (state.build.plot > i);

/** the builder buys the materials for the current stage (delivered to the site) */
function orderMaterials(state: GameState) {
  const st = currentStage(state);
  const b = state.businesses[BUILDER];
  if (!st || !b) return;
  const cost = MATERIALS[st.id] ?? 0;
  const key = `buildmat:${state.build!.plot}:${st.id}`;
  const r = transfer(state, { from: b.accountId, to: state.externalId, amount: cost, reason: 'purchase', memo: `Materials: ${st.label.split(':')[0]}`, key });
  if (r.ok) statsFor(state, b).cogs += cost;
  if (st.id === 'walls') state.containers.site_bricks.items.bricks = STAGES[2].units + 16;
}

export function startConstruction(state: GameState) {
  if (state.build) return;
  state.build = { plot: 0, stage: 0, done: 0, startedAt: state.minute, finishedAt: null };
  orderMaterials(state);
}

/** a unit of work on the current stage (a spadeful, a brick, a tile...). Returns a message when a stage completes. */
export function addWork(state: GameState, units = 1): string | null {
  const b = state.build;
  const st = currentStage(state);
  if (!b || !st) return null;
  b.done += units;
  if (b.done < st.units) return null;
  // stage complete: the developer pays for it
  const plot = PLOTS[b.plot];
  const builder = state.businesses[BUILDER];
  // the houses are funded by a housing investor from outside the district, paid stage by stage
  const key = `buildpay:${b.plot}:${st.id}`;
  const r = transfer(state, { from: state.externalId, to: builder.accountId, amount: st.pay, reason: 'services', memo: `${plot.name}: ${st.label.split(':')[0]} complete`, key });
  if (r.ok) statsFor(state, builder).revenue += st.pay;
  b.stage++;
  b.done = 0;
  if (b.stage >= STAGES.length) {
    b.finishedAt = state.minute;
    // a new household moves into the finished house
    const d = state.districts.harbourside;
    if (d) d.households += 1;
    news(state, 'good', `${plot.name} is finished`, 'Harbour Build Co. has handed the new house over. A family has moved in.', true);
    b.plot++;
    b.stage = 0;
    if (b.plot < PLOTS.length) { b.startedAt = state.minute; orderMaterials(state); }
    else {
      // no more plots: the labourers are laid off with a week's pay
      builder.positions.forEach((pos) => { pos.headcount = 0; });
      for (const c of Object.values(state.contracts)) {
        if (c.businessId !== BUILDER || c.status !== 'active') continue;
        const w = state.people[c.personId];
        w.equipment = null;
        moveAll(state, w.handsId, 'site_bricks');
        transfer(state, { from: builder.accountId, to: w.accountId, amount: c.wage * 35, reason: 'wage', memo: 'Redundancy pay, Harbour Build Co.', key: `redund:${c.id}` });
        endContract(state, c.id, 'closed', 'Both houses are finished: Harbour Build Co. has no more work here and paid you a week in lieu.');
      }
    }
    return `${plot.name} is finished!`;
  }
  orderMaterials(state);
  const next = STAGES[b.stage];
  news(state, 'info', `${plot.name}: ${st.label.split(':')[0]} done`, `Next: ${next.label}. ${fmtMoney(st.pay)} paid by the developer.`, false);
  return `${st.label.split(':')[0]} complete - next: ${next.label.split(':')[0].toLowerCase()}.`;
}

/** progress through the current stage, 0..1 */
export const stageProgress = (state: GameState) => { const st = currentStage(state); return st && state.build ? state.build.done / st.units : 0; };

/** courses of brickwork laid so far on a plot (12 to the roof line) */
export function courses(state: GameState, plotIndex: number): number {
  const b = state.build;
  if (!b || b.plot > plotIndex) return 12;
  if (b.plot < plotIndex || b.stage < 2) return 0;
  if (b.stage > 2) return 12;
  return Math.floor((b.done / STAGES[2].units) * 12);
}

export const bricksOnPallet = (state: GameState) => count(state.containers.site_bricks, 'bricks');
