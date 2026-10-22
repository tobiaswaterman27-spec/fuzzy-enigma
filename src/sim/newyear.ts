// New Year's Eve on the last night of the year: the town comes down to the quay for the fireworks
// over the harbour at midnight. Everyone there is in good spirits, and it counts as a big night out.
import type { GameState } from './types';
import { dayIndex, minuteOfDay, at } from './clock';
import { YEAR_DAYS } from './life';
import { clamp, rand } from './core';
import { news, lifeEvent } from './events';
import { gesture } from './talk';
import { QUAY_EDGE } from './world/layout';

const lastNight = (minute: number) => dayIndex(minute) % YEAR_DAYS === YEAR_DAYS - 1;
/** fireworks: 23:55 on the last night until 00:20 */
export function newYearShow(state: GameState): boolean {
  const m = minuteOfDay(state.minute);
  return (lastNight(state.minute) && m >= 23 * 60 + 55) || (lastNight(state.minute - 60) && m < 20);
}

export function newYearTick(state: GameState) {
  const day = dayIndex(state.minute);
  const m = minuteOfDay(state.minute);
  if (lastNight(state.minute) && m === 9 * 60) news(state, 'info', "New Year's Eve", 'Fireworks over the harbour at midnight. Half the town will be down on the quay.', true);
  // from half past ten, people head down to the quay and stay until the show is over
  if (lastNight(state.minute) && m >= 22 * 60 + 30 && Math.floor(state.minute) % 3 === 0) {
    const until = at(day + 1, 0, 25);
    for (const p of Object.values(state.people)) {
      const n = p.npc;
      if (!n || p.isPlayer || n.ambient || p.police || p.dead || p.away || p.action || (n as any).nye === day || rand(state) > 0.12) continue;
      if ((p.age ?? 40) > 78) continue;
      (n as any).nye = day;
      p.sleeping = false;
      const spot = { x: -45 + rand(state) * 90, z: QUAY_EDGE - 2 - rand(state) * 9 };
      n.goal = 'leisure';
      n.plan = [{ kind: 'move', to: spot, label: 'the quay' }, { kind: 'wait', until }, { kind: 'call', fn: 'goHomeNow' }];
      n.nextDecision = until;
      (n as any).gathering = `nye:${day}`;
    }
  }
  // midnight: cheering, and anyone you are with on the quay is glad you came
  if (newYearShow(state) && Math.floor(state.minute) % 1 === 0) {
    for (const p of Object.values(state.people)) if (p.visible && p.pos.z > QUAY_EDGE - 14 && !p.isPlayer && rand(state) < 0.08) gesture(state, p, rand(state) < 0.5 ? 'happy' : 'laugh', 3);
  }
  const me = state.people[state.playerId];
  if (lastNight(state.minute - 60) && m === 5 && me.visible && me.pos.z > QUAY_EDGE - 14) {
    me.needs.mood = clamp(me.needs.mood + 15, 0, 100);
    lifeEvent(state, me, 'Went to the New Year fireworks on the quay');
    news(state, 'good', 'Happy New Year!', 'The fireworks over the harbour were brilliant.', true);
  }
  // the gathering marker stops blocking their normal day once it is over
  for (const p of Object.values(state.people)) if (typeof (p.npc as any)?.gathering === 'string' && !newYearShow(state) && !lastNight(state.minute)) (p.npc as any).gathering = undefined;
}
