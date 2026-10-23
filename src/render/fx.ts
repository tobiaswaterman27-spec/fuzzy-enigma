// Smoke, fire and explosions: a pool of soft sprites that rise, grow and fade, plus a flash of light
// and flying debris when something goes up. Cheap enough to leave running: a fixed pool, one shared
// texture per kind.
import * as THREE from 'three';

type Kind = 'smoke' | 'black' | 'fire' | 'spark';
interface Puff { s: THREE.Sprite; vel: THREE.Vector3; life: number; max: number; grow: number; kind: Kind }
interface Bit { m: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; life: number }

function softTex(inner: string, outer: string): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  r.addColorStop(0, inner); r.addColorStop(1, outer);
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Fx {
  private puffs: Puff[] = [];
  private free: THREE.Sprite[] = [];
  private bits: Bit[] = [];
  private mats: Record<Kind, THREE.SpriteMaterial>;
  private flash: THREE.PointLight;
  private flashT = 0;
  constructor(private scene: THREE.Scene) {
    this.mats = {
      smoke: new THREE.SpriteMaterial({ map: softTex('rgba(220,220,220,0.55)', 'rgba(220,220,220,0)'), depthWrite: false }),
      black: new THREE.SpriteMaterial({ map: softTex('rgba(30,30,30,0.7)', 'rgba(30,30,30,0)'), depthWrite: false }),
      fire: new THREE.SpriteMaterial({ map: softTex('rgba(255,230,140,1)', 'rgba(255,90,0,0)'), depthWrite: false, blending: THREE.AdditiveBlending }),
      spark: new THREE.SpriteMaterial({ map: softTex('rgba(255,255,200,1)', 'rgba(255,160,40,0)'), depthWrite: false, blending: THREE.AdditiveBlending }),
    };
    this.flash = new THREE.PointLight('#ffb050', 0, 40, 1.5);
    scene.add(this.flash);
  }

  emit(kind: Kind, x: number, y: number, z: number, vel = new THREE.Vector3(0, 1.2, 0), size = 0.6, life = 2) {
    if (this.puffs.length > 260) return;
    const s = this.free.pop() ?? new THREE.Sprite();
    s.material = this.mats[kind];
    s.position.set(x, y, z);
    s.scale.setScalar(size);
    s.renderOrder = 5;
    this.scene.add(s);
    this.puffs.push({ s, vel: vel.clone(), life, max: life, grow: kind === 'fire' ? 0.6 : 1.1, kind });
  }

  /** a car going up: a ball of fire, a flash, smoke and pieces flying */
  explode(x: number, z: number) {
    this.flash.position.set(x, 2, z); this.flashT = 0.6;
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, u = Math.random();
      this.emit('fire', x + Math.cos(a) * u, 0.8 + Math.random(), z + Math.sin(a) * u, new THREE.Vector3(Math.cos(a) * 3 * u, 2 + Math.random() * 3, Math.sin(a) * 3 * u), 1.4 + Math.random(), 0.7 + Math.random() * 0.4);
    }
    for (let i = 0; i < 14; i++) this.emit('black', x + (Math.random() - 0.5) * 2, 1.5, z + (Math.random() - 0.5) * 2, new THREE.Vector3((Math.random() - 0.5) * 1.5, 2.5 + Math.random() * 2, (Math.random() - 0.5) * 1.5), 1.6, 3 + Math.random() * 2);
    const metal = new THREE.MeshStandardMaterial({ color: '#2a2a2a', roughness: 0.8, metalness: 0.4 });
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.15 + Math.random() * 0.4, 0.05, 0.1 + Math.random() * 0.3), metal);
      m.position.set(x, 1, z); m.castShadow = true;
      this.scene.add(m);
      const a = Math.random() * Math.PI * 2;
      this.bits.push({ m, vel: new THREE.Vector3(Math.cos(a) * (3 + Math.random() * 5), 4 + Math.random() * 6, Math.sin(a) * (3 + Math.random() * 5)), spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10), life: 6 });
    }
  }

  update(dt: number) {
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.life -= dt;
      if (p.life <= 0) { this.scene.remove(p.s); this.free.push(p.s); this.puffs.splice(i, 1); continue; }
      p.s.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(1 - dt * (p.kind === 'fire' ? 2 : 0.6));
      p.s.scale.multiplyScalar(1 + p.grow * dt);
      // materials are shared, so a puff fades out by shrinking away at the end of its life
      if (p.life / p.max < 0.3) p.s.scale.multiplyScalar(1 - dt * 2.5);
    }
    for (let i = this.bits.length - 1; i >= 0; i--) {
      const b = this.bits[i];
      b.life -= dt;
      b.vel.y -= 9.8 * dt;
      b.m.position.addScaledVector(b.vel, dt);
      if (b.m.position.y < 0.03) { b.m.position.y = 0.03; b.vel.multiplyScalar(0.4); b.vel.y = Math.abs(b.vel.y) * 0.3; b.spin.multiplyScalar(0.5); }
      b.m.rotation.x += b.spin.x * dt; b.m.rotation.y += b.spin.y * dt; b.m.rotation.z += b.spin.z * dt;
      if (b.life <= 0) { this.scene.remove(b.m); b.m.geometry.dispose(); this.bits.splice(i, 1); }
    }
    this.flashT = Math.max(0, this.flashT - dt);
    this.flash.intensity = this.flashT > 0 ? 400 * this.flashT : 0;
  }
}
