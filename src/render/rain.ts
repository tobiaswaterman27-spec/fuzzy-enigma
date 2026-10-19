// Rain: streak sprites falling in a box that follows the camera, denser as the rain gets heavier.
import * as THREE from 'three';

const N = 3000;
const BOX = 34, H = 20;

function streakTexture(): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = 16; cv.height = 64;
  const c = cv.getContext('2d')!;
  const g = c.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, 'rgba(210,220,230,0)');
  g.addColorStop(0.5, 'rgba(210,220,230,0.9)');
  g.addColorStop(1, 'rgba(210,220,230,0)');
  c.fillStyle = g;
  c.fillRect(7, 0, 2, 64);
  const t = new THREE.CanvasTexture(cv);
  return t;
}

export class Rain {
  private points: THREE.Points;
  private pos: Float32Array;
  private speed: Float32Array;
  constructor(scene: THREE.Scene) {
    this.pos = new Float32Array(N * 3);
    this.speed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      this.pos.set([(Math.random() - 0.5) * BOX, Math.random() * H, (Math.random() - 0.5) * BOX], i * 3);
      this.speed[i] = 13 + Math.random() * 6;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.9, map: streakTexture(), transparent: true, opacity: 0.6, depthWrite: false, sizeAttenuation: true, color: '#c8d2dc' }));
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }

  /** intensity 0..1; centre = camera position */
  update(dt: number, intensity: number, centre: THREE.Vector3) {
    this.points.visible = intensity > 0.02;
    if (!this.points.visible) return;
    const g = this.points.geometry;
    g.setDrawRange(0, Math.floor(N * Math.min(1, intensity)));
    (this.points.material as THREE.PointsMaterial).opacity = 0.35 + 0.45 * intensity;
    this.points.position.set(centre.x, Math.max(0, centre.y - H / 2), centre.z);
    const p = this.pos;
    for (let i = 0; i < N; i++) {
      p[i * 3 + 1] -= this.speed[i] * dt;
      if (p[i * 3 + 1] < 0) p[i * 3 + 1] += H;
    }
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}
