import { describe, expect, it } from 'vitest';
import { getWorld } from '../src/sim/world/layout';
import { taxiSpots } from '../src/sim/taxi';

describe('HarbourCabs', () => {
  it('fares wait at kerbs all over the city, never inside a building', () => {
    const w = getWorld();
    const spots = taxiSpots();
    expect(spots.filter((s) => s.pos.z < -400).length).toBeGreaterThan(20);
    for (const s of spots) expect(w.colliders.some((r) => s.pos.x > r.x0 && s.pos.x < r.x1 && s.pos.z > r.z0 && s.pos.z < r.z1), s.name).toBe(false);
  });
});
