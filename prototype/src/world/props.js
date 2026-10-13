import * as THREE from 'three';
import { Rng } from '../core/rng.js';
import { PROP_GEOMETRY } from './models.js';
import { HALF, PLAY_LIMIT, flatSpots } from './layout.js';
import { regionAt, heightAt, roadDistance, isWater } from './terrain.js';

// What grows where: [prop, count, collider radius per unit scale, scale range, regions, options]
const SCATTER = [
  ['palm', 260, 0.45, [0.8, 1.25], ['sunfields', 'marsh'], { shadow: true }],
  ['wheat', 520, 0, [0.8, 1.3], ['sunfields'], { cluster: 5 }],
  ['bush', 380, 0, [0.7, 1.4], ['sunfields', 'marsh', 'ruins']],
  ['rock', 420, 0.85, [0.5, 1.8], ['sunfields', 'marsh', 'ruins', 'ashen'], { shadow: true }],
  ['reed', 900, 0, [0.8, 1.3], ['marsh'], { cluster: 6, wet: true }],
  ['deadtree', 170, 0.35, [0.8, 1.4], ['marsh', 'ashen'], { shadow: true }],
  ['column', 110, 0.95, [0.8, 1.2], ['ruins'], { shadow: true }],
  ['wallRuin', 70, -1, [0.9, 1.1], ['ruins', 'ashen'], { shadow: true }],
  ['spike', 220, 0.6, [0.7, 1.6], ['ashen'], { shadow: true }],
  ['bones', 200, 0, [0.8, 1.3], ['ashen', 'ruins']],
];

export function scatterProps(scene, colliders) {
  const rng = new Rng(4242);
  const flats = flatSpots();
  const blocked = (x, z, pad) => {
    if (roadDistance(x, z) < 4 + pad) return true;
    for (const f of flats) if (Math.hypot(x - f.x, z - f.z) < f.r + 3 + pad) return true;
    return false;
  };
  const dummy = new THREE.Object3D();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });

  for (const [name, count, colR, [smin, smax], regions, opts = {}] of SCATTER) {
    const geo = PROP_GEOMETRY[name]();
    const mesh = new THREE.InstancedMesh(geo, material, count);
    mesh.castShadow = !!opts.shadow;
    mesh.receiveShadow = true;
    let placed = 0, tries = 0;
    let cx = 0, cz = 0, inCluster = 0;
    while (placed < count && tries < count * 40) {
      tries++;
      let x, z;
      if (opts.cluster && inCluster > 0) {
        x = cx + rng.float(-4, 4); z = cz + rng.float(-4, 4);
        inCluster--;
      } else {
        x = rng.float(-PLAY_LIMIT + 4, PLAY_LIMIT - 4);
        z = rng.float(-PLAY_LIMIT + 4, PLAY_LIMIT - 4);
        if (opts.cluster) { cx = x; cz = z; inCluster = opts.cluster; }
      }
      if (!regions.includes(regionAt(x, z))) continue;
      if (blocked(x, z, colR > 0 ? 2 : 0)) continue;
      const wet = isWater(x, z);
      if (wet && !opts.wet && name !== 'deadtree') continue;
      const s = rng.float(smin, smax);
      const rot = name === 'wallRuin' ? rng.int(0, 1) * Math.PI / 2 : rng.float(0, Math.PI * 2);
      dummy.position.set(x, heightAt(x, z) - 0.05, z);
      dummy.rotation.set(0, rot, 0);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      mesh.setMatrixAt(placed++, dummy.matrix);
      if (colR > 0) colliders.addCircle(x, z, colR * s);
      if (colR < 0) {
        // Axis-aligned wall segment (6 x 1.1 at scale 1).
        const hw = (rot === 0 ? 3 : 0.55) * s, hd = (rot === 0 ? 0.55 : 3) * s;
        colliders.addBox(x - hw, z - hd, x + hw, z + hd);
      }
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }

  // Mountains around the edge of the world.
  const bigGeo = PROP_GEOMETRY.bigRock();
  const ring = new THREE.InstancedMesh(bigGeo, material, 240);
  let n = 0;
  for (let i = 0; i < 240; i++) {
    const side = i % 4, t = rng.float(-HALF, HALF), off = rng.float(PLAY_LIMIT + 4, HALF);
    const x = side === 0 ? t : side === 1 ? t : side === 2 ? off : -off;
    const z = side === 0 ? off : side === 1 ? -off : t;
    dummy.position.set(x, heightAt(x, z) - 2, z);
    dummy.rotation.set(rng.float(0, 1), rng.float(0, 6), 0);
    dummy.scale.set(rng.float(0.8, 1.8), rng.float(1, 2.6), rng.float(0.8, 1.8));
    dummy.updateMatrix();
    ring.setMatrixAt(n++, dummy.matrix);
  }
  ring.count = n;
  ring.computeBoundingSphere();
  scene.add(ring);
}
