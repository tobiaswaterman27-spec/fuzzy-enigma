// A dog: body, head with snout and ears, a wagging tail and four legs that trot with its speed.
import * as THREE from 'three';

export class DogView {
  root = new THREE.Group();
  private legs: THREE.Object3D[] = [];
  private tail: THREE.Object3D;
  private head: THREE.Object3D;
  private phase = 0;
  pos = new THREE.Vector2();
  facing = 0;
  speed = 0;

  constructor(color: string, size: number) {
    const coat = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: '#1a1410', roughness: 0.5 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.32, 6, 12), coat);
    body.rotation.x = Math.PI / 2; body.position.y = 0.36;
    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.125, 12, 10), coat);
    chest.position.set(0, 0.37, 0.15);
    this.head = new THREE.Group();
    this.head.position.set(0, 0.5, 0.27);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 10), coat);
    const snout = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.07, 4, 8), coat);
    snout.rotation.x = Math.PI / 2; snout.position.set(0, -0.025, 0.1);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), dark);
    nose.position.set(0, -0.015, 0.165);
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.08, 0.05), coat);
      ear.position.set(s * 0.065, 0.02, -0.01); ear.rotation.z = s * 0.5;
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 5), dark);
      eye.position.set(s * 0.035, 0.02, 0.07);
      this.head.add(ear, eye);
    }
    this.head.add(skull, snout, nose);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 6, 16), new THREE.MeshStandardMaterial({ color: '#b3261e', roughness: 0.5 }));
    collar.position.set(0, 0.45, 0.22); collar.rotation.x = Math.PI / 2.6;
    this.tail = new THREE.Group();
    this.tail.position.set(0, 0.42, -0.25);
    const t = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.16, 4, 6), coat);
    t.position.y = 0.09; this.tail.add(t);
    this.tail.rotation.x = -0.7;
    for (const [x, z] of [[-0.07, 0.17], [0.07, 0.17], [-0.07, -0.16], [0.07, -0.16]]) {
      const hip = new THREE.Group();
      hip.position.set(x, 0.3, z);
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.22, 4, 6), coat);
      leg.position.y = -0.14;
      hip.add(leg);
      this.legs.push(hip);
      this.root.add(hip);
    }
    this.root.add(body, chest, this.head, collar, this.tail);
    this.root.scale.setScalar(size);
    this.root.traverse((o) => { o.castShadow = true; });
  }

  /** follow a spot (the owner's side), trotting when it has to catch up */
  update(dt: number, tx: number, tz: number, ownerFacing: number) {
    const dx = tx - this.pos.x, dz = tz - this.pos.y, d = Math.hypot(dx, dz);
    if (d > 10) { this.pos.set(tx, tz); this.speed = 0; }
    else if (d > 0.08) {
      const v = Math.min(d * 3, d > 1.5 ? 5 : 2.4);
      this.speed += (v - this.speed) * Math.min(1, dt * 6);
      const step = Math.min(d, this.speed * dt);
      this.pos.x += (dx / d) * step; this.pos.y += (dz / d) * step;
      if (d > 0.25) this.facing = Math.atan2(dx, dz);
    } else { this.speed *= 0.8; this.facing += (((ownerFacing - this.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 2); }
    this.root.position.set(this.pos.x, 0, this.pos.y);
    this.root.rotation.y = this.facing;
    this.phase += dt * (2 + this.speed * 5);
    const swing = Math.min(0.7, this.speed * 0.35);
    this.legs.forEach((l, i) => { l.rotation.x = Math.sin(this.phase + (i === 0 || i === 3 ? 0 : Math.PI)) * swing; });
    this.tail.rotation.z = Math.sin(performance.now() / 90) * 0.5;
    this.head.rotation.x = Math.sin(this.phase * 0.5) * 0.05 - (this.speed < 0.1 ? Math.sin(performance.now() / 1300) * 0.12 : 0);
  }
}
