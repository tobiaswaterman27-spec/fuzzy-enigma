// Wet ground: in the rain the roads and pavements darken and go glossy, picking up the sky and the
// street lamps; they dry off again when it stops.
import type * as THREE from 'three';

const mats: { m: THREE.MeshStandardMaterial; rough: number; color: THREE.Color }[] = [];
let level = -1;

export function wettable(m: THREE.MeshStandardMaterial) {
  if (!mats.some((x) => x.m === m)) mats.push({ m, rough: m.roughness, color: m.color.clone() });
  return m;
}

/** w: 0 dry .. 1 soaking (eases towards the rain, so it takes a while to dry off) */
export function setWet(w: number) {
  if (Math.abs(w - level) < 0.01) return;
  level = w;
  for (const x of mats) {
    x.m.roughness = x.rough - (x.rough - 0.15) * w * 0.9;
    x.m.color.copy(x.color).multiplyScalar(1 - 0.42 * w);
  }
}
