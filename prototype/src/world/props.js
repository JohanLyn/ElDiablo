import * as THREE from 'three';
import { Rng } from '../core/rng.js';
import { PROP_GEOMETRY } from './models.js';
import { HALF, PLAY_LIMIT, flatSpots } from './layout.js';
import { regionAt, heightAt, roadDistance, isWater, WATER_LEVEL } from './terrain.js';
import { canalDistance } from './canals.js';
import { nearBlocked } from './spots.js';
import { patchLit } from './shaders/lit.js';

// What grows where: [prop, count, collider radius per unit scale, scale range, regions, options]
//   cluster: members per clump   wet: may stand in water   shore: hugs the waterline
//   sway: wind amount            mat: material key         tint: instance colour jitter
const CHUNK = 64;
const SCATTER = [
  ['palm', 90, 0.45, [0.8, 1.3], ['sunfields', 'marsh'], { shadow: true, sway: 0.011, mat: 'leaf' }],
  ['palm', 140, 0.45, [0.85, 1.35], ['sunfields'], { shadow: true, sway: 0.011, mat: 'leaf', cluster: 8, clusterR: 6 }],
  ['wheat', 520, 0, [0.8, 1.3], ['sunfields'], { cluster: 5, sway: 0.1, mat: 'leaf' }],
  ['bush', 380, 0, [0.7, 1.4], ['sunfields', 'marsh', 'ruins'], { tint: 0.18 }],
  ['rock', 420, 0.85, [0.5, 1.8], ['sunfields', 'marsh', 'ruins', 'ashen'], { shadow: true, tint: 0.2 }],
  ['reed', 420, 0, [0.9, 1.4], ['marsh'], { cluster: 6, wet: true, sway: 0.09, mat: 'leaf' }],
  ['reed', 900, 0, [1.0, 1.55], ['marsh'], { cluster: 9, wet: true, shore: true, sway: 0.09, mat: 'leaf', clusterR: 3 }],
  ['deadtree', 170, 0.35, [0.8, 1.4], ['marsh', 'ashen'], { shadow: true }],
  ['column', 70, 0.95, [0.8, 1.2], ['ruins'], { shadow: true, tint: 0.1 }],
  ['columnFallen', 22, -2, [0.9, 1.15], ['ruins'], { shadow: true, fallen: true }],
  ['obelisk', 12, 0.7, [0.8, 1.2], ['ruins'], { shadow: true }],
  ['wallRuin', 70, -1, [0.9, 1.1], ['ruins', 'ashen'], { shadow: true, tint: 0.1 }],
  ['spike', 220, 0.6, [0.7, 1.7], ['ashen'], { shadow: true, mat: 'obsidian' }],
  ['bones', 260, 0, [0.8, 1.4], ['ashen', 'ruins'], { cluster: 4, clusterR: 5 }],
  ['scarecrow', 18, 0.35, [0.95, 1.1], ['sunfields'], { shadow: true, sway: 0.008, mat: 'leaf' }],
  ['sandDrift', 90, 0, [1.5, 3.4], ['ruins'], { drift: true, tint: 0.06 }],
];

export function scatterProps(scene, colliders) {
  const rng = new Rng(4242);
  const flats = flatSpots();
  const blocked = (x, z, pad) => {
    if (roadDistance(x, z) < 4 + pad) return true;
    if (canalDistance(x, z) < 3.6 + pad) return true;
    if (nearBlocked(x, z, pad)) return true;
    for (const f of flats) if (Math.hypot(x - f.x, z - f.z) < f.r + 3 + pad) return true;
    return false;
  };
  const dummy = new THREE.Object3D();
  const tmpCol = new THREE.Color();
  const mats = {
    plain: patchLit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })),
    leaf: patchLit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }), { sway: 1 }),
    obsidian: patchLit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.25, emissive: 0x1c0a38, emissiveIntensity: 0.55 })),
  };
  // Each sway amount needs its own material (the amount is a uniform baked at compile).
  const swayMats = new Map();
  const matFor = (opts) => {
    if (opts.sway) {
      if (!swayMats.has(opts.sway)) swayMats.set(opts.sway, patchLit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }), { sway: opts.sway }));
      return swayMats.get(opts.sway);
    }
    return mats[opts.mat] ?? mats.plain;
  };

  const shoreBand = (x, z) => { const h = heightAt(x, z); return h > WATER_LEVEL - 0.55 && h < WATER_LEVEL + 0.8; };

  for (const [name, count, colR, [smin, smax], regions, opts = {}] of SCATTER) {
    const geo = PROP_GEOMETRY[name]();
    const mat = matFor(opts);
    const chunks = new Map();
    let placed = 0, tries = 0;
    let cx = 0, cz = 0, inCluster = 0;
    const maxTries = count * (opts.shore ? 400 : 40);
    while (placed < count && tries < maxTries) {
      tries++;
      let x, z;
      if (opts.cluster && inCluster > 0) {
        const cr = opts.clusterR ?? 4;
        x = cx + rng.float(-cr, cr); z = cz + rng.float(-cr, cr);
        inCluster--;
      } else {
        x = rng.float(-PLAY_LIMIT + 4, PLAY_LIMIT - 4);
        z = rng.float(-PLAY_LIMIT + 4, PLAY_LIMIT - 4);
        if (!regions.includes(regionAt(x, z))) continue;
        if (opts.shore && !shoreBand(x, z)) continue;
        if (opts.cluster) { cx = x; cz = z; inCluster = opts.cluster; }
      }
      if (!regions.includes(regionAt(x, z))) continue;
      if (blocked(x, z, colR > 0 || colR < 0 ? 2 : 0)) continue;
      const wet = isWater(x, z);
      if (wet && !opts.wet && name !== 'deadtree') continue;
      if (opts.shore && !(wet || shoreBand(x, z) || heightAt(x, z) < WATER_LEVEL + 1.2)) continue;
      const s = rng.float(smin, smax);
      const rot = name === 'wallRuin' ? rng.int(0, 1) * Math.PI / 2 : rng.float(0, Math.PI * 2);
      dummy.position.set(x, heightAt(x, z) - (opts.drift ? 0.12 : 0.05), z);
      dummy.rotation.set(0, rot, 0);
      if (opts.drift) dummy.scale.set(s * rng.float(1.2, 1.9), s * rng.float(0.45, 0.8), s * rng.float(0.7, 1.2));
      else dummy.scale.setScalar(s);
      dummy.updateMatrix();
      const j = opts.tint ?? 0.12;
      const b = 1 + rng.float(-j, j * 0.6), h = rng.float(-1, 1) * j * 0.35;
      const key = `${Math.floor((x + HALF) / CHUNK)},${Math.floor((z + HALF) / CHUNK)}`;
      let ch = chunks.get(key);
      if (!ch) chunks.set(key, (ch = []));
      ch.push({ m: dummy.matrix.clone(), c: [b * (1 + h), b, b * (1 - h)] });
      placed++;
      if (opts.fallen) {
        const ax = Math.cos(rot), az = -Math.sin(rot);
        for (const o of [-3.6, -1.4, 1.0, 3.2]) colliders.addCircle(x + ax * o * s, z + az * o * s, 0.85 * s);
      } else if (colR > 0) colliders.addCircle(x, z, colR * s);
      if (colR < 0 && name === 'wallRuin') {
        // Axis-aligned wall segment (6 x 1.1 at scale 1).
        const hw = (rot === 0 ? 3 : 0.55) * s, hd = (rot === 0 ? 0.55 : 3) * s;
        colliders.addBox(x - hw, z - hd, x + hw, z + hd);
      }
    }
    // One InstancedMesh per 64 m chunk so the camera and shadow frustums can cull them.
    for (const list of chunks.values()) {
      const mesh = new InstancedMeshSafe(geo, mat, list.length);
      mesh.castShadow = !!opts.shadow;
      mesh.receiveShadow = true;
      list.forEach((it, i) => { mesh.setMatrixAt(i, it.m); mesh.setColorAt(i, tmpCol.setRGB(...it.c)); });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      scene.add(mesh);
    }
  }

  // Mountains around the edge of the world, tinted per side.
  const bigGeo = PROP_GEOMETRY.bigRock();
  const ring = new THREE.InstancedMesh(bigGeo, mats.plain, 240);
  let n = 0;
  for (let i = 0; i < 240; i++) {
    const side = i % 4, t = rng.float(-HALF, HALF), off = rng.float(PLAY_LIMIT + 4, HALF);
    const x = side === 0 ? t : side === 1 ? t : side === 2 ? off : -off;
    const z = side === 0 ? off : side === 1 ? -off : t;
    dummy.position.set(x, heightAt(x, z) - 2, z);
    dummy.rotation.set(rng.float(0, 1), rng.float(0, 6), 0);
    dummy.scale.set(rng.float(0.8, 1.8), rng.float(1, 2.6), rng.float(0.8, 1.8));
    dummy.updateMatrix();
    ring.setMatrixAt(n, dummy.matrix);
    const b = rng.float(0.85, 1.1);
    // north: violet basalt, east: sandstone, west: grey-green, south: warm brown
    const c = side === 1 ? [0.62, 0.55, 0.78] : side === 2 ? [1.25, 1.05, 0.8] : side === 3 ? [0.85, 0.95, 0.85] : [1.1, 0.95, 0.85];
    ring.setColorAt(n, tmpCol.setRGB(c[0] * b, c[1] * b, c[2] * b));
    n++;
  }
  ring.count = n;
  ring.computeBoundingSphere();
  scene.add(ring);
}

// InstancedMesh whose colour buffer is pre-allocated so setColorAt never reallocates.
class InstancedMeshSafe extends THREE.InstancedMesh {
  constructor(geo, mat, count) {
    super(geo, mat, count);
    this.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3);
  }
}
