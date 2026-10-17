// Recognisable retail product models with baked vertex colours, so each
// shelf section is one instanced draw call. One instance = one unit of stock.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function colored(g: THREE.BufferGeometry, color: string, x = 0, y = 0, z = 0, rotX = 0, rotZ = 0): THREE.BufferGeometry {
  let geo = g.index ? g.toNonIndexed() : g;
  if (rotX) geo.rotateX(rotX);
  if (rotZ) geo.rotateZ(rotZ);
  geo.translate(x, y, z);
  const c = new THREE.Color(color);
  const n = geo.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (geo.getAttribute('uv')) geo.deleteAttribute('uv');
  geo = geo.clone();
  return geo;
}

type Maker = () => THREE.BufferGeometry[];
const ITEM: Record<string, Maker> = {
  bread: () => [colored(new THREE.CapsuleGeometry(0.055, 0.14, 4, 10), '#c98b4a', 0, 0.06, 0, Math.PI / 2), colored(new THREE.BoxGeometry(0.1, 0.02, 0.2), '#e9d9b6', 0, 0.105, 0)],
  milk: () => [colored(new THREE.BoxGeometry(0.075, 0.2, 0.075), '#f4f6f8', 0, 0.1, 0), colored(new THREE.BoxGeometry(0.077, 0.05, 0.077), '#2f6fd6', 0, 0.13, 0), colored(new THREE.ConeGeometry(0.054, 0.04, 4), '#f4f6f8', 0, 0.22, 0)],
  apples: () => [0, 1, 2, 3].map((i) => colored(new THREE.SphereGeometry(0.038, 10, 8), i % 2 ? '#c8352e' : '#a8261f', (i % 2) * 0.06 - 0.03, 0.04 + Math.floor(i / 2) * 0.05, (i % 3) * 0.02 - 0.02)),
  soup: () => [colored(new THREE.CylinderGeometry(0.037, 0.037, 0.11, 14), '#d9762b', 0, 0.055, 0), colored(new THREE.CylinderGeometry(0.0375, 0.0375, 0.02, 14), '#c8ccd0', 0, 0.105, 0), colored(new THREE.CylinderGeometry(0.0375, 0.0375, 0.03, 14), '#f3e6d0', 0, 0.06, 0)],
  pasta: () => [colored(new THREE.BoxGeometry(0.05, 0.19, 0.11), '#f2d06b', 0, 0.095, 0), colored(new THREE.BoxGeometry(0.052, 0.06, 0.112), '#1f4fa0', 0, 0.15, 0)],
  coffee: () => [colored(new THREE.CylinderGeometry(0.045, 0.045, 0.14, 14), '#5a3a22', 0, 0.07, 0), colored(new THREE.CylinderGeometry(0.047, 0.047, 0.025, 14), '#d8b46a', 0, 0.152, 0)],
  snacks: () => [colored(new THREE.BoxGeometry(0.13, 0.17, 0.05), '#3b7dd8', 0, 0.085, 0), colored(new THREE.BoxGeometry(0.135, 0.02, 0.03), '#e8e8e8', 0, 0.18, 0), colored(new THREE.BoxGeometry(0.06, 0.06, 0.052), '#f2c230', 0, 0.09, 0)],
  soap: () => [colored(new THREE.BoxGeometry(0.09, 0.04, 0.06), '#9ad0c2', 0, 0.02, 0), colored(new THREE.BoxGeometry(0.06, 0.042, 0.03), '#ffffff', 0, 0.021, 0)],
};

const cache = new Map<string, THREE.BufferGeometry>();

/** a shelf facing for one unit: five of the item side by side, two deep */
export function productGeometry(product: string): THREE.BufferGeometry {
  const hit = cache.get(product);
  if (hit) return hit;
  const make = ITEM[product] ?? (() => [colored(new THREE.BoxGeometry(0.1, 0.15, 0.1), '#888888', 0, 0.075, 0)]);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) for (let j = 0; j < 2; j++) for (const g of make()) parts.push(g.clone().translate(j * 0.13 - 0.065, 0, i * 0.165 - 0.33));
  const merged = mergeGeometries(parts, false)!;
  merged.computeVertexNormals();
  cache.set(product, merged);
  return merged;
}

export const productMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
