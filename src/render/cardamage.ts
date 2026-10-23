// Damage you can see on a car: the side that hit something is pushed in (crumpled, not just moved),
// smashed lights go dark, and a burnt-out car is charred all over. The car's own copy of its
// geometry is bent from the original each time the damage changes.
import * as THREE from 'three';

const _inv = new THREE.Matrix4(), _n = new THREE.Matrix3(), _p = new THREE.Vector3(), _d = new THREE.Vector3();
const noise = (x: number, y: number, z: number) => { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return s - Math.floor(s); };

interface Bent { mesh: THREE.Mesh; orig: Float32Array; toCar: THREE.Matrix4 }

export function applyCarDamage(obj: THREE.Object3D, dmg: readonly number[], wrecked: boolean) {
  const key = `${dmg.map((d) => d.toFixed(2)).join(',')}|${wrecked}`;
  if (obj.userData.dmgKey === key) return;
  obj.userData.dmgKey = key;
  // the detailed model only (the far one is too small to matter)
  const lod = obj.children.find((c) => (c as THREE.LOD).isLOD) as THREE.LOD | undefined;
  const model = lod ? lod.levels[0].object : obj.children[0];
  if (!model) return;
  obj.updateMatrixWorld(true);
  let bent = obj.userData.bent as Bent[] | undefined;
  if (!bent) {
    bent = [];
    _inv.copy(obj.matrixWorld).invert();
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry = m.geometry.clone();
      const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute;
      bent!.push({ mesh: m, orig: Float32Array.from(pos.array as Float32Array), toCar: new THREE.Matrix4().multiplyMatrices(_inv, m.matrixWorld) });
    });
    // the car's extent, in its own space
    const box = new THREE.Box3();
    for (const b of bent) { const pos = b.mesh.geometry.getAttribute('position'); for (let i = 0; i < pos.count; i++) box.expandByPoint(_p.fromBufferAttribute(pos, i).applyMatrix4(b.toCar)); }
    obj.userData.box = box;
    obj.userData.bent = bent;
  }
  const box = obj.userData.box as THREE.Box3;
  const [f, r, l, rt] = dmg;
  for (const b of bent) {
    const pos = b.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    _inv.copy(b.toCar).invert();
    _n.setFromMatrix4(_inv);
    for (let i = 0; i < pos.count; i++) {
      _p.set(b.orig[i * 3], b.orig[i * 3 + 1], b.orig[i * 3 + 2]).applyMatrix4(b.toCar);
      const n = 0.65 + 0.7 * noise(_p.x * 3, _p.y * 3, _p.z * 3);
      _d.set(0, 0, 0);
      const wf = Math.max(0, (_p.z - (box.max.z - 1.0)) / 1.0), wr = Math.max(0, ((box.min.z + 0.9) - _p.z) / 0.9);
      const wl = Math.max(0, (_p.x - (box.max.x - 0.45)) / 0.45), wrt = Math.max(0, ((box.min.x + 0.45) - _p.x) / 0.45);
      const mid = Math.max(0, 1 - Math.abs(_p.z) / 1.6);
      _d.z += -f * 0.42 * wf * wf * n + r * 0.36 * wr * wr * n;
      _d.y += -(f * wf + r * wr) * 0.12 * n;
      _d.x += -l * 0.2 * wl * mid * n + rt * 0.2 * wrt * mid * n;
      if (wrecked) _d.y -= 0.06 * Math.max(0, _p.y - 0.9);
      _p.add(_d).applyMatrix4(_inv);
      pos.setXYZ(i, _p.x, _p.y, _p.z);
    }
    pos.needsUpdate = true;
    b.mesh.geometry.computeVertexNormals();
  }
  // smashed headlights and, on a burnt-out car, charred paint and glass
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (!m.userData.ownMat) { m.material = mat.clone(); m.userData.ownMat = true; m.userData.baseColor = (m.material as THREE.MeshStandardMaterial).color.clone(); }
    const own = m.material as THREE.MeshStandardMaterial;
    const light = /^head/.test(m.name) || /^tail/.test(m.name);
    if (wrecked) { own.color.set('#191714'); own.roughness = 1; own.metalness = 0.2; if (own.emissive) own.emissiveIntensity = 0; }
    else if (light && ((/^head/.test(m.name) && f > 0.35) || (/^tail/.test(m.name) && r > 0.35))) { own.color.set('#222'); if (own.emissive) own.emissiveIntensity = 0; }
  });
}
