// Cheats, typed on the keyboard as you play (like the old GTA codes): a cuppa puts you right, the
// bobbies forget you, a bit of wonga turns up, and a motor appears. Each use is noted in your history.
import type { GameState, Id } from './types';
import { createContainer } from './inventory';
import { lifeEvent } from './events';
import { transfer } from './ledger';
import { CAR_MODELS } from './cars';

export const CHEATS: Record<string, { what: string; run: (s: GameState, id: Id) => void }> = {
  CUPPA: { what: 'Full health, fed, rested and washed', run: (s, id) => { const p = s.people[id]; p.health = 100; p.needs.energy = 100; p.needs.satiety = 100; p.needs.hygiene = 100; p.needs.mood = Math.max(p.needs.mood, 80); } },
  BOBBIES: { what: 'The police forget all about you', run: (s) => { s.wanted = null; } },
  WONGA: { what: '£1,000 down the back of the sofa', run: (s, id) => { transfer(s, { from: s.externalId, to: s.people[id].accountId, amount: 100000, reason: 'transfer', memo: 'Down the back of the sofa', key: `cheat:${Math.floor(s.minute * 100)}` }); } },
  MOTOR: { what: 'A sports car, and you behind the wheel', run: (s, id) => spawnCar(s, id, 'sports') },
  CHELSEATRACTOR: { what: 'A big SUV, and you behind the wheel', run: (s, id) => spawnCar(s, id, 'suv') },
};

function spawnCar(s: GameState, personId: Id, body: string) {
  const p = s.people[personId];
  if (p.where === 'vehicle' || p.where !== 'outside') return;
  const vid = `cheat_${Math.floor(s.minute)}_${Object.keys(s.vehicles).length}`;
  const boot = createContainer(s, 'van', 'traffic', vid, 20, undefined, `${vid}_boot`);
  const model = CAR_MODELS.find((m) => m.body === body && m.id !== 'new') ?? CAR_MODELS[0];
  s.vehicles[vid] = {
    id: vid, name: model.name.replace(/ \(.*\)$/, ''), ownerId: 'traffic', kind: 'car', model: model.id, color: model.colors[0], price: model.price,
    pos: { ...p.pos }, heading: p.facing, route: [], routeIdx: 0, speed: 0, state: 'manual_out', driverId: personId,
    cargoId: boot.id, shipmentId: null, waitUntil: 0, condition: 100, odometer: 0, billedOdo: 0,
  };
  p.where = 'vehicle'; p.visible = false;
}

/** the letters typed so far: a cheat if they end in one */
export function typedCheat(s: GameState, personId: Id, typed: string): string | null {
  for (const [code, c] of Object.entries(CHEATS)) if (typed.endsWith(code)) {
    c.run(s, personId);
    s.cheats = (s.cheats ?? 0) + 1;
    lifeEvent(s, s.people[personId], `Used a cheat (${code})`);
    return `CHEAT ACTIVATED: ${c.what}.`;
  }
  return null;
}
