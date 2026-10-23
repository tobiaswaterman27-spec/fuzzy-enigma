// The harbour: water beyond the quay wall with a moving surface, fishing boats on their moorings,
// gulls wheeling overhead, bollards along the edge and the bait and tackle hut.
import * as THREE from 'three';
import { BAIT_HUT, QUAY_EDGE } from '../sim/world/layout';

/** the fishing boats on their moorings (the hire boat steers round them) */
export const MOORED: [number, number][] = [[-30, 98], [-8, 104], [18, 99], [42, 108]];

function waterNormals(): THREE.CanvasTexture {
  const s = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const c = cv.getContext('2d')!;
  const img = c.createImageData(s, s);
  // sum of a few sine ripples, turned into a tangent-space normal map
  const h = (x: number, y: number) => Math.sin(x * 0.11 + y * 0.05) * 0.6 + Math.sin(x * 0.04 - y * 0.13) * 0.8 + Math.sin((x + y) * 0.21) * 0.3 + Math.sin(x * 0.31 - y * 0.07) * 0.2;
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1);
    const n = new THREE.Vector3(-dx, -dy, 2).normalize();
    const i = (y * s + x) * 4;
    img.data[i] = (n.x * 0.5 + 0.5) * 255; img.data[i + 1] = (n.y * 0.5 + 0.5) * 255; img.data[i + 2] = (n.z * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(40, 20);
  return t;
}

export function boat(hull: string, trim: string): THREE.Group {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(-1.1, 0); shape.lineTo(1.1, 0); shape.quadraticCurveTo(1.35, 0.6, 1.2, 1.0); shape.lineTo(-1.2, 1.0); shape.quadraticCurveTo(-1.35, 0.6, -1.1, 0);
  const hullGeo = new THREE.ExtrudeGeometry(shape, { depth: 5.2, bevelEnabled: true, bevelThickness: 0.4, bevelSize: 0.3, bevelSegments: 4 });
  hullGeo.translate(0, 0, -2.6);
  const h = new THREE.Mesh(hullGeo, new THREE.MeshStandardMaterial({ color: hull, roughness: 0.5 }));
  h.scale.set(1, 0.9, 1);
  g.add(h);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 5.4), new THREE.MeshStandardMaterial({ color: '#8a6a48', roughness: 0.8 }));
  deck.position.y = 0.92; g.add(deck);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 1.6), new THREE.MeshStandardMaterial({ color: '#f0eee8', roughness: 0.6 }));
  cabin.position.set(0, 1.55, -0.6); g.add(cabin);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.1, 1.8), new THREE.MeshStandardMaterial({ color: trim, roughness: 0.5 }));
  roof.position.set(0, 2.2, -0.6); g.add(roof);
  for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.45), new THREE.MeshStandardMaterial({ color: '#1f2a33', roughness: 0.1 })); w.position.set(s * 0.76, 1.75, -0.6); w.rotation.y = s * Math.PI / 2; g.add(w); }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 4, 8), new THREE.MeshStandardMaterial({ color: '#ddd', roughness: 0.4 }));
  mast.position.set(0, 3, 0.8); g.add(mast);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.62, 0.12, 5.9), new THREE.MeshStandardMaterial({ color: trim, roughness: 0.5 }));
  stripe.position.y = 0.75; g.add(stripe);
  g.traverse((o) => { o.castShadow = true; });
  return g;
}

function gull(): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: '#f4f4f2', roughness: 0.7, side: THREE.DoubleSide });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.22, 4, 6), m);
  body.rotation.x = Math.PI / 2; g.add(body);
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.16), new THREE.MeshStandardMaterial({ color: s > 0 ? '#e8e8e6' : '#e8e8e6', roughness: 0.7, side: THREE.DoubleSide }));
    wing.position.set(s * 0.24, 0, 0); wing.rotation.x = -Math.PI / 2; wing.name = s > 0 ? 'wR' : 'wL';
    g.add(wing);
  }
  return g;
}

export class Harbour {
  private water: THREE.Mesh;
  private normals: THREE.CanvasTexture;
  private boats: { g: THREE.Group; x: number; z: number; ph: number }[] = [];
  private gulls: { g: THREE.Group; r: number; cx: number; cz: number; y: number; sp: number; ph: number }[] = [];
  readonly group = new THREE.Group();

  constructor(scene: THREE.Scene) {
    this.normals = waterNormals();
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(2600, 700), new THREE.MeshStandardMaterial({ color: '#2f5868', roughness: 0.14, metalness: 0.35, normalMap: this.normals, normalScale: new THREE.Vector2(0.55, 0.55) }));
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(0, -1.05, QUAY_EDGE + 350);
    this.water.receiveShadow = false;
    this.group.add(this.water);
    // the harbour wall: dressed stone face from the quay down into the water, with a capping course
    const stone = new THREE.MeshStandardMaterial({ color: '#8b877d', roughness: 0.92 });
    const wall = new THREE.Mesh(new THREE.BoxGeometry(260, 1.9, 0.8), stone);
    wall.position.set(0, -0.86, QUAY_EDGE + 0.4); wall.receiveShadow = true;
    this.group.add(wall);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(260, 0.14, 1.0), new THREE.MeshStandardMaterial({ color: '#a29e94', roughness: 0.85 }));
    cap.position.set(0, 0.03, QUAY_EDGE + 0.35); this.group.add(cap);
    // bollards along the edge
    const iron = new THREE.MeshStandardMaterial({ color: '#2a2d30', roughness: 0.5, metalness: 0.6 });
    for (let x = -56; x <= 56; x += 8) {
      if ([-22, -4, 14, 34].some((f) => Math.abs(f - x) < 3)) continue;
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.55, 12), iron);
      b.position.set(x, 0.3, QUAY_EDGE - 0.3); b.castShadow = true; this.group.add(b);
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), iron);
      top.position.set(x, 0.57, QUAY_EDGE - 0.3); this.group.add(top);
    }
    // fishing boats on their moorings
    const colours: [string, string][] = [['#1f4f7a', '#c0392b'], ['#e8e2d0', '#2b4f8c'], ['#7a2b2b', '#f1c40f'], ['#2e5a3a', '#f0eee8']];
    MOORED.forEach(([x, z], i) => {
      const b = boat(...colours[i]);
      b.position.set(x, -1.2, z);
      b.rotation.y = 0.3 * (i % 2 ? 1 : -1);
      this.group.add(b);
      this.boats.push({ g: b, x, z, ph: i * 1.7 });
    });
    for (let i = 0; i < 7; i++) {
      const g = gull();
      this.group.add(g);
      this.gulls.push({ g, r: 6 + (i % 3) * 5, cx: -30 + i * 10, cz: QUAY_EDGE + 8 + (i % 2) * 10, y: 7 + (i % 4) * 2, sp: 0.25 + (i % 3) * 0.08, ph: i * 0.9 });
    }
    // the bait and tackle hut
    const wood = new THREE.MeshStandardMaterial({ color: '#3f6b7a', roughness: 0.8 });
    const hut = new THREE.Mesh(new THREE.BoxGeometry(4, 2.4, 3), wood);
    hut.position.set(BAIT_HUT.x, 1.2, BAIT_HUT.z); hut.castShadow = true; hut.receiveShadow = true;
    this.group.add(hut);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.15, 3.5), new THREE.MeshStandardMaterial({ color: '#3a3a3a', roughness: 0.7 }));
    roof.position.set(BAIT_HUT.x, 2.5, BAIT_HUT.z); roof.rotation.x = 0.08; this.group.add(roof);
    const hatch = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.0, 0.1), new THREE.MeshStandardMaterial({ color: '#1d1d1d', roughness: 0.4 }));
    hatch.position.set(BAIT_HUT.x, 1.4, BAIT_HUT.z - 1.52); this.group.add(hatch);
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.5), new THREE.MeshStandardMaterial({ color: '#8a6a48', roughness: 0.8 }));
    shelf.position.set(BAIT_HUT.x, 0.95, BAIT_HUT.z - 1.7); this.group.add(shelf);
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 96;
    const c = cv.getContext('2d')!; c.fillStyle = '#f2efe6'; c.fillRect(0, 0, 512, 96); c.fillStyle = '#1f3f4a'; c.font = 'bold 54px sans-serif'; c.textAlign = 'center'; c.fillText('BAIT & TACKLE', 256, 68);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.6), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(cv), roughness: 0.6 }));
    sign.position.set(BAIT_HUT.x, 2.15, BAIT_HUT.z - 1.53); sign.rotation.y = Math.PI; this.group.add(sign);
    scene.add(this.group);
  }

  update(dt: number) {
    const t = performance.now() / 1000;
    this.normals.offset.set(t * 0.004, t * 0.007);
    for (const b of this.boats) {
      b.g.position.y = -1.2 + Math.sin(t * 0.9 + b.ph) * 0.08;
      b.g.rotation.z = Math.sin(t * 0.7 + b.ph) * 0.04;
      b.g.rotation.x = Math.sin(t * 0.55 + b.ph * 2) * 0.025;
    }
    for (const g of this.gulls) {
      const a = t * g.sp + g.ph;
      g.g.position.set(g.cx + Math.cos(a) * g.r, g.y + Math.sin(t * 0.6 + g.ph) * 0.8, g.cz + Math.sin(a) * g.r);
      g.g.rotation.y = -a;
      const flap = Math.sin(t * 7 + g.ph) * 0.45;
      const wl = g.g.getObjectByName('wL'), wr = g.g.getObjectByName('wR');
      if (wl) wl.rotation.z = flap; if (wr) wr.rotation.z = -flap;
    }
    void dt;
  }
}
