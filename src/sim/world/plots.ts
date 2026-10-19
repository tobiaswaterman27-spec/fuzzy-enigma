// Building plots at the end of Harbour Road (construction.ts builds houses on them).
export interface Plot { id: string; name: string; rect: { x0: number; z0: number; x1: number; z1: number }; house: { x0: number; z0: number; x1: number; z1: number }; front: 'x0' | 'x1' }
export const PLOTS: Plot[] = [
  { id: 'plot_w', name: '15 Harbour Road', rect: { x0: -20, z0: 67.4, x1: -10.2, z1: 75.8 }, house: { x0: -17.6, z0: 70.4, x1: -12.6, z1: 74.4 }, front: 'x1' },
  { id: 'plot_e', name: '14 Harbour Road', rect: { x0: 10.2, z0: 67.4, x1: 20, z1: 75.8 }, house: { x0: 12.6, z0: 70.4, x1: 17.6, z1: 74.4 }, front: 'x0' },
];

