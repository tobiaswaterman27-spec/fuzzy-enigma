// Static world presentation built from the shared layout data.
import * as THREE from 'three';
import { getWorld, wallsFor, WALL_T, type BuildingDef, type Obstacle, type Rect } from '../sim/world/layout';

const M = (color: string, rough = 0.9, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra });

function box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, shadow = true) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z);
  o.castShadow = shadow;
  o.receiveShadow = true;
  return o;
}
const rbox = (r: Rect, h: number, m: THREE.Material, y0 = 0, shadow = true) => box(r.x1 - r.x0, h, r.z1 - r.z0, m, (r.x0 + r.x1) / 2, y0 + h / 2, (r.z0 + r.z1) / 2, shadow);

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function signTexture(text: string, color: string, bg: string) {
  return canvasTex(1024, 160, (c) => {
    c.fillStyle = bg; c.fillRect(0, 0, 1024, 160);
    c.fillStyle = color; c.font = 'bold 92px Arial Black, Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, 512, 86, 980);
  });
}

function facadeTexture(base: string, trim: string, floors: number, lit: boolean) {
  return canvasTex(256, 256, (c) => {
    c.fillStyle = base; c.fillRect(0, 0, 256, 256);
    const rows = Math.max(1, floors);
    for (let r = 0; r < rows; r++) for (let i = 0; i < 4; i++) {
      const x = 18 + i * 60, y = 30 + r * (220 / rows);
      c.fillStyle = trim; c.fillRect(x - 4, y - 4, 44, 220 / rows * 0.55 + 8);
      c.fillStyle = lit && (i + r) % 3 === 0 ? '#ffd98a' : '#3b4a57';
      c.fillRect(x, y, 36, 220 / rows * 0.55);
    }
  });
}

export interface WorldView {
  group: THREE.Group;
  /** per building: meshes to hide (roof/upper walls) when the player is inside */
  cutaway: Map<string, { roof: THREE.Object3D[]; walls: THREE.Mesh[]; fullH: number }>;
  windowsMat: THREE.MeshStandardMaterial[];
  lampBulbs: THREE.MeshStandardMaterial;
  lampLights: THREE.PointLight[];
}

export function buildWorld(scene: THREE.Scene): WorldView {
  const w = getWorld();
  const g = new THREE.Group();
  scene.add(g);
  const cutaway: WorldView['cutaway'] = new Map();
  const windowsMat: THREE.MeshStandardMaterial[] = [];

  // ground
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(260, 200), M('#6f9a5a'));
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(0, -0.02, 13);
  grass.receiveShadow = true;
  g.add(grass);
  const kinds: Record<string, { c: string; y: number }> = {
    road: { c: '#3d4146', y: 0.0 }, lane: { c: '#4a4e53', y: 0.005 }, sidewalk: { c: '#b9b6ae', y: 0.06 },
    forecourt: { c: '#8f8c86', y: 0.03 }, grass: { c: '#7fae63', y: 0.01 }, plaza: { c: '#c9c2b4', y: 0.06 },
  };
  for (const r of w.roads) {
    const k = kinds[r.kind];
    const m = new THREE.Mesh(new THREE.BoxGeometry(r.rect.x1 - r.rect.x0, 0.06, r.rect.z1 - r.rect.z0), M(k.c, 0.95));
    m.position.set((r.rect.x0 + r.rect.x1) / 2, k.y - 0.03, (r.rect.z0 + r.rect.z1) / 2);
    m.receiveShadow = true;
    g.add(m);
  }
  // road markings
  const dash = M('#e9e4c8', 0.7);
  for (let x = -94; x < 94; x += 6) if (Math.abs(x) > 7) g.add(box(3, 0.02, 0.15, dash, x, 0.01, 0, false));
  for (let z = -46; z < 74; z += 6) if (Math.abs(z) > 7) g.add(box(0.15, 0.02, 3, dash, 0, 0.01, z, false));
  for (const [x, z, rot] of [[-12, 0, 0], [12, 0, 0], [0, -11, 1], [0, 11, 1]] as const) for (let i = -4; i <= 4; i++) {
    g.add(rot ? box(0.6, 0.02, 2.5, dash, i * 1.1, 0.012, z, false) : box(2.5, 0.02, 0.6, dash, x, 0.012, i * 1.1, false));
  }

  // buildings
  for (const b of w.buildings) buildBuilding(g, b, cutaway, windowsMat);

  // obstacles / furniture / props
  for (const o of w.obstacles) g.add(buildObstacle(o));

  // lamps
  const lampBulbs = M('#fff3c4', 0.4, { emissive: new THREE.Color('#ffcf70'), emissiveIntensity: 0 });
  const pole = M('#3a3f44', 0.5);
  for (const l of w.lamps) {
    g.add(box(0.14, 5, 0.14, pole, l.x, 2.5, l.z));
    g.add(box(0.5, 0.18, 0.5, lampBulbs, l.x, 5, l.z, false));
  }
  const lampLights: THREE.PointLight[] = [];
  for (let i = 0; i < 6; i++) { const pl = new THREE.PointLight('#ffcf80', 0, 18, 1.6); pl.position.y = 4.6; g.add(pl); lampLights.push(pl); }

  // parked cars
  for (const p of w.parked) g.add(buildCar(p.color, p.pos.x, p.pos.z, p.rot));
  return { group: g, cutaway, windowsMat, lampBulbs, lampLights };
}

function buildBuilding(g: THREE.Group, b: BuildingDef, cutaway: WorldView['cutaway'], windowsMat: THREE.MeshStandardMaterial[]) {
  const { x0, z0, x1, z1 } = b.rect;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, W = x1 - x0, D = z1 - z0;
  const roofs: THREE.Object3D[] = [];
  const wallsOut: THREE.Mesh[] = [];
  if (b.interior) {
    const wallM = M(b.color, 0.85);
    const innerM = M('#efe9df', 0.9);
    for (const r of wallsFor(b)) {
      const isInternal = b.internalWalls?.includes(r);
      const m = rbox(r, b.interior ? 3.2 : b.height, isInternal ? innerM : wallM);
      g.add(m);
      wallsOut.push(m);
    }
    // floor
    const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.08, D), M(b.floorColor ?? '#ccc', 0.8));
    floor.position.set(cx, 0.04, cz);
    floor.receiveShadow = true;
    g.add(floor);
    // upper storey / parapet shell above the cutaway height
    const upper = box(W + WALL_T, b.height - 3.2, D + WALL_T, M(b.color, 0.85), cx, 3.2 + (b.height - 3.2) / 2, cz);
    roofs.push(upper);
    const roof = box(W + 0.6, 0.25, D + 0.6, M(b.roof, 0.8), cx, b.height + 0.12, cz);
    roofs.push(roof);
    for (const r of roofs) g.add(r);
    // door frames
    for (const d of b.doors) addDoor(g, b, d.side, d.a, d.b, d.open, b.trim);
    // interior ceiling lights
    if (b.id === 'market' || b.id === 'jobcentre' || b.id === 'cafe' || b.id === 'flat') {
      const panel = M('#ffffff', 0.3, { emissive: new THREE.Color('#fff6e0'), emissiveIntensity: 0.7 });
      for (let x = x0 + 4; x < x1 - 2; x += 6) for (let z = z0 + 4; z < z1 - 2; z += 6) { const p = box(1.6, 0.05, 0.6, panel, x, 3.15, z, false); roofs.push(p); g.add(p); }
    }
    cutaway.set(b.id, { roof: roofs, walls: wallsOut, fullH: 3.2 });
  } else {
    const tex = facadeTexture(b.color, b.trim, b.floors, false);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(Math.max(1, Math.round(W / 8)), 1);
    const fm = M('#ffffff', 0.85, { map: tex, emissive: new THREE.Color('#000000') });
    windowsMat.push(fm);
    const shell = box(W, b.height, D, fm, cx, b.height / 2, cz);
    g.add(shell);
    const isHouse = b.id.startsWith('house_');
    if (isHouse) {
      const roofG = new THREE.ConeGeometry(Math.max(W, D) * 0.75, 2.6, 4);
      const roof = new THREE.Mesh(roofG, M(b.roof, 0.8));
      roof.rotation.y = Math.PI / 4;
      roof.scale.set(W / Math.max(W, D), 1, D / Math.max(W, D));
      roof.position.set(cx, b.height + 1.3, cz);
      roof.castShadow = true;
      g.add(roof);
    } else g.add(box(W + 0.4, 0.3, D + 0.4, M(b.roof, 0.8), cx, b.height + 0.15, cz));
    for (const d of b.doors) addDoor(g, b, d.side, d.a, d.b, false, b.trim);
  }
  if (b.sign) {
    const st = signTexture(b.sign.text, b.sign.color, b.sign.bg);
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(W * 0.8, 14), Math.min(W * 0.8, 14) * 0.156), new THREE.MeshStandardMaterial({ map: st, roughness: 0.6, emissive: new THREE.Color('#ffffff'), emissiveMap: st, emissiveIntensity: 0.15 }));
    const y = b.interior ? Math.min(b.height - 0.6, 4.1) : Math.min(b.height - 0.8, 4.5);
    if (b.sign.side === 'zmax') { sm.position.set(cx, y, z1 + 0.2); }
    if (b.sign.side === 'zmin') { sm.position.set(cx, y, z0 - 0.2); sm.rotation.y = Math.PI; }
    g.add(sm);
    if (b.interior) roofs.push(sm);
  }
}

function addDoor(g: THREE.Group, b: BuildingDef, side: string, a: number, c: number, open: boolean, trim: string) {
  const { x0, z0, x1, z1 } = b.rect;
  const tm = M(trim, 0.6);
  const doorM = M(open ? '#9fc3d1' : '#5b3e2b', 0.4, open ? { transparent: true, opacity: 0.25 } : {});
  const w = c - a, mid = (a + c) / 2, h = 2.4;
  const along = side === 'zmin' || side === 'zmax';
  const px = side === 'xmin' ? x0 : side === 'xmax' ? x1 : mid;
  const pz = side === 'zmin' ? z0 : side === 'zmax' ? z1 : mid;
  const off = side === 'zmin' || side === 'xmin' ? -0.17 : 0.17;
  if (along) {
    g.add(box(w + 0.3, 0.2, 0.36, tm, px, h + 0.1, pz));
    if (!open) g.add(box(w, h, 0.08, doorM, px, h / 2, pz + off));
  } else {
    g.add(box(0.36, 0.2, w + 0.3, tm, px, h + 0.1, pz));
    if (!open) g.add(box(0.08, h, w, doorM, px + off, h / 2, pz));
  }
}

function buildObstacle(o: Obstacle): THREE.Object3D {
  const r = o.rect;
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, W = r.x1 - r.x0, D = r.z1 - r.z0;
  const grp = new THREE.Group();
  switch (o.kind) {
    case 'gondola': {
      const frame = M('#d7dbe0', 0.5);
      grp.add(box(W * 0.3, o.height, D, frame, cx, o.height / 2, cz));
      for (const y of [0.15, 0.6, 1.05, 1.5]) grp.add(box(W, 0.04, D, frame, cx, y, cz));
      break;
    }
    case 'counter': grp.add(box(W, o.height, D, M(o.color ?? '#8b6f4e', 0.6), cx, o.height / 2, cz)); grp.add(box(W + 0.05, 0.05, D + 0.05, M('#2b2b2b', 0.4), cx, o.height, cz)); break;
    case 'pallet': grp.add(box(W, 0.14, D, M('#a5814f', 0.9), cx, 0.07, cz)); break;
    case 'kiosk': grp.add(box(W, o.height, D, M('#334455', 0.4), cx, o.height / 2, cz)); grp.add(box(0.05, 0.4, 0.6, M('#4fc3f7', 0.2, { emissive: new THREE.Color('#2a7fa8'), emissiveIntensity: 0.6 }), cx + W / 2, 1.2, cz)); break;
    case 'terminal': grp.add(box(W, 0.5, D, M('#2b2f33', 0.4), cx, 1.3, cz)); grp.add(box(W * 0.8, 0.35, 0.02, M('#7cd67c', 0.2, { emissive: new THREE.Color('#2f8f2f'), emissiveIntensity: 0.7 }), cx, 1.3, r.z0 - 0.01)); break;
    case 'cupboard': grp.add(box(W, o.height, D, M('#7d8a96', 0.5), cx, o.height / 2, cz)); break;
    case 'bed': grp.add(box(W, 0.45, D, M('#6b4f3a', 0.8), cx, 0.22, cz)); grp.add(box(W - 0.1, 0.18, D - 0.1, M('#e8e4dc', 0.9), cx, 0.52, cz)); grp.add(box(0.9, 0.12, D - 0.4, M('#ffffff', 0.9), r.x1 - 0.55, 0.66, cz)); grp.add(box(W * 0.6, 0.06, D - 0.05, M('#4e6e9e', 0.9), r.x0 + W * 0.3, 0.63, cz)); break;
    case 'kitchen': grp.add(box(W, o.height, D, M('#d9d4cb', 0.6), cx, o.height / 2, cz)); grp.add(box(W, 0.05, D, M('#3d3d3d', 0.3), cx, o.height, cz)); grp.add(box(0.9, 1.9, D, M('#e8ecef', 0.3), r.x0 + 0.45, 0.95, cz)); break;
    case 'table': grp.add(box(W, 0.06, D, M('#8b6a48', 0.7), cx, o.height, cz)); for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) grp.add(box(0.07, o.height, 0.07, M('#5a4430'), cx + dx * (W / 2 - 0.1), o.height / 2, cz + dz * (D / 2 - 0.1))); break;
    case 'wardrobe': grp.add(box(W, o.height, D, M('#7a5638', 0.7), cx, o.height / 2, cz)); grp.add(box(0.02, o.height - 0.2, 0.02, M('#3a2a1c'), cx, o.height / 2, r.z1 + 0.01)); break;
    case 'sofa': grp.add(box(W, 0.45, D, M('#5f7d6e', 0.9), cx, 0.22, cz)); grp.add(box(0.25, 0.8, D, M('#5f7d6e', 0.9), r.x0 + 0.12, 0.4, cz)); break;
    case 'board': grp.add(box(W, 1.4, D, M('#c9a66b', 0.8), cx, 1.5, cz)); for (let i = 0; i < 6; i++) grp.add(box(0.7, 0.5, 0.02, M(['#ffffff', '#fff6b0', '#d9f0ff'][i % 3], 0.9), r.x0 + 0.6 + i * 0.95, 1.5 + (i % 2) * 0.3, r.z1 + 0.01)); break;
    case 'desk': grp.add(box(W, o.height, D, M('#7b8794', 0.6), cx, o.height / 2, cz)); grp.add(box(0.5, 0.35, 0.05, M('#222', 0.3), cx, o.height + 0.25, cz)); break;
    case 'tree': {
      grp.add(box(0.35, 2.4, 0.35, M('#6b4a2e'), cx, 1.2, cz));
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.9, 0), M('#3f7a3a', 0.9));
      crown.position.set(cx, 3.6, cz); crown.castShadow = true; grp.add(crown);
      break;
    }
    case 'bench': grp.add(box(W, 0.08, D, M('#8b6a48'), cx, 0.45, cz)); grp.add(box(W, 0.4, 0.06, M('#8b6a48'), cx, 0.7, r.z0)); grp.add(box(0.08, 0.45, D, M('#333'), r.x0 + 0.1, 0.22, cz)); grp.add(box(0.08, 0.45, D, M('#333'), r.x1 - 0.1, 0.22, cz)); break;
    case 'bin': grp.add(box(W, o.height, D, M('#2f5d3a', 0.6), cx, o.height / 2, cz)); break;
    case 'busstop': grp.add(box(W, 0.08, D + 0.6, M('#9fb3c8', 0.3, { transparent: true, opacity: 0.6 }), cx, 2.4, cz)); grp.add(box(0.08, 2.4, 0.08, M('#555'), r.x0, 1.2, cz)); grp.add(box(0.08, 2.4, 0.08, M('#555'), r.x1, 1.2, cz)); grp.add(box(W, 1.6, 0.04, M('#cfe3f0', 0.2, { transparent: true, opacity: 0.4 }), cx, 1.3, cz)); break;
    case 'lamp': case 'car': break;
    default: grp.add(box(W, o.height, D, M('#888'), cx, o.height / 2, cz));
  }
  return grp;
}

export function buildCar(color: string, x: number, z: number, rot: number, van = false): THREE.Group {
  const grp = new THREE.Group();
  const body = M(color, 0.4);
  const glass = M('#22303c', 0.2);
  const L = van ? 5 : 4.2, H = van ? 1.3 : 0.75;
  grp.add(box(1.85, H, L, body, 0, 0.45 + H / 2, 0));
  if (van) { grp.add(box(1.8, 0.9, 1.3, body, 0, 1.75, L / 2 - 0.95)); grp.add(box(1.7, 0.5, 0.05, glass, 0, 1.85, L / 2 - 0.3)); grp.add(box(1.88, 0.35, 3.0, M('#f4c20d', 0.6), 0, 1.1, -0.6)); }
  else { grp.add(box(1.7, 0.6, 2.2, glass, 0, 1.45, -0.2)); grp.add(box(1.75, 0.08, 2.0, body, 0, 1.78, -0.2)); }
  const wheel = M('#151515', 0.8);
  for (const [dx, dz] of [[-0.95, 1.3], [0.95, 1.3], [-0.95, -1.3], [0.95, -1.3]]) {
    const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.25, 12), wheel);
    wh.rotation.z = Math.PI / 2; wh.position.set(dx, 0.36, dz * (L / 4.2)); grp.add(wh);
  }
  grp.add(box(1.6, 0.15, 0.05, M('#fff7d0', 0.3, { emissive: new THREE.Color('#fff2b0'), emissiveIntensity: 0.3 }), 0, 0.85, L / 2 + 0.01, false));
  grp.position.set(x, 0, z);
  grp.rotation.y = rot;
  return grp;
}
