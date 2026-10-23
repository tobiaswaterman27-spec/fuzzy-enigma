// Skid marks: dark rubber streaks laid on the road behind the back wheels when a car slides or locks
// up. One instanced mesh of short strips, reused round-robin (the oldest go first).
import * as THREE from 'three';

const MAX = 900;

export class Skids {
  private mesh: THREE.InstancedMesh;
  private n = 0;
  private last: [THREE.Vector2 | null, THREE.Vector2 | null] = [null, null];
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private s = new THREE.Vector3(); private p = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: '#0c0c0c', transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), MAX);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }

  /** the car's back wheels this frame; strength 0 lifts the pen */
  lay(x: number, z: number, heading: number, strength: number) {
    const fx = Math.sin(heading), fz = Math.cos(heading), rx = Math.cos(heading), rz = -Math.sin(heading);
    for (const side of [0, 1] as const) {
      const sd = side ? 0.78 : -0.78;
      const w = new THREE.Vector2(x - fx * 1.3 + rx * sd, z - fz * 1.3 + rz * sd);
      const prev = this.last[side];
      if (strength <= 0) { this.last[side] = null; continue; }
      if (!prev) { this.last[side] = w; continue; }
      const d = prev.distanceTo(w);
      if (d < 0.3) continue;
      if (d < 3) {
        this.e.set(0, Math.atan2(w.x - prev.x, w.y - prev.y), 0); this.q.setFromEuler(this.e);
        this.m.compose(this.p.set((w.x + prev.x) / 2, 0.025, (w.y + prev.y) / 2), this.q, this.s.set(0.24, 1, d + 0.04));
        this.mesh.setMatrixAt(this.n % MAX, this.m);
        this.n++;
        this.mesh.count = Math.min(MAX, this.n);
        this.mesh.instanceMatrix.needsUpdate = true;
      }
      this.last[side] = w;
    }
  }
}
