// Achievements: little milestones of a life in Harbourside, announced when you first reach them.
import type { GameState } from './types';
import { news } from './events';
import { netWorth } from './wealth';
import { playerCar } from './cars';
import { ownedHome } from './property';
import { snowing } from './weather';

export interface Achievement { id: string; title: string; how: string; check: (s: GameState) => boolean }
const me = (s: GameState) => s.people[s.playerId];
const hist = (s: GameState, re: RegExp) => me(s).history.some((e) => re.test(e.text));
const paid = (s: GameState, re: RegExp) => s.ledger.txns.some((t) => t.from === me(s).accountId && re.test(t.memo ?? ''));

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'payday', title: 'Payday', how: 'Get your first wages', check: (s) => Object.values(s.ledger.accounts).length > 0 && s.ledger.txns.some((t) => t.to === me(s).accountId && t.reason === 'wage') },
  { id: 'friend', title: 'Not a stranger any more', how: 'Make a friend', check: (s) => Object.values(me(s).relations).some((v) => v >= 30) },
  { id: 'bestie', title: 'Best mates', how: 'Get really close to someone (80+)', check: (s) => Object.values(me(s).relations).some((v) => v >= 80) },
  { id: 'date', title: 'Butterflies', how: 'Start going out with someone', check: (s) => !!me(s).partnerId },
  { id: 'married', title: 'Just married', how: 'Get married', check: (s) => me(s).relationship === 'married' },
  { id: 'fish', title: 'Gone fishing', how: 'Land a fish off the quay', check: (s) => (me(s).fishCaught ?? 0) >= 1 },
  { id: 'fish20', title: 'Old salt', how: 'Land 20 fish', check: (s) => (me(s).fishCaught ?? 0) >= 20 },
  { id: 'bass', title: 'The one that did not get away', how: 'Land a sea bass over 4 kg', check: (s) => (me(s).fishingBest?.fish_bass ?? 0) > 4 },
  { id: 'goal', title: 'Back of the net', how: 'Score a goal in the park', check: (s) => (me(s).goals ?? 0) >= 1 },
  { id: 'hattrick', title: 'Hat-trick', how: 'Score three goals', check: (s) => (me(s).goals ?? 0) >= 3 },
  { id: 'darts', title: 'One hundred and eighty!', how: 'Win a game of darts at The Anchor', check: (s) => (me(s).dartsWon ?? 0) >= 1 },
  { id: 'dog', title: "Man's best friend", how: 'Adopt a dog', check: (s) => !!me(s).dog },
  { id: 'car', title: 'Wheels', how: 'Buy a car', check: (s) => !!playerCar(s, s.playerId) },
  { id: 'home', title: 'Homeowner', how: 'Buy your own home', check: (s) => !!ownedHome(s, s.playerId) },
  { id: 'fit', title: 'Fit as a fiddle', how: 'Reach 80 fitness', check: (s) => (me(s).fitness ?? 0) >= 80 },
  { id: 'favours', title: 'Good neighbour', how: 'Do 10 favours', check: (s) => (me(s).favoursDone ?? 0) >= 10 },
  { id: 'cabbie', title: 'Cabbie', how: 'Complete 10 HarbourCabs fares', check: (s) => (s.taxi?.done ?? 0) >= 10 },
  { id: 'thief', title: 'Have-a-go hero', how: 'Catch a shoplifter', check: (s) => s.news.some((n) => n.title === 'You caught a shoplifter') },
  { id: 'lucky', title: 'Lucky dip', how: 'Win on the lottery or a scratchcard (£100+)', check: (s) => hist(s, /Won .* on (the lottery|a scratchcard)/) },
  { id: 'snow', title: 'Snow day', how: 'Be out in the snow', check: (s) => me(s).visible && snowing(s) && !me(s).where.startsWith('flat') },
  { id: 'wedding', title: 'Plus one', how: 'Go to a wedding, funeral or party', check: (s) => hist(s, /^Went to /) },
  { id: 'wanted', title: 'Most wanted', how: 'Get five stars', check: (s) => (s.wanted?.level ?? 0) >= 5 },
  { id: 'nicked', title: 'Nicked', how: 'Get arrested', check: (s) => (me(s).record?.length ?? 0) >= 1 },
  { id: 'hospital', title: 'Patched up', how: 'Spend time in hospital', check: (s) => hist(s, /^Admitted to /) },
  { id: 'stunt', title: 'Air time', how: 'Land a unique stunt jump', check: (s) => (s.stunts?.length ?? 0) >= 1 },
  { id: 'stunts', title: 'Evel Knievel', how: 'Land every stunt jump in the city', check: (s) => (s.stunts?.length ?? 0) >= 8 },
  { id: 'bike', title: 'On your bike', how: 'Hire a Harbour Bike', check: (s) => paid(s, /^Harbour Bikes/) },
  { id: 'bus', title: 'All aboard', how: 'Ride a bus', check: (s) => paid(s, /^Bus fare/) },
  { id: 'train', title: 'Mind the gap', how: 'Take the train', check: (s) => paid(s, /^Train ticket/) },
  { id: 'film', title: 'Movie night', how: 'Watch a film at Harbourgate', check: (s) => paid(s, /^Cinema ticket/) },
  { id: 'match', title: 'Up the Harbour!', how: 'Watch Harbour City play', check: (s) => hist(s, /^Watched Harbour City/) },
  { id: 'vince', title: 'No questions asked', how: 'Do a job for Vince', check: (s) => (s.vinceRep ?? 0) >= 1 },
  { id: 'vince5', title: "Vince's favourite", how: 'Do five jobs for Vince', check: (s) => (s.vinceRep ?? 0) >= 5 },
  { id: 'turf', title: 'Not round here', how: 'Run a gang off their corner', check: (s) => hist(s, /off their corner/) },
  { id: 'cash', title: 'Finders keepers', how: 'Pick up cash someone dropped', check: (s) => s.ledger.txns.some((t) => t.to === me(s).accountId && t.memo === 'Cash off the pavement') },
  { id: 'boom', title: 'Total loss', how: 'Blow up a car', check: (s) => Object.values(s.vehicles).some((v) => v.wrecked) },
  { id: 'grab', title: 'Smash and grab', how: 'Clear out the jeweller', check: (s) => hist(s, /^Smash-and-grab/) },
  { id: 'jail', title: 'Jailbird', how: 'Do time in HMP Harbourside', check: (s) => hist(s, /^Sent to prison/) },
  { id: 'escape', title: 'The great escape', how: 'Break out of prison', check: (s) => hist(s, /^Escaped from HMP/) },
  { id: 'clean', title: 'Clean slate', how: 'Have your record wiped at City Hall', check: (s) => hist(s, /record expunged/) },
  { id: 'grand', title: 'Comfortable', how: 'Net worth over £10,000', check: (s) => netWorth(s, s.playerId).total >= 1000000 },
  { id: 'bigshot', title: 'THE BIGSHOT', how: 'Net worth over £1,000,000', check: (s) => netWorth(s, s.playerId).total >= 100000000 },
];

/** every minute: anything newly achieved is announced */
export function achievementsTick(state: GameState) {
  if (Math.floor(state.minute) % 2 !== 0) return;
  const got = (state.achievements ??= {});
  for (const a of ACHIEVEMENTS) {
    if (got[a.id] !== undefined) continue;
    let ok = false;
    try { ok = a.check(state); } catch { ok = false; }
    if (!ok) continue;
    got[a.id] = state.minute;
    news(state, 'good', `Achievement: ${a.title}`, a.how, true);
  }
}
