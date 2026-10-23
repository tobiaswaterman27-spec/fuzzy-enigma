// The Saturday market drawn in the park: gazebo stalls with striped awnings, a table of produce and
// a trader behind each one. Shown only while the market is on.
import * as THREE from 'three';
import type { GameState, Appearance } from '../sim/types';
import { STALLS, marketOn } from '../sim/streetmarket';
import { ITEMS } from '../sim/items';
import { AnimationController, buildRig, type Rig } from './character';
import { productUnitGeometry, productMaterial } from './products';
import { requestHuman } from './humanBuilder';

const TRADERS: Appearance[] = [
  { frame: 'm', skin: '#c98e66', hair: 'short', hairColor: '#2a1b10', build: 'broad', outfit: 'outfit_casual', height: 1.02 },
  { frame: 'f', skin: '#f1d3b6', hair: 'bun', hairColor: '#a8743f', build: 'average', outfit: 'uniform_cafe', height: 0.98 },
  { frame: 'm', skin: '#7a4a2e', hair: 'curly', hairColor: '#111111', build: 'slim', outfit: 'outfit_smart', height: 1.0 },
];

const std = (color: string, rough = 0.7, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra });
function bx(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z);
  o.castShadow = true; o.receiveShadow = true;
  return o;
}

export class MarketStalls {
  private group = new THREE.Group();
  private traders: ({ rig: Rig; anim: AnimationController } | null)[] = STALLS.map(() => null);

  constructor(scene: THREE.Scene) {
    const leg = std('#d9dcdf', 0.4, { metalness: 0.5 });
    const white = std('#f4f2ec', 0.8);
    const wood = std('#8a6a48', 0.8);
    for (const st of STALLS) {
      const g = new THREE.Group();
      g.position.set(st.obj.x, 0, st.obj.z);
      const W = 2.8, D = 2.2;
      for (const [x, z] of [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]]) g.add(bx(0.05, 2.3, 0.05, leg, x, 1.15, z));
      // a peaked canopy in the trader's colour with a striped valance round the edge
      const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(W, D) / 2 + 0.05, 0.7, 4, 1), std(st.awning, 0.85, { side: THREE.DoubleSide }));
      roof.rotation.y = Math.PI / 4;
      roof.scale.set(W / Math.hypot(W, D) * 1.41, 1, D / Math.hypot(W, D) * 1.41);
      roof.position.y = 2.65;
      roof.castShadow = true;
      g.add(roof);
      for (let i = 0; i < 12; i++) {
        const m = i % 2 ? white : std(st.awning, 0.85);
        const t = (i + 0.5) / 12;
        g.add(bx(W / 12, 0.22, 0.02, m, -W / 2 + t * W, 2.2, -D / 2));
      }
      // table with a cloth, crates of produce
      g.add(bx(2.4, 0.06, 0.8, wood, 0, 0.82, -0.55));
      g.add(bx(2.42, 0.6, 0.02, white, 0, 0.55, -0.96));
      for (const x of [-1.1, 1.1]) g.add(bx(0.05, 0.8, 0.7, leg, x, 0.4, -0.55));
      const unit = productUnitGeometry(st.product);
      for (let c = 0; c < 3; c++) {
        const cx = -0.8 + c * 0.8;
        g.add(bx(0.6, 0.18, 0.45, wood, cx, 0.94, -0.55));
        const inst = new THREE.InstancedMesh(unit, productMaterial, 6);
        const dm = new THREE.Object3D();
        for (let k = 0; k < 6; k++) { dm.position.set(cx - 0.18 + (k % 3) * 0.18, 1.04 + Math.floor(k / 3) * 0.06, -0.62 + Math.floor(k / 3) * 0.14); dm.rotation.y = k * 0.7; dm.updateMatrix(); inst.setMatrixAt(k, dm.matrix); }
        g.add(inst);
      }
      // price board
      const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
      const c2 = cv.getContext('2d')!;
      c2.fillStyle = '#1c1f1d'; c2.fillRect(0, 0, 256, 128);
      c2.fillStyle = '#f3efe2'; c2.font = 'bold 30px sans-serif'; c2.textAlign = 'center';
      c2.fillText(ITEMS[st.product].name.toUpperCase(), 128, 52);
      c2.font = '26px sans-serif'; c2.fillText(`£${(Math.round(ITEMS[st.product].retail * 1.15 / 5) * 5 / 100).toFixed(2)}`, 128, 96);
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const board = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.3), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
      board.position.set(0.9, 1.25, -0.96); board.rotation.y = Math.PI;
      g.add(board);
      this.group.add(g);
    }
    this.group.visible = false;
    scene.add(this.group);
  }

  update(state: GameState, dt: number, viewer: { x: number; z: number }) {
    const on = marketOn(state) && Math.hypot(viewer.x - 58, viewer.z - 19) < 90;
    this.group.visible = on;
    if (!on) return;
    STALLS.forEach((st, i) => {
      let t = this.traders[i];
      if (!t) {
        // the trader appears once their body is ready (built in the background)
        if (!requestHuman(TRADERS[i])) return;
        const rig = buildRig(TRADERS[i]);
        rig.root.position.set(st.obj.x, 0, st.obj.z + 0.55);
        rig.root.rotation.y = Math.PI;
        this.group.add(rig.root);
        t = this.traders[i] = { rig, anim: new AnimationController(rig) };
      }
      t.anim.update(dt, 0, false, null);
    });
  }
}
