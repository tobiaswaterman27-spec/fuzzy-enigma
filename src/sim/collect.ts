// Lost wallets: forty of them dropped round the city (in parks, on the beach, behind the docks, down
// side streets). Walk over one to pick it up: there is cash inside. Find them all for the record.
import type { GameState, Vec2 } from './types';
import { fmtMoney } from './core';
import { lifeEvent, news } from './events';
import { transfer } from './ledger';
import { collidersIn, getWorld } from './world/layout';

export const WALLETS = 40;
let spots: Vec2[] | null = null;
export function walletSpots(): Vec2[] {
  if (spots) return spots;
  const w = getWorld();
  let seed = 9173;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const grounds = w.city.ground.filter((g) => ['grass', 'sand', 'concrete', 'paving', 'gravel', 'garden'].includes(g.kind) && g.rect.x1 - g.rect.x0 > 6 && g.rect.z1 - g.rect.z0 > 6);
  const out: Vec2[] = [];
  for (let tries = 0; out.length < WALLETS && tries < 5000; tries++) {
    const g = grounds[Math.floor(rnd() * grounds.length)];
    const p = { x: g.rect.x0 + 2 + rnd() * (g.rect.x1 - g.rect.x0 - 4), z: g.rect.z0 + 2 + rnd() * (g.rect.z1 - g.rect.z0 - 4) };
    if (collidersIn(p.x - 1, p.z - 1, p.x + 1, p.z + 1).some((r) => p.x > r.x0 - 0.6 && p.x < r.x1 + 0.6 && p.z > r.z0 - 0.6 && p.z < r.z1 + 0.6)) continue;
    if (out.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 60)) continue;
    out.push(p);
  }
  spots = out;
  return out;
}

/** every minute: anything at your feet is yours */
export function walletsTick(state: GameState) {
  const me = state.people[state.playerId];
  if (!me.visible || me.where === 'vehicle') return;
  const found = (state.wallets ??= []);
  walletSpots().forEach((p, i) => {
    if (found.includes(i) || Math.abs(p.x - me.pos.x) > 1.6 || Math.abs(p.z - me.pos.z) > 1.6) return;
    found.push(i);
    me.gesture = { clip: 'pickup', until: state.minute + 0.35 };
    const cash = 1000 + ((i * 7919) % 9000);
    transfer(state, { from: state.externalId, to: me.accountId, amount: cash, reason: 'transfer', memo: 'A lost wallet', key: `wallet:${i}` });
    news(state, 'good', `You found a wallet (${found.length}/${WALLETS})`, `${fmtMoney(cash)} inside. ${found.length === WALLETS ? 'That is every one of them!' : 'There are more out there.'}`, true);
    if (found.length === WALLETS) lifeEvent(state, me, 'Found every lost wallet in the city');
  });
}
