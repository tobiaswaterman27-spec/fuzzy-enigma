// Traffic lights: every junction in the city runs the same cycle (traffic along x, then along z, with
// amber between), so one set of shared lamp materials lights them all. The traffic stops for them.
export const CYCLE = 26;
/** which way may go at time t (seconds): 'x' (east-west), 'z' (north-south), or null during amber/all-red */
export function greenFor(t: number): 'x' | 'z' | null {
  const k = ((t % CYCLE) + CYCLE) % CYCLE;
  return k < 11 ? 'x' : k < 13 ? null : k < 24 ? 'z' : null;
}
/** the lamp showing for one direction: 'g', 'a' or 'r' */
export function lampFor(axis: 'x' | 'z', t: number): 'g' | 'a' | 'r' {
  const k = ((t % CYCLE) + CYCLE) % CYCLE;
  if (axis === 'x') return k < 11 ? 'g' : k < 13 ? 'a' : 'r';
  return k >= 13 && k < 24 ? 'g' : k >= 24 ? 'a' : 'r';
}
