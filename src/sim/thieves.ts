// Pickpockets. In a busy street now and then someone brushes past you a little too close, and your
// money goes with them: they run. Catch them (knock them down) and what they took is on the pavement.
import type { GameState, Person } from './types';
import { dist, fmtMoney, rand } from './core';
import { news } from './events';
import { transfer } from './ledger';
import { flee } from './health';
import { goTo } from './npc';

export function thiefTick(state: GameState) {
  const me = state.people[state.playerId];
  if (!me || !me.visible || me.away || me.dead || me.where !== 'outside' || me.down != null) return;
  const t = state.thief;
  if (t) {
    const o = state.people[t.id];
    if (!o || o.dead || !o.visible || state.minute - t.at > 30) { state.thief = null; return; }
    if (t.stage === 'closing') {
      if (dist(o.pos, me.pos) < 1.1) {
        const bal = state.ledger.accounts[me.accountId]?.balance ?? 0;
        const take = Math.min(8000, Math.max(0, Math.round(bal * 0.08)));
        if (take <= 0) { state.thief = null; return; }
        transfer(state, { from: me.accountId, to: o.accountId, amount: take, reason: 'transfer', memo: 'Pickpocketed', key: `pickpocketed:${o.id}:${Math.floor(state.minute)}` });
        o.stole = take;
        t.stage = 'running';
        o.gesture = { clip: 'pickup', until: state.minute + 0.3 };
        flee(state, o, me.pos);
        news(state, 'bad', `Pickpocketed! ${fmtMoney(take)} gone`, `${o.name.split(' ')[0]} is running for it. Catch them and put them down to get it back.`, true);
      } else if (!o.move || dist(o.move.dest, me.pos) > 1.5) goTo(state, o, me.pos, 'a mark');
    }
    return;
  }
  // a busy street, and not too often
  if (rand(state) > 0.006) return;
  const crowd = Object.values(state.people).filter((o) => o.visible && !o.isPlayer && !o.police && o.down == null && !o.combat && dist(o.pos, me.pos) < 22);
  if (crowd.length < 5) return;
  const o: Person | undefined = crowd.find((c) => c.npc?.ambient && c.id.startsWith('crowd_') && dist(c.pos, me.pos) > 6);
  if (!o) return;
  state.thief = { id: o.id, at: state.minute, stage: 'closing' };
  goTo(state, o, me.pos, 'a mark');
}
