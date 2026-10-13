import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Build one vertex-coloured geometry from primitive parts so a whole prop can be
// drawn with a single InstancedMesh.
export function part(geo, color, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.deleteAttribute('uv');
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
  g.applyMatrix4(m);
  const c = new THREE.Color(color);
  const cols = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < cols.length; i += 3) { cols[i] = c.r; cols[i + 1] = c.g; cols[i + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g;
}

export const merge = (parts) => mergeGeometries(parts, false);

const cyl = (rt, rb, h, s = 6) => new THREE.CylinderGeometry(rt, rb, h, s);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

export const PROP_GEOMETRY = {
  palm() {
    const parts = [part(cyl(0.16, 0.3, 5.2, 6), 0x7a5a3a, { y: 2.6, rz: 0.06 })];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      parts.push(part(box(0.5, 0.06, 2.8), 0x4c7a30, { x: Math.sin(a) * 1.2, y: 5.0, z: Math.cos(a) * 1.2, ry: a, rx: 0.42 }));
    }
    parts.push(part(new THREE.SphereGeometry(0.3, 6, 4), 0x6a4a22, { y: 5.0 }));
    return merge(parts);
  },
  wheat() {
    const parts = [];
    for (let i = 0; i < 9; i++) parts.push(part(box(0.08, 0.9, 0.08), i % 3 ? 0xd8b85a : 0xc9a443, { x: (i % 3 - 1) * 0.3, y: 0.45, z: (Math.floor(i / 3) - 1) * 0.3, rz: (i % 2 - 0.5) * 0.2 }));
    return merge(parts);
  },
  bush() {
    return merge([part(new THREE.IcosahedronGeometry(0.9, 0), 0x5b6e33, { y: 0.45, sy: 0.65 }), part(new THREE.IcosahedronGeometry(0.6, 0), 0x6b7e3b, { x: 0.5, y: 0.5, sy: 0.7 })]);
  },
  rock() {
    return merge([part(new THREE.DodecahedronGeometry(1, 0), 0x7a6d60, { y: 0.35, sy: 0.65 })]);
  },
  reed() {
    const parts = [];
    for (let i = 0; i < 8; i++) {
      const a = i * 2.4, r = 0.25 + (i % 3) * 0.12, h = 1.6 + (i % 4) * 0.25;
      parts.push(part(cyl(0.025, 0.04, h, 4), 0x7d8a3c, { x: Math.sin(a) * r, y: h / 2, z: Math.cos(a) * r, rx: Math.sin(a) * 0.1 }));
      if (i % 2) parts.push(part(cyl(0.06, 0.06, 0.3, 5), 0x5a3a22, { x: Math.sin(a) * r, y: h - 0.1, z: Math.cos(a) * r }));
    }
    return merge(parts);
  },
  deadtree() {
    return merge([
      part(cyl(0.12, 0.3, 4, 5), 0x3d332c, { y: 2 }),
      part(cyl(0.05, 0.1, 1.8, 4), 0x3d332c, { x: 0.5, y: 3.2, rz: -0.9 }),
      part(cyl(0.05, 0.1, 1.5, 4), 0x3d332c, { x: -0.4, y: 2.6, rz: 0.8 }),
      part(cyl(0.04, 0.08, 1.2, 4), 0x3d332c, { z: 0.4, y: 3.6, rx: 0.8 }),
    ]);
  },
  column() {
    return merge([
      part(box(1.9, 0.4, 1.9), 0xc2a77a, { y: 0.2 }),
      part(cyl(0.7, 0.8, 3, 8), 0xd9c49a, { y: 1.9 }),
      part(cyl(0.55, 0.7, 0.6, 8), 0xd9c49a, { y: 3.5, rz: 0.25, x: 0.1 }),
    ]);
  },
  wallRuin() {
    return merge([
      part(box(6, 2.2, 1.1), 0xc9a877, { y: 1.1 }),
      part(box(2, 0.9, 1.15), 0xb8955f, { x: -1.5, y: 2.6 }),
      part(box(0.9, 0.4, 1.15), 0xb8955f, { x: 1.8, y: 2.4 }),
    ]);
  },
  spike() {
    return merge([part(new THREE.ConeGeometry(0.6, 3.2, 5), 0x2b2233, { y: 1.6 }), part(new THREE.ConeGeometry(0.35, 1.8, 5), 0x3a2c44, { x: 0.6, y: 0.9, rz: -0.35 })]);
  },
  bones() {
    return merge([
      part(cyl(0.05, 0.05, 1.0, 4), 0xddd6c4, { y: 0.06, rz: Math.PI / 2 }),
      part(cyl(0.05, 0.05, 0.8, 4), 0xddd6c4, { y: 0.06, rz: Math.PI / 2, ry: 1.1, z: 0.3 }),
      part(new THREE.SphereGeometry(0.2, 6, 4), 0xe8e0cc, { x: 0.5, y: 0.18, z: -0.2 }),
    ]);
  },
  bigRock() {
    return merge([part(new THREE.DodecahedronGeometry(6, 0), 0x6f6156, { y: 1, sy: 1.1 })]);
  },
};

// A simple robed humanoid for NPCs.
export function makeNpc({ robe = 0x8a3a2a, trim = 0xd6a740, skin = 0xc98f62, hat = null } = {}) {
  const g = new THREE.Group();
  const robeMat = new THREE.MeshStandardMaterial({ color: robe, roughness: 0.8 });
  const trimMat = new THREE.MeshStandardMaterial({ color: trim, roughness: 0.4, metalness: 0.6 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.7, 10), robeMat);
  body.position.y = 0.85;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), skinMat);
  head.position.y = 1.9;
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.04, 6, 14), trimMat);
  belt.rotation.x = Math.PI / 2;
  belt.position.y = 1.1;
  g.add(body, head, belt);
  if (hat === 'crown') {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.3, 8), trimMat);
    c.position.y = 2.2;
    g.add(c);
  } else if (hat === 'turban') {
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.1, 6, 12), robeMat);
    t.rotation.x = Math.PI / 2;
    t.position.y = 2.08;
    g.add(t);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export function makeWaypoint() {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0x8c7f70, roughness: 0.9 });
  const lapis = new THREE.MeshStandardMaterial({ color: 0x1d3b8c, roughness: 0.35, metalness: 0.2, emissive: 0x000000 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3, 0.4, 8), stone);
  base.position.y = 0.2;
  const ob = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 3.6, 4), lapis);
  ob.position.y = 2.2;
  ob.rotation.y = Math.PI / 4;
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x3a64c8, transparent: true, opacity: 0.25 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.06, 6, 40), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.45;
  g.add(base, ob, ring);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData = { lapis, ringMat };
  return g;
}

export function makeShrine(color) {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0xb59a74, roughness: 0.9 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.0, 1.8), stone);
  base.position.y = 0.5;
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.4, 0.4, 10), new THREE.MeshStandardMaterial({ color: 0xd6a740, metalness: 0.8, roughness: 0.3 }));
  bowl.position.y = 1.2;
  const flameMat = new THREE.MeshBasicMaterial({ color });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.1, 8), flameMat);
  flame.position.y = 1.9;
  g.add(base, bowl, flame);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData = { flame, flameMat };
  return g;
}

export function makeChest(tier) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: tier >= 3 ? 0x3a2a4a : 0x6a4426, roughness: 0.8 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd6a740, metalness: 0.85, roughness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 0.9), wood);
  body.position.y = 0.4;
  const lid = new THREE.Group();
  lid.position.set(0, 0.8, -0.45);
  const lidMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.4, 8, 1, false, 0, Math.PI), wood);
  lidMesh.rotation.z = Math.PI / 2;
  lidMesh.position.z = 0.45;
  lid.add(lidMesh);
  const band = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.12, 0.95), gold);
  band.position.y = 0.55;
  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.25, 0.08), gold);
  lock.position.set(0, 0.7, 0.47);
  g.add(body, lid, band, lock);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData = { lid };
  return g;
}

export function makeHouse(w, d, h, rng) {
  const g = new THREE.Group();
  const wall = new THREE.MeshStandardMaterial({ color: 0xb98d60, roughness: 0.95 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 1 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wall);
  body.position.y = h / 2;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.3, d + 0.4), new THREE.MeshStandardMaterial({ color: 0x9a7048, roughness: 1 }));
  roof.position.y = h + 0.15;
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.9, 0.1), dark);
  door.position.set(0, 0.95, d / 2 + 0.03);
  g.add(body, roof, door);
  // Roof beams sticking out (typical mud-brick detail).
  for (let i = 0; i < Math.floor(w / 1.2); i++) {
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.6, 4), dark);
    beam.rotation.x = Math.PI / 2;
    beam.position.set(-w / 2 + 0.6 + i * 1.2, h - 0.3, d / 2 + 0.25);
    g.add(beam);
  }
  if (rng.chance(0.5)) {
    const awning = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, 0.06, 1.4), new THREE.MeshStandardMaterial({ color: rng.pick([0x8a2a2a, 0x2a4f8a, 0x8a6a2a]), roughness: 0.9 }));
    awning.position.set(0, 2.4, d / 2 + 0.7);
    awning.rotation.x = 0.25;
    g.add(awning);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

export function makeGate() {
  const g = new THREE.Group();
  const brick = new THREE.MeshStandardMaterial({ color: 0x7a5236, roughness: 1 });
  const lapis = new THREE.MeshStandardMaterial({ color: 0x1d3b8c, roughness: 0.35, metalness: 0.25 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd6a740, roughness: 0.3, metalness: 0.8 });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  for (const sx of [-1, 1]) {
    add(new THREE.BoxGeometry(4, 12, 4), brick, sx * 7, 6, 0);
    add(new THREE.BoxGeometry(4.3, 0.5, 4.3), gold, sx * 7, 12.2, 0);
    for (let k = 0; k < 5; k++) add(new THREE.BoxGeometry(4.08, 0.4, 4.08), lapis, sx * 7, 1.6 + k * 2.2, 0);
    add(new THREE.BoxGeometry(16, 8, 3), brick, sx * 16, 4, 0.5);
  }
  add(new THREE.BoxGeometry(18, 2.6, 4), brick, 0, 12.6, 0);
  add(new THREE.BoxGeometry(18.2, 0.6, 4.2), lapis, 0, 11.2, 0);
  const portalMat = new THREE.MeshBasicMaterial({ color: 0x5a2bd8, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const portal = add(new THREE.PlaneGeometry(10, 11), portalMat, 0, 5.5, 0);
  portal.castShadow = false;
  // Stairs leading down into the gate.
  for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(9, 0.3, 1.2), brick, 0, 0.15 + i * 0.05, 3 + i * 1.2).position.y = 0.3 - i * 0.07;
  g.userData = { portalMat };
  return g;
}
