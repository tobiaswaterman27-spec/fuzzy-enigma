// Buy-to-let: the new houses built on the Harbour Road plots go on sale when finished. Buy one and a
// letting agent finds a tenant within a few days; the rent comes in every Monday less the agent's fee,
// and now and then something needs fixing. Sell it back to the developer at 95% whenever you like.
import type { GameState, Id } from './types';
import { at, dayIndex, fmtDate } from './clock';
import { fmtMoney, nextId } from './core';
import { transfer } from './ledger';
import { lifeEvent, news } from './events';
import { plotFinished } from './construction';
import { PLOTS } from './world/plots';

export const NEW_BUILD_PRICE = 9000000;
export const NEW_BUILD_RENT = 17500;
export const AGENT_FEE = 0.1;
export const RESALE_SHARE = 0.95;
const TENANTS = ['the Okonkwo family', 'Sam and Jo Hartley', 'Mrs Delia Brandt', 'the Kowalski family', 'Arun and Meera Shah', 'Tom Ellery and partner'];
const REPAIRS: [string, number][] = [['Boiler service', 9000], ['Leaking tap fixed', 4500], ['Broken window latch', 3500], ['Gutter cleared', 6000]];

export interface NewBuild { plotId: Id; ownerId: Id; price: number; boughtAt: number; tenant: string | null; nextRent: number | null }

export function forSale(state: GameState) {
  return PLOTS.map((pl, i) => ({ plot: pl, i })).filter(({ plot, i }) => plotFinished(state, i) && !state.newBuilds?.[plot.id]);
}

export function ownedBuilds(state: GameState, personId: Id): NewBuild[] {
  return Object.values(state.newBuilds ?? {}).filter((b) => b.ownerId === personId);
}

export function buyNewBuild(state: GameState, personId: Id, plotId: Id): { ok: boolean; msg: string } {
  const p = state.people[personId];
  const i = PLOTS.findIndex((x) => x.id === plotId);
  if (!p || i < 0) return { ok: false, msg: 'No such house.' };
  if (!plotFinished(state, i)) return { ok: false, msg: 'It is still being built.' };
  if (state.newBuilds?.[plotId]) return { ok: false, msg: 'Already sold.' };
  const r = transfer(state, { from: p.accountId, to: state.externalId, amount: NEW_BUILD_PRICE, reason: 'property', memo: `Purchase of ${PLOTS[i].name}`, key: `newbuild:${plotId}` });
  if (!r.ok) return { ok: false, msg: `It costs ${fmtMoney(NEW_BUILD_PRICE)}.` };
  (state.newBuilds ??= {})[plotId] = { plotId, ownerId: personId, price: NEW_BUILD_PRICE, boughtAt: state.minute, tenant: null, nextRent: null };
  lifeEvent(state, p, `Bought ${PLOTS[i].name} to let`);
  news(state, 'good', `You own ${PLOTS[i].name}`, `Harbourside Lettings is looking for a tenant: expect someone within a few days. Rent ${fmtMoney(NEW_BUILD_RENT)} a week, less a ${Math.round(AGENT_FEE * 100)}% fee.`, p.isPlayer);
  return { ok: true, msg: `Bought ${PLOTS[i].name} for ${fmtMoney(NEW_BUILD_PRICE)}.` };
}

export function sellNewBuild(state: GameState, personId: Id, plotId: Id): { ok: boolean; msg: string } {
  const b = state.newBuilds?.[plotId];
  const p = state.people[personId];
  if (!b || !p || b.ownerId !== personId) return { ok: false, msg: 'You do not own it.' };
  const amount = Math.round(b.price * RESALE_SHARE);
  const r = transfer(state, { from: state.externalId, to: p.accountId, amount, reason: 'property', memo: `Sale of ${PLOTS.find((x) => x.id === plotId)!.name}`, key: `newbuild_sale:${plotId}:${state.minute}` });
  if (!r.ok) return { ok: false, msg: r.error };
  delete state.newBuilds![plotId];
  return { ok: true, msg: `Sold for ${fmtMoney(amount)}.` };
}

/** tenants move in, rent comes in on Mondays, repairs now and then */
export function lettingsTick(state: GameState) {
  for (const b of Object.values(state.newBuilds ?? {})) {
    const p = state.people[b.ownerId];
    const name = PLOTS.find((x) => x.id === b.plotId)?.name ?? 'your house';
    if (!p) continue;
    if (!b.tenant && state.minute >= b.boughtAt + 3 * 1440) {
      const seq = Number(nextId(state, 'tenant').replace(/\D/g, '')) || 0;
      b.tenant = TENANTS[seq % TENANTS.length];
      const d = dayIndex(state.minute);
      b.nextRent = at(d + ((7 - (d % 7)) % 7 || 7), 9, 0);
      news(state, 'good', `${name} is let`, `${b.tenant[0].toUpperCase()}${b.tenant.slice(1)} moved in. First rent on ${fmtDate(b.nextRent)}.`, p.isPlayer);
    }
    if (b.tenant && b.nextRent !== null && state.minute >= b.nextRent) {
      const net = Math.round(NEW_BUILD_RENT * (1 - AGENT_FEE));
      transfer(state, { from: state.externalId, to: p.accountId, amount: net, reason: 'property', memo: `Rent: ${name} (less agent's fee)`, key: `let_rent:${b.plotId}:${b.nextRent}` });
      // roughly one week in eight something needs fixing
      const wk = Math.floor(b.nextRent / (7 * 1440));
      if ((wk * 7 + b.plotId.length * 3) % 8 === 0) {
        const [what, cost] = REPAIRS[wk % REPAIRS.length];
        const r = transfer(state, { from: p.accountId, to: state.externalId, amount: cost, reason: 'services', memo: `${what}: ${name}`, key: `let_repair:${b.plotId}:${b.nextRent}` });
        if (r.ok) news(state, 'money', `Repair at ${name}`, `${what}: ${fmtMoney(cost)}.`, p.isPlayer);
      }
      b.nextRent += 7 * 1440;
    }
  }
}
