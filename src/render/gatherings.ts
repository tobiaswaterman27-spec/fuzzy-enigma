// What a gathering looks like: a flower arch for a wedding, a memorial with wreaths for a funeral,
// a table with a cake and balloons for a birthday. Built when one is on, removed afterwards.
import * as THREE from 'three';
import type { GameState } from '../sim/types';
import { activeGathering, GATHER_SPOT } from '../sim/gatherings';

const mat = (color: string, rough = 0.6, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra });

function flowers(g: THREE.Group, x: number, y: number, z: number, n: number, spread: number, colors: string[]) {
  const geo = new THREE.SphereGeometry(0.06, 8, 6);
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(geo, mat(colors[i % colors.length], 0.7));
    const a = (i / n) * Math.PI * 2 * 3.1;
    m.position.set(x + Math.cos(a) * spread * ((i * 37) % 10) / 10, y + ((i * 13) % 7) * 0.03, z + Math.sin(a) * spread * ((i * 53) % 10) / 10);
    g.add(m);
  }
}

function wedding(): THREE.Group {
  const g = new THREE.Group();
  const white = mat('#f4f1ea', 0.5);
  // the arch: two posts and a curved top, wound with greenery and white and pink flowers
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.3, 10), white); p.position.set(s * 1.1, 1.15, 0); g.add(p); }
  const top = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.05, 8, 24, Math.PI), white);
  top.position.set(0, 2.3, 0);
  g.add(top);
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI;
    flowers(g, Math.cos(a) * 1.1, 2.3 + Math.sin(a) * 1.1, 0, 4, 0.12, ['#ffffff', '#f7c6d0', '#4f7d3a', '#ffffff']);
  }
  for (const s of [-1, 1]) for (let y = 0.3; y < 2.2; y += 0.35) flowers(g, s * 1.1, y, 0, 3, 0.1, ['#ffffff', '#f7c6d0', '#4f7d3a']);
  // an aisle of petals
  const petal = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 4.5), mat('#f7dbe2', 0.9));
  petal.rotation.x = -Math.PI / 2; petal.position.set(0, 0.02, -2.6);
  g.add(petal);
  return g;
}

function funeral(): THREE.Group {
  const g = new THREE.Group();
  // an easel with a framed photograph, and wreaths on stands either side
  const wood = mat('#4a3324', 0.6);
  for (const s of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.5, 0.04), wood); leg.position.set(s * 0.25, 0.75, 0); leg.rotation.z = s * 0.12; g.add(leg); }
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.78, 0.04), mat('#1d1d1d', 0.4));
  frame.position.set(0, 1.35, 0.02); g.add(frame);
  const photo = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.66), mat('#8c8478', 0.8));
  photo.position.set(0, 1.35, 0.045); photo.rotation.y = Math.PI; g.add(photo);
  for (const s of [-1, 1]) {
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.1, 8), mat('#2a2a2a', 0.5));
    stand.position.set(s * 1.1, 0.55, 0); g.add(stand);
    const wreath = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.09, 10, 24), mat('#2f5a2a', 0.8));
    wreath.position.set(s * 1.1, 1.15, 0); g.add(wreath);
    flowers(g, s * 1.1, 1.15, 0.05, 14, 0.35, ['#ffffff', '#f2e6b8', '#ffffff']);
  }
  flowers(g, 0, 0.08, -0.4, 30, 0.6, ['#ffffff', '#f2e6b8', '#c9a0dc', '#ffffff']);
  return g;
}

function birthday(): THREE.Group {
  const g = new THREE.Group();
  const table = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.8), mat('#fafafa', 0.7));
  table.position.set(0, 0.74, 0); g.add(table);
  for (const [x, z] of [[-0.7, -0.33], [0.7, -0.33], [-0.7, 0.33], [0.7, 0.33]]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.72, 6), mat('#999', 0.4)); l.position.set(x, 0.36, z); g.add(l); }
  const cake = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.16, 24), mat('#f3d7e4', 0.6));
  cake.position.set(0, 0.85, 0); g.add(cake);
  for (let i = 0; i < 6; i++) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.07, 6), mat('#6fa8dc')); const a = (i / 6) * Math.PI * 2; c.position.set(Math.cos(a) * 0.1, 0.96, Math.sin(a) * 0.1); g.add(c);
    const fl = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), mat('#ffcf40', 0.3, { emissive: new THREE.Color('#ffaa20'), emissiveIntensity: 2 })); fl.position.set(Math.cos(a) * 0.1, 1.005, Math.sin(a) * 0.1); g.add(fl); }
  const colors = ['#e74c3c', '#f1c40f', '#3498db', '#9b59b6', '#2ecc71'];
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), mat(colors[i], 0.25));
    b.scale.y = 1.2; b.position.set(-0.9 + (i % 2) * 0.12, 1.7 + i * 0.12, -0.3 + i * 0.1); g.add(b);
    const str = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 1.0, 4), mat('#ddd')); str.position.set(-0.8, 1.15 + i * 0.06, -0.3 + i * 0.05); g.add(str);
  }
  return g;
}

export class GatheringProps {
  private current: { id: string; obj: THREE.Group } | null = null;
  constructor(private scene: THREE.Scene) {}
  update(state: GameState) {
    const g = activeGathering(state);
    if (this.current && this.current.id !== g?.id) { this.scene.remove(this.current.obj); this.current = null; }
    if (!g || this.current) return;
    const obj = g.kind === 'wedding' ? wedding() : g.kind === 'funeral' ? funeral() : birthday();
    obj.position.set(GATHER_SPOT.x, 0, GATHER_SPOT.z + 2.6);
    obj.traverse((o) => { o.castShadow = true; });
    this.scene.add(obj);
    this.current = { id: g.id, obj };
  }
}
